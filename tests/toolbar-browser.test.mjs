import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { browser as createBrowser } from "./helpers/browser.mjs";
import { openBlankDocument } from "./helpers/documents.mjs";

const browser = (t, options = {}) => createBrowser(t, { toolbarPinned: false, ...options });

async function move(b, x, y) {
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

async function settled(b, visible) {
  await b.wait((visible) => {
    const toolbar = document.querySelector("#editor-topbar");
    return getComputedStyle(toolbar).opacity === (visible ? "1" : "0") &&
      toolbar.getAnimations().length === 0;
  }, 30000, visible);
}

async function click(b, selector) {
  const point = await b.evaluate((selector) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  await move(b, point.x, point.y);
  for (const type of ["mousePressed", "mouseReleased"])
    await b.command("Input.dispatchMouseEvent", {
      type, ...point, button: "left", clickCount: 1,
    });
}

async function geometry(b) {
  return b.evaluate(() => {
    const workspace = document.querySelector("#workspace").getBoundingClientRect();
    const scroll = document.querySelector("#page-scroll");
    return {
      top: workspace.top,
      height: workspace.height,
      width: document.querySelector("#page-canvas").width,
      scroll: scroll.scrollTop,
    };
  });
}

test("Browser: Toolbar gleitet bei Mausnähe ein, ohne das Dokument zu verschieben", { timeout: 60000 }, async (t) => {
  const b = await browser(t, { reducedMotion: false });
  await move(b, 500, 300);
  await settled(b, false);
  assert.deepEqual(await b.evaluate(() => ({
    pointerEvents: getComputedStyle(document.querySelector("#editor-topbar")).pointerEvents,
    workspaceTop: document.querySelector("#workspace").getBoundingClientRect().top,
    hitToolbar: !!document.elementFromPoint(500, 10)?.closest("#editor-topbar"),
  })), { pointerEvents: "none", workspaceTop: 0, hitToolbar: false });
  await openBlankDocument(b, 4);
  await b.evaluate(() => { document.querySelector("#page-scroll").scrollTop = 300; });
  const before = await geometry(b);
  await move(b, 500, 97);
  await settled(b, false);
  await move(b, 500, 96);
  assert.equal(await b.evaluate(() => document.querySelector(".app-shell").classList.contains("toolbar-visible")), true);
  assert.equal(await b.evaluate(() => document.querySelector("#editor-topbar").getAnimations().some((animation) => animation.transitionProperty === "transform")), true);
  await settled(b, true);
  assert.deepEqual(await geometry(b), before);
  await click(b, '[data-tool="select"]');
  await move(b, 500, 300);
  await settled(b, false);
  assert.deepEqual(await geometry(b), before);
  for (const y of [10, 300, 10]) await move(b, 500, y);
  await settled(b, true);
  await b.screenshot("/tmp/pdfhelper-toolbar-revealed.png");
  await move(b, -10, -10);
  await settled(b, false);
  await move(b, 10, 50);
  await settled(b, true);
  await move(b, 10, 300);
  await settled(b, false);
  assert.deepEqual(b.errors, []);
});

test("Browser: Pin reserviert Platz, bleibt gespeichert und ist bei schmalen Fenstern erreichbar", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await b.evaluate(() => { document.querySelector("#page-scroll").scrollTop = 300; });
  const before = await geometry(b);
  await move(b, 500, 10);
  await settled(b, true);
  assert.equal((await geometry(b)).scroll, before.scroll);
  await click(b, "#toolbar-pin");
  await move(b, 500, 300);
  await settled(b, true);
  assert.deepEqual(await b.evaluate(() => ({
    pinned: document.querySelector("#toolbar-pin").getAttribute("aria-pressed"),
    label: document.querySelector("#toolbar-pin").title,
    stored: localStorage.getItem("pdfhelper:toolbar-pinned"),
    top: document.querySelector("#workspace").getBoundingClientRect().top,
  })), { pinned: "true", label: "Toolbar lösen", stored: "true", top: 43 });
  await b.navigate();
  await b.wait(() => document.querySelector("#toolbar-pin")?.getAttribute("aria-pressed") === "true");
  await settled(b, true);
  assert.equal((await geometry(b)).top, 43);
  const otherTab = await b.newTab();
  assert.equal(await otherTab(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (document.querySelector("#toolbar-pin")?.getAttribute("aria-pressed") === "true") return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }), true);
  for (const width of [768, 390, 320]) {
    await b.command("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false });
    assert.equal(await b.evaluate(() => {
      const rect = document.querySelector("#toolbar-pin").getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth &&
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button")?.id === "toolbar-pin";
    }), true);
  }
  await click(b, "#toolbar-pin");
  await move(b, 200, 300);
  await settled(b, false);
  assert.equal((await geometry(b)).top, 0);
  await b.navigate();
  await b.wait(() => !!document.querySelector("#toolbar-pin .icon"));
  await move(b, 200, 300);
  await settled(b, false);
  assert.deepEqual(b.errors, []);
});

test("Browser: Toolbar bleibt bei Tastaturbedienung und offenen Menüs sichtbar und lässt die Suche frei", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await move(b, 500, 300);
  await settled(b, false);
  for (const type of ["keyDown", "keyUp"])
    await b.command("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await settled(b, true);
  assert.equal(await b.evaluate(() => document.querySelector("#editor-topbar").contains(document.activeElement)), true);
  await click(b, "#recent-button");
  await move(b, 500, 300);
  await b.wait(() => !document.querySelector("#recent-menu").hidden);
  await settled(b, true);
  await click(b, "#recent-button");
  await move(b, 500, 300);
  await settled(b, false);
  await openBlankDocument(b);
  await b.evaluate(() => document.querySelector('[data-action="rotate-page"]').click());
  await b.wait(() => document.querySelector("#page-loading").hidden);
  for (const [selector, id] of [["#history-button", "history-menu"], ['[data-style-tool="text"]', "tool-style-menu"]]) {
    await move(b, 500, 10);
    await settled(b, true);
    await click(b, selector);
    await move(b, 500, 500);
    await b.wait((id) => document.getElementById(id).matches(":popover-open"), 30000, id);
    await settled(b, true);
    assert.equal(await b.evaluate((id) => document.getElementById(id).getBoundingClientRect().top >= document.querySelector("#editor-topbar").getBoundingClientRect().bottom, id), true);
    await click(b, selector);
    await move(b, 500, 300);
    await settled(b, false);
  }
  await b.evaluate(() => document.querySelector("#search-button").click());
  await move(b, 500, 10);
  await settled(b, true);
  assert.equal(await b.evaluate(() => document.querySelector("#search-bar").getBoundingClientRect().top >= document.querySelector("#editor-topbar").getBoundingClientRect().bottom), true);
  await click(b, '[data-action="search-close"]');
  await move(b, 500, 300);
  await settled(b, false);
  assert.deepEqual(b.errors, []);
});

test("Browser: Blockierter Einstellungsspeicher verhindert das Festpinnen nicht", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await b.command("Page.addScriptToEvaluateOnNewDocument", {
    source: 'Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blockiert", "SecurityError"); } });',
  });
  await b.navigate();
  await b.wait(() => !!document.querySelector("#toolbar-pin .icon"));
  await move(b, 500, 300);
  await settled(b, true);
  assert.equal((await geometry(b)).top, 43);
  await click(b, "#toolbar-pin");
  await move(b, 500, 300);
  await settled(b, false);
  await move(b, 500, 10);
  await settled(b, true);
  await click(b, "#toolbar-pin");
  await move(b, 500, 300);
  await settled(b, true);
  assert.deepEqual(b.errors, []);
});

test("Browser: Reduzierte Bewegung und Touch behalten die Toolbar bedienbar", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await move(b, 500, 300);
  await settled(b, false);
  await move(b, 500, 10);
  assert.equal(await b.evaluate(() => document.querySelector("#editor-topbar").getAnimations().length), 0);
  await b.command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await move(b, 500, 300);
  await b.wait(() => matchMedia("(hover: none)").matches);
  await settled(b, true);
  assert.equal((await geometry(b)).top, 43);
  assert.equal(await b.evaluate(() => document.querySelector("#toolbar-pin").getAttribute("aria-pressed")), "false");
  await b.command("Emulation.setTouchEmulationEnabled", { enabled: false });
  await settled(b, false);
  assert.equal((await geometry(b)).top, 0);
  assert.deepEqual(b.errors, []);
});

test("Browser: Toolbar blendet auch beim Wechsel in den EPUB-Buchinhalt aus", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await b.evaluate(async () => {
    const { epubFixture } = await import("./tests/helpers/formats.mjs");
    const transfer = new DataTransfer();
    transfer.items.add(new File([await epubFixture()], "Testbuch.epub"));
    const input = document.querySelector("#file-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await b.wait(() => document.querySelector(".epub-book iframe")?.contentDocument?.querySelector("h1"));
  await move(b, 500, 10);
  await settled(b, true);
  await move(b, 500, 300);
  await settled(b, false);
  await move(b, 500, 80);
  await settled(b, true);
  await move(b, 500, 500);
  await settled(b, false);
  assert.deepEqual(b.errors, []);
});

test("Browser: Simulierte macOS- und Windows-Fensterbereiche bleiben stationär", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  const css = await readFile(new URL("../src/ui/app.css", import.meta.url), "utf8");
  b.override("src/ui/app.css", css.replaceAll("(display-mode: window-controls-overlay)", "(min-width: 0px)"));
  await b.navigate();
  await b.wait(() => !!document.querySelector("#toolbar-pin .icon"));
  for (const [left, right] of [[80, 0], [0, 140]]) {
    await b.evaluate(({ left, right }) => {
      const style = document.documentElement.style;
      style.setProperty("--wco-height", "32px");
      style.setProperty("--wco-left", `${left}px`);
      style.setProperty("--wco-right", `${right}px`);
    }, { left, right });
    await move(b, 500, 300);
    await settled(b, false);
    assert.equal((await geometry(b)).top, 32);
    assert.equal(await b.evaluate(() => getComputedStyle(document.querySelector(".toolbar-frame")).getPropertyValue("app-region")), "drag");
    await move(b, 500, 50);
    await settled(b, true);
    assert.equal((await geometry(b)).top, 32);
    assert.equal(await b.evaluate(({ left, right }) => {
      const first = document.querySelector("#editor-topbar button").getBoundingClientRect();
      const last = document.querySelector("#toolbar-pin").getBoundingClientRect();
      return first.left >= left && last.right <= innerWidth - right;
    }, { left, right }), true);
    await click(b, "#toolbar-pin");
    await move(b, 500, 300);
    await settled(b, true);
    assert.equal((await geometry(b)).top, 43);
    await click(b, "#toolbar-pin");
    await b.command("Emulation.setDeviceMetricsOverride", { width: 320, height: 960, deviceScaleFactor: 1, mobile: false });
    await move(b, 150, 50);
    await settled(b, true);
    assert.equal(await b.evaluate(({ right }) => {
      const rect = document.querySelector("#toolbar-pin").getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth - right &&
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button")?.id === "toolbar-pin";
    }, { right }), true);
    await b.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  }
  assert.deepEqual(b.errors, []);
});
