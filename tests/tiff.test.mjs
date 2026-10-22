import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { tiffPages } from "../src/pdf/tiff.js";
import { deflateTiffFixture } from "./helpers/tiff.mjs";

const context = vm.createContext({});
context.self = context;
for (const path of ["pako/3.0.2/pako.umd.min.js", "utif/3.1.0/UTIF.js"])
  vm.runInContext(await readFile(new URL(`../vendor/${path}`, import.meta.url), "utf8"), context);

function decode(bytes) {
  const pages = tiffPages(bytes);
  context.UTIF.decodeImage(bytes.buffer, pages[0], pages);
  return pages[0];
}

test("TIFF-Deflate dekodiert Strips, letzte Teil-Strips und gepolsterte Tiles", () => {
  for (const options of [
    {},
    { width: 100, height: 100 },
    { compression: 32946 },
    { height: 5, rows: 2 },
    { width: 17, height: 19, tile: [16, 16] },
    { channels: 1, bits: [1], width: 8, height: 2, tile: [3, 2] },
  ]) {
    const page = decode(deflateTiffFixture(options));
    const channels = options.channels ?? 3, bits = options.bits?.[0] ?? 8;
    assert.equal(page.data.length, Math.ceil(page.width * channels * bits / 8) * page.height);
    if (bits === 8) assert.ok(page.data.every((value) => value === 42));
  }
});

test("TIFF-Deflate stoppt eine Speicherbombe beim ersten überlangen Ausgabeblock", () => {
  const bytes = deflateTiffFixture({ block: () => new Uint8Array(8 * 1024 ** 2) });
  assert.ok(bytes.length < 9000);
  const push = context.pako.Inflate.prototype.push;
  let emitted = 0;
  context.pako.Inflate.prototype.push = function (...args) {
    const onData = this.onData;
    this.onData = (chunk) => { emitted += chunk.length; onData(chunk); };
    return push.apply(this, args);
  };
  try {
    assert.throws(() => decode(bytes), /überschreiten/);
    assert.equal(emitted, 19);
  } finally {
    context.pako.Inflate.prototype.push = push;
  }
});

test("TIFF-Deflate lehnt falsche Längen, defekte Streams und den Rohdaten-Kurzschluss ab", () => {
  for (const options of [
    { block: (size) => new Uint8Array(size + 1) },
    { block: (size) => new Uint8Array(size - 1) },
    { height: 5, rows: 2, block: (size, index) => new Uint8Array(size + (index === 0 ? 1 : 0)) },
    { height: 5, rows: 2, block: (size, index) => new Uint8Array(size + (index === 2 ? 1 : 0)) },
    { width: 17, height: 19, tile: [16, 16], block: (size) => new Uint8Array(size + 1) },
    { packed: (bytes) => bytes.subarray(0, bytes.length - 1) },
    { packed: (bytes) => { bytes[bytes.length - 1] ^= 255; return bytes; } },
    { packed: () => new Uint8Array(18) },
  ]) assert.throws(() => decode(deflateTiffFixture(options)), /TIFF/);
});

test("TIFF prüft Kanalzahl und Bittiefen vor dem Dekodieren", () => {
  for (const options of [
    { channels: 0, bits: [8] },
    { channels: 5 },
    { bits: [8] },
    { bits: [8, 16, 8] },
    { bits: [8, 8, 8, 8, 8] },
  ]) assert.throws(() => tiffPages(deflateTiffFixture(options)), /beschädigt/);
});
