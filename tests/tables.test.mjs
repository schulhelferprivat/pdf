import test from "node:test";
import assert from "node:assert/strict";
import { detectTables } from "../src/core/tables.js";
import { extractTableRules } from "../src/pdf/table-rules.js";

function word(text, x, y, extra = {}) {
  return { text, x, y, width: text.length * 5, height: 10, segment: 0, start: 0, end: text.length, ...extra };
}

function grid(x = 40, y = 60) {
  return [
    word("Artikel", x, y), word("Anzahl", x + 120, y), word("Preis", x + 220, y),
    word("Alpha", x, y + 30), word("2", x + 120, y + 30), word("10", x + 220, y + 30),
    word("Beta", x, y + 60), word("4", x + 120, y + 60), word("20", x + 220, y + 60),
  ];
}

test("Tabellen aus Textpositionen behalten Zelltexte und Zeichenpositionen", () => {
  const words = grid();
  words[0] = word("Artikel", 40, 60, { segment: 7, start: 3, end: 10 });
  const tables = detectTables(words);
  assert.equal(tables.length, 1);
  const table = tables[0];
  assert.equal(table.columns.length, 3);
  assert.deepEqual(table.rows.map((row) => row.cells.map((cell) => cell.text)), [
    ["Artikel", "Anzahl", "Preis"], ["Alpha", "2", "10"], ["Beta", "4", "20"],
  ]);
  assert.equal(table.rows[0].cells[0].words[0], words[0]);
  assert.ok(table.rect.x <= 40 && table.rect.y <= 60);
  assert.ok(table.rect.x + table.rect.width >= 285);
});

test("Leere Zellen und Fragmente derselben Zelle verschieben keine Spalten", () => {
  const words = grid().filter((item) => item.text !== "2");
  words.push(word("Zusatz", 70, 90, { segment: 5, start: 8, end: 14 }));
  const [table] = detectTables(words.reverse());
  assert.equal(table.columns.length, 3);
  assert.deepEqual(table.rows[1].cells.map((cell) => cell.text), ["Alpha Zusatz", "", "10"]);
});

test("Eine einzelne belegte Zeile innerhalb der Tabelle bleibt auswählbar", () => {
  const words = grid().filter((item) => item.y !== 90 || item.text === "Alpha");
  const [table] = detectTables(words);
  assert.equal(table.rows.length, 3);
  assert.deepEqual(table.rows[1].cells.map((cell) => cell.text), ["Alpha", "", ""]);
});

test("Kurze Fortsetzungszeilen werden ihrer Zelle zugeordnet", () => {
  const words = grid();
  words.push(word("Fortsetzung", 40, 103));
  const [table] = detectTables(words);
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[1].cells[0].text, "Alpha Fortsetzung");
});

test("Tabellen untereinander und nebeneinander werden getrennt erkannt", () => {
  assert.equal(detectTables([...grid(), ...grid(40, 300)]).length, 2);
  const twoColumns = grid().filter((item) => item.x < 200);
  const right = twoColumns.map((item) => ({ ...item, x: item.x + 500 }));
  const tables = detectTables([...twoColumns, ...right]);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables.map((table) => table.columns.length), [2, 2]);
  assert.equal(detectTables([...twoColumns, ...right.map((item) => ({ ...item, y: item.y + 15 }))]).length, 2);
});

test("Stilfragmente innerhalb eines Wortes werden ohne zusätzliche Leerzeichen kopiert", () => {
  const words = grid().filter((item) => item.text !== "Alpha");
  words.push(word("Al", 40, 90), word("pha", 50, 90));
  const [table] = detectTables(words);
  assert.equal(table.rows[1].cells[0].text, "Alpha");
});

test("Fließtext, mehrspaltige Absätze und einzelne Textzeilen liefern keine Tabellen", () => {
  const paragraph = (x) => [0, 15, 30, 45].flatMap((y) => {
    let cursor = x;
    return ["Dies", "ist", "ein", "normaler", "Absatz", "mit", "Text."].map((text) => {
      const item = word(text, cursor, y);
      cursor += item.width + 4;
      return item;
    });
  });
  assert.deepEqual(detectTables([]), []);
  assert.deepEqual(detectTables([word("Titel", 40, 20)]), []);
  assert.deepEqual(detectTables(grid().slice(0, 3)), []);
  assert.deepEqual(detectTables(paragraph(40)), []);
  assert.deepEqual(detectTables([...paragraph(40), ...paragraph(500)]), []);
});

test("Mehrdeutige Texte über mehrere Spalten werden keiner Zelle zugeordnet", () => {
  const words = grid();
  const merged = word("Verbundener Zellinhalt über mehrere Spalten", 40, 90);
  words.splice(3, 3, merged);
  const tables = detectTables(words);
  assert.ok(tables.every((table) => table.rows.every((row) =>
    row.cells.every((cell) => !cell.words.includes(merged)),
  )));
});

test("Ungültige und leere Textfragmente werden ignoriert", () => {
  const tables = detectTables([...grid(), word("", 0, 0), word("Fehler", NaN, 0), word("Flach", 0, 0, { height: 0 })]);
  assert.equal(tables.length, 1);
});

test("Gitterlinien bestimmen den sichtbaren Tabellenrand und die Zellgrenzen", () => {
  const rules = [
    ...[30, 145, 245, 300].map((x) => ({ x, y: 50, width: 0, height: 90 })),
    ...[50, 80, 110, 140].map((y) => ({ x: 30, y, width: 270, height: 0 })),
  ];
  const [table] = detectTables(grid(), rules);
  assert.deepEqual(table.rect, { x: 30, y: 50, width: 270, height: 90 });
  assert.deepEqual(table.columns.map((column) => column.rect.x), [30, 145, 245]);
  assert.deepEqual(table.rows.map((row) => row.rect.y), [50, 80, 110]);
  assert.deepEqual(detectTables(grid(), rules.filter((rule) => rule.height === 0)), detectTables(grid()));
});

test("PDF-Linien berücksichtigen Transformationen, Pfadschlüsse und Kurven", () => {
  const ops = { save: 10, restore: 11, transform: 12, stroke: 20, fill: 22, constructPath: 91 };
  const rules = extractTableRules({
    fnArray: [10, 12, 91, 11, 91, 91, 91],
    argsArray: [
      null, [2, 0, 0, 2, 10, 20],
      [20, [new Float32Array([0, 0, 0, 1, 30, 0, 1, 30, 40, 1, 0, 40, 4])]],
      null,
      [20, [new Float32Array([0, 0, 0, 1, 30, 30])]],
      [22, [new Float32Array([0, 0, 0, 1, 100, 0])]],
      [20, [new Float32Array([0, 0, 0, 2, 10, 0, 20, 20, 30, 30, 1, 60, 30])]],
    ],
  }, ops);
  assert.deepEqual(rules, [
    { x: 10, y: -20, width: 60, height: 0 },
    { x: 70, y: -100, width: 0, height: 80 },
    { x: 10, y: -100, width: 60, height: 0 },
    { x: 10, y: -100, width: 0, height: 80 },
    { x: 30, y: -30, width: 30, height: 0 },
  ]);
});
