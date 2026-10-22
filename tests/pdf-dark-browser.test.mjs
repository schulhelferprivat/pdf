import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";
import { openBlankDocument } from "./helpers/documents.mjs";

test("Browser: PDF Dark Mode färbt Seiten und Scans, erhält eingebettete Bilder und lässt den Export hell", { timeout: 90000 }, async (t) => {
  const b = await browser(t);
  await b.evaluate(async () => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib();
    const pdf = await lib.PDFDocument.create();
    const pngBytes = (canvas) => Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (value) => value.charCodeAt(0));
    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = 20;
    imageCanvas.height = 20;
    imageCanvas.getContext("2d").fillStyle = "#fff";
    imageCanvas.getContext("2d").fillRect(0, 0, 20, 20);
    imageCanvas.getContext("2d").fillStyle = "#e60000";
    imageCanvas.getContext("2d").fillRect(10, 0, 10, 20);
    const image = await pdf.embedPng(pngBytes(imageCanvas));
    const page = pdf.addPage([300, 400]);
    page.drawRectangle({ x: 20, y: 300, width: 60, height: 20, color: lib.rgb(0, 0, 0) });
    page.drawText("Testtext", { x: 20, y: 340, size: 18 });
    page.drawImage(image, { x: 100, y: 230, width: 70, height: 70 });
    const field = pdf.getForm().createTextField("Name");
    field.addToPage(page, { x: 20, y: 150, width: 100, height: 24 });
    const scanCanvas = document.createElement("canvas");
    scanCanvas.width = 300;
    scanCanvas.height = 400;
    const context = scanCanvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 300, 400);
    context.fillStyle = "#000";
    context.fillRect(20, 50, 60, 20);
    context.fillStyle = "#e60000";
    context.fillRect(100, 100, 60, 60);
    const scan = await pdf.embedPng(pngBytes(scanCanvas));
    pdf.addPage([300, 400]).drawImage(scan, { x: 0, y: 0, width: 300, height: 400 });
    const transfer = new DataTransfer();
    transfer.items.add(new File([await pdf.save()], "dark-test.pdf", { type: "application/pdf" }));
    const input = document.querySelector("#file-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await b.wait(() => document.querySelectorAll("#page-list .page-item").length === 2 && document.querySelector("#page-loading").hidden && !document.querySelector("#busy-dialog").open);
  const sample = (x, y, selector = "#page-canvas") => b.evaluate(({ x, y, selector }) => {
    const canvas = document.querySelector(selector);
    const pixel = canvas.getContext("2d").getImageData(
      Math.floor(x * canvas.width / 300),
      Math.floor(y * canvas.height / 400),
      1, 1,
    ).data;
    return [...pixel].slice(0, 3);
  }, { x, y, selector });
  const sampleRatio = (x, y) => b.evaluate(({ x, y }) => {
    const canvas = document.querySelector("#page-canvas");
    return [...canvas.getContext("2d").getImageData(
      Math.floor(x * canvas.width),
      Math.floor(y * canvas.height),
      1, 1,
    ).data].slice(0, 3);
  }, { x, y });
  assert.ok((await sample(10, 10))[0] > 240);
  assert.equal(await b.evaluate(() => document.querySelector("#pdf-dark-button").getAttribute("aria-pressed")), "false");
  await b.evaluate(() => document.querySelector("#pdf-dark-button").click());
  await b.wait(() => document.querySelector("#page-loading").hidden && document.querySelector("#page-canvas").width > 0);
  assert.deepEqual(await sample(10, 10), [32, 35, 41]);
  assert.deepEqual(await sample(30, 90), [232, 237, 242]);
  assert.deepEqual(await sample(110, 110), [255, 255, 255]);
  assert.deepEqual(await sample(150, 110), [230, 0, 0]);
  await b.wait(() => !!document.querySelector("#page-list .page-item:first-child canvas"));
  assert.deepEqual(await sample(10, 10, "#page-list .page-item:first-child canvas"), [32, 35, 41]);
  assert.equal(await b.evaluate(() => document.querySelector("#form-layer input")?.value), "");
  assert.equal(await b.evaluate(() => getComputedStyle(document.querySelector("#form-layer input")).color), "rgb(232, 237, 242)");
  assert.equal(await b.evaluate(() => document.querySelector("#document-title").classList.contains("dirty")), false);
  assert.equal(await b.evaluate(() => document.querySelector("#text-layer").textContent.includes("Testtext")), true);
  await b.evaluate(() => document.querySelector('[data-action="rotate-page"]').click());
  await b.wait(() => document.querySelector("#page-canvas").width > document.querySelector("#page-canvas").height && document.querySelector("#page-loading").hidden);
  assert.deepEqual(await sampleRatio(0.725, 0.367), [255, 255, 255]);
  await b.evaluate(() => document.querySelector('[data-action="undo"]').click());
  await b.wait(() => document.querySelector("#page-canvas").width < document.querySelector("#page-canvas").height && document.querySelector("#page-loading").hidden);
  await b.evaluate(() => document.querySelector("#pdf-dark-button").click());
  await b.wait(() => document.querySelector("#page-loading").hidden);
  assert.deepEqual(await sample(10, 10), [255, 255, 255]);
  await b.evaluate(() => document.querySelector("#pdf-dark-button").click());
  await b.wait(() => document.querySelector("#page-loading").hidden);
  assert.deepEqual(await sample(10, 10), [32, 35, 41]);
  await b.evaluate(() => document.querySelector('[data-action="next"]').click());
  await b.wait(() => document.querySelector("#current-page").value === "2" && document.querySelector("#page-loading").hidden);
  await b.wait(() => !!document.querySelector("#page-flow .page-slot:first-child .page-preview"));
  assert.deepEqual(await sample(10, 10, "#page-flow .page-slot:first-child .page-preview"), [32, 35, 41]);
  assert.deepEqual(await sample(10, 10), [32, 35, 41]);
  assert.deepEqual(await sample(30, 55), [232, 237, 242]);
  assert.deepEqual(await sample(110, 110), [230, 0, 0]);
  await b.evaluate(() => document.querySelector('[data-action="zoom-in"]').click());
  await b.wait(() => document.querySelector("#page-loading").hidden);
  assert.deepEqual(await sample(10, 10), [32, 35, 41]);
  await b.evaluate(() => {
    window.downloads = [];
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.downloads.push(this.href);
    };
    document.querySelector('[data-action="export"]').click();
    document.querySelector("#export-form").requestSubmit();
  });
  await b.wait(() => window.downloads?.length === 1);
  const exported = await b.evaluate(async () => {
    const { pdfJs, renderOptions } = await import("./src/pdf/vendors.js");
    const pdf = (await pdfJs()).getDocument({ ...renderOptions(), data: new Uint8Array(await (await fetch(window.downloads[0])).arrayBuffer()) });
    try {
      const page = await (await pdf.promise).getPage(1);
      const canvas = document.createElement("canvas");
      canvas.width = 300;
      canvas.height = 400;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: page.getViewport({ scale: 1 }), background: "#fff" }).promise;
      return [...canvas.getContext("2d").getImageData(10, 10, 1, 1).data].slice(0, 3);
    } finally {
      await pdf.destroy();
    }
  });
  assert.deepEqual(exported, [255, 255, 255]);
  await openBlankDocument(b);
  assert.deepEqual(await sample(10, 10), [32, 35, 41]);
  await b.navigate();
  await b.wait(() => document.querySelector("#pdf-dark-button")?.getAttribute("aria-pressed") === "true");
  assert.equal(await b.evaluate(() => localStorage.getItem("pdfhelper:pdf-dark")), "true");
  await openBlankDocument(b);
  assert.deepEqual(await sample(10, 10), [32, 35, 41]);
  assert.deepEqual(b.errors, []);
});
