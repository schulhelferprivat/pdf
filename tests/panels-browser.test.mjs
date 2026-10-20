import { togglePin } from "./helpers/panels.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";
import { openBlankDocument, selectDocument } from "./helpers/documents.mjs";

async function widths(b) {
  return b.evaluate(() => ["pages", "comments"].map((name) =>
    parseFloat(getComputedStyle(document.getElementById(`${name}-panel`)).width),
  ));
}

async function settle(b) {
  await b.evaluate(async () => {
    await Promise.all(["pages", "comments"].flatMap((name) =>
      document.getElementById(`${name}-panel`).getAnimations().map((animation) =>
        animation.finished.catch(() => {}),
      ),
    ));
  });
}

async function startDrag(b, name) {
  if (name === "pages") {
    await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 200 });
    await b.wait(() => getComputedStyle(document.querySelector("#pages-panel")).opacity === "1");
  }
  const point = await b.evaluate((name) => {
    const rect = document.getElementById(`${name}-resizer`).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + 50 };
  }, name);
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await b.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  return point;
}

async function drag(b, name, delta) {
  const point = await startDrag(b, name);
  point.x += delta;
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "left", buttons: 1 });
  await b.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}

async function doubleClick(b, name) {
  if (name === "pages") {
    await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 200 });
    await b.wait(() => getComputedStyle(document.querySelector("#pages-panel")).opacity === "1");
  }
  const point = await b.evaluate((name) => {
    const rect = document.getElementById(`${name}-resizer`).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + 50 };
  }, name);
  for (const clickCount of [1, 2]) {
    for (const type of ["mousePressed", "mouseReleased"])
      await b.command("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount });
  }
}

async function key(b, name, key, shiftKey = false) {
  return b.evaluate(({ name, key, shiftKey }) => {
    const handle = document.getElementById(`${name}-resizer`);
    handle.focus();
    const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    handle.dispatchEvent(event);
    return event.defaultPrevented;
  }, { name, key, shiftKey });
}

test("Browser: beide Sidebars lassen sich ziehen und per Doppelklick zurücksetzen", { timeout: 90000 }, async (t) => {
  const b = await browser(t, { reducedMotion: false });
  await openBlankDocument(b, 3);
  await b.evaluate(() => document.querySelector('[data-action="toggle-comments"]').click());
  await settle(b);
  const initial = await widths(b);
  assert.equal(initial[0], 160);
  assert.deepEqual(await b.evaluate(() => {
    const rect = document.querySelector(".thumbnail").getBoundingClientRect();
    return [rect.width, rect.height];
  }), [116, 160]);
  const point = await startDrag(b, "pages");
  point.x += 70;
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "left", buttons: 1 });
  assert.deepEqual(await widths(b), [initial[0] + 70, initial[1]]);
  assert.deepEqual(await b.evaluate(() => ({
    selecting: getComputedStyle(document.body).userSelect,
    transition: getComputedStyle(document.getElementById("pages-panel")).transitionDuration,
  })), { selecting: "none", transition: "0s" });
  await b.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  assert.equal(await b.evaluate(() => document.body.classList.contains("resizing-panels")), false);
  await drag(b, "comments", -60);
  assert.deepEqual(await widths(b), [initial[0] + 70, initial[1] + 60]);
  await doubleClick(b, "pages");
  assert.deepEqual(await widths(b), [initial[0], initial[1] + 60]);
  await doubleClick(b, "comments");
  assert.deepEqual(await widths(b), initial);
  assert.equal(await b.evaluate(() => parseFloat(getComputedStyle(document.getElementById("comments-panel")).transitionDuration) > 0), true);
  await drag(b, "pages", -1000);
  assert.equal((await widths(b))[0], 160);
  await drag(b, "comments", 1000);
  assert.equal((await widths(b))[1], 220);
  await drag(b, "pages", 1000);
  await drag(b, "comments", -1000);
  assert.deepEqual(await widths(b), [480, 480]);
  assert.equal(await b.evaluate(() => document.getElementById("page-scroll").scrollWidth <= document.getElementById("page-scroll").clientWidth), true);
  assert.deepEqual(b.errors, []);
});

test("Browser: Sidebar-Tastatursteuerung, Sitzungsbreiten und abgebrochene Gesten", { timeout: 90000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await b.evaluate(() => document.querySelector('[data-action="toggle-comments"]').click());
  const initial = await widths(b);
  await b.evaluate(() => {
    window.separatorKeys = [];
    document.addEventListener("keydown", (event) => window.separatorKeys.push(event.key));
  });
  assert.equal(await key(b, "pages", "ArrowRight"), true);
  await key(b, "comments", "ArrowLeft", true);
  assert.deepEqual(await widths(b), [initial[0] + 10, initial[1] + 50]);
  assert.deepEqual(await b.evaluate(() => window.separatorKeys), []);
  assert.deepEqual(await b.evaluate(() => ["pages", "comments"].map((name) => {
    const handle = document.getElementById(`${name}-resizer`);
    return [handle.getAttribute("role"), handle.getAttribute("aria-orientation"), Number(handle.getAttribute("aria-valuenow"))];
  })), [["separator", "vertical", initial[0] + 10], ["separator", "vertical", initial[1] + 50]]);
  await togglePin(b, "sidebar");
  await b.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector('[data-action="toggle-comments"]').click();
  });
  assert.deepEqual(await b.evaluate(() => [
    !document.querySelector("#workspace").classList.contains("sidebar-visible"),
    document.getElementById("comments-panel").hidden,
  ]), [true, true]);
  await togglePin(b, "sidebar");
  await b.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector('[data-action="toggle-comments"]').click();
  });
  await openBlankDocument(b, 2);
  await selectDocument(b, 0);
  assert.deepEqual(await widths(b), [initial[0] + 10, initial[1] + 50]);
  await key(b, "pages", "Enter");
  assert.equal(await b.evaluate(() => document.getElementById("pages-panel").classList.contains("expanded")), true);
  assert.equal((await widths(b))[0], 200);
  await key(b, "comments", "Enter");
  assert.equal((await widths(b))[1], initial[1]);
  for (const type of ["pointercancel", "lostpointercapture"]) {
    await startDrag(b, "pages");
    await b.evaluate((type) => {
      const handle = document.getElementById("pages-resizer");
      handle.dispatchEvent(new PointerEvent(type, { pointerId: 1 }));
    }, type);
    assert.equal(await b.evaluate(() => document.body.classList.contains("resizing-panels")), false);
    await b.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 300, y: 100, button: "left", clickCount: 1 });
  }
  assert.deepEqual(b.errors, []);
});

test("Browser: manuelle Sidebarbreiten werden bei Fensteränderungen begrenzt und mobil zurückgesetzt", { timeout: 90000 }, async (t) => {
  const b = await browser(t);
  await openBlankDocument(b, 3);
  await b.evaluate(() => document.querySelector('[data-action="toggle-comments"]').click());
  await drag(b, "pages", 1000);
  await drag(b, "comments", -1000);
  await b.command("Emulation.setDeviceMetricsOverride", { width: 900, height: 960, deviceScaleFactor: 1, mobile: false });
  await b.wait(() => ["pages", "comments"].every((name) =>
    Math.abs(parseFloat(getComputedStyle(document.getElementById(`${name}-panel`)).width) - 360) < 1,
  ));
  await key(b, "pages", "Enter");
  await key(b, "comments", "Enter");
  assert.deepEqual(await widths(b), [160, 288]);
  await b.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await b.evaluate(() => {
    document.querySelector('[data-action="toggle-comments"]').click();
    document.activeElement?.blur();
  });
  await togglePin(b, "sidebar");
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 200 });
  await b.wait(() => document.querySelector("#workspace").classList.contains("sidebar-visible"));
  const editorWidth = await b.evaluate(() => document.getElementById("editor").clientWidth);
  await drag(b, "pages", 1000);
  assert.ok(Math.abs((await widths(b))[0] - 331.5) < 1);
  assert.equal(await b.evaluate(() => document.getElementById("editor").clientWidth), editorWidth);
  await doubleClick(b, "pages");
  assert.equal((await widths(b))[0], 160);
  await togglePin(b, "sidebar");
  await b.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector('[data-action="toggle-comments"]').click();
  });
  await drag(b, "comments", -1000);
  assert.equal((await widths(b))[1], 390);
  await doubleClick(b, "comments");
  assert.equal((await widths(b))[1], 320);
  await b.command("Emulation.setDeviceMetricsOverride", { width: 1600, height: 960, deviceScaleFactor: 1, mobile: false });
  await b.wait(() => parseFloat(getComputedStyle(document.getElementById("pages-panel")).width) === 160);
  assert.deepEqual(await widths(b), [160, 288]);
  assert.deepEqual(b.errors, []);
});
