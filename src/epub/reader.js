import { epubDirectory } from "../core/archive.js";
import { readBytes } from "../core/files.js";
import { fadeContent, cancelContentFade } from "../ui/motion.js";

const readerPolicy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' blob:; img-src blob: data:; font-src blob: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function xmlDocument(text) {
  if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(text))
    throw new Error("Eigene XML-Entitäten werden in EPUB-Dateien nicht unterstützt.");
  const decoder = document.createElement("textarea");
  const source = text.replace(/<!DOCTYPE[^>]*>/gi, "").replace(/&([a-z][a-z\d]+);/gi, (entity, name) => {
    if (["amp", "quot", "apos", "lt", "gt"].includes(name)) return entity;
    decoder.innerHTML = entity;
    return decoder.value === entity ? entity : [...decoder.value].map((character) => `&#${character.codePointAt(0)};`).join("");
  });
  const xml = new DOMParser().parseFromString(source, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("Die EPUB-Datei enthält ungültiges XML.");
  return xml;
}

function safeReference(value) {
  return !/^[\s\u0000-\u0020]*(?:[a-z][a-z\d+.-]*:|[\\/]{2})/i.test(value) || /^data:image\/(?:png|jpeg|webp|gif);/i.test(value);
}

function cleanDocument(xml) {
  for (const node of [...xml.querySelectorAll("*")]) {
    const name = node.localName.toLowerCase();
    if (["script", "iframe", "frame", "object", "embed", "form", "input", "button", "textarea", "select", "base", "foreignobject", "audio", "video", "source"].includes(name) ||
        (name === "meta" && [...node.attributes].some((attribute) => attribute.localName.toLowerCase() === "http-equiv")) ||
        (name === "link" && node.getAttribute("rel") !== "stylesheet")) {
      node.remove();
      continue;
    }
    for (const attribute of [...node.attributes]) {
      const key = attribute.localName.toLowerCase();
      if (key.startsWith("on") || ["srcdoc", "srcset", "action", "formaction", "target", "ping"].includes(key) ||
          (["href", "src", "poster"].includes(key) && !safeReference(attribute.value)))
        node.removeAttributeNode(attribute);
    }
  }
  let head = xml.querySelector("head");
  if (!head && xml.documentElement.localName === "html") {
    head = xml.createElementNS("http://www.w3.org/1999/xhtml", "head");
    xml.documentElement.prepend(head);
  }
  if (head) {
    const meta = xml.createElementNS("http://www.w3.org/1999/xhtml", "meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", readerPolicy);
    head.prepend(meta);
  }
  return new XMLSerializer().serializeToString(xml);
}

function waitForBook(operation, signal) {
  return new Promise((resolve, reject) => {
    const finish = (error, result) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new DOMException("Abgebrochen", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Die EPUB-Datei konnte nicht rechtzeitig geöffnet werden.")), 60000);
    signal?.addEventListener("abort", abort, { once: true });
    operation.then((result) => finish(null, result), (error) => finish(error));
    if (signal?.aborted) abort();
  });
}

function readEntry(entry, size, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Abgebrochen", "AbortError"));
    const stream = entry.internalStream("uint8array"), chunks = [];
    let length = 0, finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      if (error) {
        stream.pause();
        chunks.length = 0;
        reject(error);
      } else {
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        resolve(bytes);
      }
    };
    const abort = () => finish(new DOMException("Abgebrochen", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    stream.on("data", (chunk) => {
      if (finished) return;
      length += chunk.length;
      if (length > size) finish(new Error("Die EPUB-Datei enthält falsche Größenangaben."));
      else chunks.push(chunk);
    });
    stream.on("error", finish);
    stream.on("end", () => finish(length === size ? null : new Error("Die EPUB-Datei ist unvollständig.")));
    stream.resume();
  });
}

export async function openEpub(file, { signal, progress = () => {} } = {}) {
  const bytes = await readBytes(file, { signal });
  const directory = epubDirectory(bytes);
  if (directory.has("META-INF/encryption.xml") || directory.has("META-INF/rights.xml"))
    throw new Error("Verschlüsselte oder DRM-geschützte EPUB-Dateien werden nicht unterstützt.");
  await import("../../vendor/jszip/3.10.2/jszip.min.js");
  await import("../../vendor/epubjs/0.3.93/epub.min.js");
  const zip = await globalThis.JSZip.loadAsync(bytes);
  const clean = new globalThis.JSZip();
  let index = 0;
  for (const [name, info] of directory) {
    if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
    if (name.endsWith("/")) continue;
    const entry = zip.file(name);
    if (!entry) throw new Error("Die EPUB-Datei enthält ungültige Dateipfade.");
    let data = await readEntry(entry, info.size, signal);
    if (/\.(?:xhtml|html|htm|xml|opf|ncx|svg)$/i.test(name)) {
      const xml = xmlDocument(new TextDecoder().decode(data));
      data = ["html", "svg"].includes(xml.documentElement.localName) ? cleanDocument(xml) : new XMLSerializer().serializeToString(xml);
    }
    clean.file(name, data);
    progress(++index / directory.size * 0.8);
  }
  const container = xmlDocument(await clean.file("META-INF/container.xml").async("string"));
  const rootfile = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!rootfile || !clean.file(rootfile)) throw new Error("Das EPUB-Inhaltsverzeichnis fehlt.");
  const packageXml = xmlDocument(await clean.file(rootfile).async("string"));
  if (packageXml.documentElement.localName !== "package" || !packageXml.querySelector("spine itemref"))
    throw new Error("Die EPUB-Datei enthält keine lesbaren Kapitel.");
  const packageUrl = new URL(rootfile, "https://epub.invalid/");
  const xmlPaths = new Set([`/${rootfile}`, "/META-INF/container.xml"]);
  clean.file(rootfile, new XMLSerializer().serializeToString(packageXml));
  for (const item of packageXml.querySelectorAll("manifest item")) {
    if (!["application/xhtml+xml", "image/svg+xml", "application/x-dtbncx+xml", "application/xml", "text/xml"].includes(item.getAttribute("media-type"))) continue;
    const href = new URL(item.getAttribute("href"), packageUrl);
    if (href.origin !== packageUrl.origin) continue;
    const entry = clean.file(decodeURIComponent(href.pathname.slice(1)));
    if (!entry) throw new Error("Ein EPUB-Kapitel oder eine eingebettete Grafik fehlt.");
    xmlPaths.add(decodeURIComponent(href.pathname));
    const xml = xmlDocument(await entry.async("string"));
    clean.file(entry.name, ["html", "svg"].includes(xml.documentElement.localName) ? cleanDocument(xml) : new XMLSerializer().serializeToString(xml));
  }
  const archive = await clean.generateAsync({ type: "arraybuffer", compression: "STORE" });
  if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
  const book = globalThis.ePub();
  const load = book.load.bind(book);
  book.load = (path) => {
    const url = book.resolve(path);
    if (book.archived && xmlPaths.has(decodeURIComponent(new URL(url, "https://epub.invalid/").pathname)))
      return book.archive.request(url, "xml");
    return load(path);
  };
  book.opened.catch(() => {});
  book.ready.catch(() => {});
  try {
    await waitForBook(book.open(archive, "binary").then(() => book.ready), signal);
    if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
    const reader = new EpubReader(book);
    progress(1);
    return reader;
  } catch (error) {
    book.destroy();
    throw error;
  }
}

class EpubReader {
  constructor(book) {
    this.book = book;
    this.fontSize = 100;
    this.position = null;
    this.destroyed = false;
    this.displayGeneration = 0;
    this.host = document.createElement("div");
    this.host.className = "epub-book";
    this.host.hidden = true;
    this.chapters = book.spine.spineItems.filter((section) => section.linear);
    this.index = 0;
  }

  outline(items = this.book.navigation.toc) {
    return items.map((item) => ({ title: item.label.trim(), href: item.href, items: this.outline(item.subitems ?? []) }));
  }

  async show(container, onChange, onError) {
    const wasHidden = this.host.hidden;
    if (this.host.parentElement !== container) container.append(this.host);
    this.host.hidden = false;
    this.host.inert = false;
    this.onChange = onChange;
    if (!this.rendition) {
      this.rendition = this.book.renderTo(this.host, {
        width: "100%", height: "100%", flow: "scrolled-doc", manager: "default", spread: "none",
        allowScriptedContent: false, allowPopups: false,
      });
      const display = this.rendition.display.bind(this.rendition);
      this.rendition.display = async (target) => {
        const generation = ++this.displayGeneration;
        cancelContentFade(this.host);
        const section = await display(target);
        if (generation === this.displayGeneration && !this.destroyed && !this.host.hidden)
          fadeContent(this.host);
        return section;
      };
      this.rendition.themes.default({ body: { color: "#20232b", background: "#fff", "overflow-wrap": "break-word" }, img: { "max-width": "100%" } });
      this.rendition.on("relocated", (location) => {
        if (this.host.hidden || this.destroyed) return;
        this.position = location.start.cfi;
        this.index = Math.max(0, this.chapters.findIndex((section) => section.index === location.start.index));
        this.onChange?.();
      });
      this.rendition.on("displayError", (error) => { if (!this.destroyed) onError(error); });
      this.rendition.hooks.content.register((contents) => {
        contents.window.frameElement.title = this.book.packaging.metadata.title || "EPUB-Kapitel";
        contents.document.addEventListener("keydown", (event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
            event.preventDefault();
            this.host.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: event.ctrlKey, metaKey: event.metaKey, bubbles: true }));
          }
          if ((event.ctrlKey || event.metaKey) && ["s", "z", "y", "f"].includes(event.key.toLowerCase())) event.preventDefault();
        });
        contents.document.addEventListener("click", (event) => {
          const link = event.target.closest?.("a");
          if (link && !safeReference(link.getAttribute("href") ?? "")) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }, true);
        contents.document.addEventListener("contextmenu", (event) => event.preventDefault());
      });
      await this.rendition.display();
    } else if (this.size && (this.size.width !== this.host.clientWidth || this.size.height !== this.host.clientHeight)) {
      this.rendition.resize();
      await this.rendition.display(this.position ?? undefined);
    } else {
      const scroller = this.host.querySelector(".epub-container");
      if (scroller && this.scroll) {
        scroller.scrollTop = this.scroll.top;
        scroller.scrollLeft = this.scroll.left;
      }
      if (wasHidden) fadeContent(this.host);
    }
    this.onChange?.();
  }

  hide() {
    this.displayGeneration++;
    cancelContentFade(this.host);
    if (!this.host.hidden) {
      this.position = this.rendition?.currentLocation()?.start?.cfi ?? this.position;
      const scroller = this.host.querySelector(".epub-container");
      this.scroll = scroller ? { top: scroller.scrollTop, left: scroller.scrollLeft } : null;
      this.size = { width: this.host.clientWidth, height: this.host.clientHeight };
    }
    this.host.hidden = true;
    this.host.inert = true;
    this.onChange = null;
  }

  async go(href) {
    await this.rendition?.display(href);
  }

  async step(delta) {
    const chapter = this.chapters[this.index + delta];
    if (chapter) await this.go(chapter.href);
  }

  font(value) {
    this.displayGeneration++;
    cancelContentFade(this.host);
    this.fontSize = value;
    this.rendition?.themes.fontSize(`${value}%`);
  }

  destroy() {
    this.displayGeneration++;
    cancelContentFade(this.host);
    this.destroyed = true;
    this.onChange = null;
    this.book.destroy();
    this.host.remove();
  }
}
