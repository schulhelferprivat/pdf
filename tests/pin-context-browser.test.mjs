import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";
import { openBlankDocument } from "./helpers/documents.mjs";

async function key(b, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["keyDown", "keyUp"])
    await b.command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers });
}

async function move(b, x, y) {
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

async function rightClick(b, selector, corner = false) {
  const point = await b.evaluate(({ selector, corner }) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return corner ? { x: rect.right - 3, y: rect.bottom - 3 }
      : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, { selector, corner });
  await move(b, point.x, point.y);
  for (const type of ["mousePressed", "mouseReleased"])
    await b.command("Input.dispatchMouseEvent", { type, ...point, button: "right", clickCount: 1 });
  await b.wait(() => document.querySelector("#context-menu").matches(":popover-open"), 5000).catch(async (error) => {
    throw new Error(`${selector}: ${await b.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 250), point)}`, { cause: error });
  });
}

async function menu(b) {
  return b.evaluate(() => ({
    labels: [...document.querySelectorAll("#context-menu button")].map((button) => button.textContent),
    separators: document.querySelectorAll('#context-menu [role="separator"]').length,
    pins: document.querySelectorAll('#context-menu [data-action^="pin-"]').length,
  }));
}

async function textAnnotation(b) {
  await b.evaluate(() => document.querySelector('[data-tool="text"]').click());
  const point = await b.evaluate(() => {
    const rect = document.querySelector("#page-stage").getBoundingClientRect();
    return { x: rect.x + 80, y: rect.y + 80 };
  });
  await move(b, point.x, point.y);
  for (const type of ["mousePressed", "mouseReleased"])
    await b.command("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  await b.command("Input.insertText", { text: "Notiz" });
  await key(b, "Escape", "Escape", 27);
  await b.wait(() => !!document.querySelector(".annotation-entry"));
  await b.evaluate(() => {
    const section = document.querySelector('[data-side-section="annotations"]');
    if (!section.open) section.querySelector("summary").click();
    document.querySelector('[data-tool="select"]').click();
  });
}

test("Browser: Rechtsklick ergänzt genau eine Pin-Aktion auf Leisten, Buttons, Dateinamen, Seiten und Annotationen", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  assert.equal(await b.evaluate(() => !!document.querySelector("#toolbar-pin, #sidebar-pin")), false);
  await rightClick(b, "#save-button");
  assert.deepEqual(await menu(b), { labels: ["Toolbar entpinnen"], separators: 0, pins: 1 });
  await key(b, "Escape", "Escape", 27);
  await openBlankDocument(b, 3);
  await openBlankDocument(b, 3);
  await textAnnotation(b);
  for (const [selector, label, prefix, corner] of [
    ["#editor-topbar", "Toolbar", [], true],
    ['[data-tool="select"]', "Toolbar", []],
    ["#document-title", "Toolbar", ["Umbenennen", "Dateinamen kopieren", "Schließen"]],
    ["#pages-panel", "Sidebar", [], true],
    ['[data-action="select-all"]', "Sidebar", []],
    [".thumbnail", "Sidebar", ["Links drehen", "Rechts drehen", "Nach vorne", "Nach hinten", "In neues Dokument kopieren"]],
    ["#file-list .file-open", "Sidebar", ["Umbenennen", "Dateinamen kopieren", "Schließen"]],
    [".annotation-entry", "Sidebar", ["Annotation löschen"]],
  ]) {
    await rightClick(b, selector, corner);
    const state = await menu(b);
    assert.equal(state.labels.at(-1), `${label} entpinnen`, selector);
    assert.deepEqual(state.labels.slice(0, prefix.length), prefix, selector);
    assert.equal(state.pins, 1, selector);
    assert.equal(state.separators, prefix.length ? 1 : 0, selector);
    await key(b, "Escape", "Escape", 27);
  }
  await rightClick(b, ".thumbnail");
  await b.evaluate(() => document.querySelector('[data-action="pin-sidebar"]').click());
  await move(b, 700, 500);
  await b.wait(() => !document.querySelector("#workspace").classList.contains("sidebar-visible"));
  assert.equal(await b.evaluate(() => document.querySelector("#context-menu").matches(":popover-open")), false);
  await b.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 844, deviceScaleFactor: 1, mobile: false });
  await rightClick(b, "#save-button");
  assert.equal(await b.evaluate(() => {
    const rect = document.querySelector("#context-menu").getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
  }), true);
  await b.screenshot("/tmp/pdfhelper-pin-context-mobile.png");
  assert.deepEqual(b.errors, []);
});

test("Browser: Leisten-Kontextmenüs sind per Tastatur erreichbar und geben den Fokus nach Aktion und Escape zurück", { timeout: 60000 }, async (t) => {
  const b = await browser(t, { toolbarPinned: false });
  await move(b, 700, 500);
  await key(b, "Tab", "Tab", 9);
  assert.equal(await b.evaluate(() => document.activeElement.id), "editor-topbar");
  await key(b, "ContextMenu", "ContextMenu", 93);
  assert.deepEqual(await menu(b), { labels: ["Toolbar anpinnen"], separators: 0, pins: 1 });
  await key(b, "ArrowDown", "ArrowDown", 40);
  await key(b, "ArrowUp", "ArrowUp", 38);
  await key(b, "Enter", "Enter", 13);
  assert.deepEqual(await b.evaluate(() => [document.activeElement.id, document.querySelector("#editor-topbar").dataset.pinned]), ["editor-topbar", "true"]);
  await key(b, "F10", "F10", 121, 8);
  await key(b, "Enter", "Enter", 13);
  assert.deepEqual(await b.evaluate(() => [document.activeElement.id, document.querySelector("#editor-topbar").dataset.pinned]), ["editor-topbar", "false"]);
  await b.evaluate(() => document.querySelector("#pages-panel").focus());
  await key(b, "F10", "F10", 121, 8);
  assert.deepEqual(await menu(b), { labels: ["Sidebar entpinnen"], separators: 0, pins: 1 });
  await move(b, 700, 500);
  assert.equal(await b.evaluate(() => document.querySelector("#workspace").classList.contains("sidebar-visible")), true);
  await key(b, "Escape", "Escape", 27);
  assert.equal(await b.evaluate(() => document.activeElement.id), "pages-panel");
  await b.evaluate(() => document.activeElement.blur());
  await b.wait(() => !document.querySelector("#workspace").classList.contains("sidebar-visible"));
  assert.deepEqual(b.errors, []);
});

test("Browser: Nach Löschen der letzten Annotation per Tastatur-Kontextmenü erhält die Sidebar den Fokus", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await textAnnotation(b);
  await key(b, "Tab", "Tab", 9);
  await b.evaluate(() => document.querySelector(".annotation-entry").focus());
  await key(b, "F10", "F10", 121, 8);
  assert.deepEqual(await menu(b), { labels: ["Annotation löschen", "Sidebar entpinnen"], separators: 1, pins: 1 });
  await key(b, "Enter", "Enter", 13);
  await b.wait(() => !document.querySelector(".annotation-entry"));
  assert.equal(await b.evaluate(() => document.activeElement.id), "pages-panel");
  assert.deepEqual(b.errors, []);
});
