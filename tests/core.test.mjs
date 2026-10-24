import test from "node:test";
import assert from "node:assert/strict";
import {
  createDocument,
  createPage,
  edit,
  undo,
  redo,
  travel,
  historyLimit,
  copyPages,
  assignGroup,
  splitGroups,
  groupWith,
  moveWithGroups,
  fieldKey,
  safeName,
} from "../src/core/model.js";
import {
  pagePoint,
  displayPoint,
  displayRect,
  fitSize,
  lineRects,
  sweepStep,
  snapTurn,
  wrapText,
  fitFontSize,
} from "../src/core/geometry.js";
import { layoutPlan } from "../src/pdf/layout.js";
import { findMatches, normalizeQuery } from "../src/core/search.js";
import { cursorIcon } from "../src/ui/icons.js";
import { describeError, describeRenameError } from "../src/core/errors.js";
test("Drucklayout erhält Sonderregeln und Kopienzahlen", () => {
  assert.deepEqual(layoutPlan(3).sheets, [
    [0, 0],
    [1, 1],
    [2, 2],
  ]);
  assert.deepEqual(layoutPlan(3, { students: 1 }).sheets, [
    [0, 1],
    [2, null],
  ]);
  assert.deepEqual(layoutPlan(3, { special: true }).sheets, [
    [0, 0],
    [1, 2],
    [1, 2],
  ]);
  assert.equal(layoutPlan(3, { special: true, students: 5 }).copies, 3);
  assert.equal(
    layoutPlan(3, { special: true, padding: "lcm", students: 5 }).sheets.length,
    8,
  );
  assert.equal(
    layoutPlan(3, { special: true, padding: "lcm", students: 5 }).copies,
    1,
  );
  assert.deepEqual(layoutPlan(3, { perSheet: 4, padding: "blank" }).sheets, [
    [0, 1, 2, null],
  ]);
  assert.deepEqual(layoutPlan(3, { perSheet: 4, padding: "auto" }).sheets, [
    [0, 1, 2, 0],
  ]);
  assert.deepEqual(
    layoutPlan(3, { perSheet: 4, padding: "lcm", students: 24 }).sheets,
    [
      [0, 1, 2, 0],
      [0, 1, 2, 1],
      [0, 1, 2, 2],
    ],
  );
  assert.equal(
    layoutPlan(3, { perSheet: 4, padding: "lcm", students: 24 }).copies,
    6,
  );
  assert.equal(layoutPlan(8, { perSheet: 4, padding: "lcm" }).sheets.length, 2);
  for (const perSheet of [2, 4, 6, 8])
    for (const count of [1, 2, 3, 4, 5, 12, 24])
      assert.ok(layoutPlan(count, { perSheet }).sheets.length > 0);
  assert.throws(() => layoutPlan(4, { special: true }));
  assert.throws(() => layoutPlan(3, { perSheet: 4, padding: "lcm" }));
  assert.throws(() =>
    layoutPlan(3, { special: true, padding: "lcm", students: 1000 }),
  );
});
test("PDF-Koordinaten und Bildschirmkoordinaten sind bei allen Drehungen invers", () => {
  for (const baseRotation of [0, 90, 180, 270])
    for (const rotation of [0, 90, 180, 270]) {
      const page = {
        width: 600,
        height: 800,
        crop: { x: 23, y: 37, width: 350, height: 500 },
        baseRotation,
        rotation,
      };
      for (const [x, y] of [
        [0, 0],
        [27, 49],
        [180, 250],
      ])
        assert.deepEqual(displayPoint(page, ...pagePoint(page, x, y)), [x, y]);
      const rect = displayRect(page, [23, 37, 373, 537]);
      assert.ok(rect.width > 0 && rect.height > 0);
    }
  const size = fitSize(100000, 200000);
  assert.ok(size.width * size.height <= 4_000_000);
  assert.throws(() => fitSize(Infinity, 20));
});
test("Mehrstufiger Verlauf mit Wiederholen, Zusammenfassen und Grenze", () => {
  const doc = createDocument("Verlauf", [
    createPage("s", 0, { width: 100, height: 200 }, "g"),
  ]);
  const page = doc.pages[0];
  edit(doc, "Drehen", (doc) => (doc.pages[0].rotation = 90));
  edit(doc, "Drehen", (doc) => (doc.pages[0].rotation = 180));
  edit(doc, "Drehen", (doc) => (doc.pages[0].rotation = 270));
  assert.deepEqual(
    doc.history.past.map((entry) => entry.label),
    ["Drehen", "Drehen", "Drehen"],
  );
  assert.equal(undo(doc), true);
  assert.equal(undo(doc), true);
  assert.equal(doc.pages[0].rotation, 90);
  assert.equal(doc.history.future.length, 2);
  assert.equal(redo(doc), true);
  assert.equal(doc.pages[0].rotation, 180);
  assert.equal(travel(doc, -5), 2);
  assert.equal(doc.pages[0].rotation, 0);
  assert.equal(doc.dirty, false);
  assert.equal(undo(doc), false);
  assert.equal(travel(doc, 3), 3);
  assert.equal(doc.pages[0].rotation, 270);
  assert.equal(doc.dirty, true);
  assert.equal(redo(doc), false);
  travel(doc, -2);
  edit(doc, "Löschen", (doc) => (doc.pages = []));
  assert.equal(doc.history.future.length, 0);
  assert.equal(redo(doc), false);
  assert.equal(undo(doc), true);
  assert.equal(doc.pages[0].id, page.id);
  assert.equal(doc.pages[0].rotation, 90);
  edit(doc, "Text", (doc) => (doc.formValues.a = "H"), "eingabe");
  edit(doc, "Text", (doc) => (doc.formValues.a = "Ha"), "eingabe");
  edit(doc, "Text", (doc) => (doc.formValues.a = "Hal"), "eingabe");
  assert.equal(doc.history.past.length, 2);
  undo(doc);
  assert.equal(doc.formValues.a, undefined);
  redo(doc);
  assert.equal(doc.formValues.a, "Hal");
  for (let i = 0; i < historyLimit + 20; i++)
    edit(doc, `Schritt ${i}`, (doc) => (doc.formValues.b = i));
  assert.equal(doc.history.past.length, historyLimit);
  assert.equal(doc.history.past[0].label, "Schritt 20");
  assert.equal(travel(doc, -historyLimit - 1), historyLimit);
  assert.equal(doc.formValues.b, 19);
});
test("Rückgängig, Gruppen und unabhängige Formularseitenkopien", () => {
  const pages = Array.from({ length: 4 }, (_, i) =>
    createPage(
      "s",
      i,
      { width: 100, height: 200, widgets: [{ name: "field" }] },
      "original",
    ),
  );
  const doc = createDocument("Dokument", pages);
  doc.formValues[fieldKey(pages[0], "field")] = "Wert";
  edit(doc, "Gruppieren", () => {
    assignGroup(doc, [pages[1].id, pages[3].id]);
    doc.pages[0].rotation = 90;
  });
  assert.deepEqual(splitGroups(doc, true), [
    [pages[0].id],
    [pages[1].id, pages[3].id],
    [pages[2].id],
  ]);
  assert.equal(undo(doc), true);
  assert.equal(doc.pages[0].rotation, 0);
  assert.equal(doc.groups.length, 0);
  assert.equal(undo(doc), false);
  const target = createDocument("Kopie");
  const copied = copyPages(doc, doc.pages, target);
  assert.notEqual(copied[0].id, doc.pages[0].id);
  assert.notEqual(copied[0].formGroup, doc.pages[0].formGroup);
  assert.equal(copied[0].formGroup, copied[1].formGroup);
  assert.equal(target.formValues[fieldKey(copied[0], "field")], "Wert");
  assert.equal(safeName("../Beispiel.pdf"), "..-Beispiel.pdf");
});
test("Suche findet Treffer unabhängig von Schreibweise, Leerraum und Segmenten", () => {
  assert.equal(normalizeQuery("  Hallo \n  Welt "), "hallo welt");
  assert.deepEqual(findMatches(["Text"], "  "), []);
  assert.deepEqual(findMatches(["Alpha BETA", "\n", "beta"], "Beta"), [
    { start: { segment: 0, offset: 6 }, end: { segment: 0, offset: 10 } },
    { start: { segment: 2, offset: 0 }, end: { segment: 2, offset: 4 } },
  ]);
  assert.deepEqual(findMatches(["Seiten", "über", "sicht"], "tenübersi"), [
    { start: { segment: 0, offset: 3 }, end: { segment: 2, offset: 2 } },
  ]);
  assert.deepEqual(findMatches(["Erste", "\n", "Zeile"], "erste   zeile"), [
    { start: { segment: 0, offset: 0 }, end: { segment: 2, offset: 5 } },
  ]);
  assert.deepEqual(findMatches(["a  \t b"], "a b"), [
    { start: { segment: 0, offset: 0 }, end: { segment: 0, offset: 6 } },
  ]);
  assert.equal(findMatches(["aaaa"], "aa").length, 2);
  assert.deepEqual(findMatches(["\u0130x"], "x"), [
    { start: { segment: 0, offset: 1 }, end: { segment: 0, offset: 2 } },
  ]);
  assert.deepEqual(findMatches(["Ωmega 😀 Ende"], "ende"), [
    { start: { segment: 0, offset: 9 }, end: { segment: 0, offset: 13 } },
  ]);
});
test("Textmarker fasst Auswahlrechtecke zeilenweise und überlappungsfrei zusammen", () => {
  assert.deepEqual(
    lineRects([
      { x: 10, y: 10, width: 30, height: 12 },
      { x: 42, y: 11, width: 20, height: 11 },
      { x: 10, y: 20, width: 50, height: 12 },
      { x: 200, y: 10, width: 20, height: 12 },
      { x: 5, y: 5, width: 0, height: 9 },
    ]),
    [
      { x: 10, y: 10, width: 52, height: 11 },
      { x: 200, y: 10, width: 20, height: 12 },
      { x: 10, y: 21, width: 50, height: 11 },
    ],
  );
  assert.deepEqual(
    lineRects([
      { x: 50, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 30, y: 1, width: 10, height: 9 },
      { x: 15, y: 0, width: 10, height: 10 },
    ]),
    [{ x: 0, y: 0, width: 60, height: 10 }],
  );
  assert.deepEqual(lineRects([]), []);
});
test("Umbenennen meldet die tatsächliche Ursache", () => {
  const allowed = describeRenameError(new DOMException("x", "NotAllowedError"), { writeGranted: true });
  assert.match(allowed, /Schreibberechtigung ist erteilt/);
  assert.match(allowed, /Ordner freigeben/);
  assert.doesNotMatch(allowed, /Schreibberechtigung erlauben/);
  const locked = new DOMException("locked", "NoModificationAllowedError");
  assert.match(describeRenameError(locked), /anderen Programm geöffnet/);
  assert.match(describeRenameError(locked), /\(NoModificationAllowedError\)$/);
  assert.match(
    describeRenameError(new DOMException("x", "InvalidModificationError")),
    /bereits eine Datei mit diesem Namen/,
  );
  const unknown = describeRenameError(new DOMException("Something odd", "UnknownError"));
  assert.match(unknown, /Something odd \(UnknownError\)$/);
  for (const error of [locked, new DOMException("Something odd", "UnknownError")])
    assert.equal(
      describeError(new Error(describeRenameError(error))),
      describeRenameError(error),
    );
  assert.match(describeRenameError(new DOMException("x", "constructor")), /\(constructor\)$/);
});
test("Ziehdrehung folgt dem Winkel um die Seitenmitte und rastet ein", () => {
  const center = { x: 100, y: 100 };
  const at = (degrees, radius = 40) => ({
    x: center.x + radius * Math.cos((degrees * Math.PI) / 180),
    y: center.y + radius * Math.sin((degrees * Math.PI) / 180),
  });
  const sweep = (from, to, steps = 12) => {
    let total = 0;
    for (let i = 1; i <= steps; i++)
      total += sweepStep(
        center,
        at(from + ((to - from) * (i - 1)) / steps),
        at(from + ((to - from) * i) / steps),
      );
    return total;
  };
  assert.ok(Math.abs(sweep(-90, 0) - 90) < 1e-9);
  assert.ok(Math.abs(sweep(-90, -180) + 90) < 1e-9);
  assert.ok(Math.abs(sweep(170, 190, 2) - 20) < 1e-9);
  assert.equal(sweepStep(center, at(0, 5), at(90)), 0);
  assert.equal(sweepStep(center, at(0), at(120)), 0);
  assert.deepEqual(
    [40, 59, 60, -59, -60, -100, 149, 150, 185, 360, -30].map(snapTurn),
    [0, 0, 90, 0, 270, 270, 90, 180, 180, 0, 0],
  );
});
test("Gruppen folgen den Gesten der Seitenleiste", () => {
  const sample = (order, groups = []) => {
    const doc = createDocument(
      "Gruppen",
      [...order].map((id, index) => ({
        ...createPage("s", index, { width: 100, height: 200 }, "f"),
        id,
      })),
    );
    doc.groups = groups.map((group) => [...group]);
    return doc;
  };
  const state = (doc) => [
    doc.pages.map((page) => page.id).join(""),
    doc.groups.map((group) => group.join("")),
  ];
  let doc = sample("abcd");
  groupWith(doc, ["d"], "a");
  assert.deepEqual(state(doc), ["adbc", ["ad"]]);
  groupWith(doc, ["c"], "a");
  assert.deepEqual(state(doc), ["acdb", ["acd"]]);
  groupWith(doc, ["a"], "a");
  assert.deepEqual(state(doc), ["acdb", ["acd"]]);
  doc = sample("abcde", ["bc"]);
  groupWith(doc, ["a", "e"], "c");
  assert.deepEqual(state(doc), ["bcaed", ["bcae"]]);
  doc = sample("abcd", ["ab"]);
  moveWithGroups(doc, ["b"], "d", true);
  assert.deepEqual(state(doc), ["acdb", []]);
  doc = sample("abcde", ["abc"]);
  moveWithGroups(doc, ["c"], "e", true);
  assert.deepEqual(state(doc), ["abdec", ["ab"]]);
  doc = sample("abcd", ["abc"]);
  moveWithGroups(doc, ["d"], "b", false);
  assert.deepEqual(state(doc), ["adbc", ["adbc"]]);
  doc = sample("abcde", ["abc"]);
  moveWithGroups(doc, ["a"], "c", true);
  assert.deepEqual(state(doc), ["bcade", ["bca"]]);
  doc = sample("abcde", ["abc"]);
  moveWithGroups(doc, ["c"], "a", false);
  assert.deepEqual(state(doc), ["cabde", ["cab"]]);
  doc = sample("abcde", ["ab"]);
  moveWithGroups(doc, ["a", "b"], "e", true);
  assert.deepEqual(state(doc), ["cdeab", ["ab"]]);
  doc = sample("abcdef", ["bc", "ef"]);
  moveWithGroups(doc, ["a", "d"], "f", false);
  assert.deepEqual(state(doc), ["bceadf", ["bc", "eadf"]]);
  doc = sample("abcd", ["ab"]);
  moveWithGroups(doc, ["d"], "d", true);
  assert.deepEqual(state(doc), ["abcd", ["ab"]]);
});
test("Werkzeug-Cursor enthalten Symbol, Farbe und Klickpunkt", () => {
  const value = cursorIcon("pen", { color: "#354a63", hotspot: [3, 21] });
  assert.match(value, /^url\("data:image\/svg\+xml,[^"]+"\) 3 21, crosshair$/);
  const svg = decodeURIComponent(value.slice(value.indexOf(",") + 1, value.indexOf('")')));
  assert.match(svg, /stroke="#354a63"/);
  assert.match(svg, /stroke="#ffffff"/);
  assert.equal((svg.match(/<path /g) || []).length, 3);
  assert.notEqual(
    cursorIcon("pen", { color: "#d93a3a", hotspot: [3, 21] }),
    value,
  );
  assert.match(cursorIcon("eraser", { fallback: "default" }), /12 12, default$/);
});
test("Formulartext wird umgebrochen und bei Überlauf bis 6 pt verkleinert", () => {
  const measure = (text, size) => text.length * size * 0.5;
  assert.deepEqual(
    wrapText("eins zwei drei\nvier", 10, (text) => text.length),
    ["eins zwei", "drei", "vier"],
  );
  const single = { width: 104, height: 20, measure };
  assert.equal(fitFontSize("", single), 12);
  assert.equal(fitFontSize("kurz", single), 12);
  assert.equal(fitFontSize("kurz", { ...single, size: 14 }), 14);
  assert.equal(fitFontSize("x".repeat(25), { ...single, size: 14 }), 8);
  assert.equal(fitFontSize("x".repeat(200), single), 6);
  assert.equal(fitFontSize("kurz", { ...single, size: 4 }), 4);
  const multi = { width: 104, height: 40, multiline: true, measure };
  assert.equal(fitFontSize("wort ".repeat(4).trim(), multi), 12);
  assert.equal(fitFontSize("wort ".repeat(20).trim(), multi), 7.5);
  assert.equal(fitFontSize("wort ".repeat(60).trim(), multi), 6);
});
