import test from "node:test";
import assert from "node:assert/strict";
import { generateOutline } from "../src/pdf/outline.js";
import { Renderer } from "../src/pdf/renderer.js";

function text(str, y, size = 12, x = 40, extra = {}) {
  return { str, transform: [size, 0, 0, size, x, 800 - y], width: str.length * size * 0.45, fontName: `font-${size}`, ...extra };
}

function body(y) {
  return [0, 18, 36, 54].map((offset) => text("Dies ist ein längerer Absatz mit normalem Fließtext im Dokument.", y + offset));
}

function page(items, tree = null) {
  return {
    getTextContent: async () => ({ items }),
    getStructTree: async () => tree,
    getViewport: () => ({ height: 800, convertToViewportPoint: (x, y) => [x, 800 - y] }),
  };
}

function pdf(pages) {
  return { numPages: pages.length, getPage: async (number) => pages[number - 1], getOutline: async () => null };
}

function entry(title, index, items = []) {
  return { title, index, items, open: true };
}

test("Automatische Gliederung erkennt Kapitel, Unterkapitel und Textfragmente", async () => {
  const pages = ["Einleitung", "Ergebnisse"].map((title, index) => page([
    text(title, 80, 24), ...body(120),
    text("Details", 250, 18), text(` ${index + 1}`, 250, 18, 96.7), ...body(285),
  ]));
  assert.deepEqual(await generateOutline(pdf(pages)), [
    entry("Einleitung", 0, [entry("Details 1", 0)]),
    entry("Ergebnisse", 1, [entry("Details 2", 1)]),
  ]);
});

test("Mehrzeilige Überschriften werden verbunden und Kopfzeilen entfernt", async () => {
  const pages = ["Lange Einleitung", "Weitere Ergebnisse"].map((title, index) => page([
    text("Handbuch", 28, 28), text(title, 130, 24), text("zum aktuellen Thema", 159, 24),
    ...body(200), text(`Seite ${index + 1}`, 775, 18),
  ]));
  assert.deepEqual(await generateOutline(pdf(pages)), [
    entry("Lange Einleitung zum aktuellen Thema", 0), entry("Weitere Ergebnisse zum aktuellen Thema", 1),
  ]);
});

test("Kapitelnummern unterstützen eine moderate, wiederkehrende Schriftvergrößerung", async () => {
  const pages = ["1 Einleitung", "2 Ergebnisse"].map((title) => page([
    text(title, 150, 14), ...body(180),
  ]));
  assert.deepEqual(await generateOutline(pdf(pages)), [entry("1 Einleitung", 0), entry("2 Ergebnisse", 1)]);
});

test("Fließtext, Bildscans, Titel, Tabellen und isolierte Hervorhebungen bleiben ohne Gliederung", async () => {
  const cases = [
    [page([]), page([])],
    [page(body(80)), page(body(80))],
    [page([text("Dokumenttitel", 80, 24), ...body(120)]), page(body(80))],
    [page([text("Nur groß", 80, 24)]), page([text("Auch groß", 80, 24)])],
    [page([text("Hinweis", 80, 24), ...body(120)]), page([text("Achtung", 80, 20), ...body(120)])],
    ["Umsatz", "Kosten"].map((title) => page([
      text(title, 80, 24), text("2026", 80, 24, 300), ...body(120),
    ])),
    ["Ein wichtiger Satz.", "Noch ein wichtiger Satz."].map((title) => page([text(title, 80, 24), ...body(120)])),
    ["Einleitung", "Ergebnisse"].map((title) => page([...body(80), text(title, 155, 24), ...body(190)])),
    ["1. Erster Punkt", "2. Zweiter Punkt"].map((title) => page([text(title, 80), ...body(110)])),
  ];
  for (const pages of cases) assert.deepEqual(await generateOutline(pdf(pages)), []);
});

function taggedPage(title, level, index) {
  const id = `p${index}_mc0`;
  return page([
    { type: "beginMarkedContentProps", id },
    { type: "beginMarkedContent", tag: "Span" },
    text(title, 150),
    { type: "endMarkedContent" }, { type: "endMarkedContent" },
    ...body(190),
  ], { role: "Root", children: [{ role: level, children: [{ type: "content", id }] }] });
}

test("Markierte Überschriften liefern auch bei gleicher Schriftgröße eine Hierarchie", async () => {
  assert.deepEqual(await generateOutline(pdf([
    taggedPage("Einleitung", "H1", 0), taggedPage("Details", "H2", 1), taggedPage("Ergebnisse", "H1", 2),
  ])), [entry("Einleitung", 0, [entry("Details", 1)]), entry("Ergebnisse", 2)]);
});

test("Eine einzelne markierte Überschrift verhindert den optischen Fallback nicht", async () => {
  assert.deepEqual(await generateOutline(pdf([
    taggedPage("Titel", "H1", 0),
    page([text("Einleitung", 150, 24), ...body(190)]),
    page([text("Ergebnisse", 150, 24), ...body(190)]),
  ])), [entry("Einleitung", 1), entry("Ergebnisse", 2)]);
});

test("Artefakte und leere oder wiederholte Markierungen erzeugen keine Einträge", async () => {
  const first = taggedPage("Kopfzeile", "H1", 0);
  const second = taggedPage("Kopfzeile", "H1", 1);
  assert.deepEqual(await generateOutline(pdf([first, second])), []);
  const artifacts = ["Einleitung", "Ergebnisse"].map((title) => page([
    { type: "beginMarkedContent", tag: "Artifact" }, text(title, 80, 24),
    { type: "endMarkedContent" }, ...body(120),
  ]));
  assert.deepEqual(await generateOutline(pdf(artifacts)), []);
});

test("Vorhandene Inhaltsverzeichnisse haben Vorrang und werden gecacht", async () => {
  const renderer = new Renderer(new Map(), new Map());
  let reads = 0;
  renderer.source = async () => ({
    getOutline: async () => { reads++; return [{ title: "Original", dest: [2], items: [], count: 0 }]; },
    getPage: () => assert.fail("Keine Texterkennung bei vorhandenem Verzeichnis"),
  });
  const pending = renderer.outline("source");
  assert.equal(renderer.outline("source"), pending);
  assert.deepEqual(await pending, [{ title: "Original", index: 2, items: [], open: false }]);
  assert.equal(reads, 1);
  assert.equal(renderer.uses.get("source"), 0);
});

test("Analysefehler ergeben keine Teilgliederung und geben die PDF-Nutzung frei", async () => {
  const renderer = new Renderer(new Map(), new Map());
  renderer.source = async () => pdf([
    taggedPage("Einleitung", "H1", 0), taggedPage("Details", "H1", 1),
    { getTextContent: async () => { throw new Error("Defekte Seite"); } },
  ]);
  assert.deepEqual(await renderer.outline("source"), []);
  assert.equal(renderer.uses.get("source"), 0);
});

test("Laufende Analyse schützt die PDF-Instanz und wird nur einmal ausgeführt", async () => {
  let resume, destroyed = 0, reads = 0;
  const gate = new Promise((resolve) => { resume = resolve; });
  const source = pdf([taggedPage("Einleitung", "H1", 0), taggedPage("Ergebnisse", "H1", 1)]);
  const getPage = source.getPage;
  source.getPage = async (number) => { reads++; await gate; return getPage(number); };
  const renderer = new Renderer(new Map([["source", {}]]), new Map());
  renderer.documents.set("source", Promise.resolve({ pdf: source, task: { destroy: async () => { destroyed++; } } }));
  const pending = renderer.outline("source");
  assert.equal(renderer.outline("source"), pending);
  await renderer.disposeUnused(new Set());
  assert.equal(destroyed, 0);
  renderer.sources.delete("source");
  resume();
  assert.deepEqual(await pending, [entry("Einleitung", 0), entry("Ergebnisse", 1)]);
  assert.equal(reads, 2);
  assert.equal(renderer.uses.get("source"), 0);
  assert.equal(renderer.documents.has("source"), false);
  await Promise.resolve();
  assert.equal(destroyed, 1);
});
