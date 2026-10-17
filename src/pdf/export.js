import { readBytes } from "../core/files.js";
import { processPdf } from "./client.js";
import { pdfJs, renderOptions } from "./vendors.js";
import { safeName, splitGroups, limits } from "../core/model.js";
import { fitSize } from "../core/geometry.js";
const urls = new Set();
export function blobUrl(blob) {
  const url = URL.createObjectURL(blob);
  urls.add(url);
  return url;
}
export function releaseUrl(url) {
  URL.revokeObjectURL(url);
  urls.delete(url);
}
export async function payloadFor(
  document,
  pages,
  sources,
  assets,
  options,
  signal,
) {
  const sourceIds = new Set(pages.map((page) => page.sourceId).filter(Boolean));
  const imageIds = new Set(
    pages.flatMap((page) =>
      page.elements.filter((el) => el.type === "image").map((el) => el.assetId),
    ),
  );
  const bytes = [...sourceIds].reduce(
    (total, id) => total + sources.get(id).file.size,
    0,
  );
  if (bytes > limits.totalBytes)
    throw new Error(
      "Die Quelldateien dieser Auswahl sind zusammen größer als 150 MiB.",
    );
  return {
    document: { pages, formValues: document.formValues },
    options,
    sources: await Promise.all(
      [...sourceIds].map(async (id) => ({
        id,
        password: sources.get(id).password,
        data: await readBytes(sources.get(id).file, { signal }),
      })),
    ),
    images: await Promise.all(
      [...imageIds].map(async (id) => ({
        id,
        mime: assets.get(id).mime,
        bytes: await readBytes(assets.get(id).file, { signal }),
      })),
    ),
  };
}
export async function buildPdf(document, pages, sources, assets, options, job) {
  const payload = await payloadFor(
    document,
    pages,
    sources,
    assets,
    options,
    job?.signal,
  );
  if (job?.signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
  return processPdf("assemble", payload, job);
}
export async function download(blob, name, { share = false, signal } = {}) {
  if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
  if (
    share &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) &&
        navigator.maxTouchPoints > 1)) &&
    navigator.share &&
    navigator.canShare
  ) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return true;
      } catch (error) {
        if (error.name === "AbortError") return false;
      }
    }
  }
  const url = blobUrl(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => releaseUrl(url), 120000);
  return true;
}
export async function zipOutputs(outputs, name, signal, progress) {
  await import("../../vendor/jszip/3.10.2/jszip.min.js");
  const archive = new globalThis.JSZip();
  for (const output of outputs)
    archive.file(output.name, output.blob || output.data);
  const data = await archive.generateAsync(
    { type: "blob", compression: "STORE" },
    (event) => {
      if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
      progress?.(event.percent / 100);
    },
  );
  return download(data, safeName(name, "zip"), { signal });
}
export async function renderOutput(
  data,
  {
    dpi = 150,
    quality = 0.9,
    format = "png",
    signal,
    progress,
    maxPixels = 16_000_000,
  } = {},
) {
  const lib = await pdfJs();
  const task = lib.getDocument({ ...renderOptions(), data: data.slice() });
  const abort = () => void task.destroy();
  signal?.addEventListener("abort", abort, { once: true });
  const outputs = [];
  let reduced = false;
  try {
    const pdf = await task.promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
      const page = await pdf.getPage(i),
        size = page.getViewport({ scale: 1 });
      const budget = Math.min(
        maxPixels,
        Math.floor(
          (navigator.deviceMemory && navigator.deviceMemory <= 4
            ? 16_000_000
            : 48_000_000) / pdf.numPages,
        ),
      );
      const bounds = fitSize(
        (size.width * dpi) / 72,
        (size.height * dpi) / 72,
        budget,
        8192,
      );
      if (bounds.factor < 0.999) reduced = true;
      const viewport = page.getViewport({
        scale: Math.min(bounds.width / size.width, bounds.height / size.height),
      });
      const canvas = document.createElement("canvas");
      canvas.width = bounds.width;
      canvas.height = bounds.height;
      try {
        const render = page.render({
          canvasContext: canvas.getContext("2d", { alpha: false }),
          viewport,
          annotationMode: 1,
          intent: "print",
          background: "#fff",
        });
        const cancel = () => render.cancel();
        signal?.addEventListener("abort", cancel, { once: true });
        try {
          await render.promise;
        } finally {
          signal?.removeEventListener("abort", cancel);
        }
        const blob = await new Promise((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value
                ? resolve(value)
                : reject(
                    new Error("Das Seitenbild konnte nicht erzeugt werden."),
                  ),
            format === "jpg" ? "image/jpeg" : "image/png",
            quality,
          ),
        );
        outputs.push({
          blob,
          width: size.width,
          height: size.height,
          dpi: viewport.scale * 72,
        });
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
      progress?.(i / pdf.numPages);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
  return { outputs, reduced };
}
let printCleanup = null;
export async function printOutputs(outputs, job) {
  if (printCleanup)
    throw new Error(
      "Bitte den bereits geöffneten Druckdialog zuerst schließen.",
    );
  const area = document.createElement("section");
  area.className = "print-area";
  area.setAttribute("aria-hidden", "true");
  const style = document.createElement("style"),
    printUrls = [];
  let count = 0;
  const cleanup = () => {
    area.remove();
    style.remove();
    printUrls.forEach(releaseUrl);
    window.removeEventListener("afterprint", cleanup);
    printCleanup = null;
  };
  printCleanup = cleanup;
  try {
    let total = 0;
    const lib = await pdfJs();
    for (const output of outputs) {
      const task = lib.getDocument({
        ...renderOptions(),
        data: output.data.slice(),
      });
      try {
        total += (await task.promise).numPages;
      } finally {
        await task.destroy();
      }
    }
    const pixelBudget = Math.min(
      4_000_000,
      Math.floor(40_000_000 / Math.max(1, total)),
    );
    const rules = [];
    for (const output of outputs) {
      const rendered = await renderOutput(output.data, {
        dpi: 150,
        signal: job.signal,
        maxPixels: pixelBudget,
        progress: job.progress,
      });
      for (const page of rendered.outputs) {
        const wrapper = document.createElement("div");
        wrapper.className = "print-page";
        wrapper.dataset.printPage = String(count);
        const image = document.createElement("img");
        image.alt = "";
        image.src = blobUrl(page.blob);
        printUrls.push(image.src);
        wrapper.append(image);
        area.append(wrapper);
        rules.push(
          `@page pdfhelper-${count}{size:${page.width}pt ${page.height}pt;margin:0} .print-page[data-print-page="${count}"]{page:pdfhelper-${count};width:${page.width}pt;height:${page.height}pt}`,
        );
        count++;
      }
    }
    if (job.signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
    style.textContent = `@media print{${rules.join("")}}`;
    document.head.append(style);
    document.body.append(area);
    await Promise.all(
      [...area.querySelectorAll("img")].map((image) => image.decode()),
    );
    window.addEventListener("afterprint", cleanup, { once: true });
    window.focus();
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
export function cleanupExports() {
  printCleanup?.();
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
}
export { splitGroups };
