import test from "node:test";
import assert from "node:assert/strict";
import { validateFile, fileTypes, fileExtension, documentName } from "../src/core/files.js";
import { tiffPages } from "../src/pdf/tiff.js";
import { tiffFixture } from "./helpers/formats.mjs";

test("Dateitypen, Endungen und Namen berücksichtigen alle Eingabeformate", async () => {
  assert.equal(documentName("Abbildung.TIFF"), "Abbildung");
  assert.equal(documentName("Buch.EPUB"), "Buch");
  assert.equal(documentName("Ohne-Endung"), "Ohne-Endung");
  assert.equal(fileExtension("Abbildung.JpEg"), ".JpEg");
  assert.deepEqual(fileTypes["image/tiff"], [".tif", ".tiff"]);
  assert.equal(await validateFile(new File([tiffFixture()], "falsche.pdf")), "image/tiff");
  await assert.rejects(validateFile(new File(["ungültig"], "falsch.webp", { type: "image/webp" })), /gültige/);
  await assert.rejects(validateFile(new File([], "leer.svg")), /leer/);
  await assert.rejects(validateFile({ size: 101 * 1024 ** 2, slice: () => new Blob([new Uint8Array([80,75,3,4])]) }), /100 MiB/);
});

test("TIFF erkennt Hauptseiten, Byte-Reihenfolge, Ausrichtung und beschädigte Verzeichnisse", () => {
  for (const little of [true, false]) {
    const pages = tiffPages(tiffFixture({ little }));
    assert.equal(pages.length, 2);
    assert.deepEqual(pages.map((page) => page.t274[0]), [1, 6]);
    assert.deepEqual(pages.map((page) => page.t256[0]), [3, 3]);
  }
  const cyclic = tiffFixture();
  new DataView(cyclic.buffer).setUint32(8 + 2 + 12 * 12, 8, true);
  assert.throws(() => tiffPages(cyclic), /beschädigt/);
  assert.throws(() => tiffPages(tiffFixture({ compression: 999 })), /nicht unterstützte/);
  const large = tiffFixture();
  new DataView(large.buffer).setUint32(8 + 2 + 12 + 8, 100000000, true);
  assert.throws(() => tiffPages(large), /Megapixel/);
  assert.throws(() => tiffPages(tiffFixture().subarray(0, 30)), /beschädigt/);
  assert.throws(() => tiffPages(tiffFixture({ orientations: Array(501).fill(1), thumbnail: false })), /500 Seiten/);
});
