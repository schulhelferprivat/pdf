import { limits } from "./model.js";

export function epubDirectory(bytes) {
  const fail = () => {
    throw new Error("Die EPUB-Datei ist beschädigt oder verwendet ein nicht unterstütztes ZIP-Format.");
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--)
    if (view.getUint32(end, true) === 0x06054b50 &&
        end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  if (end < Math.max(0, bytes.length - 65557)) fail();
  const count = view.getUint16(end + 10, true);
  const start = view.getUint32(end + 16, true);
  if (view.getUint32(end + 4, true) || view.getUint16(end + 8, true) !== count ||
      count === 65535 || start + view.getUint32(end + 12, true) !== end) fail();
  let offset = start, total = 0;
  const entries = new Map();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) fail();
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 24, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > end || size === 0xffffffff || compressed === 0xffffffff) fail();
    if (flags & 1) throw new Error("Verschlüsselte EPUB-Dateien werden nicht unterstützt.");
    if (![0, 8].includes(compression)) fail();
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!name || name.startsWith("/") || /[\\\x00-\x1f]/.test(name) || name.split("/").includes("..") || entries.has(name)) fail();
    total += size;
    if (total > limits.totalBytes) throw new Error("Die entpackte EPUB-Datei ist größer als 150 MiB.");
    const local = view.getUint32(offset + 42, true);
    if (local + 30 > start || view.getUint32(local, true) !== 0x04034b50) fail();
    if (view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== compression) fail();
    const dataOffset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (dataOffset + compressed > start) fail();
    entries.set(name, { size, compressed, compression, dataOffset });
    offset = next;
  }
  if (offset !== end) fail();
  const mime = entries.get("mimetype");
  if (!mime || mime.compression || mime.size !== 20 || mime.compressed !== 20 ||
      decoder.decode(bytes.subarray(mime.dataOffset, mime.dataOffset + 20)) !== "application/epub+zip" ||
      !entries.has("META-INF/container.xml"))
    throw new Error("Das ZIP-Archiv ist keine gültige EPUB-Datei.");
  return entries;
}
