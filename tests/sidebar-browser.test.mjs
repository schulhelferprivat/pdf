import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";
import { openBlankDocument } from "./helpers/documents.mjs";

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
  if (selector === "#sidebar-pin" && !touch) {
    await move(b, 10, 80);
    await settle(b, true);
  }
  const point = await b.evaluate((selector) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  if (selector === "#sidebar-pin")
    assert.equal(await b.evaluate((point) => document.elementFromPoint(point.x, point.y)?.closest("button")?.id, point), "sidebar-pin");
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
  await b.evaluate(() => {
    document.querySelector("#sidebar-pin").click();
    document.activeElement?.blur();
  });
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

test("Browser: Beide Pins sind standardmäßig aktiv, die Sidebar reserviert nur bei mehr Inhalt Platz", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  assert.deepEqual(await b.evaluate(() => ({
    pins: ["toolbar-pin", "sidebar-pin"].map((id) => document.getElementById(id).getAttribute("aria-pressed")),
    oldButton: !!document.querySelector('[data-action="toggle-pages"]'),
    reserved: document.querySelector("#workspace").classList.contains("sidebar-reserved"),
  })), { pins: ["true", "true"], oldButton: false, reserved: false });
  await settle(b, false);
  await move(b, 10, 150);
  await settle(b, true);
  assert.equal(await b.evaluate(() => document.querySelector("#editor").getBoundingClientRect().left), 0);
  await move(b, 700, 500);
  await settle(b, false);
  await openBlankDocument(b);
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
  await move(b, 97, 200);
  await settle(b, false);
  await move(b, 96, 200);
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

test("Browser: Sidebar- und Toolbar-Pins speichern unabhängige Einstellungen", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await b.evaluate(() => document.querySelector("#toolbar-pin").click());
  assert.equal(await b.evaluate(() => document.querySelector("#sidebar-pin").getAttribute("aria-pressed")), "true");
  await unpin(b);
  assert.deepEqual(await b.evaluate(() => ["toolbar", "sidebar"].map((name) => localStorage.getItem(`pdfhelper:${name}-pinned`))), ["false", "false"]);
  await b.navigate();
  await b.wait(() => !!document.querySelector("#sidebar-pin .icon"));
  assert.deepEqual(await b.evaluate(() => ["toolbar-pin", "sidebar-pin"].map((id) => document.getElementById(id).getAttribute("aria-pressed"))), ["false", "false"]);
  await move(b, 10, 150);
  await settle(b, true);
  await click(b, "#sidebar-pin");
  await b.navigate();
  await b.wait(() => document.querySelector("#sidebar-pin .icon") && document.querySelector("#sidebar-pin")?.getAttribute("aria-pressed") === "true");
  assert.equal(await b.evaluate(() => document.querySelector("#toolbar-pin").getAttribute("aria-pressed")), "false");
  assert.deepEqual(b.errors, []);
});

test("Browser: Sidebar bleibt bei Kontextmenü, Tastatur und Größenänderung offen", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await unpin(b);
  await b.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await b.evaluate(() => document.querySelector("#sidebar-pin").focus());
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

test("Browser: Sidebar-Pin bleibt bei überlagerter Toolbar erreichbar und kleine Fenster reservieren höchstens die halbe Breite", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await b.evaluate(() => document.querySelector("#toolbar-pin").click());
  await move(b, 10, 10);
  assert.equal(await b.evaluate(() => {
    const pin = document.querySelector("#sidebar-pin").getBoundingClientRect();
    const toolbar = document.querySelector("#editor-topbar").getBoundingClientRect();
    return pin.top >= toolbar.bottom && document.elementFromPoint(pin.x + pin.width / 2, pin.y + pin.height / 2)?.closest("button")?.id === "sidebar-pin";
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
  await click(b, "#sidebar-pin", true);
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
  await b.wait(() => !!document.querySelector("#sidebar-pin .icon"));
  assert.deepEqual(await b.evaluate(() => ["toolbar-pin", "sidebar-pin"].map((id) => document.getElementById(id).getAttribute("aria-pressed"))), ["true", "true"]);
  await openBlankDocument(b, 3);
  await unpin(b);
  await b.evaluate(() => document.querySelector("#toolbar-pin").click());
  assert.deepEqual(await b.evaluate(() => ["toolbar-pin", "sidebar-pin"].map((id) => document.getElementById(id).getAttribute("aria-pressed"))), ["false", "false"]);
  await b.navigate();
  await b.wait(() => !!document.querySelector("#sidebar-pin .icon"));
  assert.equal(await b.evaluate(() => document.querySelector("#sidebar-pin").getAttribute("aria-pressed")), "true");
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
