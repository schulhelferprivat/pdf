import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pdfLib, pdfJs } from "../src/pdf/vendors.js";
import { assemble, inspect } from "../src/pdf/engine.js";
import { createPage } from "../src/core/model.js";
const lib = await pdfLib();
const fontBytes = await Promise.all(
  ["Regular", "Bold"].map(
    async (weight) =>
      new Uint8Array(
        await readFile(
          new URL(`../assets/NotoSans-${weight}.ttf`, import.meta.url),
        ),
      ),
  ),
);
async function fixture() {
  const doc = await lib.PDFDocument.create();
  const first = doc.addPage([300, 400]),
    second = doc.addPage([400, 300]);
  first.setCropBox(10, 20, 280, 360);
  second.setRotation(lib.degrees(90));
  const form = doc.getForm();
  const field = form.createTextField("shared");
  field.setText("Ausgangswert");
  field.addToPage(first, { x: 30, y: 50, width: 180, height: 25 });
  field.addToPage(second, { x: 30, y: 50, width: 180, height: 25 });
  const check = form.createCheckBox("check");
  check.addToPage(first, { x: 40, y: 100, width: 15, height: 15 });
  const radio = form.createRadioGroup("radio");
  radio.addOptionToPage("A", first, { x: 60, y: 100, width: 15, height: 15 });
  radio.addOptionToPage("B", second, { x: 60, y: 100, width: 15, height: 15 });
  const dropdown = form.createDropdown("select");
  dropdown.addOptions(["Eins", "Zwei"]);
  dropdown.addToPage(first, { x: 30, y: 140, width: 120, height: 25 });
  const list = form.createOptionList("list");
  list.addOptions(["Rot", "Grün"]);
  list.enableMultiselect();
  list.addToPage(second, { x: 30, y: 140, width: 120, height: 70 });
  return new Uint8Array(await doc.save());
}
async function makePayload() {
  const data = await fixture(),
    info = await inspect(data);
  assert.equal(
    info.pages[1].widgets.find((widget) => widget.type === "radio").on,
    "B",
  );
  return {
    fontBytes,
    sources: [{ id: "source", data }],
    document: {
      pages: info.pages.map((page, i) =>
        createPage("source", i, page, "group"),
      ),
      formValues: {
        "group:shared": "Prüfung äöü ß Ω",
        "group:check": "Yes",
        "group:radio": "B",
        "group:select": ["Zwei"],
        "group:list": ["Rot", "Grün"],
      },
    },
    options: {},
  };
}
test("PDF-Export entfernt Aktionen an Seiten, Feldern und Widgets in allen Exportvarianten", async () => {
  const payload = await makePayload();
  const source = await lib.PDFDocument.load(payload.sources[0].data);
  const name = lib.PDFName.of;
  const action = source.context.register(source.context.obj({
    S: "JavaScript",
    JS: lib.PDFHexString.fromText('app.alert("security-regression")'),
  }));
  const attach = (dict, trigger) => {
    dict.set(name("A"), action);
    dict.set(name("AA"), source.context.obj({ [trigger]: action }));
  };
  for (const page of source.getPages()) {
    page.drawText("Sichtbarer Inhalt", { x: 30, y: 250, size: 12 });
    attach(page.node, "O");
  }
  for (const field of source.getForm().getFields()) {
    attach(field.acroField.dict, "K");
    for (const widget of field.acroField.getWidgets()) attach(widget.dict, "U");
  }
  payload.sources[0].data = await source.save();
  for (const options of [
    {},
    { plainGroup: "group" },
    { password: "security-export" },
    { flatten: true },
    { flatten: true, password: "security-export" },
    { layout: { perSheet: 2, students: 1, autoOrientation: true } },
  ]) {
    const { data } = await assemble({ ...payload, options });
    const output = await lib.PDFDocument.load(data, { password: options.password });
    const seen = new Set();
    const check = (object) => {
      if (!object || seen.has(object)) return;
      seen.add(object);
      if (object instanceof lib.PDFDict) {
        assert.equal(object.has(name("A")), false);
        assert.equal(object.has(name("AA")), false);
        assert.notEqual(object.get(name("S")), name("JavaScript"));
        for (const [, value] of object.entries()) check(value);
      } else if (object instanceof lib.PDFArray) {
        for (const value of object.asArray()) check(value);
      } else if (object.dict) check(object.dict);
    };
    for (const [, object] of output.context.enumerateIndirectObjects()) check(object);
    for (const page of output.getPages()) assert.ok(page.node.Contents());
    const fields = output.getForm();
    if (options.flatten || options.layout) assert.equal(fields.getFields().length, 0);
    else {
      const prefix = options.plainGroup ? "" : "group.";
      assert.equal(fields.getTextField(`${prefix}shared`).getText(), "Prüfung äöü ß Ω");
      assert.equal(fields.getCheckBox(`${prefix}check`).isChecked(), true);
      assert.equal(fields.getRadioGroup(`${prefix}radio`).getSelected(), "B");
      assert.deepEqual(fields.getDropdown(`${prefix}select`).getSelected(), ["Zwei"]);
      for (const field of fields.getFields())
        for (const widget of field.acroField.getWidgets()) assert.ok(widget.dict.has(name("AP")));
    }
  }
});
test("AcroForm wird nach Umordnen mit Ressourcen und allen Feldtypen übernommen", async () => {
  const payload = await makePayload();
  payload.document.pages.reverse();
  const { data } = await assemble(payload);
  const output = await lib.PDFDocument.load(data);
  const form = output.getForm();
  assert.equal(output.getPageCount(), 2);
  assert.equal(output.getPage(0).getRotation().angle, 90);
  assert.equal(form.getTextField("group.shared").getText(), "Prüfung äöü ß Ω");
  assert.equal(
    form.getTextField("group.shared").acroField.getWidgets().length,
    2,
  );
  assert.equal(form.getCheckBox("group.check").isChecked(), true);
  assert.equal(form.getRadioGroup("group.radio").getSelected(), "B");
  assert.deepEqual(form.getDropdown("group.select").getSelected(), ["Zwei"]);
  assert.deepEqual(form.getOptionList("group.list").getSelected(), [
    "Rot",
    "Grün",
  ]);
  for (const field of form.getFields())
    for (const widget of field.acroField.getWidgets())
      assert.ok(output.getPages().some((page) => widget.P() === page.ref));
});
test("Aufteilen entfernt Widgets anderer Seiten und Duplikate bleiben unabhängig", async () => {
  const payload = await makePayload();
  payload.document.pages = payload.document.pages.slice(0, 1);
  const first = structuredClone(payload.document.pages[0]);
  first.id = "duplicate";
  first.formGroup = "copy";
  payload.document.pages.push(first);
  payload.document.formValues["copy:shared"] = "Kopie";
  const { data } = await assemble(payload);
  const output = await lib.PDFDocument.load(data),
    form = output.getForm();
  assert.equal(output.getPageCount(), 2);
  assert.equal(
    form.getTextField("group.shared").acroField.getWidgets().length,
    1,
  );
  assert.equal(form.getTextField("copy.shared").getText(), "Kopie");
  assert.equal(form.getTextField("group.shared").getText(), "Prüfung äöü ß Ω");
});
test("Speichern behält die Feldnamen der Ursprungsgruppe", async () => {
  const payload = await makePayload();
  const copy = structuredClone(payload.document.pages[0]);
  copy.id = "duplicate";
  copy.formGroup = "copy";
  payload.document.pages.push(copy);
  payload.options.plainGroup = "group";
  const { data } = await assemble(payload);
  const form = (await lib.PDFDocument.load(data)).getForm();
  assert.equal(form.getTextField("shared").getText(), "Prüfung äöü ß Ω");
  assert.equal(form.getCheckBox("check").isChecked(), true);
  assert.ok(form.getTextField("copy.shared"));
  assert.ok(!form.getFields().some((field) => field.getName().startsWith("group.")));
});
test("AES-256 R6 schützt echte Inhalte und erhält Formularwerte", async () => {
  const payload = await makePayload();
  payload.options.password = "test-open-password";
  const { data } = await assemble(payload);
  const text = Buffer.from(data).toString("latin1");
  assert.match(text, /\/R\s+6\b/);
  assert.match(text, /\/CFM\s*\/AESV3/);
  assert.ok(!text.includes("Prüfung"));
  await assert.rejects(lib.PDFDocument.load(data));
  await assert.rejects(lib.PDFDocument.load(data, { password: "wrong" }));
  const output = await lib.PDFDocument.load(data, {
    password: "test-open-password",
  });
  assert.equal(
    output.getForm().getTextField("group.shared").getText(),
    "Prüfung äöü ß Ω",
  );
  assert.equal(output.getForm().getCheckBox("group.check").isChecked(), true);
});
test("Festes Einbetten und Drucklayout erhalten sichtbare Inhalte ohne Widgets", async () => {
  const payload = await makePayload();
  payload.options.flatten = true;
  let result = await assemble(payload),
    output = await lib.PDFDocument.load(result.data);
  assert.equal(output.getForm().getFields().length, 0);
  assert.ok(output.getPage(0).node.Contents());
  payload.options.layout = { perSheet: 2, students: 1, autoOrientation: true };
  result = await assemble(payload);
  output = await lib.PDFDocument.load(result.data);
  assert.equal(output.getPageCount(), 1);
  assert.equal(result.copies, 1);
  const unresolved = [];
  const visit = (dict, path) => {
    const xObjects = dict
      .lookup(lib.PDFName.of("Resources"))
      ?.lookup(lib.PDFName.of("XObject"));
    for (const [name, ref] of xObjects?.entries() || []) {
      const stream = output.context.lookup(ref);
      if (!stream?.dict) unresolved.push(`${path}${name}`);
      else visit(stream.dict, `${path}${name}`);
    }
  };
  visit(output.getPage(0).node, "");
  assert.deepEqual(unresolved, []);
});
test("Drucklayout verarbeitet leere Seiten ohne Inhaltsstrom", async () => {
  const blank = await lib.PDFDocument.create();
  blank.addPage([595.3, 841.9]);
  const filled = blank.addPage([595.3, 841.9]);
  filled.drawText("Inhalt", { x: 50, y: 700 });
  blank.addPage([595.3, 841.9]);
  const data = new Uint8Array(await blank.save()),
    info = await inspect(data);
  const result = await assemble({
    fontBytes,
    sources: [{ id: "source", data }],
    document: {
      formValues: {},
      pages: info.pages.map((page, i) =>
        createPage("source", i, page, "group"),
      ),
    },
    options: { layout: { perSheet: 2, students: 1, autoOrientation: true } },
  });
  const output = await lib.PDFDocument.load(result.data);
  assert.equal(output.getPageCount(), 2);
});
test("Eigene Texte, Markierungen, Bilder und mehrteilige Zeichnungen werden exportiert", async () => {
  const png = new Uint8Array(
    await readFile(new URL("../assets/icon-192.png", import.meta.url)),
  );
  const payload = {
    fontBytes,
    sources: [],
    images: [{ id: "image", mime: "image/png", bytes: png }],
    document: {
      formValues: {},
      pages: [
        {
          id: "blank",
          width: 595.3,
          height: 841.9,
          rotation: 0,
          baseRotation: 0,
          elements: [
            {
              type: "text",
              x: 30,
              y: 800,
              width: 200,
              height: 60,
              angle: 0,
              text: "Text Ω",
              fontSize: 16,
              color: "#334455",
            },
            {
              type: "highlight",
              x: 30,
              y: 700,
              width: 180,
              height: 30,
              angle: 0,
              color: "#ffff00",
              opacity: 0.35,
            },
            {
              type: "highlight",
              x: 30,
              y: 650,
              width: 200,
              height: 40,
              angle: 0,
              color: "#f1ce54",
              opacity: 0.35,
              rects: [
                [0, 0, 1, 0.5],
                [0, 0.5, 0.4, 0.5],
              ],
            },
            {
              type: "image",
              assetId: "image",
              x: 200,
              y: 500,
              width: 60,
              height: 60,
              angle: 0,
            },
            {
              type: "draw",
              x: 100,
              y: 400,
              width: 120,
              height: 60,
              angle: 0,
              color: "#334455",
              paths: [
                [
                  [0, 0],
                  [1, 1],
                ],
                [
                  [1, 0],
                  [0, 1],
                ],
              ],
            },
          ],
        },
      ],
    },
    options: {},
  };
  const { data } = await assemble(payload);
  const output = await lib.PDFDocument.load(data);
  assert.equal(output.getPageCount(), 1);
  assert.ok(
    output.getPage(0).node.Resources().lookup(lib.PDFName.of("XObject")).keys()
      .length,
  );
});
test("Eigene Elemente werden als Anmerkungen gespeichert und beim Öffnen wiederhergestellt", async () => {
  const elements = [
    {
      id: "text",
      type: "text",
      x: 30,
      y: 380,
      width: 150,
      height: 40,
      angle: 0,
      text: "Notiz Ω",
      fontSize: 14,
      color: "#334455",
      opacity: 1,
      bold: true,
    },
    {
      id: "highlight",
      type: "highlight",
      x: 30,
      y: 300,
      width: 100,
      height: 20,
      angle: 0,
      color: "#f1ce54",
      opacity: 0.35,
      rects: [[0, 0, 1, 1]],
    },
    {
      id: "draw",
      type: "draw",
      x: 50,
      y: 200,
      width: 80,
      height: 40,
      angle: 90,
      color: "#354a63",
      opacity: 1,
      strokeWidth: 3,
      points: [
        [0, 0],
        [0.5, 1],
        [1, 0],
      ],
    },
  ];
  const source = await lib.PDFDocument.create();
  source.addPage([300, 400]);
  const sourceData = new Uint8Array(await source.save());
  const payload = {
    fontBytes,
    sources: [{ id: "source", data: sourceData }],
    document: {
      formValues: {},
      pages: [
        {
          ...createPage("source", 0, (await inspect(sourceData)).pages[0], "g"),
          elements,
        },
      ],
    },
    options: {},
  };
  const { data } = await assemble(payload);
  const saved = await lib.PDFDocument.load(data);
  const annotations = saved
    .getPage(0)
    .node.Annots()
    .asArray()
    .map((ref) => saved.context.lookup(ref));
  assert.deepEqual(
    annotations.map((annotation) =>
      annotation.get(lib.PDFName.of("Subtype")).asString(),
    ),
    ["/FreeText", "/Highlight", "/Ink"],
  );
  assert.ok(
    annotations.every((annotation) => annotation.get(lib.PDFName.of("AP"))),
  );
  const info = await inspect(data.slice());
  assert.deepEqual(
    info.pages[0].elements,
    elements.map(({ id, ...element }) => element),
  );
  const cleaned = await lib.PDFDocument.load(info.data);
  assert.equal(cleaned.getPage(0).node.Annots()?.size() ?? 0, 0);
  const restored = createPage("source", 0, info.pages[0], "g").elements;
  assert.equal(restored.length, 3);
  assert.ok(restored.every((element) => element.id && element.id !== "text"));
  payload.options.flatten = true;
  const flat = await lib.PDFDocument.load((await assemble(payload)).data);
  assert.equal(flat.getPage(0).node.Annots()?.size() ?? 0, 0);
});
test("Passwortgeschützte Dateien behalten wiederhergestellte Elemente verschlüsselt", async () => {
  const source = await lib.PDFDocument.create();
  source.addPage([300, 400]);
  const sourceData = new Uint8Array(await source.save());
  const element = {
    type: "draw",
    x: 20,
    y: 100,
    width: 50,
    height: 50,
    angle: 0,
    color: "#354a63",
    opacity: 1,
    strokeWidth: 2,
    points: [
      [0, 0],
      [1, 1],
    ],
  };
  const { data } = await assemble({
    fontBytes,
    sources: [{ id: "source", data: sourceData }],
    document: {
      formValues: {},
      pages: [
        {
          ...createPage("source", 0, (await inspect(sourceData)).pages[0], "g"),
          elements: [{ ...element, id: "draw" }],
        },
      ],
    },
    options: { password: "geheim" },
  });
  const info = await inspect(data, "geheim");
  assert.deepEqual(info.pages[0].elements, [element]);
  await assert.rejects(lib.PDFDocument.load(info.data));
  const cleaned = await lib.PDFDocument.load(info.data, { password: "geheim" });
  assert.equal(cleaned.getPage(0).node.Annots()?.size() ?? 0, 0);
});
test("Kommentare werden als PDF-Notizen gespeichert und wieder eingelesen", async () => {
  const comments = [
    {
      id: "offen",
      type: "comment",
      x: 40,
      y: 360,
      width: 20,
      height: 20,
      angle: 0,
      color: "#f5c542",
      opacity: 1,
      text: "Bitte prüfen Ω",
      done: false,
      date: "2026-10-17T08:30:00.000Z",
    },
    {
      id: "erledigt",
      type: "comment",
      x: 120,
      y: 200,
      width: 20,
      height: 20,
      angle: 0,
      color: "#6fd0f2",
      opacity: 1,
      text: "Erledigt",
      done: true,
      date: "2026-10-16T12:00:00.000Z",
    },
  ];
  const source = await lib.PDFDocument.create();
  source.addPage([300, 400]);
  const sourceData = new Uint8Array(await source.save());
  const payload = {
    fontBytes,
    sources: [{ id: "source", data: sourceData }],
    document: {
      formValues: {},
      pages: [
        {
          ...createPage("source", 0, (await inspect(sourceData)).pages[0], "g"),
          elements: comments,
        },
      ],
    },
    options: {},
  };
  const { data } = await assemble(payload);
  const saved = await lib.PDFDocument.load(data);
  const name = (value) => lib.PDFName.of(value);
  const annotations = saved
    .getPage(0)
    .node.Annots()
    .asArray()
    .map((ref) => ({ ref, dict: saved.context.lookup(ref) }));
  assert.deepEqual(
    annotations.map(({ dict }) => dict.get(name("Subtype")).asString()),
    ["/Text", "/Text", "/Text"],
  );
  const [open, done, state] = annotations.map(({ dict }) => dict);
  assert.equal(open.get(name("Contents")).decodeText(), "Bitte prüfen Ω");
  assert.equal(open.get(name("Name")).asString(), "/Comment");
  assert.equal(open.get(name("F")).asNumber() & 4, 0);
  assert.equal(open.get(name("M")).decodeText(), "D:20261017083000Z");
  assert.equal(open.get(name("AP")), undefined);
  assert.equal(state.get(name("IRT")), annotations[1].ref);
  assert.equal(state.get(name("StateModel")).asString(), "/Review");
  assert.equal(state.get(name("State")).asString(), "/Completed");
  assert.equal(done.get(name("Contents")).decodeText(), "Erledigt");
  const info = await inspect(data.slice());
  assert.deepEqual(
    info.pages[0].elements,
    comments.map(({ id, ...comment }) => comment),
  );
  const cleaned = await lib.PDFDocument.load(info.data);
  assert.equal(cleaned.getPage(0).node.Annots()?.size() ?? 0, 0);
  payload.options.flatten = true;
  const flat = await lib.PDFDocument.load((await assemble(payload)).data);
  assert.equal(flat.getPage(0).node.Annots()?.size() ?? 0, 0);
  assert.equal(
    new TextDecoder()
      .decode(flat.getPage(0).getContentStream?.()?.contents ?? new Uint8Array())
      .includes("Bitte"),
    false,
  );
});
test("Fremde PDF-Notizen mit Antworten, Status und Popup werden übernommen", async () => {
  const doc = await lib.PDFDocument.create();
  const page = doc.addPage([300, 400]);
  const { context } = doc;
  const note = context.register(
    context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [50, 300, 70, 320],
      Contents: lib.PDFHexString.fromText("Fremder Kommentar"),
      T: lib.PDFHexString.fromText("Prüferin"),
      M: lib.PDFString.of("D:20260102030405+01'00'"),
      C: [0, 0, 1],
      Name: "Comment",
    }),
  );
  const popup = context.register(
    context.obj({
      Type: "Annot",
      Subtype: "Popup",
      Rect: [80, 250, 200, 320],
      Parent: note,
    }),
  );
  context.lookup(note).set(lib.PDFName.of("Popup"), popup);
  const reply = context.register(
    context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [50, 300, 70, 320],
      IRT: note,
      Contents: lib.PDFHexString.fromText("Antwort"),
      T: lib.PDFHexString.fromText("Autor"),
    }),
  );
  const state = context.register(
    context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [50, 300, 70, 320],
      IRT: note,
      StateModel: "Review",
      State: "Completed",
    }),
  );
  const square = context.register(
    context.obj({ Type: "Annot", Subtype: "Square", Rect: [10, 10, 40, 40] }),
  );
  for (const ref of [note, popup, reply, state, square]) page.node.addAnnot(ref);
  const info = await inspect(new Uint8Array(await doc.save()));
  assert.deepEqual(info.pages[0].elements, [
    {
      type: "comment",
      x: 50,
      y: 320,
      width: 20,
      height: 20,
      angle: 0,
      color: "#0000ff",
      opacity: 1,
      text: "Fremder Kommentar\n\nAutor: Antwort",
      done: true,
      date: "2026-01-02T02:04:05.000Z",
      author: "Prüferin",
    },
  ]);
  const cleaned = await lib.PDFDocument.load(info.data);
  const remaining = cleaned
    .getPage(0)
    .node.Annots()
    .asArray()
    .map((ref) => cleaned.context.lookup(ref).get(lib.PDFName.of("Subtype")).asString());
  assert.deepEqual(remaining, ["/Square"]);
});
async function legacyForm() {
  const doc = await lib.PDFDocument.create();
  const first = doc.addPage([400, 400]),
    second = doc.addPage([400, 400]);
  const context = doc.context,
    name = lib.PDFName.of,
    fields = [];
  const appearance = (on) => {
    const stream = context.register(
      context.stream("", { BBox: [0, 0, 15, 15], Subtype: name("Form") }),
    );
    return context.obj({ N: { [on]: stream, Off: stream } });
  };
  const widget = (page, entries, rect = [20, 20, 120, 40]) => {
    const ref = context.register(
      context.obj({ Type: "Annot", Subtype: "Widget", Rect: rect, P: page.ref, F: 4, ...entries }),
    );
    page.node.addAnnot(ref);
    return ref;
  };
  const field = (entries, kids = []) => {
    const ref = context.register(context.obj({ ...entries, Kids: [] }));
    for (const [page, extra] of kids)
      context.lookup(ref).get(name("Kids")).push(widget(page, { Parent: ref, ...extra }));
    fields.push(ref);
    return ref;
  };
  fields.push(
    widget(first, { FT: "Btn", T: lib.PDFString.of("ohneV"), AS: "Ja", AP: appearance("Ja") }),
    widget(first, { FT: "Btn", T: lib.PDFString.of("ohneAP"), V: "Yes" }),
    widget(first, { FT: "Tx", T: lib.PDFString.of("versteckt"), F: 2 }),
    widget(first, { FT: "Tx", T: lib.PDFString.of("falschesP"), V: lib.PDFString.of("Wert"), P: second.ref }),
    widget(second, {
      FT: "Ch",
      Ff: 1 << 17,
      T: lib.PDFString.of("land"),
      Opt: [[lib.PDFString.of("DE"), lib.PDFString.of("Deutschland")], [lib.PDFString.of("AT"), lib.PDFString.of("Österreich")]],
      V: lib.PDFString.of("AT"),
    }),
  );
  field({ FT: "Btn", T: lib.PDFString.of("gruppe"), V: "B" }, [
    [first, { AS: "Off", AP: appearance("A") }],
    [first, { AS: "B", AP: appearance("B") }],
  ]);
  field({ FT: "Btn", Ff: 1 << 15, T: lib.PDFString.of("ohneZustand") }, [
    [first, {}],
    [first, {}],
  ]);
  doc.catalog.set(name("AcroForm"), context.obj({ Fields: fields }));
  return new Uint8Array(await doc.save({ updateFieldAppearances: false }));
}
test("Gespeicherte Formularinhalte werden auch aus untypischen Strukturen erkannt", async () => {
  const info = await inspect(await legacyForm());
  const find = (page, field) =>
    info.pages[page].widgets.filter((widget) => widget.name === field);
  assert.deepEqual(
    find(0, "ohneV").map(({ value, on }) => ({ value, on })),
    [{ value: "Ja", on: "Ja" }],
  );
  assert.deepEqual(
    find(0, "ohneAP").map(({ value, on }) => ({ value, on })),
    [{ value: "Yes", on: "Yes" }],
  );
  assert.deepEqual(
    find(0, "gruppe").map(({ value, on }) => ({ value, on })),
    [
      { value: "B", on: "A" },
      { value: "B", on: "B" },
    ],
  );
  assert.ok(find(0, "ohneZustand").every((widget) => widget.on === "" && widget.value === ""));
  assert.deepEqual(find(0, "versteckt"), []);
  assert.deepEqual(find(0, "falschesP").length, 1);
  assert.deepEqual(find(1, "falschesP"), []);
  const [land] = find(1, "land");
  assert.deepEqual(land.value, ["AT"]);
  assert.deepEqual(land.options, ["DE", "AT"]);
  assert.deepEqual(land.labels, ["Deutschland", "Österreich"]);
});
test("Exportwerte von Auswahlfeldern und Kontrollkästchen-Gruppen bleiben beim Speichern erhalten", async () => {
  const data = await legacyForm(),
    info = await inspect(data);
  const payload = {
    fontBytes,
    sources: [{ id: "source", data }],
    document: {
      pages: info.pages.map((page, i) => createPage("source", i, page, "group")),
      formValues: { "group:gruppe": "A", "group:land": ["DE"], "group:ohneV": "" },
    },
    options: { plainGroup: "group" },
  };
  const { data: saved } = await assemble(payload);
  const output = await lib.PDFDocument.load(saved),
    name = lib.PDFName.of;
  const reopened = await inspect(saved);
  const values = Object.fromEntries(
    reopened.pages.flatMap((page) => page.widgets.map((widget) => [widget.name, widget.value])),
  );
  assert.equal(values.gruppe, "A");
  assert.equal(values.ohneV, "");
  assert.equal(values.ohneAP, "Yes");
  assert.deepEqual(values.land, ["DE"]);
  assert.deepEqual(
    output
      .getForm()
      .getCheckBox("gruppe")
      .acroField.getWidgets()
      .map((widget) => widget.getAppearanceState().decodeText()),
    ["A", "Off"],
  );
  const land = output.getForm().getDropdown("land");
  assert.equal(land.acroField.dict.get(name("V")).decodeText(), "DE");
  assert.deepEqual(
    output
      .getForm()
      .getTextField("falschesP")
      .acroField.getWidgets()
      .map((widget) => widget.P()),
    [output.getPage(0).ref],
  );
  const { data: flat } = await assemble({ ...payload, options: { flatten: true } });
  const js = await pdfJs();
  const task = js.getDocument({ data: flat, isEvalSupported: false });
  try {
    const page = await (await task.promise).getPage(2);
    const text = (await page.getTextContent()).items.map((item) => item.str).join(" ");
    assert.ok(text.includes("Deutschland"));
  } finally {
    await task.destroy();
  }
});
async function styledForm() {
  const doc = await lib.PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const context = doc.context,
    name = lib.PDFName.of;
  const appearance = (content) =>
    context.register(context.stream(content, { BBox: [0, 0, 100, 20], Subtype: name("Form") }));
  const widget = (entries) => {
    const ref = context.register(
      context.obj({ Type: "Annot", Subtype: "Widget", P: page.ref, F: 4, ...entries }),
    );
    page.node.addAnnot(ref);
    return ref;
  };
  const lower = widget({
    FT: "Tx",
    T: lib.PDFString.of("unten"),
    Rect: [20, 20, 120, 40],
    V: lib.PDFString.of("bleibt"),
    AP: { N: appearance("% original unten") },
  });
  const upper = widget({
    FT: "Tx",
    T: lib.PDFString.of("oben"),
    Rect: [200, 300, 300, 320],
    Q: 2,
    Ff: (1 << 24) | (1 << 13),
    MaxLen: 6,
    DA: lib.PDFString.of("/Helv 9 Tf 1 0 0 rg"),
    MK: { BG: [0.9], BC: [0, 0, 1] },
    V: lib.PDFString.of("alt"),
    AP: { N: appearance("% original oben") },
  });
  const left = widget({
    FT: "Tx",
    T: lib.PDFString.of("links"),
    Rect: [20, 300, 120, 320],
  });
  const stream = appearance("% original haken");
  const box = widget({
    FT: "Btn",
    T: lib.PDFString.of("haken"),
    Rect: [20, 200, 35, 215],
    V: "Ja",
    AS: "Ja",
    AP: { N: { Ja: stream, Off: stream } },
  });
  widget({
    FT: "Tx",
    T: lib.PDFString.of("waise"),
    Rect: [20, 100, 120, 120],
    V: lib.PDFString.of("ohne Formular"),
  });
  const font = context.register(
    context.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" }),
  );
  doc.catalog.set(
    name("AcroForm"),
    context.obj({
      Fields: [lower, upper, left, box],
      DA: lib.PDFString.of("/Helv 0 Tf 0 g"),
      DR: { Font: { Helv: font } },
    }),
  );
  return { doc, page };
}
test("Formularfelder liefern Stil, Tab-Reihenfolge und verwaiste Widgets", async () => {
  const { doc, page } = await styledForm();
  let info = await inspect(new Uint8Array(await doc.save({ updateFieldAppearances: false })));
  assert.deepEqual(
    info.pages[0].widgets.map((widget) => widget.name),
    ["unten", "oben", "links", "haken", "waise"],
  );
  const upper = info.pages[0].widgets.find((widget) => widget.name === "oben");
  assert.deepEqual(
    {
      align: upper.align,
      comb: upper.comb,
      password: upper.password,
      fontSize: upper.fontSize,
      color: upper.color,
      background: upper.background,
      border: upper.border,
      maxLength: upper.maxLength,
    },
    {
      align: "right",
      comb: false,
      password: true,
      fontSize: 9,
      color: "#ff0000",
      background: "#e6e6e6",
      border: "#0000ff",
      maxLength: 6,
    },
  );
  assert.equal(info.pages[0].widgets.find((widget) => widget.name === "waise").value, "ohne Formular");
  assert.equal(info.pages[0].widgets.find((widget) => widget.name === "links").fontSize, null);
  page.node.set(lib.PDFName.of("Tabs"), lib.PDFName.of("R"));
  info = await inspect(new Uint8Array(await doc.save({ updateFieldAppearances: false })));
  assert.deepEqual(
    info.pages[0].widgets.map((widget) => widget.name),
    ["links", "oben", "haken", "waise", "unten"],
  );
});
test("Speichern erhält das Aussehen unveränderter Felder und erzeugt nur geänderte neu", async () => {
  const { doc } = await styledForm();
  const data = new Uint8Array(await doc.save({ updateFieldAppearances: false })),
    info = await inspect(data);
  const { data: saved } = await assemble({
    fontBytes,
    sources: [{ id: "source", data }],
    document: {
      pages: info.pages.map((page, i) => createPage("source", i, page, "group")),
      formValues: { "group:oben": "neu" },
    },
    options: { plainGroup: "group" },
  });
  const output = await lib.PDFDocument.load(saved),
    form = output.getForm(),
    name = lib.PDFName.of;
  const content = (field) => {
    const normal = form.getField(field).acroField.getWidgets()[0].getAppearances().normal;
    const stream = normal instanceof lib.PDFDict ? output.context.lookup(normal.get(name("Ja"))) : normal;
    return Buffer.from(lib.decodePDFRawStream(stream).decode()).toString("latin1");
  };
  assert.equal(content("unten"), "% original unten");
  assert.equal(content("haken"), "% original haken");
  assert.notEqual(content("oben"), "% original oben");
  assert.equal(form.getTextField("waise").getText(), "ohne Formular");
  assert.ok(content("links").length > 0);
  const resources = form.acroForm.dict.lookup(name("DR"), lib.PDFDict);
  assert.ok(resources.lookup(name("Font"), lib.PDFDict).has(name("Helv")));
  assert.equal(form.getTextField("unten").acroField.dict.lookup(name("DA")).decodeText(), "/Helv 0 Tf 0 g");
});
test("Zu langer Formulartext wird beim Speichern verkleinert und automatische Größe bleibt erhalten", async () => {
  const doc = await lib.PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const context = doc.context,
    name = lib.PDFName.of,
    fields = [];
  for (const [title, appearance, flags, rect] of [
    ["auto", "/Helv 0 Tf 0 g", 0, [20, 300, 120, 320]],
    ["fest", "/Helv 14 Tf 0 g", 0, [20, 250, 120, 270]],
    ["kurz", "/Helv 14 Tf 0 g", 0, [20, 200, 220, 220]],
    ["mehrzeilig", "/Helv 0 Tf 0 g", 1 << 12, [20, 100, 120, 150]],
  ]) {
    const ref = context.register(
      context.obj({
        Type: "Annot",
        Subtype: "Widget",
        FT: "Tx",
        T: lib.PDFString.of(title),
        DA: lib.PDFString.of(appearance),
        Ff: flags,
        Rect: rect,
        P: page.ref,
        F: 4,
      }),
    );
    page.node.addAnnot(ref);
    fields.push(ref);
  }
  doc.catalog.set(name("AcroForm"), context.obj({ Fields: fields }));
  const data = new Uint8Array(await doc.save({ updateFieldAppearances: false })),
    info = await inspect(data);
  const long = "Ein sehr langer Text, der deutlich zu breit für dieses Feld ist";
  const { data: saved } = await assemble({
    fontBytes,
    sources: [{ id: "source", data }],
    document: {
      pages: info.pages.map((entry, i) => createPage("source", i, entry, "group")),
      formValues: {
        "group:auto": long,
        "group:fest": "Etwas zu lang für vierzehn Punkt",
        "group:kurz": "kurz",
        "group:mehrzeilig": `${long} ${long}`,
      },
    },
    options: { plainGroup: "group" },
  });
  const form = (await lib.PDFDocument.load(saved)).getForm();
  const sizes = Object.fromEntries(
    ["auto", "fest", "kurz", "mehrzeilig"].map((field) => {
      const widget = form.getTextField(field).acroField.getWidgets()[0];
      const content = Buffer.from(
        lib.decodePDFRawStream(widget.getAppearances().normal).decode(),
      ).toString("latin1");
      return [field, Number(content.match(/([\d.]+) Tf/)[1])];
    }),
  );
  assert.equal(sizes.auto, 6);
  assert.ok(sizes.fest >= 6 && sizes.fest < 14);
  assert.equal(sizes.kurz, 14);
  assert.ok(sizes.mehrzeilig >= 6 && sizes.mehrzeilig < 12);
  assert.equal(
    form.getTextField("auto").acroField.dict.lookup(name("DA")).decodeText(),
    "/Helv 0 Tf 0 g",
  );
  const reopened = await inspect(saved);
  assert.deepEqual(
    reopened.pages[0].widgets.map((widget) => [widget.name, widget.fontSize]),
    [
      ["auto", null],
      ["fest", 14],
      ["kurz", 14],
      ["mehrzeilig", null],
    ],
  );
});
