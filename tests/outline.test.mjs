import test from "node:test";
import assert from "node:assert/strict";
import { destinationIndex, generateOutline } from "../src/pdf/outline.js";
import { Renderer } from "../src/pdf/renderer.js";

function text(str, y, size = 12, x = 40, extra = {}) {
  return { str, transform: [size, 0, 0, size, x, 800 - y], width: str.length * size * 0.45, fontName: `font-${size}`, ...extra };
}

function body(y) {
  return [0, 18, 36, 54].map((offset) => text("Dies ist ein längerer Absatz mit normalem Fließtext im Dokument.", y + offset));
}

function page(items, tree = null, annotations = []) {
  return {
    getTextContent: async () => ({ items }),
    getStructTree: async () => tree,
    getAnnotations: async () => annotations,
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
    numPages: 3,
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

function link(y, dest, x = 40, width = 500, extra = {}) {
  return { subtype: "Link", dest, rect: [x, 800 - y - 2, x + width, 800 - y + 12], ...extra };
}

test("Verlinkte Inhaltsverzeichnisse ersetzen Deckblattzeilen und verbinden Folgeseiten", async () => {
  const pages = [
    page([text("Dokumenttitel", 80, 24), text("Untertitel", 160, 24), ...body(210)]),
    page([
      text("Inhaltsverzeichnis", 100, 24),
      text("1 Einleitung ........", 200), text("99", 200, 12, 500),
      text("1.1 Details", 235, 12, 55), text("100", 235, 12, 500),
      text("2 Ergebnisse", 270), text("101", 270, 12, 500),
    ], null, [
      link(270, [4], 500, 20), link(235, [{ num: 7, gen: 0 }]),
      link(200, "intro", 500, 20), link(200, "intro", 40, 150),
    ]),
    page([text("3 Ausblick", 180), text("102", 180, 12, 500)], null, [link(180, [5])]),
    page([]), page([]), page([]),
  ];
  const source = pdf(pages), reads = pages.map(() => 0);
  source.getDestination = async (name) => {
    assert.equal(name, "intro");
    return [3];
  };
  source.getPageIndex = async (ref) => {
    assert.deepEqual(ref, { num: 7, gen: 0 });
    return 3;
  };
  for (const [index, sourcePage] of pages.entries()) {
    const read = sourcePage.getTextContent;
    sourcePage.getTextContent = async (options) => { reads[index]++; return read(options); };
    sourcePage.getStructTree = () => assert.fail("Verlinktes Verzeichnis hat Vorrang vor Strukturmarkierungen");
  }
  assert.deepEqual(await generateOutline(source), [
    entry("1 Einleitung", 3, [entry("1.1 Details", 3)]),
    entry("2 Ergebnisse", 4), entry("3 Ausblick", 5),
  ]);
  assert.deepEqual(reads, [1, 1, 1, 1, 1, 1]);
});

test("Mehrzeilige Titel, römische Seitenzahlen und mehrere Kapitel auf derselben Zielseite", async () => {
  const source = pdf([
    page([
      text("Contents", 60, 24),
      text("1 Ein langer", 120), text("Kapiteltitel", 134), text("iv", 134, 12, 500),
      text("2 Windows 11", 180),
      text("3 Weiterer langer", 220), text("Titel ....... 9", 234),
    ], null, [
      link(134, [1], 500, 20), link(180, [1]),
      link(220, [2]), link(234, [2]), link(234, [2]),
    ]),
    page([]), page([]),
  ]);
  assert.deepEqual(await generateOutline(source), [
    entry("1 Ein langer Kapiteltitel", 1), entry("2 Windows 11", 1),
    entry("3 Weiterer langer Titel", 2),
  ]);
});

test("Wiederkehrendes Verzeichnislayout funktioniert ohne Überschrift und bleibt ohne Nummerierung flach", async () => {
  assert.deepEqual(await generateOutline(pdf([
    page([
      text("Einleitung", 120), text("i", 120, 12, 500),
      text("Ergebnisse", 160, 16), text("12", 160, 16, 500),
      text("Ausblick", 200), text("13", 200, 12, 500),
    ], null, [link(120, [1]), link(160, [2]), link(200, [3])]),
    page([]), page([]), page([]),
  ])), [entry("Einleitung", 1), entry("Ergebnisse", 2), entry("Ausblick", 3)]);
});

test("Unnummerierte Einträge verhindern keine Kapitelhierarchie und getrennte Links bleiben getrennt", async () => {
  assert.deepEqual(await generateOutline(pdf([
    page([
      text("Inhalt", 60, 24), text("Vorwort", 120),
      text("1 Einleitung", 160), text("1.1 Details", 200),
      text("Anhang", 240), text("Register", 254),
    ], null, [link(120, [1]), link(160, [1]), link(200, [1]), link(240, [2]), link(254, [2])]),
    page([]), page([]),
  ])), [
    entry("Vorwort", 1), entry("1 Einleitung", 1, [entry("1.1 Details", 1)]),
    entry("Anhang", 2), entry("Register", 2),
  ]);
});

test("Ein Link über mehrere unnummerierte Titelzeilen ergibt einen Eintrag", async () => {
  assert.deepEqual(await generateOutline(pdf([
    page([
      text("Table of Contents", 60, 24), text("Ein langer", 120), text("Kapiteltitel", 134),
      text("Ergebnisse", 180),
    ], null, [link(134, [1], 40, 500, { rect: [40, 664, 540, 694] }), link(180, [2])]),
    page([]), page([]),
  ])), [entry("Ein langer Kapiteltitel", 1), entry("Ergebnisse", 2)]);
});

test("Ungültige benachbarte Links werden nicht in gültige Titel aufgenommen", async () => {
  const source = pdf([
    page([
      text("Inhaltsverzeichnis", 60, 24), text("Webseite", 106), text("Einleitung", 120),
      text("Defektes Ziel", 166), text("Ergebnisse", 180),
    ], null, [
      link(106, [1], 40, 500, { url: "https://example.com" }), link(120, [1]),
      link(166, "missing"), link(180, [2]),
    ]), page([]), page([]),
  ]);
  source.getDestination = async () => null;
  assert.deepEqual(await generateOutline(source), [entry("Einleitung", 1), entry("Ergebnisse", 2)]);
});

test("Gleichnamige Kapitel mit unterschiedlichen Zielen bleiben erhalten", async () => {
  assert.deepEqual(await generateOutline(pdf([
    page([text("Contents", 60, 24), text("Übersicht", 120), text("Übersicht", 160)], null, [link(120, [1]), link(160, [2])]),
    page([]), page([]),
  ])), [entry("Übersicht", 1), entry("Übersicht", 2)]);
});

test("Explizite Inhaltsverzeichnisse behalten Ziele vor der Verzeichnisseite", async () => {
  assert.deepEqual(await generateOutline(pdf([
    page([]),
    page([text("Inhaltsverzeichnis", 60, 24), text("Vorwort", 120), text("Einleitung", 160)], null, [link(120, [0]), link(160, [2])]),
    page([]),
  ])), [entry("Vorwort", 0), entry("Einleitung", 2)]);
  assert.deepEqual(await generateOutline(pdf([
    page([]), page([]),
    page([text("Contents", 60, 24), text("Introduction", 120), text("Results", 160)], null, [link(120, [0]), link(160, [1])]),
  ])), [entry("Introduction", 0), entry("Results", 1)]);
});

test("Ein Rücksprung auf einer angrenzenden Inhaltsseite verlängert das Verzeichnis nicht", async () => {
  assert.deepEqual(await generateOutline(pdf([
    page([
      text("Contents", 60, 24), text("Introduction", 120), text("Results", 160),
    ], null, [link(120, [1]), link(160, [2])]),
    page([text("Contents page", 120)], null, [link(120, [0])]), page([]),
  ])), [entry("Introduction", 1), entry("Results", 2)]);
});

test("Defekte Einzelziele, externe Links und Rücksprünge werden übersprungen", async () => {
  const source = pdf([
    page([]),
    page([
      text("Inhaltsverzeichnis", 80, 24),
      ...["Einleitung", "Ergebnisse", "Defekt", "Webseite", "Zurück", "Außerhalb", "Unbekannt", "Ungültiges Rechteck"]
        .map((title, index) => text(title, 140 + index * 35)),
    ], null, [
      link(140, [2]), link(175, [3]), link(210, "broken"),
      link(245, [2], 40, 500, { url: "https://example.com" }), link(280, [0]),
      link(315, [99]), link(350, [{ num: 99, gen: 0 }]),
      link(385, [2], 40, 500, { rect: [NaN, 0, 10, 10] }),
    ]), page([]), page([]),
  ]);
  source.getDestination = async () => { throw new Error("Unbekanntes Ziel"); };
  source.getPageIndex = async () => { throw new Error("Ungültige Referenz"); };
  assert.deepEqual(await generateOutline(source), [entry("Einleitung", 2), entry("Ergebnisse", 3)]);
});

test("Einzelne Verzeichniseinträge und gewöhnliche Querverweise ergeben keine Gliederung", async () => {
  const cases = [
    [page([text("Inhaltsverzeichnis", 80, 24), text("Einleitung", 140)], null, [link(140, [1])]), page([])],
    [page(body(80), null, [link(80, [1]), link(116, [1])]), page([])],
    [page([text("Weitere Informationen", 80), text("Siehe Ergebnisse", 120)], null, [link(80, [1]), link(120, [1])]), page([])],
    [page([]), page([text("1 Zur Einleitung", 120), text("2 Zur Übersicht", 160)], null, [link(120, [0]), link(160, [0])])],
  ];
  for (const pages of cases) assert.deepEqual(await generateOutline(pdf(pages)), []);
});

test("Deckblattgliederungen allein genügen weder optisch noch mit Strukturmarkierungen", async () => {
  const visual = pdf([
    page([text("Dokumenttitel", 80, 24), ...body(120), text("Untertitel", 250, 24), ...body(290)]),
    page(body(100)),
  ]);
  assert.deepEqual(await generateOutline(visual), []);
  const tagged = page([
    { type: "beginMarkedContentProps", id: "title" }, text("Dokumenttitel", 80, 24), { type: "endMarkedContent" },
    { type: "beginMarkedContentProps", id: "subtitle" }, text("Untertitel", 140, 18), { type: "endMarkedContent" },
  ], { role: "Root", children: [
    { role: "H1", children: [{ type: "content", id: "title" }] },
    { role: "H2", children: [{ type: "content", id: "subtitle" }] },
  ] });
  assert.deepEqual(await generateOutline(pdf([tagged, page(body(100))])), []);
});

test("Fehler beim Lesen von Annotationen verhindern zuverlässige Überschriftenerkennung nicht", async () => {
  const pages = ["Einleitung", "Ergebnisse"].map((title) => {
    const sourcePage = page([text(title, 120, 24), ...body(160)]);
    sourcePage.getAnnotations = async () => { throw new Error("Defekte Annotationen"); };
    return sourcePage;
  });
  assert.deepEqual(await generateOutline(pdf(pages)), [entry("Einleitung", 0), entry("Ergebnisse", 1)]);
});

test("Gemeinsame Zielauflösung akzeptiert nur gültige Seiten und fängt defekte Ziele ab", async () => {
  const source = {
    numPages: 4,
    getDestination: async (name) => name === "valid" ? [{ num: 8, gen: 0 }] : null,
    getPageIndex: async (ref) => {
      if (ref?.num === 8) return 2;
      throw new Error("Unbekannte Referenz");
    },
  };
  assert.equal(await destinationIndex(source, "valid"), 2);
  assert.equal(await destinationIndex(source, [0]), 0);
  for (const value of ["missing", null, [], [-1], [4], [1.5], [{}], [null]]) {
    assert.equal(await destinationIndex(source, value), null);
  }
  const renderer = new Renderer(new Map(), new Map());
  assert.equal(await renderer.destinationIndex(source, "valid"), 2);
  assert.equal(await renderer.destinationIndex(source, [4]), null);
});
