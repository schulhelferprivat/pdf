import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";

const ALT = 1,
  SHIFT = 8;

async function openTable(b) {
  await b.evaluate(async () => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib();
    const pdf = await lib.PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(lib.StandardFonts.Helvetica);
    const line = (x1, y1, x2, y2) =>
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.75 });
    for (const y of [760, 730, 600]) line(60, y, 540, y);
    for (const x of [60, 300, 540]) line(x, 760, x, 600);
    const text = (value, x, y) => page.drawText(value, { x, y, size: 11, font });
    text("Erwartete Kompetenzen", 70, 742);
    text("Mögliche Inhalte", 310, 742);
    text("Die Schüler …", 70, 712);
    text("• beschreiben Wünsche", 70, 694);
    text("und nennen Kriterien.", 80, 680);
    text("• Berufswunsch, Frieden", 310, 694);
    text("• intakte Umwelt", 310, 680);
    text("Fußzeile außerhalb", 70, 560);
    const transfer = new DataTransfer();
    transfer.items.add(new File([await pdf.save()], "Tabelle.pdf", { type: "application/pdf" }));
    const input = document.querySelector("#file-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await b.wait(
    () =>
      document.querySelector("#file-list [aria-current=true]")?.textContent === "Tabelle" &&
      document.querySelector("#page-canvas").width > 0 &&
      document.querySelector("#page-loading").hidden &&
      document.querySelector("#text-layer").dataset.page,
    30000,
  );
}

async function screen(b, x, y) {
  return b.evaluate(({ x, y }) => {
    const rect = document.querySelector("#page-stage").getBoundingClientRect(),
      factor = rect.width / 595;
    return { x: rect.left + x * factor, y: rect.top + (842 - y) * factor };
  }, { x, y });
}

async function mouse(b, type, point, modifiers = 0, button = "left") {
  await b.command("Input.dispatchMouseEvent", {
    type,
    ...point,
    modifiers,
    button: type === "mouseMoved" ? "none" : button,
    clickCount: type === "mouseMoved" ? 0 : 1,
  });
}

async function click(b, point, modifiers = 0) {
  await mouse(b, "mouseMoved", point, modifiers);
  await mouse(b, "mousePressed", point, modifiers);
  await mouse(b, "mouseReleased", point, modifiers);
}

async function copied(b) {
  return b.evaluate(() => {
    let text = "";
    const read = (event) => (text = event.defaultPrevented ? event.clipboardData.getData("text/plain") : "");
    document.addEventListener("copy", read);
    document.execCommand("copy");
    document.removeEventListener("copy", read);
    return text;
  });
}

test("table columns can be selected and copied on their own", async (t) => {
  const b = await browser(t);
  await openTable(b);
  const header = await screen(b, 180, 760);
  header.y -= 5;
  await mouse(b, "mouseMoved", header);
  await b.wait(() => document.querySelector("#page-stage").classList.contains("column-target"), 10000);
  assert.equal(
    await b.evaluate(() => getComputedStyle(document.querySelector("#text-layer")).cursor.startsWith("url(")),
    true,
  );
  await click(b, header);
  const left = "Erwartete Kompetenzen\nDie Schüler …\n• beschreiben Wünsche\nund nennen Kriterien.";
  assert.equal(await copied(b), left);
  assert.equal(await b.evaluate(() => CSS.highlights.get("column-selection")?.size > 0), true);
  assert.equal(await b.evaluate(() => getSelection().isCollapsed), true);
  await b.evaluate(() => {
    window.keyboardCopy = null;
    document.addEventListener("copy", (event) => (window.keyboardCopy = event.clipboardData.getData("text/plain")), { once: true });
  });
  for (const type of ["rawKeyDown", "keyUp"])
    await b.command("Input.dispatchKeyEvent", {
      type, key: "c", code: "KeyC", windowsVirtualKeyCode: 67, modifiers: 2, commands: type === "rawKeyDown" ? ["copy"] : [],
    });
  assert.equal(await b.evaluate(() => window.keyboardCopy), left);

  const right = await screen(b, 420, 760);
  right.y -= 5;
  await click(b, right, SHIFT);
  const both = await copied(b);
  assert.match(both, /^Erwartete Kompetenzen Mögliche Inhalte\n/);
  assert.match(both, /• beschreiben Wünsche • Berufswunsch, Frieden/);
  assert.doesNotMatch(both, /Fußzeile/);

  await click(b, right);
  assert.equal(
    await copied(b),
    "Mögliche Inhalte\n• Berufswunsch, Frieden\n• intakte Umwelt",
  );

  await b.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await b.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  assert.equal(await copied(b), "");
  assert.equal(await b.evaluate(() => CSS.highlights.has("column-selection")), false);

  const start = await screen(b, 65, 722),
    end = await screen(b, 295, 675);
  await mouse(b, "mouseMoved", start, ALT);
  await mouse(b, "mousePressed", start, ALT);
  await mouse(b, "mouseMoved", { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, ALT);
  await mouse(b, "mouseMoved", end, ALT);
  await mouse(b, "mouseReleased", end, ALT);
  const body = "Die Schüler …\n• beschreiben Wünsche\nund nennen Kriterien.";
  assert.equal(await copied(b), body);
  assert.equal(await b.evaluate(() => document.querySelectorAll("#block-layer .block-frame").length), 1);

  const width = await b.evaluate(() => document.querySelector("#page-stage").getBoundingClientRect().width);
  await b.evaluate(() => document.querySelector('[data-action="zoom-in"]').click());
  await b.wait(
    (width) =>
      document.querySelector("#page-stage").getBoundingClientRect().width > width + 1 &&
      document.querySelector("#page-loading").hidden &&
      CSS.highlights.get("column-selection")?.size > 0,
    10000,
    width,
  );
  assert.equal(await copied(b), body);

  const inside = await screen(b, 150, 694);
  await mouse(b, "mouseMoved", inside);
  await mouse(b, "mousePressed", inside, 0, "right");
  await mouse(b, "mouseReleased", inside, 0, "right");
  await b.wait(() => document.querySelector("#context-menu").matches(":popover-open"), 5000);
  assert.deepEqual(
    await b.evaluate(() => [...document.querySelectorAll("#context-menu button")].map((button) => button.textContent)),
    ["Kopieren"],
  );
  await b.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await b.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });

  await click(b, inside);
  assert.equal(await copied(b), "");
  assert.deepEqual(b.errors, []);
});

test("the copy area tool selects rectangles without a modifier key", async (t) => {
  const b = await browser(t);
  await openTable(b);
  await b.evaluate(() => document.querySelector('[data-tool="block"]').click());
  assert.deepEqual(
    await b.evaluate(() => ({
      pressed: document.querySelector('[data-tool="block"]').getAttribute("aria-pressed"),
      tool: document.querySelector("#page-stage").dataset.tool,
      cursor: getComputedStyle(document.querySelector("#interaction-layer")).cursor,
      icon: !!document.querySelector('[data-tool="block"] .icon'),
    })),
    { pressed: "true", tool: "block", cursor: "crosshair", icon: true },
  );

  const start = await screen(b, 65, 722),
    end = await screen(b, 295, 675);
  await mouse(b, "mouseMoved", start);
  await mouse(b, "mousePressed", start);
  await mouse(b, "mouseMoved", end);
  await mouse(b, "mouseReleased", end);
  assert.equal(await copied(b), "Die Schüler …\n• beschreiben Wünsche\nund nennen Kriterien.");
  assert.equal(await b.evaluate(() => document.querySelector("#page-stage").dataset.tool), "block");

  const right = await screen(b, 420, 760);
  right.y -= 5;
  await click(b, right);
  assert.equal(await copied(b), "Mögliche Inhalte\n• Berufswunsch, Frieden\n• intakte Umwelt");

  await click(b, await screen(b, 150, 500));
  assert.equal(await copied(b), "");

  await click(b, right);
  assert.notEqual(await copied(b), "");
  await b.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await b.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  assert.equal(await b.evaluate(() => document.querySelector("#page-stage").dataset.tool), "select");
  assert.equal(await copied(b), "");

  await b.evaluate(() => document.querySelector('[data-tool="block"]').click());
  await click(b, right);
  assert.notEqual(await copied(b), "");
  await b.evaluate(() => document.querySelector('[data-tool="text"]').click());
  assert.equal(await copied(b), "");
  assert.deepEqual(b.errors, []);
});
