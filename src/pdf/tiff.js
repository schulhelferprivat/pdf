import { limits } from "../core/model.js";
import { pdfLib } from "./vendors.js";
import { drawImagePage } from "./engine.js";

export function tiffPages(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[0] === 73 && bytes[1] === 73;
  const fail = () => { throw new Error("Die TIFF-Datei ist beschädigt oder verwendet eine nicht unterstützte Variante."); };
  if (bytes.length < 8 || (!little && !(bytes[0] === 77 && bytes[1] === 77)) || view.getUint16(2, little) !== 42) fail();
  let offset = view.getUint32(4, little);
  const seen = new Set(), pages = [];
  while (offset) {
    if (seen.has(offset) || offset + 2 > bytes.length) fail();
    seen.add(offset);
    const count = view.getUint16(offset, little);
    if (offset + 2 + count * 12 + 4 > bytes.length) fail();
    const page = {};
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12;
      const tag = view.getUint16(entry, little), type = view.getUint16(entry + 2, little);
      const length = view.getUint32(entry + 4, little);
      const size = { 1: 1, 3: 2, 4: 4, 7: 1, 9: 4 }[type];
      if (!size) continue;
      const position = length * size <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
      if (length * size > bytes.length || position + length * size > bytes.length) fail();
      if (![254,255,256,257,258,259,262,266,273,274,277,278,279,284,292,293,317,320,322,323,324,325,338,339,347,512,513,514,515,517,518,519,520,521].includes(tag)) continue;
      if ([256,257,259,262,266,274,277,278,284,317,322,323].includes(tag) && length !== 1) fail();
      if ([258,339].includes(tag) && (length < 1 || length > 4)) fail();
      page[`t${tag}`] = Array.from({ length }, (_, item) => {
        const start = position + item * size;
        return size === 1 ? view.getUint8(start) : size === 2 ? view.getUint16(start, little) : type === 9 ? view.getInt32(start, little) : view.getUint32(start, little);
      });
    }
    offset = view.getUint32(offset + 2 + count * 12, little);
    if ((page.t254?.[0] & 5) || page.t255?.[0] === 2) continue;
    const width = page.t256?.[0], height = page.t257?.[0];
    if (!(width > 0 && height > 0) || width * height > limits.imagePixels)
      throw new Error("Eine TIFF-Seite ist ungültig oder hat mehr als 48 Megapixel.");
    const channels = page.t277?.[0] ?? 1;
    if (channels < 1 || channels > 4 ||
        (page.t258 && (page.t258.length !== channels || page.t258.some((bits) => bits !== page.t258[0])))) fail();
    if (page.t259?.[0] === 32946) page.t259[0] = 8;
    if (![1,3,4,5,6,7,8,32773].includes(page.t259?.[0] ?? 1) ||
        page.t284?.[0] === 2 || (page.t277?.[0] ?? 1) > 4 ||
        (page.t258 ?? [1]).some((bits) => ![1,2,4,8,16].includes(bits)) ||
        (page.t339 ?? [1]).some((format) => format !== 1) ||
        ![0,1,2,3,5,6].includes(page.t262?.[0] ?? -1)) fail();
    const offsets = page.t273 ?? page.t324, sizes = page.t279 ?? page.t325;
    if (!offsets?.length || !sizes || offsets.length !== sizes.length ||
        offsets.some((start, index) => start < 0 || !(sizes[index] > 0) || start + sizes[index] > bytes.length)) fail();
    if (page.t322 && (!(page.t322[0] > 0 && page.t323?.[0] > 0) || page.t322[0] * page.t323[0] > limits.imagePixels)) fail();
    if (page.t278 && !(page.t278[0] > 0)) fail();
    if (page.t259?.[0] === 8) {
      const count = page.t322
        ? Math.ceil(width / page.t322[0]) * Math.ceil(height / page.t323[0])
        : Math.ceil(height / (page.t278?.[0] ?? height));
      if (offsets.length !== count || (page.t322 && (page.t273 || page.t279))) fail();
    }
    pages.push(page);
    if (pages.length > limits.pages) throw new Error("Die TIFF-Datei enthält mehr als 500 Seiten.");
  }
  if (!pages.length) fail();
  return pages;
}

export async function tiffPdf(bytes, progress) {
  const pages = tiffPages(bytes);
  await import("../../vendor/pako/3.0.2/pako.umd.min.js");
  await import("../../vendor/utif/3.1.0/UTIF.js");
  const lib = await pdfLib(), doc = await lib.PDFDocument.create();
  for (const [index, page] of pages.entries()) {
    globalThis.UTIF.decodeImage(bytes.buffer, page, pages);
    const rgba = globalThis.UTIF.toRGBA8(page);
    if (rgba.length !== page.width * page.height * 4) throw new Error("Die TIFF-Seite konnte nicht dekodiert werden.");
    const orientation = page.t274?.[0] ?? 1;
    if (orientation < 1 || orientation > 8) throw new Error("Die TIFF-Ausrichtung ist ungültig.");
    const width = page.width, height = page.height;
    const source = new OffscreenCanvas(width, height);
    source.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width, height), 0, 0);
    const canvas = new OffscreenCanvas(orientation >= 5 ? height : width, orientation >= 5 ? width : height);
    const transforms = [
      [1,0,0,1,0,0], [-1,0,0,1,width,0], [-1,0,0,-1,width,height], [1,0,0,-1,0,height],
      [0,1,1,0,0,0], [0,1,-1,0,height,0], [0,-1,-1,0,height,width], [0,-1,1,0,0,width],
    ];
    const context = canvas.getContext("2d");
    context.setTransform(...transforms[orientation - 1]);
    context.drawImage(source, 0, 0);
    const png = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    drawImagePage(doc, await doc.embedPng(png));
    source.width = source.height = canvas.width = canvas.height = 0;
    delete page.data;
    progress((index + 1) / pages.length);
  }
  return { data: await doc.save() };
}
