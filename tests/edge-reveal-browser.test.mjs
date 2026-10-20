import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";

async function move(b, x, y) {
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

async function visible(b, id, shown) {
  await b.wait(({ id, shown }) => {
    const element = document.getElementById(id);
    return getComputedStyle(element).opacity === (shown ? "1" : "0") && element.getAnimations().length === 0;
  }, 5000, { id, shown });
}

async function setup(t, reducedMotion = true) {
  const b = await browser(t, { toolbarPinned: false, reducedMotion });
  await b.evaluate(() => document.querySelector("#sidebar-pin").click());
  await move(b, 700, 400);
  await visible(b, "editor-topbar", false);
  await visible(b, "pages-panel", false);
  return b;
}

test("Browser: Toolbar und Sidebar erscheinen bei Randnähe aus jeder Richtung", { timeout: 60000 }, async (t) => {
  const b = await setup(t);
  for (const [from, to] of [
    [[500, 300], [500, 80]],
    [[500, -10], [500, 20]],
    [[-10, 80], [10, 80]],
    [[1450, 80], [1400, 80]],
  ]) {
    await move(b, 700, 400);
    await visible(b, "editor-topbar", false);
    await move(b, ...from);
    await move(b, ...to);
    await visible(b, "editor-topbar", true);
  }
  for (const [from, to] of [
    [[300, 250], [80, 250]],
    [[80, -10], [80, 20]],
    [[80, 970], [80, 900]],
    [[-10, 250], [20, 250]],
  ]) {
    await move(b, 700, 400);
    await visible(b, "pages-panel", false);
    await move(b, ...from);
    await move(b, ...to);
    await visible(b, "pages-panel", true);
  }
  assert.deepEqual(b.errors, []);
});

test("Browser: Dokumentelemente können die Randerkennung nicht durch gestoppte Mausereignisse blockieren", { timeout: 30000 }, async (t) => {
  const b = await setup(t);
  await b.evaluate(() => {
    for (const type of ["pointermove", "pointerover"])
      document.querySelector("#editor").addEventListener(type, (event) => event.stopPropagation());
  });
  await move(b, 500, 80);
  await visible(b, "editor-topbar", true);
  await move(b, 700, 400);
  await visible(b, "editor-topbar", false);
  await move(b, 80, 250);
  await visible(b, "pages-panel", true);
  await move(b, 700, 400);
  await visible(b, "pages-panel", false);
  assert.deepEqual(b.errors, []);
});

test("Browser: Eintritt in den Randbereich reicht ohne zusätzliches Bewegungsereignis", { timeout: 30000 }, async (t) => {
  const b = await setup(t);
  for (const [id, x, y] of [["editor-topbar", 500, 80], ["pages-panel", 80, 250]]) {
    await b.evaluate(({ x, y }) => document.querySelector("#editor").dispatchEvent(new PointerEvent("pointerover", {
      bubbles: true, pointerType: "mouse", clientX: x, clientY: y,
    })), { x, y });
    await visible(b, id, true);
    await move(b, 701, 400);
    await move(b, 700, 400);
    await visible(b, id, false);
  }
  assert.deepEqual(b.errors, []);
});

test("Browser: Schneller Wechsel vom Rand auf die einfahrende Sidebar hält sie sichtbar", { timeout: 30000 }, async (t) => {
  const b = await setup(t, false);
  await move(b, 80, 250);
  await move(b, 140, 250);
  await visible(b, "pages-panel", true);
  assert.equal(await b.evaluate(() => document.querySelector("#sidebar-pin").getAttribute("aria-pressed")), "false");
  await move(b, 700, 400);
  await visible(b, "pages-panel", false);
  assert.deepEqual(b.errors, []);
});
