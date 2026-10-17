import { limits } from "./model.js";
import { epubDirectory } from "./archive.js";
export const fileTypes = Object.freeze({
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/tiff": [".tif", ".tiff"],
  "image/svg+xml": [".svg"],
  "application/epub+zip": [".epub"],
});
export const fileAccept = Object.entries(fileTypes).flatMap(([mime, extensions]) => [mime, ...extensions]).join(",");
export function fileExtension(name, fallback = ".pdf") {
  return /\.(pdf|jpe?g|png|webp|tiff?|svg|epub)$/i.exec(name)?.[0] ?? fallback;
}
export function documentName(name) {
  return name.slice(0, name.length - fileExtension(name, "").length);
}
export function readBytes(file, { signal, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Abgebrochen", "AbortError"));
      return;
    }
    const abort = () => finish(new DOMException("Abgebrochen", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(new Error("Die Datei konnte nicht rechtzeitig gelesen werden.")),
      timeoutMs,
    );
    function finish(error, value) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    }
    signal?.addEventListener("abort", abort, { once: true });
    file.arrayBuffer().then(
      (buffer) => finish(null, new Uint8Array(buffer)),
      (error) => finish(error),
    );
  });
}
export async function validateFile(file) {
  if (!file.size) throw new Error("Die Datei ist leer.");
  const header = await readBytes(file.slice(0, 64));
  if (
    header[0] === 37 &&
    header[1] === 80 &&
    header[2] === 68 &&
    header[3] === 70 &&
    header[4] === 45
  ) {
    if (file.size > limits.pdfBytes)
      throw new Error("Die PDF ist größer als 100 MiB.");
    return "application/pdf";
  }
  if (header[0] === 80 && header[1] === 75 && header[2] === 3 && header[3] === 4) {
    if (file.size > limits.pdfBytes) throw new Error("Die EPUB-Datei ist größer als 100 MiB.");
    epubDirectory(await readBytes(file));
    return "application/epub+zip";
  }
  if (file.size > limits.imageBytes)
    throw new Error("Das Bild ist größer als 25 MiB.");
  let mime;
  if (
    header[0] === 137 &&
    header[1] === 80 &&
    header[2] === 78 &&
    header[3] === 71
  )
    mime = "image/png";
  else if (header[0] === 255 && header[1] === 216) mime = "image/jpeg";
  else if (new TextDecoder().decode(header.subarray(0, 4)) === "RIFF" &&
           new TextDecoder().decode(header.subarray(8, 12)) === "WEBP") mime = "image/webp";
  else if ((header[0] === 73 && header[1] === 73 && header[2] === 42 && header[3] === 0) ||
           (header[0] === 77 && header[1] === 77 && header[2] === 0 && header[3] === 42)) return "image/tiff";
  else if (/^\s*</.test(new TextDecoder().decode(header))) {
    svgImage(await file.text());
    return "image/svg+xml";
  }
  else
    throw new Error("Bitte eine gültige PDF-, JPG-, PNG-, WebP-, TIFF-, SVG- oder EPUB-Datei auswählen.");
  if (file.size > limits.imageBytes)
    throw new Error("Das Bild ist größer als 25 MiB.");
  const data = await readBytes(file);
  const view = new DataView(data.buffer);
  let width = 0,
    height = 0;
  if (mime === "image/png") {
    if (data.length < 24) throw new Error("Die PNG-Datei ist unvollständig.");
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (mime === "image/webp") {
    if (data.length < 25 || view.getUint32(4, true) + 8 !== data.length)
      throw new Error("Die WebP-Datei ist unvollständig.");
    const format = new TextDecoder().decode(data.subarray(12, 16));
    if (format === "VP8X" && data.length >= 30) {
      width = 1 + data[24] + (data[25] << 8) + (data[26] << 16);
      height = 1 + data[27] + (data[28] << 8) + (data[29] << 16);
    } else if (format === "VP8L" && data[20] === 47) {
      width = 1 + (view.getUint32(21, true) & 0x3fff);
      height = 1 + ((view.getUint32(21, true) >>> 14) & 0x3fff);
    } else if (format === "VP8 " && data.length >= 30 && data[23] === 157 && data[24] === 1 && data[25] === 42) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    }
  } else {
    let offset = 2;
    while (offset + 4 < data.length) {
      if (data[offset] !== 255) {
        offset++;
        continue;
      }
      while (data[offset] === 255) offset++;
      const marker = data[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 216 || (marker >= 208 && marker <= 215) || marker === 1)
        continue;
      if (offset + 2 > data.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > data.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        if (size < 8) break;
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += size;
    }
  }
  if (!width || !height || width * height > limits.imagePixels)
    throw new Error("Das Bild ist ungültig oder hat mehr als 48 Megapixel.");
  return mime;
}
export async function decodeImage(file) {
  const mime = await validateFile(file);
  if (!mime.startsWith("image/") || mime === "image/tiff")
    throw new Error("Bitte ein JPG-, PNG-, WebP- oder SVG-Bild auswählen.");
  let bitmap;
  if (mime === "image/svg+xml") {
    const svg = svgImage(await file.text());
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: mime }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      bitmap = await createImageBitmap(image);
    } finally {
      URL.revokeObjectURL(url);
    }
  } else bitmap = await createImageBitmap(new Blob([file], { type: mime }));
  if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > limits.imagePixels) {
    bitmap.close();
    throw new Error("Das Bild ist ungültig oder hat mehr als 48 Megapixel.");
  }
  return { mime, bitmap, width: bitmap.width, height: bitmap.height };
}
export async function normalizeImage(file) {
  const image = await decodeImage(file);
  const mime = image.mime === "image/jpeg" ? image.mime : "image/png";
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  try {
    canvas.getContext("2d").drawImage(image.bitmap, 0, 0);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Das Bild konnte nicht gelesen werden.")),
        mime,
        0.95,
      ),
    );
    return {
      ...image,
      mime,
      file: new File([blob], file.name, { type: mime }),
    };
  } catch (error) {
    image.bitmap.close();
    throw error;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
function svgImage(text) {
  const xml = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = xml.documentElement;
  if (xml.querySelector("parsererror") || svg.localName !== "svg" || svg.namespaceURI !== "http://www.w3.org/2000/svg")
    throw new Error("Die SVG-Datei ist ungültig.");
  const box = svg.viewBox.baseVal;
  const width = svg.width.baseVal.value || box.width || 300;
  const height = svg.height.baseVal.value || box.height || 150;
  if (!(width > 0 && height > 0) || !Number.isFinite(width * height) || Math.ceil(width) * Math.ceil(height) > limits.imagePixels)
    throw new Error("Das Bild ist ungültig oder hat mehr als 48 Megapixel.");
  svg.setAttribute("width", Math.ceil(width));
  svg.setAttribute("height", Math.ceil(height));
  return svg;
}
