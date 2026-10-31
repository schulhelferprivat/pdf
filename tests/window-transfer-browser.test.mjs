import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";
import { openBlankDocument, selectDocument } from "./helpers/documents.mjs";

async function dragDocument(b, index = 0) {
  return b.evaluate((index) => {
    const item = document.querySelectorAll("#file-list li")[index];
    const transfer = new DataTransfer();
    item.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const data = transfer.getData("application/x-pdfhelper-document");
    item.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
    return data;
  }, index);
}

async function dropDocument(b, data, index = null) {
  await b.evaluate(({ data, index }) => {
    const transfer = new DataTransfer();
    transfer.setData("application/x-pdfhelper-document", data);
    const target = index === null ? document.body : document.querySelectorAll("#file-list li")[index];
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 5, clientY: rect.top + 1,
    }));
  }, { data, index });
}

async function detachFromMenu(b) {
  await b.evaluate(() => {
    document.querySelector("#document-title").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await b.command("Runtime.evaluate", {
    expression: '[...document.querySelectorAll("#context-menu button")].find((button) => button.textContent === "In eigenem Fenster öffnen").click()',
    userGesture: true,
  });
}

async function waitForPopup(b, previous) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const target = (await b.targets()).find((target) => target.type === "page" && target.url.startsWith(b.url) && !previous.has(target.targetId));
    if (target) return { targetId: target.targetId, window: await b.attachWindow(target.targetId) };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Zusatzfenster wurde nicht geöffnet.");
}

test("Browser: PDF mit Formular und Verlauf herauslösen, zurückziehen und Zusatzfenster schließen", { timeout: 90000 }, async (t) => {
  const b = await browser(t, { prefix: "/PDFHelper/" });
  await b.evaluate(async () => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib(), pdf = await lib.PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    pdf.addPage([595, 842]);
    pdf.getForm().createTextField("Testfeld").addToPage(page, { x: 40, y: 600, width: 200, height: 30 });
    const transfer = new DataTransfer();
    transfer.items.add(new File([await pdf.save()], "Formular.pdf", { type: "application/pdf" }));
    document.querySelector("#file-input").files = transfer.files;
    document.querySelector("#file-input").dispatchEvent(new Event("change"));
  });
  await b.wait(() => document.querySelector("#form-layer input") && document.querySelector("#page-loading").hidden);
  await b.evaluate(() => {
    const field = document.querySelector("#form-layer input");
    field.value = "Erhaltener Testwert";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#page-list .thumbnail").dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    document.querySelector("#undo-button").click();
  });
  await openBlankDocument(b);
  await selectDocument(b, 0);
  await b.wait(() => document.querySelector("#form-layer input") && document.querySelector("#page-loading").hidden);
  await b.evaluate(() => {
    document.querySelectorAll("#page-list .thumbnail")[1].click();
  });
  await b.wait(() => document.querySelector("#current-page").value === "2");
  const originalId = await b.evaluate(() => document.querySelector("#file-list li.active").dataset.document);
  const previous = new Set((await b.targets()).map((target) => target.targetId));
  await detachFromMenu(b);
  const popup = await waitForPopup(b, previous), child = popup.window;
  await child.wait(() => document.querySelectorAll("#file-list li").length === 1 && document.querySelector("#page-loading").hidden && !document.querySelector(".app-shell").inert);
  await b.wait(() => document.querySelectorAll("#file-list li").length === 1 && !document.querySelector(".app-shell").inert);
  assert.deepEqual(await child.evaluate(() => ({
    current: document.querySelector("#current-page").value,
    dirty: document.querySelector("#file-list li").dataset.dirty,
    visible: !document.querySelector('[data-side-section="files"]').hidden,
    redo: document.querySelector("#redo-button").disabled,
  })), { current: "2", dirty: "true", visible: true, redo: false });
  await child.evaluate(() => document.querySelectorAll("#page-list .thumbnail")[0].click());
  await child.wait(() => document.querySelector("#form-layer input"));
  assert.equal(await child.evaluate(() => document.querySelector("#form-layer input").value), "Erhaltener Testwert");
  await child.evaluate(() => document.querySelector("#redo-button").click());
  await child.wait(() => document.querySelector("#page-loading").hidden && document.querySelector("#page-canvas").width > document.querySelector("#page-canvas").height);
  await dropDocument(b, await dragDocument(child), 0);
  await b.wait(() => document.querySelectorAll("#file-list li").length === 2 && !document.querySelector(".app-shell").inert && document.querySelector("#page-loading").hidden);
  assert.equal(await b.evaluate(() => document.querySelector("#file-list li").dataset.document), originalId);
  assert.equal(await b.evaluate(() => document.querySelector("#file-list li.active").dataset.document), originalId);
  assert.equal(await b.evaluate(() => document.querySelector("#form-layer input").value), "Erhaltener Testwert");
  await b.evaluate(() => document.querySelector("#undo-button").click());
  await b.wait(() => document.querySelector("#page-loading").hidden && document.querySelector("#page-canvas").width < document.querySelector("#page-canvas").height);
  const start = Date.now();
  while ((await b.targets()).some((target) => target.targetId === popup.targetId) && Date.now() - start < 10000)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(!(await b.targets()).some((target) => target.targetId === popup.targetId));
  assert.deepEqual(b.errors, []);
});

test("Browser: Drop in leeres Fenster erhält Ursprungsfenster und trennt Dokumente von Dateiimport", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b);
  const originalTargets = await b.targets();
  const second = await b.newTab();
  const nextTarget = (await b.targets()).find((target) => target.type === "page" && !originalTargets.some((previous) => previous.targetId === target.targetId));
  const target = await b.attachWindow(nextTarget.targetId);
  await target.wait(() => document.querySelector("#welcome .icon"));
  const data = await dragDocument(b);
  await second((data) => {
    const transfer = new DataTransfer();
    transfer.setData("application/x-pdfhelper-document", data);
    document.body.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, data);
  assert.deepEqual(await second(() => ({
    documentDrop: document.querySelector("#document-drop-overlay").hidden,
    fileDrop: document.querySelector("#drop-overlay").hidden,
    files: document.querySelector('[data-side-section="files"]').hidden,
  })), { documentDrop: false, fileDrop: true, files: false });
  await dropDocument(target, data);
  await target.wait(() => document.querySelectorAll("#file-list li").length === 1 && !document.querySelector(".app-shell").inert && document.querySelector("#page-loading").hidden);
  await b.wait(() => document.querySelectorAll("#file-list li").length === 0 && !document.querySelector(".app-shell").inert);
  assert.ok(!(await b.evaluate(() => window.closed)));
  await dropDocument(b, await dragDocument(target));
  await b.wait(() => document.querySelectorAll("#file-list li").length === 1 && !document.querySelector(".app-shell").inert);
  await target.wait(() => document.querySelectorAll("#file-list li").length === 0);
  assert.deepEqual(b.errors, []);
});

test("Browser: Blockiertes Fenster bietet erneuten Klick; Escape und interne Drops lösen kein Fenster heraus", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b);
  await b.evaluate(() => {
    window.originalOpen = window.open;
    window.openCalls = 0;
    window.open = () => { window.openCalls++; return null; };
  });
  await detachFromMenu(b);
  assert.deepEqual(await b.evaluate(() => ({
    calls: window.openCalls, count: document.querySelectorAll("#file-list li").length,
    retry: document.querySelector("#detach-retry").textContent, locked: document.querySelector(".app-shell").inert,
  })), { calls: 1, count: 1, retry: "In eigenem Fenster öffnen", locked: false });
  await b.evaluate(() => {
    const fire = (cancel, internal, ambiguous) => {
      const item = document.querySelector("#file-list li"), transfer = new DataTransfer();
      const event = (type, options = {}) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, ...options });
      item.dispatchEvent(event("dragstart"));
      if (cancel) document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      if (internal) document.body.dispatchEvent(event("drop"));
      item.dispatchEvent(event("dragend", { clientX: innerWidth + 20, clientY: 50, screenX: ambiguous ? 0 : 1800, screenY: ambiguous ? 0 : 100 }));
    };
    fire(true, false, false);
    fire(false, true, false);
    fire(false, false, true);
  });
  assert.equal(await b.evaluate(() => window.openCalls), 1);
  await b.evaluate(() => {
    const item = document.querySelector("#file-list li"), transfer = new DataTransfer();
    item.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    item.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer, clientX: innerWidth + 20, clientY: 50, screenX: 1800, screenY: 100 }));
  });
  assert.equal(await b.evaluate(() => window.openCalls), 2);
  const previous = new Set((await b.targets()).map((target) => target.targetId));
  await b.command("Runtime.evaluate", { expression: 'window.open = window.originalOpen; document.querySelector("#detach-retry").click()', userGesture: true });
  const popup = await waitForPopup(b, previous);
  await popup.window.wait(() => document.querySelectorAll("#file-list li").length === 1 && !document.querySelector(".app-shell").inert);
  await b.wait(() => document.querySelectorAll("#file-list li").length === 0);
  assert.deepEqual(b.errors, []);
});

test("Browser: Zusammengeführte Quellen und Bild aus Undo-Verlauf bleiben nach Fensterwechsel verfügbar", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  const originalTargets = new Set((await b.targets()).map((target) => target.targetId));
  await b.newTab();
  const targetInfo = (await b.targets()).find((target) => target.type === "page" && !originalTargets.has(target.targetId));
  const target = await b.attachWindow(targetInfo.targetId);
  await target.wait(() => document.querySelector("#welcome .icon"));
  const data = await b.evaluate(async () => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const { createDocument, createPage, edit } = await import("./src/core/model.js");
    const { packDocument } = await import("./src/core/document-transfer.js");
    const { setupWindowTransfer } = await import("./src/core/window-transfer.js");
    const lib = await pdfLib(), sources = new Map(), pages = [];
    for (const id of ["source-a", "source-b"]) {
      const pdf = await lib.PDFDocument.create();
      pdf.addPage([595, 842]).drawText(id, { x: 30, y: 800, size: 20 });
      sources.set(id, { id, file: new File([await pdf.save()], `${id}.pdf`, { type: "application/pdf" }), password: "", fingerprint: id, handle: null });
      pages.push(createPage(id, 0, { width: 595, height: 842 }, id));
    }
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 20;
    canvas.getContext("2d").fillStyle = "#ff0000";
    canvas.getContext("2d").fillRect(0, 0, 20, 20);
    const file = new File([await new Promise((resolve) => canvas.toBlob(resolve))], "bild.png", { type: "image/png" });
    const assets = new Map([["image-a", { file, mime: "image/png" }]]);
    pages[1].elements.push({ id: "image-element", type: "image", assetId: "image-a", x: 100, y: 100, width: 40, height: 40, rotation: 0 });
    const doc = createDocument("Zusammengeführt", pages);
    doc.origin = "source-a";
    doc.current = pages[1].id;
    doc.selected = [pages[1].id];
    edit(doc, "Seite entfernen", () => { doc.pages.pop(); });
    window.fixtureTransfer = setupWindowTransfer({
      channel: new BroadcastChannel("pdfhelper:document-transfer:/"),
      prepare: () => packDocument(doc, sources, assets),
      release: () => { window.fixtureReleased = true; },
      lock: () => {},
      report: (error) => { throw error; },
    });
    return JSON.stringify(window.fixtureTransfer.offer(doc.id));
  });
  await dropDocument(target, data);
  await target.wait(() => document.querySelectorAll("#page-list .page-item").length === 1 && !document.querySelector(".app-shell").inert && document.querySelector("#page-loading").hidden);
  await b.wait(() => window.fixtureReleased === true);
  await target.evaluate(() => document.querySelector("#undo-button").click());
  await target.wait(() => document.querySelectorAll("#page-list .page-item").length === 2 && document.querySelector("#current-page").value === "2" && document.querySelector(".annotation img")?.complete && document.querySelector("#page-loading").hidden);
  assert.deepEqual(await target.evaluate(() => {
    const image = document.querySelector(".annotation img"), canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    canvas.getContext("2d").drawImage(image, 0, 0, 1, 1);
    return { pixel: [...canvas.getContext("2d").getImageData(0, 0, 1, 1).data], source: image.src.startsWith("blob:"), redo: document.querySelector("#redo-button").disabled };
  }), { pixel: [255, 0, 0, 255], source: true, redo: false });
  await b.evaluate(() => window.fixtureTransfer.close());
  assert.deepEqual(b.errors, []);
});

test("Browser: Dateizugriff und noch fokussierte Formulareingaben bleiben im Zusatzfenster erhalten", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await b.evaluate(async () => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib(), pdf = await lib.PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    pdf.getForm().createTextField("Testfeld").addToPage(page, { x: 40, y: 600, width: 200, height: 30 });
    const directory = await navigator.storage.getDirectory();
    const handle = await directory.getFileHandle("Transfer.pdf", { create: true });
    const stream = await handle.createWritable();
    await stream.write(await pdf.save());
    await stream.close();
    window.showOpenFilePicker = async () => [handle];
    document.querySelector('[data-action="open"]').click();
  });
  await b.wait(() => document.querySelector("#form-layer input") && document.querySelector("#page-loading").hidden);
  await b.evaluate(() => document.querySelector("#form-layer input").focus());
  await b.command("Input.insertText", { text: "Eingabe vor Fensterwechsel" });
  const previous = new Set((await b.targets()).map((target) => target.targetId));
  await detachFromMenu(b);
  const { window: child } = await waitForPopup(b, previous);
  await child.wait(() => document.querySelector("#form-layer input") && document.querySelector("#page-loading").hidden && !document.querySelector(".app-shell").inert);
  assert.equal(await child.evaluate(() => document.querySelector("#form-layer input").value), "Eingabe vor Fensterwechsel");
  await child.evaluate(() => document.querySelector("#save-button").click());
  await child.wait(() => document.querySelector("#toast").textContent === "Gespeichert: Transfer.pdf" && document.querySelector("#file-list li").dataset.dirty === "false");
  assert.equal(await b.evaluate(async () => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const handle = await (await navigator.storage.getDirectory()).getFileHandle("Transfer.pdf");
    const pdf = await (await pdfLib()).PDFDocument.load(await (await handle.getFile()).arrayBuffer());
    return pdf.getForm().getTextField("Testfeld").getText();
  }), "Eingabe vor Fensterwechsel");
  assert.deepEqual(b.errors, []);
});
