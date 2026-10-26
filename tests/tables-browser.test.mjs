import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";

async function openTables(b) {
  await b.evaluate(async () => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib();
    const pdf = await lib.PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const rows = [["Artikel", "Anzahl", "Preis"], ["Alpha Zusatz", "", "10"], ["Beta", "4", "20"]];
    for (const top of [720, 450]) {
      for (let column = 0; column < 3; column++) {
        for (let row = 0; row < rows.length; row++) {
          if (rows[row][column]) page.drawText(rows[row][column], { x: [60, 220, 360][column], y: top - row * 32, size: 12 });
        }
      }
      if (top === 450) {
        for (const x of [50, 200, 340, 440])
          page.drawLine({ start: { x, y: top + 20 }, end: { x, y: top - 80 }, thickness: 1 });
        for (const y of [top + 20, top - 12, top - 44, top - 80])
          page.drawLine({ start: { x: 50, y }, end: { x: 440, y }, thickness: 1 });
      }
    }
    pdf.addPage([595, 842]);
    const transfer = new DataTransfer();
    transfer.items.add(new File([await pdf.save()], "Tabellen.pdf", { type: "application/pdf" }));
    const input = document.querySelector("#file-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await b.wait(() => !document.querySelector("#busy-dialog").open &&
    document.querySelector("#page-loading").hidden && document.querySelectorAll(".table-select-arrow").length === 12);
}

function selector(axis, index, table = 0) {
  return `.table-select-arrow[data-table="${table}"][data-table-axis="${axis}"][data-table-index="${index}"]`;
}

async function copy(b) {
  return b.evaluate(() => {
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData });
    document.body.dispatchEvent(event);
    return { text: clipboardData.getData("text/plain"), handled: event.defaultPrevented };
  });
}

async function clickArrow(b, axis, index, table = 0) {
  const target = selector(axis, index, table);
  await b.evaluate((target) => {
    const button = document.querySelector(target);
    button.scrollIntoView({ block: "center", inline: "center" });
  }, target);
  const edge = await b.evaluate((target) => {
    const button = document.querySelector(target);
    const rect = button.getBoundingClientRect();
    return button.textContent === "↓"
      ? { x: rect.left + rect.width / 2, y: rect.bottom + 1 }
      : { x: rect.right + 1, y: rect.top + rect.height / 2 };
  }, target);
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: edge.x + 2, y: edge.y });
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...edge });
  const point = await b.evaluate((target) => {
    const rect = document.querySelector(target).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, target);
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  for (const type of ["mousePressed", "mouseReleased"])
    await b.command("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
}

test("Browser: Tabellenpfeile wählen ausschließlich Zeilen und Spalten aus", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openTables(b);
  assert.ok(await b.evaluate((target) => {
    const stage = document.querySelector("#page-stage").getBoundingClientRect();
    const arrow = document.querySelector(target).getBoundingClientRect();
    return Math.abs(arrow.bottom - stage.top - (842 - 470) * stage.width / 595) < 1;
  }, selector("column", 1, 1)));
  assert.equal(await b.evaluate(() => document.querySelectorAll(".table-select-arrow.visible").length), 0);
  const edge = await b.evaluate((target) => {
    const rect = document.querySelector(target).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.bottom + 1 };
  }, selector("column", 1));
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...edge });
  assert.deepEqual(await b.evaluate(() => [...document.querySelectorAll(".table-select-arrow.visible")].map((button) => button.dataset.tableAxis)), ["column"]);
  await clickArrow(b, "column", 1);
  assert.deepEqual(await copy(b), { text: "Anzahl\n\n4", handled: true });
  assert.equal(await b.evaluate(() => document.querySelectorAll(".table-selection-part").length), 2);
  const inside = await b.evaluate(() => {
    const span = [...document.querySelectorAll("#text-layer span")].find((item) => item.textContent === "Beta");
    const rect = span.getBoundingClientRect();
    return { x: rect.right + 30, y: rect.top + rect.height / 2 };
  });
  await b.evaluate(() => document.activeElement.blur());
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...inside });
  assert.equal(await b.evaluate(() => document.querySelectorAll(".table-select-arrow.visible").length), 0);
  assert.deepEqual(await copy(b), { text: "Anzahl\n\n4", handled: true });

  const left = await b.evaluate((target) => {
    const rect = document.querySelector(target).getBoundingClientRect();
    return { x: rect.right + 1, y: rect.top + rect.height / 2 };
  }, selector("row", 1));
  await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...left });
  assert.deepEqual(await b.evaluate(() => [...document.querySelectorAll(".table-select-arrow.visible")].map((button) => button.dataset.tableAxis)), ["row"]);
  await clickArrow(b, "row", 1);
  assert.deepEqual(await copy(b), { text: "Alpha Zusatz\t\t10", handled: true });

  await b.evaluate(() => {
    navigator.clipboard.writeText = async (text) => { window.tableCopiedText = text; };
    document.querySelector("#page-stage").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 500, clientY: 300 }));
    [...document.querySelectorAll("#context-menu button")].find((button) => button.textContent === "Kopieren").click();
  });
  assert.equal(await b.evaluate(() => window.tableCopiedText), "Alpha Zusatz\t\t10");
  await b.evaluate(() => document.querySelector('[data-tool="highlight"]').click());
  await b.wait(() => document.querySelectorAll('.annotation[data-type="highlight"]').length === 1);
  assert.equal(await b.evaluate(() => document.querySelectorAll(".highlight-part").length), 2);
  assert.equal(await b.evaluate(() => document.querySelectorAll(".table-selection-part").length), 0);
  await b.evaluate(() => document.querySelector('[data-action="undo"]').click());
  await b.wait(() => !document.querySelector('.annotation[data-type="highlight"]'));
  await clickArrow(b, "column", 0);
  await b.evaluate(() => document.querySelector('[data-tool="highlight"]').click());
  await b.wait(() => document.querySelectorAll('.annotation[data-type="highlight"]').length === 1);
  assert.equal(await b.evaluate(() => document.querySelectorAll(".highlight-part").length), 3);
  assert.equal(await b.evaluate(() => {
    const otherCells = [...document.querySelectorAll("#text-layer span")]
      .filter((span) => ["Anzahl", "Preis", "4", "10", "20"].includes(span.textContent))
      .map((span) => span.getBoundingClientRect());
    return [...document.querySelectorAll(".highlight-part")].some((part) => {
      const rect = part.getBoundingClientRect();
      return otherCells.some((cell) => rect.left < cell.right && rect.right > cell.left && rect.top < cell.bottom && rect.bottom > cell.top);
    });
  }), false);
  assert.deepEqual(b.errors, []);
});

test("Browser: Tabellenauswahl folgt Zoom und Drehung und lässt sich aufheben", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openTables(b);
  await b.evaluate((target) => document.querySelector(target).focus(), selector("column", 0));
  assert.equal(await b.evaluate(() => getComputedStyle(document.activeElement).opacity), "1");
  await b.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
  await b.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  assert.deepEqual(await copy(b), { text: "Artikel\nAlpha Zusatz\nBeta", handled: true });
  await b.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  assert.equal((await copy(b)).handled, false);
  await b.command("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", text: " ", windowsVirtualKeyCode: 32 });
  await b.command("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  assert.deepEqual(await copy(b), { text: "Artikel\nAlpha Zusatz\nBeta", handled: true });

  await clickArrow(b, "row", 2);
  await b.evaluate(() => document.querySelector('[data-tool="draw"]').click());
  assert.equal((await copy(b)).handled, false);
  assert.equal(await b.evaluate(() => [...document.querySelectorAll(".table-select-arrow")].every((button) => getComputedStyle(button).display === "none")), true);
  await b.evaluate(() => document.querySelector('[data-tool="select"]').click());

  await clickArrow(b, "column", 2);
  await b.evaluate(() => {
    const span = document.querySelector("#text-layer span");
    span.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  assert.equal((await copy(b)).handled, false);
  await b.evaluate(() => getSelection().removeAllRanges());

  await b.evaluate(() => document.querySelector('[data-action="zoom-in"]').click());
  await b.wait(() => document.querySelector("#page-loading").hidden && document.querySelectorAll(".table-select-arrow").length === 12);
  assert.equal(await b.evaluate((target) => document.querySelector(target).getBoundingClientRect().width, selector("column", 0)), 24);
  await clickArrow(b, "column", 2);
  assert.deepEqual(await copy(b), { text: "Preis\n10\n20", handled: true });

  for (let turn = 0; turn < 4; turn++) {
    await b.evaluate(() => document.querySelector('[data-action="rotate-page"]').click());
    await b.wait(() => document.querySelector("#page-loading").hidden && document.querySelectorAll(".table-select-arrow").length === 12);
    assert.equal((await copy(b)).handled, false);
    await clickArrow(b, "column", 0);
    assert.deepEqual(await copy(b), { text: "Artikel\nAlpha Zusatz\nBeta", handled: true });
  }
  await clickArrow(b, "row", 2, 1);
  assert.deepEqual(await copy(b), { text: "Beta\t4\t20", handled: true });
  await b.evaluate(() => document.querySelector('[data-action="next"]').click());
  await b.wait(() => document.querySelector("#current-page").value === "2" && document.querySelector("#page-loading").hidden);
  assert.equal(await b.evaluate(() => document.querySelectorAll(".table-select-arrow, .table-selection-part").length), 0);
  assert.equal((await copy(b)).handled, false);
  assert.deepEqual(b.errors, []);
});
