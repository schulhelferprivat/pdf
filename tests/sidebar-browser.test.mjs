import { togglePin } from "./helpers/panels.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";
import { openBlankDocument, selectDocument } from "./helpers/documents.mjs";

async function move(b, x, y) {
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

async function settle(b, visible) {
  await b.wait((visible) => {
    const panel = document.querySelector("#pages-panel");
    return getComputedStyle(panel).opacity === (visible ? "1" : "0") && panel.getAnimations().length === 0;
  }, 30000, visible);
}

async function click(b, selector, touch = false) {
  const point = await b.evaluate((selector) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  if (touch) {
    await b.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await b.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await move(b, point.x, point.y);
    for (const type of ["mousePressed", "mouseReleased"])
      await b.command("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  }
}

async function unpin(b) {
  await togglePin(b, "sidebar");
  await b.evaluate(() => document.activeElement?.blur());
  await move(b, 700, 500);
  await settle(b, false);
}

async function geometry(b) {
  return b.evaluate(() => {
    const editor = document.querySelector("#editor").getBoundingClientRect();
    const scroll = document.querySelector("#page-scroll");
    return [editor.left, editor.width, scroll.scrollTop, document.querySelector("#page-canvas").width];
  });
}

async function view(b, action) {
  await b.evaluate((action) => document.querySelector(`[data-action="${action}"]`).click(), action);
  await b.wait(() => document.querySelector("#page-loading").hidden && !document.querySelector("#page-stage").style.scale);
  await b.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test("Browser: Beide Pins sind standardmäßig aktiv, die Sidebar reserviert nur bei mehr Inhalt Platz", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  assert.deepEqual(await b.evaluate(() => ({
    pins: ["editor-topbar", "pages-panel"].map((id) => document.getElementById(id).dataset.pinned),
    oldButton: !!document.querySelector('[data-action="toggle-pages"]'),
    reserved: document.querySelector("#workspace").classList.contains("sidebar-reserved"),
    selectionDisabled: [...document.querySelectorAll(".bulk-select-button")].map((button) => button.disabled),
  })), { pins: ["true", "true"], oldButton: false, reserved: false, selectionDisabled: [true, true] });
  await settle(b, false);
  await move(b, 10, 150);
  await settle(b, true);
  assert.equal(await b.evaluate(() => document.querySelector("#editor").getBoundingClientRect().left), 0);
  await move(b, 700, 500);
  await settle(b, false);
  await openBlankDocument(b);
  assert.deepEqual(await b.evaluate(() => [...document.querySelectorAll(".bulk-select-button")].map((button) => button.disabled)), [false, false]);
  await settle(b, false);
  await openBlankDocument(b);
  await settle(b, true);
  assert.equal(await b.evaluate(() => document.querySelector("#workspace").classList.contains("sidebar-reserved")), true);
  await b.evaluate(() => document.querySelector('#file-list li.active [data-action="close-document"]').click());
  await settle(b, false);
  await openBlankDocument(b, 3);
  await settle(b, true);
  assert.deepEqual(b.errors, []);
});

test("Browser: Sidebar gleitet am linken Rand ein und bleibt über ihrer ganzen Breite bedienbar", { timeout: 60000 }, async (t) => {
  const b = await browser(t, { reducedMotion: false });
  await openBlankDocument(b, 4);
  await unpin(b);
  await b.wait(() => document.querySelector("#page-loading").hidden && Math.abs(document.querySelector("#page-canvas").width - document.querySelector("#page-stage").getBoundingClientRect().width) < 2);
  await b.evaluate(() => { document.querySelector("#page-scroll").scrollTop = 300; });
  const before = await geometry(b);
  const edge = await b.evaluate(() => document.querySelector(".page-slot").getBoundingClientRect().left);
  await move(b, edge, 200);
  await settle(b, false);
  await move(b, edge - 1, 200);
  assert.equal(await b.evaluate(() => document.querySelector("#pages-panel").getAnimations().some((animation) => animation.transitionProperty === "transform")), true);
  await settle(b, true);
  await move(b, 140, 200);
  await settle(b, true);
  assert.deepEqual(await geometry(b), before);
  await move(b, 500, 500);
  await settle(b, false);
  assert.deepEqual(await geometry(b), before);
  assert.equal(await b.evaluate(() => document.elementFromPoint(120, 200)?.closest("#pages-panel") === null), true);
  for (const x of [10, 500, 10]) await move(b, x, 200);
  await settle(b, true);
  await b.screenshot("/tmp/pdfhelper-sidebar-revealed.png");
  assert.deepEqual(b.errors, []);
});

test("Browser: Der ganze linke PDF-Freiraum öffnet die Sidebar, die Seitenkante und PDF-Fläche bleiben ausgenommen", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await unpin(b);
  await view(b, "fit-page");
  const edge = await b.evaluate(() => document.querySelector(".page-slot").getBoundingClientRect().left);
  assert.ok(edge > 200);
  const before = await geometry(b);
  for (const outside of [{ x: edge + 30, y: 300 }, { x: edge - 1, y: -10 }, { x: edge - 1, y: 970 }]) {
    await move(b, outside.x, outside.y);
    await settle(b, false);
    await move(b, edge - 1, 300);
    await settle(b, true);
    assert.deepEqual(await geometry(b), before);
    await move(b, edge + 30, 300);
    await settle(b, false);
  }
  for (const x of [edge, edge + 1, edge + 100]) {
    await move(b, x, 300);
    await settle(b, false);
  }
  await b.screenshot("/tmp/pdfhelper-sidebar-pdf-edge.png");
  assert.deepEqual(b.errors, []);
});

test("Browser: Ruhender Cursor folgt der PDF-Kante bei Zoom und Fensteränderungen", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await unpin(b);
  await move(b, 200, 300);
  await settle(b, false);
  await view(b, "fit-page");
  await settle(b, true);
  await view(b, "fit-width");
  await settle(b, false);
  await view(b, "fit-page");
  await settle(b, true);
  await b.command("Emulation.setDeviceMetricsOverride", { width: 600, height: 960, deviceScaleFactor: 1, mobile: false });
  await settle(b, false);
  await b.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await settle(b, true);
  assert.deepEqual(b.errors, []);
});

test("Browser: Sichtbare Seiten unterschiedlicher Breite begrenzen die Randzone auch beim Scrollen und Dokumentwechsel", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await b.evaluate(async () => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib(), pdf = await lib.PDFDocument.create();
    for (const width of [240, 800, 450]) pdf.addPage([width, 1100]);
    const transfer = new DataTransfer();
    transfer.items.add(new File([await pdf.save()], "Seitenbreiten.pdf", { type: "application/pdf" }));
    const input = document.querySelector("#file-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await b.wait(() => document.querySelectorAll(".page-slot").length === 3 && document.querySelector("#page-loading").hidden);
  await unpin(b);
  await view(b, "fit-page");
  await view(b, "zoom-in");
  const point = await b.evaluate(() => {
    const [first, second] = document.querySelectorAll(".page-slot");
    const a = first.getBoundingClientRect(), c = second.getBoundingClientRect();
    return { x: (a.left + c.left) / 2, second: second.offsetTop, firstBottom: a.bottom, viewportBottom: document.querySelector("#page-scroll").getBoundingClientRect().bottom };
  });
  assert.ok(point.x > 160 && point.firstBottom > point.viewportBottom);
  await move(b, point.x, 300);
  await settle(b, true);
  await b.evaluate((top) => { document.querySelector("#page-scroll").scrollTop = top; }, point.second);
  await settle(b, false);
  await b.evaluate(() => { document.querySelector("#page-scroll").scrollTop = 0; });
  await settle(b, true);
  await b.evaluate(() => { document.querySelector("#page-scroll").scrollTop = 200; });
  await settle(b, false);
  await b.evaluate(() => { document.querySelector("#page-scroll").scrollTop = 0; });
  await settle(b, true);
  await openBlankDocument(b);
  await settle(b, false);
  await selectDocument(b, 0);
  await b.wait(() => document.querySelectorAll(".page-slot").length === 3 && document.querySelector("#page-loading").hidden);
  await settle(b, true);
  assert.deepEqual(b.errors, []);
});

test("Browser: Doppelseiten und horizontales Scrollen lösen die Sidebar niemals über dem PDF aus", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 4);
  await unpin(b);
  await view(b, "fit-page");
  await view(b, "toggle-page-view");
  const row = await b.evaluate(() => {
    const [first, second] = [...document.querySelectorAll(".page-slot")].map((slot) => slot.getBoundingClientRect());
    return { edge: Math.min(first.left, second.left), gap: (first.right + second.left) / 2 };
  });
  for (const x of [row.gap, row.edge, row.edge + 1]) {
    await move(b, x, 300);
    await settle(b, false);
  }
  await move(b, row.edge - 1, 300);
  await settle(b, true);
  await move(b, 700, 300);
  await settle(b, false);
  await view(b, "toggle-page-view");
  await view(b, "fit-width");
  await view(b, "zoom-in");
  await b.evaluate(() => { document.querySelector("#page-scroll").scrollLeft = 100; });
  assert.ok(await b.evaluate(() => document.querySelector(".page-slot").getBoundingClientRect().left <= 0));
  for (const x of [0, 10, 96]) {
    await move(b, x, 300);
    await settle(b, false);
  }
  await b.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await b.evaluate(() => document.querySelector("#pages-panel").focus());
  await settle(b, true);
  assert.deepEqual(b.errors, []);
});

test("Browser: Sidebar- und Toolbar-Pins speichern unabhängige Einstellungen", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await togglePin(b, "toolbar");
  assert.equal(await b.evaluate(() => document.querySelector("#pages-panel").dataset.pinned), "true");
  await unpin(b);
  assert.deepEqual(await b.evaluate(() => ["toolbar", "sidebar"].map((name) => localStorage.getItem(`pdfhelper:${name}-pinned`))), ["false", "false"]);
  await b.navigate();
  await b.wait(() => !!document.querySelector("#pages-panel")?.dataset.pinned);
  assert.deepEqual(await b.evaluate(() => ["editor-topbar", "pages-panel"].map((id) => document.getElementById(id).dataset.pinned)), ["false", "false"]);
  await move(b, 10, 150);
  await settle(b, true);
  await togglePin(b, "sidebar");
  await b.navigate();
  await b.wait(() => document.querySelector("#pages-panel")?.dataset.pinned === "true");
  assert.equal(await b.evaluate(() => document.querySelector("#editor-topbar").dataset.pinned), "false");
  assert.deepEqual(b.errors, []);
});

test("Browser: Sidebar bleibt bei Kontextmenü, Tastatur und Größenänderung offen", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await unpin(b);
  await b.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await b.evaluate(() => document.querySelector("#pages-panel").focus());
  await settle(b, true);
  await move(b, 700, 500);
  await settle(b, true);
  await b.evaluate(() => document.activeElement.blur());
  await settle(b, false);
  await move(b, 10, 150);
  await settle(b, true);
  const point = await b.evaluate(() => {
    const rect = document.querySelector(".thumbnail").getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  for (const type of ["mousePressed", "mouseReleased"])
    await b.command("Input.dispatchMouseEvent", { type, ...point, button: "right", clickCount: 1 });
  await b.wait(() => document.querySelector("#context-menu").matches(":popover-open"));
  await move(b, 700, 500);
  await settle(b, true);
  await b.evaluate(() => document.querySelector("#context-menu").hidePopover());
  await settle(b, false);
  await move(b, 10, 150);
  await settle(b, true);
  const handle = await b.evaluate(() => {
    const rect = document.querySelector("#pages-resizer").getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + 100 };
  });
  await move(b, handle.x, handle.y);
  await b.command("Input.dispatchMouseEvent", { type: "mousePressed", ...handle, button: "left", clickCount: 1 });
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 350, y: handle.y, button: "left", buttons: 1 });
  await settle(b, true);
  assert.equal(await b.evaluate(() => document.querySelector("#pages-panel").getBoundingClientRect().width), 160 + 350 - handle.x);
  await b.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 600, y: handle.y, button: "left", clickCount: 1 });
  await move(b, 700, 500);
  await settle(b, false);
  assert.deepEqual(b.errors, []);
});

test("Browser: Sidebar bleibt bei überlagerter Toolbar bedienbar und kleine Fenster reservieren höchstens die halbe Breite", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await togglePin(b, "toolbar");
  await move(b, 10, 10);
  assert.equal(await b.evaluate(() => {
    const selection = document.querySelector('[data-action="select-all"]').getBoundingClientRect();
    const toolbar = document.querySelector("#editor-topbar").getBoundingClientRect();
    return selection.top >= toolbar.bottom && document.elementFromPoint(selection.x + selection.width / 2, selection.y + selection.height / 2)?.closest("button")?.dataset.action === "select-all";
  }), true);
  for (const width of [600, 390, 320]) {
    await b.command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: false });
    assert.equal(await b.evaluate(() => {
      const sidebar = document.querySelector("#pages-panel").getBoundingClientRect();
      const editor = document.querySelector("#editor").getBoundingClientRect();
      return sidebar.width <= innerWidth / 2 && Math.abs(editor.left - sidebar.width) < 1;
    }), true);
  }
  assert.deepEqual(b.errors, []);
});

test("Browser: Touch-Griff öffnet die gelöste Sidebar und Außentippen schließt sie", { timeout: 60000 }, async (t) => {
  const b = await browser(t, { viewport: { width: 390, height: 844 } });
  await openBlankDocument(b, 3);
  await unpin(b);
  await b.command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await b.wait(() => !document.querySelector("#sidebar-grip").hidden);
  await click(b, "#sidebar-grip", true);
  await settle(b, true);
  await b.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 370, y: 500 }] });
  await b.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await settle(b, false);
  await click(b, "#sidebar-grip", true);
  await settle(b, true);
  await b.evaluate(() => document.querySelector("#pages-panel").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 200 })));
  await click(b, '[data-action="pin-sidebar"]', true);
  assert.equal(await b.evaluate(() => document.querySelector("#workspace").classList.contains("sidebar-reserved")), true);
  await b.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 370, y: 500 }] });
  await b.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await settle(b, true);
  assert.deepEqual(b.errors, []);
});

test("Browser: Blockierter Speicher verwendet aktive Pins und erlaubt Änderungen bis zum Neuladen", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await b.command("Page.addScriptToEvaluateOnNewDocument", {
    source: 'Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blockiert", "SecurityError"); } });',
  });
  await b.navigate();
  await b.wait(() => !!document.querySelector("#pages-panel")?.dataset.pinned);
  assert.deepEqual(await b.evaluate(() => ["editor-topbar", "pages-panel"].map((id) => document.getElementById(id).dataset.pinned)), ["true", "true"]);
  await openBlankDocument(b, 3);
  await unpin(b);
  await togglePin(b, "toolbar");
  assert.deepEqual(await b.evaluate(() => ["editor-topbar", "pages-panel"].map((id) => document.getElementById(id).dataset.pinned)), ["false", "false"]);
  await b.navigate();
  await b.wait(() => !!document.querySelector("#pages-panel")?.dataset.pinned);
  assert.equal(await b.evaluate(() => document.querySelector("#pages-panel").dataset.pinned), "true");
  assert.deepEqual(b.errors, []);
});

test("Browser: Seitenziehen hält die gelöste Sidebar offen und reduzierte Bewegung deaktiviert ihr Gleiten", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await unpin(b);
  await move(b, 10, 200);
  assert.equal(await b.evaluate(() => document.querySelector("#pages-panel").getAnimations().length), 0);
  await b.wait(() => document.querySelector(".thumbnail canvas"));
  await b.evaluate(() => {
    const item = document.querySelector(".page-item"),
      rect = item.getBoundingClientRect();
    item.dispatchEvent(new DragEvent("dragstart", {
      bubbles: true, dataTransfer: new DataTransfer(), clientX: rect.x + 30, clientY: rect.y + 30,
    }));
  });
  await move(b, 700, 500);
  await settle(b, true);
  await b.evaluate(() => document.querySelector(".page-item").dispatchEvent(new DragEvent("dragend", { bubbles: true })));
  await settle(b, false);
  assert.deepEqual(b.errors, []);
});

test("Browser: Mausbewegungen im EPUB-Inhalt blenden die Sidebar wieder aus", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await b.evaluate(async () => {
    const { epubFixture } = await import("./tests/helpers/formats.mjs");
    const transfer = new DataTransfer();
    transfer.items.add(new File([await epubFixture()], "Sidebar.epub"));
    const input = document.querySelector("#file-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await b.wait(() => document.querySelector(".epub-book iframe")?.contentDocument?.querySelector("h1"));
  await settle(b, true);
  await unpin(b);
  await move(b, 10, 200);
  await settle(b, true);
  await move(b, 700, 500);
  await settle(b, false);
  assert.deepEqual(b.errors, []);
});
