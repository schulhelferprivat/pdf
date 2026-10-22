import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";
import { openBlankDocument, selectDocument } from "./helpers/documents.mjs";
import { tiffFixture } from "./helpers/formats.mjs";
import { deflateTiffFixture } from "./helpers/tiff.mjs";
import { deflateSync } from "node:zlib";

test("Browser: TIFF-Ausrichtungen, Deflate und Abbruch im Worker", { timeout: 90000 }, async (t) => {
  const b = await browser(t);
  const original = tiffFixture({ orientations: [1], thumbnail: false });
  const packed = deflateSync(original.subarray(164, 182));
  const compressed = new Uint8Array(original.length + packed.length);
  compressed.set(original); compressed.set(packed, original.length);
  const view = new DataView(compressed.buffer);
  view.setUint16(8 + 2 + 4 * 12 + 8, 8, true);
  view.setUint32(8 + 2 + 6 * 12 + 8, original.length, true);
  view.setUint32(8 + 2 + 10 * 12 + 8, packed.length, true);
  const result = await b.evaluate(async ({ all, compressed, cancel }) => {
    const { processPdf } = await import("./src/pdf/client.js");
    const { pdfLib, pdfJs, renderOptions } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib();
    const converted = await processPdf("tiff-pdf", { data: new Uint8Array(all) });
    const documentPdf = await lib.PDFDocument.load(converted.data);
    const dimensions = documentPdf.getPages().map((page) => {
      const xObjects = page.node.Resources().lookup(lib.PDFName.of("XObject"), lib.PDFDict);
      const stream = documentPdf.context.lookup(xObjects.entries()[0][1]);
      return [stream.dict.lookup(lib.PDFName.of("Width"), lib.PDFNumber).asNumber(), stream.dict.lookup(lib.PDFName.of("Height"), lib.PDFNumber).asNumber()];
    });
    const task = (await pdfJs()).getDocument({ data: converted.data.slice(), ...renderOptions() });
    const rendered = await task.promise;
    const points = [[90,300],[500,300],[500,530],[90,530],[100,100],[440,100],[440,700],[100,700]], corners = [];
    for (let index = 0; index < 8; index++) {
      const page = await rendered.getPage(index + 1), viewport = page.getViewport({ scale: 1 });
      const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      corners.push([...canvas.getContext("2d").getImageData(...points[index], 1, 1).data]);
    }
    await task.destroy();
    const packed = await processPdf("tiff-pdf", { data: new Uint8Array(compressed) });
    const packedPages = (await lib.PDFDocument.load(packed.data)).getPageCount();
    const controller = new AbortController();
    let abort;
    try {
      await processPdf("tiff-pdf", { data: new Uint8Array(cancel) }, { signal: controller.signal, progress: () => controller.abort() });
    } catch (error) { abort = error.name; }
    const recovered = await processPdf("tiff-pdf", { data: new Uint8Array(compressed) });
    return { dimensions, corners, packedPages, abort, recovered: recovered.data.length > 0 };
  }, { all: [...tiffFixture({ orientations: [1,2,3,4,5,6,7,8], thumbnail: false, little: false })], compressed: [...compressed], cancel: [...tiffFixture({ orientations: Array(30).fill(1), thumbnail: false })] });
  assert.deepEqual(result.dimensions, [[3,2],[3,2],[3,2],[3,2],[2,3],[2,3],[2,3],[2,3]]);
  assert.ok(result.corners.every((pixel) => pixel.slice(0,3).every((value) => value > 245)));
  assert.equal(result.packedPages, 1);
  assert.equal(result.abort, "AbortError");
  assert.equal(result.recovered, true);
  assert.deepEqual(b.errors, []);
});

test("Browser: TIFF-Worker lehnt Deflate-Speicherbomben ab und verarbeitet danach gültige Dateien", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  const invalid = [
    deflateTiffFixture({ block: () => new Uint8Array(8 * 1024 ** 2) }),
    deflateTiffFixture({ packed: (bytes) => bytes.subarray(0, bytes.length - 1) }),
    deflateTiffFixture({ packed: () => new Uint8Array(18) }),
    deflateTiffFixture({ bits: [8] }),
  ];
  const valid = [
    deflateTiffFixture({ height: 5, rows: 2 }),
    deflateTiffFixture({ width: 17, height: 19, tile: [16, 16] }),
  ];
  const result = await b.evaluate(async ({ invalid, valid }) => {
    const { processPdf } = await import("./src/pdf/client.js");
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib(), errors = [], dimensions = [];
    const jobs = [...invalid, ...valid].map((bytes) => processPdf("tiff-pdf", { data: new Uint8Array(bytes) }));
    for (const result of await Promise.allSettled(jobs)) {
      if (result.status === "rejected") errors.push(result.reason.message);
      else {
        const doc = await lib.PDFDocument.load(result.value.data);
        const images = doc.getPage(0).node.Resources().lookup(lib.PDFName.of("XObject"), lib.PDFDict);
        const image = doc.context.lookup(images.entries()[0][1]);
        dimensions.push([
          image.dict.lookup(lib.PDFName.of("Width"), lib.PDFNumber).asNumber(),
          image.dict.lookup(lib.PDFName.of("Height"), lib.PDFNumber).asNumber(),
        ]);
      }
    }
    return { errors, dimensions };
  }, { invalid: invalid.map((bytes) => [...bytes]), valid: valid.map((bytes) => [...bytes]) });
  assert.equal(result.errors.length, invalid.length);
  assert.match(result.errors[0], /überschreiten.*Bildgröße/);
  assert.ok(result.errors.every((message) => /TIFF/.test(message)));
  assert.deepEqual(result.dimensions, [[3, 5], [17, 19]]);
  assert.deepEqual(b.errors, []);
});

test("Browser: WebP, SVG und mehrseitige TIFF lokal in PDF umwandeln", { timeout: 90000 }, async (t) => {
  const b = await browser(t, { prefix: "/PDFHelper/" });
  const result = await b.evaluate(async (tiff) => {
    const { normalizeImage, validateFile } = await import("./src/core/files.js");
    const { processPdf } = await import("./src/pdf/client.js");
    const { pdfLib, pdfJs, renderOptions } = await import("./src/pdf/vendors.js");
    const canvas = document.createElement("canvas");
    canvas.width = 16; canvas.height = 12;
    canvas.getContext("2d").fillRect(4, 3, 8, 6);
    const webp = new File([await new Promise((resolve) => canvas.toBlob(resolve, "image/webp"))], "Bild.webp");
    const join = (parts) => {
      const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
      let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      return bytes;
    };
    const chunk = (name, payload) => {
      const bytes = new Uint8Array(8 + payload.length + (payload.length & 1));
      bytes.set(new TextEncoder().encode(name)); new DataView(bytes.buffer).setUint32(4, payload.length, true); bytes.set(payload, 8);
      return bytes;
    };
    const frames = [];
    for (const color of ["red", "blue"]) {
      canvas.getContext("2d").fillStyle = color; canvas.getContext("2d").fillRect(0, 0, 16, 12);
      const frame = new Uint8Array(await (await new Promise((resolve) => canvas.toBlob(resolve, "image/webp"))).arrayBuffer());
      const parts = [], header = new Uint8Array(16); header[6] = 15; header[9] = 11; header[12] = 100;
      for (let offset = 12; offset + 8 <= frame.length;) {
        const size = new DataView(frame.buffer).getUint32(offset + 4, true);
        const name = new TextDecoder().decode(frame.subarray(offset, offset + 4));
        if (["VP8 ", "VP8L", "ALPH"].includes(name)) parts.push(frame.subarray(offset, offset + 8 + size + (size & 1)));
        offset += 8 + size + (size & 1);
      }
      frames.push(chunk("ANMF", join([header, ...parts])));
    }
    const extended = new Uint8Array(10); extended[0] = 2; extended[4] = 15; extended[7] = 11;
    const payload = join([new TextEncoder().encode("WEBP"), chunk("VP8X", extended), chunk("ANIM", new Uint8Array(6)), ...frames]);
    const animated = chunk("RIFF", payload);
    const firstFrame = await normalizeImage(new File([animated], "Animation.webp"));
    canvas.getContext("2d").drawImage(firstFrame.bitmap, 0, 0);
    const firstColor = canvas.getContext("2d").getImageData(8, 6, 1, 1).data;
    const animationRed = firstColor[0] > 240 && firstColor[2] < 20;
    firstFrame.bitmap.close();
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><script>parent.svgExecuted=true</script><rect x="4" y="3" width="8" height="6" fill="red"/><image href="https://example.invalid/blocked-svg"/></svg>'], "Vektor.svg");
    const normalized = [];
    for (const file of [webp, svg]) {
      const image = await normalizeImage(file);
      canvas.getContext("2d").clearRect(0, 0, 16, 12);
      canvas.getContext("2d").drawImage(image.bitmap, 0, 0);
      normalized.push({ mime: image.mime, width: image.width, height: image.height, alpha: canvas.getContext("2d").getImageData(0, 0, 1, 1).data[3] });
      image.bitmap.close();
    }
    const converted = await processPdf("tiff-pdf", { data: new Uint8Array(tiff) });
    const lib = await pdfLib(), pdf = await lib.PDFDocument.load(converted.data);
    const renderer = await pdfJs();
    const task = renderer.getDocument({ data: converted.data.slice(), ...renderOptions() });
    const rendered = await task.promise;
    const samples = [];
    for (let index = 1; index <= 2; index++) {
      const page = await rendered.getPage(index);
      const viewport = page.getViewport({ scale: 1 });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const point = index === 1 ? [90, 300] : [440, 100];
      samples.push([...canvas.getContext("2d").getImageData(...point, 1, 1).data]);
    }
    await task.destroy();
    const transfer = new DataTransfer();
    for (const file of [webp, svg, new File([new Uint8Array(tiff)], "Scan.tiff"), new File(["defekt"], "Defekt.webp")]) transfer.items.add(file);
    const input = document.querySelector("#file-input"); input.files = transfer.files; input.dispatchEvent(new Event("change"));
    return { normalized, pages: pdf.getPageCount(), samples, animationRed, svgExecuted: !!window.svgExecuted, detected: await validateFile(svg) };
  }, [...tiffFixture()]);
  assert.deepEqual(result.normalized, [
    { mime: "image/png", width: 16, height: 12, alpha: 0 },
    { mime: "image/png", width: 16, height: 12, alpha: 0 },
  ]);
  assert.equal(result.pages, 2);
  assert.equal(result.svgExecuted, false);
  assert.equal(result.animationRed, true);
  assert.equal(result.detected, "image/svg+xml");
  assert.ok(result.samples.every((pixel) => pixel.slice(0, 3).every((channel) => channel > 245)));
  await b.wait(() => document.querySelectorAll("#file-list li").length === 3 && !document.querySelector("#busy-dialog").open && document.querySelector("#toast").textContent.includes("Defekt.webp"));
  assert.equal(await b.evaluate(() => document.querySelector("#total-pages").textContent), "2");
  assert.deepEqual(await b.evaluate(() => [...document.querySelectorAll("#file-list .file-open")].map((node) => node.textContent)), ["Bild", "Vektor", "Scan"]);
  assert.deepEqual(b.errors, []);
});

test("Browser: EPUB lesen, sicher navigieren, Dokumente wechseln und offline öffnen", { timeout: 120000 }, async (t) => {
  const b = await browser(t, { prefix: "/PDFHelper/" });
  const bytes = await b.evaluate(async () => {
    const { epubFixture } = await import("./tests/helpers/formats.mjs");
    return [...await epubFixture()];
  });
  const open = async (bytes) => b.evaluate((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "Testbuch.epub"));
    const input = document.querySelector("#file-input"); input.files = transfer.files; input.dispatchEvent(new Event("change"));
  }, bytes);
  await open(bytes);
  await b.wait(() => document.querySelector(".epub-book iframe")?.contentDocument?.querySelector("h1"));
  await b.wait(() => {
    const frame = document.querySelector(".epub-book iframe"),
      paragraph = frame?.contentDocument?.querySelector("p");
    return paragraph && frame.contentWindow.getComputedStyle(paragraph).color === "rgb(15, 60, 90)";
  });
  const security = await b.evaluate(() => {
    const frame = document.querySelector(".epub-book iframe"), doc = frame.contentDocument;
    const image = doc.querySelector("#local-image");
    return {
      title: doc.querySelector("h1").textContent,
      script: !!window.epubScriptExecuted || !!window.epubEventExecuted,
      sandbox: frame.getAttribute("sandbox"),
      activeContent: doc.querySelectorAll("script,form,iframe,[onload]").length,
      external: doc.querySelector("#external").getAttribute("href"),
      image: image.src.startsWith("blob:") && image.complete && image.naturalWidth > 0,
      disabled: document.querySelector("#save-button").disabled,
      chapters: document.querySelectorAll(".epub-outline-link").length,
    };
  });
  assert.deepEqual(security, { title: "Erstes Kapitel", script: false, sandbox: "allow-same-origin", activeContent: 0, external: null, image: true, disabled: true, chapters: 2 });
  await b.evaluate(() => document.querySelector("#epub-next").click());
  await b.wait(() => document.querySelector(".epub-book iframe")?.contentDocument?.querySelector("h1")?.textContent === "Zweites Kapitel");
  await b.evaluate(() => {
    const select = document.querySelector("#epub-font"); select.value = "150"; select.dispatchEvent(new Event("change"));
    const scroller = document.querySelector(".epub-container");
    scroller.scrollTop = 600;
    window.epubScroll = scroller.scrollTop;
  });
  await b.wait(() => document.querySelector(".epub-container").scrollTop >= 500);
  await openBlankDocument(b, 2);
  await selectDocument(b, 0);
  await b.wait(() => !document.querySelector("#epub-reader").hidden && document.querySelector(".epub-book iframe")?.contentDocument?.querySelector("h1")?.textContent === "Zweites Kapitel");
  assert.equal(await b.evaluate(() => document.querySelector("#epub-font").value), "150");
  await b.wait(() => Math.abs(document.querySelector(".epub-container").scrollTop - window.epubScroll) < 5);
  await b.evaluate(() => document.querySelector(".epub-outline-link").click());
  await b.wait(() => document.querySelector(".epub-book iframe")?.contentDocument?.querySelector("h1")?.textContent === "Erstes Kapitel");
  await b.evaluate(() => document.querySelector(".epub-book iframe").contentDocument.querySelector("#internal").click());
  await b.wait(() => document.querySelector(".epub-book iframe")?.contentDocument?.querySelector("h1")?.textContent === "Zweites Kapitel");
  await b.wait(async () => {
    const registration = await navigator.serviceWorker.ready;
    return !!registration.active && !!navigator.serviceWorker.controller;
  });
  await b.offline(true);
  await b.navigate();
  await b.wait(() => document.querySelector("#welcome .icon"));
  await open(bytes);
  await b.wait(() => document.querySelector(".epub-book iframe")?.contentDocument?.querySelector("h1")?.textContent === "Erstes Kapitel");
  await b.wait(() => {
    const frame = document.querySelector(".epub-book iframe"),
      paragraph = frame?.contentDocument?.querySelector("p");
    return paragraph && frame.contentWindow.getComputedStyle(paragraph).color === "rgb(15, 60, 90)";
  });
  await b.evaluate(async (tiff) => {
    const canvas = document.createElement("canvas"); canvas.width = 10; canvas.height = 10;
    canvas.getContext("2d").fillRect(0, 0, 10, 10);
    const transfer = new DataTransfer();
    transfer.items.add(new File([await new Promise((resolve) => canvas.toBlob(resolve, "image/webp"))], "Offline.webp"));
    transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'], "Offline.svg"));
    transfer.items.add(new File([new Uint8Array(tiff)], "Offline.tiff"));
    const input = document.querySelector("#file-input"); input.files = transfer.files; input.dispatchEvent(new Event("change"));
  }, [...tiffFixture()]);
  await b.wait(() => document.querySelectorAll("#file-list li").length === 4 && document.querySelector("#total-pages").textContent === "2" && document.querySelector("#page-loading").hidden);
  await selectDocument(b, 0);
  await b.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await b.wait(() => document.querySelector("#epub-reader").getBoundingClientRect().right <= innerWidth + 1);
  assert.deepEqual(b.errors, []);
});

test("Browser: EPUB-Grenzen, DRM und falsche ZIP-Archive ablehnen", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  const errors = await b.evaluate(async () => {
    const { epubFixture } = await import("./tests/helpers/formats.mjs");
    const { openEpub } = await import("./src/epub/reader.js");
    const { validateFile } = await import("./src/core/files.js");
    const { epubDirectory } = await import("./src/core/archive.js");
    const result = [];
    const capture = async (operation) => { try { await operation(); result.push(null); } catch (error) { result.push(error.message); } };
    await capture(async () => openEpub(new File([await epubFixture({ drm: true })], "Geschuetzt.epub")));
    await capture(async () => validateFile(new File([await new JSZip().file("test.txt", "Text").generateAsync({ type: "uint8array" })], "Falsch.epub")));
    const bytes = await epubFixture(), directory = epubDirectory(bytes);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    for (; offset < bytes.length - 46; offset++) if (view.getUint32(offset, true) === 0x02014b50) break;
    view.setUint32(offset + 24, 151 * 1024 ** 2, true);
    await capture(() => epubDirectory(bytes));
    const fixed = await openEpub(new File([await epubFixture({ fixed: true })], "Fest.epub"));
    result.push(fixed.book.packaging.metadata.layout);
    fixed.destroy();
    const older = await openEpub(new File([await epubFixture({ epub2: true, alternateNames: true })], "Alt.epub"));
    const container = document.createElement("div"); container.style.width = "600px"; container.style.height = "800px"; document.body.append(container);
    await older.show(container, () => {}, () => {});
    const chapter = container.querySelector("iframe").contentDocument;
    result.push({ title: older.outline()[0].title, text: chapter.body.textContent.includes("Absatz\u00a01:"), scripts: chapter.querySelectorAll("script").length, policy: !!chapter.querySelector('meta[http-equiv="Content-Security-Policy"]') });
    older.destroy(); container.remove();
    return result;
  });
  assert.match(errors[0], /DRM/);
  assert.match(errors[1], /gültige EPUB/);
  assert.match(errors[2], /150 MiB/);
  assert.equal(errors[3], "pre-paginated");
  assert.deepEqual(errors[4], { title: "Erstes Kapitel", text: true, scripts: 0, policy: true });
  assert.deepEqual(b.errors, []);
});

test("Browser: neue Dateitypen per Dateistart und Dialog öffnen, speichern und formatgerecht umbenennen", { timeout: 90000 }, async (t) => {
  const b = await browser(t);
  await b.command("Page.addScriptToEvaluateOnNewDocument", {
    source: 'Object.defineProperty(window, "launchQueue", { configurable: true, value: { setConsumer(consumer) { window.launchConsumer = consumer; } } });',
  });
  await b.navigate();
  await b.wait(() => !!window.launchConsumer && !!document.querySelector("#welcome .icon"));
  await b.evaluate(async (tiff) => {
    const { epubFixture } = await import("./tests/helpers/formats.mjs");
    const root = await navigator.storage.getDirectory();
    window.formatHandles = [];
    window.originalSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="blue"/></svg>';
    for (const [name, data] of [["Testbuch.epub", await epubFixture()], ["Scan.tif", new Uint8Array(tiff)], ["Vektor.svg", window.originalSvg]]) {
      const handle = await root.getFileHandle(name, { create: true });
      const stream = await handle.createWritable(); await stream.write(data); await stream.close();
      window.formatHandles.push(handle);
    }
    window.launchConsumer({ files: [window.formatHandles[0]] });
  }, [...tiffFixture()]);
  await b.wait(() => !!document.querySelector(".epub-book iframe")?.contentDocument?.querySelector("h1"));
  await b.evaluate(() => {
    document.querySelector("#document-title").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = document.querySelector(".name-editor"); input.value = "Lesebuch.epub";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await b.wait(async () => {
    const { recentFiles } = await import("./src/core/recent.js");
    return (await recentFiles()).some((entry) => entry.name === "Lesebuch.epub");
  });
  await b.evaluate(() => {
    window.showOpenFilePicker = async (options) => {
      window.formatPickerTypes = options.types[0].accept;
      return [{ kind: "file", name: "Verschwunden.webp", getFile: async () => { throw new DOMException("Fehlt", "NotFoundError"); } }, ...window.formatHandles.slice(1)];
    };
    document.querySelector('[data-action="open"]').click();
  });
  await b.wait(() => document.querySelectorAll("#file-list li").length === 3 && !document.querySelector("#busy-dialog").open && document.querySelector("#page-loading").hidden);
  assert.deepEqual(await b.evaluate(() => Object.keys(window.formatPickerTypes)), ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/tiff", "image/svg+xml", "application/epub+zip"]);
  assert.match(await b.evaluate(() => document.querySelector("#toast").textContent), /Verschwunden.webp/);
  await b.evaluate(() => document.querySelector('[data-action="rotate-page"]').click());
  await b.evaluate(() => {
    window.showSaveFilePicker = async (options) => {
      window.savedFormatName = options.suggestedName;
      return (await navigator.storage.getDirectory()).getFileHandle("Export.pdf", { create: true });
    };
    document.querySelector("#save-button").click();
  });
  await b.wait(() => document.querySelector("#toast").textContent.startsWith("Gespeichert"));
  const saved = await b.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const pdf = await (await root.getFileHandle("Export.pdf")).getFile();
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const documentPdf = await (await pdfLib()).PDFDocument.load(await pdf.arrayBuffer());
    return { name: window.savedFormatName, original: await (await window.formatHandles[2].getFile()).text(), expected: window.originalSvg, header: await pdf.slice(0, 5).text(), rotation: documentPdf.getPage(0).getRotation().angle };
  });
  assert.equal(saved.name, "Vektor.pdf");
  assert.equal(saved.original, saved.expected);
  assert.equal(saved.header, "%PDF-");
  assert.equal(saved.rotation, 90);
  await b.evaluate(() => document.querySelector('[data-action="merge"]').click());
  await b.wait(() => document.querySelector("#document-title .document-title-name").textContent === "Zusammengeführt");
  assert.equal(await b.evaluate(() => document.querySelector("#total-pages").textContent), "3");
  await b.evaluate(() => document.querySelector("#recent-button").click());
  await b.wait(() => !document.querySelector("#recent-menu").hidden);
  await b.evaluate(() => {
    const item = [...document.querySelectorAll("#recent-menu .recent-item")].find((item) => item.querySelector("strong").textContent === "Vektor.svg");
    item.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 100 }));
  });
  await b.evaluate(() => [...document.querySelectorAll("#context-menu button")].find((button) => button.textContent === "Umbenennen").click());
  await b.evaluate(() => {
    const input = document.querySelector(".name-editor"); input.value = "Grafik.svg";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await b.wait(async () => {
    const { recentFiles } = await import("./src/core/recent.js");
    return (await recentFiles()).some((entry) => entry.name === "Grafik.svg");
  });
  await selectDocument(b, 0);
  await b.evaluate(() => document.querySelector(".file-close").click());
  await b.evaluate(() => document.querySelector("#recent-button").click());
  await b.wait(() => !document.querySelector("#recent-menu").hidden);
  await b.evaluate(() => [...document.querySelectorAll("#recent-menu .recent-item")].find((item) => item.querySelector("strong").textContent === "Lesebuch.epub").click());
  await b.wait(() => !document.querySelector("#epub-reader").hidden && !!document.querySelector(".epub-book iframe")?.contentDocument?.querySelector("h1"));
  assert.deepEqual(b.errors, []);
});
