let library;
export async function pdfLib() {
  if (!library)
    library = import("../../vendor/cantoo-pdf-lib/2.11.1/pdf-lib.min.js").then(
      () => globalThis.PDFLib,
    );
  return library;
}
let kit;
export async function fontkit() {
  if (!kit)
    kit = import("../../vendor/fontkit/2.0.12/fontkit.mjs").then(
      (module) => module.default,
    );
  return kit;
}
let renderer;
export async function pdfJs() {
  if (!renderer)
    renderer = import("../../vendor/pdfjs-dist/6.4.299/build/pdf.mjs").then(
      (lib) => {
        lib.GlobalWorkerOptions.workerSrc = new URL(
          "../../vendor/pdfjs-dist/6.4.299/build/pdf.worker.mjs",
          import.meta.url,
        ).href;
        return lib;
      },
    );
  return renderer;
}
export function renderOptions() {
  return {
    cMapUrl: new URL("../../vendor/pdfjs-dist/6.4.299/cmaps/", import.meta.url)
      .href,
    cMapPacked: true,
    standardFontDataUrl: new URL(
      "../../vendor/pdfjs-dist/6.4.299/standard_fonts/",
      import.meta.url,
    ).href,
    wasmUrl: new URL("../../vendor/pdfjs-dist/6.4.299/wasm/", import.meta.url)
      .href,
    iccUrl: new URL("../../vendor/pdfjs-dist/6.4.299/iccs/", import.meta.url)
      .href,
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: true,
  };
}
