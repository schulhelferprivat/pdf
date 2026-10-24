import { readBytes } from "../core/files.js";
import { pdfJs, renderOptions } from "./vendors.js";
import { displayedSize, normalizeAngle } from "../core/model.js";
import { fitSize, displayPoint, displayRect } from "../core/geometry.js";
import { generateOutline } from "./outline.js";
import { darkenCanvas, darkTextColor } from "./dark.js";
export class Renderer {
  constructor(sources, assets) {
    this.sources = sources;
    this.assets = assets;
    this.documents = new Map();
    this.uses = new Map();
    this.renderTasks = new Set();
    this.mainTask = null;
    this.generation = 0;
    this.thumbnailCanvases = new Map();
    this.outlines = new Map();
    this.texts = new Map();
    this.imageRotations = new WeakMap();
  }
  async source(id) {
    if (!this.documents.has(id)) {
      const entry = this.sources.get(id);
      const promise = (async () => {
        const lib = await pdfJs();
        const data = await readBytes(entry.file);
        const task = lib.getDocument({
          ...renderOptions(),
          data,
          password: entry.password ?? "",
        });
        try {
          return { task, pdf: await task.promise };
        } catch (error) {
          await task.destroy();
          throw error;
        }
      })();
      this.documents.set(id, promise);
      try {
        await promise;
      } catch (error) {
        this.documents.delete(id);
        throw error;
      }
    }
    const entry = this.documents.get(id);
    this.documents.delete(id);
    this.documents.set(id, entry);
    return (await entry).pdf;
  }
  trim() {
    for (const [id, promise] of this.documents) {
      if (this.uses.get(id)) continue;
      if (this.documents.size <= 2 && this.sources.has(id)) continue;
      this.documents.delete(id);
      void promise.then(({ task }) => task.destroy()).catch(() => {});
    }
  }
  cancelMain() {
    this.generation++;
    this.mainTask?.cancel();
    this.mainTask = null;
  }
  async render(
    page,
    canvas,
    scale,
    {
      main = false,
      preview = false,
      document = null,
      composite = false,
      darkMode = false,
      signal,
    } = {},
  ) {
    if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
    const generation = this.generation;
    const size = displayedSize(page);
    const maxPixels = composite
      ? navigator.deviceMemory && navigator.deviceMemory <= 4
        ? 4_000_000
        : 16_000_000
      : main || preview
        ? 4_000_000
        : 65_536;
    const bounds = fitSize(
      size.width * scale,
      size.height * scale,
      maxPixels,
      composite ? 8192 : main || preview ? 4096 : 256,
    );
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const effective = Math.min(
      bounds.width / size.width,
      bounds.height / size.height,
    );
    let imageCoordinates = null;
    let imageRotation = 0;
    if (page.sourceId) {
      this.uses.set(page.sourceId, (this.uses.get(page.sourceId) || 0) + 1);
      try {
        const pdf = await this.source(page.sourceId);
        const sourcePage = await pdf.getPage(page.index + 1);
        if (main && generation !== this.generation)
          throw new DOMException(
            "Veraltete Ansicht",
            "RenderingCancelledException",
          );
        const angle = normalizeAngle((page.baseRotation || 0) + page.rotation);
        const viewport = sourcePage.getViewport({
          scale: effective,
          rotation: angle,
        });
        const needsCoordinates = darkMode && !sourcePage.imageCoordinates;
        const task = sourcePage.render({
          canvasContext: ctx,
          viewport,
          annotationMode: 2,
          background: "#fff",
          recordImages: darkMode,
        });
        if (main) this.mainTask = task;
        const abort = () => task.cancel();
        signal?.addEventListener("abort", abort, { once: true });
        this.renderTasks.add(task);
        try {
          await task.promise;
          if (darkMode) {
            if (needsCoordinates && !this.imageRotations.has(sourcePage))
              this.imageRotations.set(sourcePage, angle);
            imageCoordinates = sourcePage.imageCoordinates;
            imageRotation = normalizeAngle(angle - (this.imageRotations.get(sourcePage) ?? angle));
          }
        } finally {
          this.renderTasks.delete(task);
          signal?.removeEventListener("abort", abort);
          if (this.mainTask === task) this.mainTask = null;
        }
      } finally {
        this.uses.set(
          page.sourceId,
          Math.max(0, (this.uses.get(page.sourceId) || 1) - 1),
        );
        this.trim();
      }
    }
    if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
    if (darkMode) darkenCanvas(ctx, imageCoordinates, imageRotation);
    if (document && (composite || !main))
      await this.composite(page, ctx, effective, document, darkMode);
    return {
      width: size.width * scale,
      height: size.height * scale,
      scale,
      actualDpi: effective * 72,
    };
  }
  async composite(page, ctx, scale, document, darkMode = false) {
    ctx.save();
    ctx.scale(scale, scale);
    for (const widget of page.widgets || []) {
      if (widget.type === "unsupported") continue;
      const key = `${page.formGroup}:${widget.name}`;
      const value = document.formValues[key] ?? widget.value;
      const rect = displayRect(page, widget.rect);
      ctx.fillStyle = darkMode ? "#202329" : widget.background || "#fff";
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      ctx.clip();
      ctx.fillStyle = darkMode ? "#e8edf2" : widget.color || "#111";
      const size = widget.fontSize || Math.min(12, rect.height * 0.7);
      ctx.font = `${size}px Noto`;
      ctx.textAlign = widget.align || "left";
      const textX =
        widget.align === "center"
          ? rect.x + rect.width / 2
          : widget.align === "right"
            ? rect.x + rect.width - 2
            : rect.x + 2;
      if (widget.type === "checkbox" || widget.type === "radio") {
        ctx.strokeStyle = "#777";
        ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
        ctx.textAlign = "left";
        if (widget.on !== "" && value === widget.on)
          ctx.fillText("✓", rect.x + 2, rect.y + rect.height * 0.8);
      } else {
        const text = Array.isArray(value)
          ? value
              .map((entry) => {
                const index = widget.options?.indexOf(entry) ?? -1;
                return index < 0 ? entry : (widget.labels?.[index] ?? entry);
              })
              .join(", ")
          : widget.password
            ? "•".repeat(String(value ?? "").length)
            : String(value ?? "");
        text
          .split("\n")
          .forEach((line, i) =>
            ctx.fillText(
              line,
              textX,
              rect.y + Math.min(size * 1.05, rect.height * 0.75) + i * size * 1.2,
            ),
          );
      }
      ctx.restore();
    }
    for (const el of page.elements) {
      if (el.type === "comment") continue;
      const [x, y] = displayPoint(page, el.x, el.y);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(
        (((page.baseRotation || 0) + page.rotation - el.angle) * Math.PI) / 180,
      );
      ctx.globalAlpha = el.opacity ?? 1;
      ctx.fillStyle = darkMode && el.type === "text" ? darkTextColor(el.color) : el.color;
      ctx.strokeStyle = el.color;
      if (el.type === "image") {
        const asset = this.assets.get(el.assetId);
        if (asset) {
          if (!asset.bitmap) asset.bitmap = await createImageBitmap(asset.file);
          ctx.drawImage(asset.bitmap, 0, 0, el.width, el.height);
        }
      } else if (el.type === "highlight")
        for (const [rx, ry, rw, rh] of el.rects || [[0, 0, 1, 1]])
          ctx.fillRect(
            rx * el.width,
            ry * el.height,
            rw * el.width,
            rh * el.height,
          );
      else if (el.type === "draw") {
        ctx.lineWidth = el.strokeWidth || 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        for (const points of el.paths || [el.points])
          points.forEach(([px, py], i) =>
            ctx[i ? "lineTo" : "moveTo"](px * el.width, py * el.height),
          );
        ctx.stroke();
      } else {
        ctx.font = `${el.bold ? "700" : "400"} ${el.fontSize}px Noto`;
        ctx.textBaseline = "alphabetic";
        ctx.beginPath();
        ctx.rect(0, 0, el.width, el.height);
        ctx.clip();
        let lineIndex = 0;
        for (const paragraph of String(el.text).split("\n")) {
          let line = "";
          for (const word of paragraph.split(" ")) {
            const next = line ? `${line} ${word}` : word;
            if (ctx.measureText(next).width > el.width && line) {
              ctx.fillText(
                line,
                0,
                el.fontSize + lineIndex++ * el.fontSize * 1.25,
              );
              line = word;
            } else line = next;
          }
          ctx.fillText(line, 0, el.fontSize + lineIndex++ * el.fontSize * 1.25);
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }
  async sourcePage(page) {
    const pdf = await this.source(page.sourceId);
    return { pdf, sourcePage: await pdf.getPage(page.index + 1) };
  }
  async textLayer(page, container, scale) {
    if (!page.sourceId) return null;
    const lib = await pdfJs();
    const { sourcePage } = await this.sourcePage(page);
    return new lib.TextLayer({
      textContentSource: sourcePage.streamTextContent(),
      container,
      viewport: sourcePage.getViewport({
        scale,
        rotation: normalizeAngle((page.baseRotation || 0) + page.rotation),
      }),
    });
  }
  pageText(page) {
    if (!page.sourceId) return Promise.resolve(null);
    const key = `${page.sourceId}:${page.index}`;
    if (!this.texts.has(key)) {
      const promise = (async () => {
        this.uses.set(page.sourceId, (this.uses.get(page.sourceId) || 0) + 1);
        try {
          const { sourcePage } = await this.sourcePage(page);
          const content = await sourcePage.getTextContent();
          return content.items.flatMap((item) =>
            item.str === undefined
              ? []
              : item.hasEOL
                ? [item.str, "\n"]
                : [item.str],
          );
        } finally {
          this.uses.set(
            page.sourceId,
            Math.max(0, (this.uses.get(page.sourceId) || 1) - 1),
          );
          this.trim();
        }
      })();
      this.texts.set(key, promise);
      promise.catch(() => this.texts.delete(key));
    }
    return this.texts.get(key);
  }
  async links(page) {
    if (!page.sourceId) return [];
    this.uses.set(page.sourceId, (this.uses.get(page.sourceId) || 0) + 1);
    try {
      const { pdf, sourcePage } = await this.sourcePage(page);
      const links = [];
      for (const annotation of await sourcePage.getAnnotations({
        intent: "display",
      })) {
        if (annotation.subtype !== "Link") continue;
        if (annotation.url) {
          links.push({ rect: annotation.rect, url: annotation.url });
          continue;
        }
        if (!annotation.dest) continue;
        const index = await this.destinationIndex(pdf, annotation.dest);
        if (index !== null)
          links.push({ rect: annotation.rect, sourceId: page.sourceId, index });
      }
      return links;
    } finally {
      this.uses.set(
        page.sourceId,
        Math.max(0, (this.uses.get(page.sourceId) || 1) - 1),
      );
      this.trim();
    }
  }
  async destinationIndex(pdf, value) {
    const dest =
      typeof value === "string"
        ? await pdf.getDestination(value).catch(() => null)
        : value;
    if (!Array.isArray(dest)) return null;
    if (Number.isInteger(dest[0])) return dest[0];
    return pdf.getPageIndex(dest[0]).catch(() => null);
  }
  outline(sourceId) {
    if (!this.outlines.has(sourceId))
      this.outlines.set(
        sourceId,
        (async () => {
          this.uses.set(sourceId, (this.uses.get(sourceId) || 0) + 1);
          try {
            const pdf = await this.source(sourceId);
            const build = async (items) => {
              const entries = [];
              for (const item of items || []) {
                const children = await build(item.items);
                const entry = { title: item.title?.trim() || "Ohne Titel" };
                if (item.url) entry.url = item.url;
                else if (item.dest)
                  entry.index = await this.destinationIndex(pdf, item.dest);
                entry.items = children;
                entry.open = item.count > 0;
                entries.push(entry);
              }
              return entries;
            };
            const outline = await pdf.getOutline();
            return await (outline?.length ? build(outline) : generateOutline(pdf));
          } finally {
            this.uses.set(sourceId, Math.max(0, (this.uses.get(sourceId) || 1) - 1));
            this.trim();
          }
        })().catch(() => []),
      );
    return this.outlines.get(sourceId);
  }
  retainThumbnail(id, canvas) {
    const previous = this.thumbnailCanvases.get(id);
    if (previous && previous !== canvas) {
      previous.width = 0;
      previous.height = 0;
    }
    this.thumbnailCanvases.delete(id);
    this.thumbnailCanvases.set(id, canvas);
    while (this.thumbnailCanvases.size > 32) {
      const first = this.thumbnailCanvases.keys().next().value,
        old = this.thumbnailCanvases.get(first);
      old.width = 0;
      old.height = 0;
      old.remove();
      this.thumbnailCanvases.delete(first);
    }
  }
  clearThumbnails() {
    for (const canvas of this.thumbnailCanvases.values()) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.thumbnailCanvases.clear();
  }
  async disposeUnused(ids) {
    for (const id of this.outlines.keys())
      if (!ids.has(id)) this.outlines.delete(id);
    for (const key of this.texts.keys())
      if (!ids.has(key.slice(0, key.lastIndexOf(":")))) this.texts.delete(key);
    for (const [id, promise] of this.documents)
      if (!ids.has(id) && !this.uses.get(id)) {
        this.documents.delete(id);
        await promise.then(({ task }) => task.destroy()).catch(() => {});
      }
  }
  destroy() {
    this.cancelMain();
    for (const task of this.renderTasks) task.cancel();
    this.clearThumbnails();
    void this.disposeUnused(new Set());
  }
}
