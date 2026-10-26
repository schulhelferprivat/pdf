import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";
import { openBlankDocument, selectDocument } from "./helpers/documents.mjs";

async function openChapters(b, name = "Kapitel.pdf") {
  await b.evaluate(async (name) => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib(), doc = await lib.PDFDocument.create();
    const font = await doc.embedFont(lib.StandardFonts.Helvetica);
    for (const title of ["Einleitung", "Ergebnisse", "Ausblick"]) {
      const page = doc.addPage([595, 842]);
      page.drawText("Handbuch", { x: 40, y: 815, size: 16, font });
      page.drawText(title, { x: 40, y: 720, size: 24, font });
      for (let i = 0; i < 8; i++) {
        page.drawText("Ein Absatz mit normalem Text beschreibt hier das aktuelle Thema.", {
          x: 40, y: 680 - i * 18, size: 12, font,
        });
      }
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([await doc.save()], name, { type: "application/pdf" }));
    document.querySelector("#file-input").files = transfer.files;
    document.querySelector("#file-input").dispatchEvent(new Event("change"));
  }, name);
  await b.wait(() => document.querySelectorAll(".page-item").length === 3 && !document.querySelector("#busy-dialog").open);
}

async function openLinkedContents(b, options = {}) {
  await b.evaluate(async ({ bookmarks = false, rotated = false }) => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib(), doc = await lib.PDFDocument.create(), context = doc.context;
    const pages = Array.from({ length: 6 }, () => doc.addPage([595, 842]));
    pages[0].drawText("Dokumenttitel", { x: 40, y: 740, size: 28 });
    pages[0].drawText("Untertitel", { x: 40, y: 700, size: 24 });
    pages[0].drawText("Weitere Angaben zum Dokument", { x: 40, y: 650, size: 20 });
    pages[1].drawText("Inhaltsverzeichnis", { x: 40, y: 780, size: 24 });
    pages[1].drawText("1 Einleitung ........", { x: 40, y: 710, size: 12 });
    pages[1].drawText("99", { x: 500, y: 710, size: 12 });
    pages[1].drawText("1.1 Ein langer", { x: 55, y: 662, size: 12 });
    pages[1].drawText("Kapiteltitel", { x: 55, y: 648, size: 12 });
    pages[1].drawText("iv", { x: 500, y: 648, size: 12 });
    pages[1].drawText("2 Ergebnisse", { x: 40, y: 600, size: 12 });
    pages[1].drawText("101", { x: 500, y: 600, size: 12 });
    pages[1].drawText("Defektes Ziel", { x: 40, y: 550, size: 12 });
    pages[2].drawText("3 Ausblick", { x: 40, y: 750, size: 12 });
    pages[2].drawText("102", { x: 500, y: 750, size: 12 });
    for (const [index, title] of ["Einleitung", "Ergebnisse", "Ausblick"].entries()) {
      const page = pages[index + 3];
      page.drawText(title, { x: 40, y: 720, size: 24 });
      for (let line = 0; line < 8; line++) {
        page.drawText("Ein Absatz mit normalem Text beschreibt hier das aktuelle Thema.", {
          x: 40, y: 680 - line * 18, size: 12,
        });
      }
    }
    const destination = (index) => context.obj([pages[index].ref, lib.PDFName.of("XYZ"), null, null, null]);
    doc.catalog.set(lib.PDFName.of("Names"), context.obj({
      Dests: { Names: [lib.PDFString.of("intro"), destination(3), lib.PDFString.of("last"), destination(5)] },
    }));
    const annotate = (page, rect, dest, action = false) => {
      const annotation = { Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0] };
      if (action) annotation.A = { S: "GoTo", D: dest };
      else annotation.Dest = dest;
      page.node.addAnnot(context.register(context.obj(annotation)));
    };
    annotate(pages[1], [500, 708, 520, 724], lib.PDFString.of("intro"), true);
    annotate(pages[1], [40, 708, 200, 724], lib.PDFString.of("intro"));
    annotate(pages[1], [500, 646, 520, 662], destination(3));
    annotate(pages[1], [40, 598, 520, 614], destination(4));
    annotate(pages[1], [40, 548, 220, 564], lib.PDFString.of("missing"));
    annotate(pages[2], [40, 748, 520, 764], lib.PDFString.of("last"));
    annotate(pages[3], [40, 718, 200, 734], destination(1));
    if (rotated) {
      pages[1].setRotation(lib.degrees(90));
      pages[2].setRotation(lib.degrees(270));
    }
    if (bookmarks) {
      const root = context.nextRef(), parent = context.nextRef(), child = context.nextRef();
      context.assign(root, context.obj({ Type: "Outlines", First: parent, Last: parent, Count: 2 }));
      context.assign(parent, context.obj({
        Title: lib.PDFString.of("Originalkapitel"), Parent: root, Dest: destination(4),
        First: child, Last: child, Count: 1,
      }));
      context.assign(child, context.obj({
        Title: lib.PDFString.of("Originaldetails"), Parent: parent, Dest: destination(5),
      }));
      doc.catalog.set(lib.PDFName.of("Outlines"), root);
    }
    window.linkedContentsFile = new File([await doc.save()], "Verzeichnis.pdf", { type: "application/pdf" });
    const transfer = new DataTransfer();
    transfer.items.add(window.linkedContentsFile);
    document.querySelector("#file-input").files = transfer.files;
    document.querySelector("#file-input").dispatchEvent(new Event("change"));
  }, options);
  await b.wait(() => document.querySelectorAll(".page-item").length === 6 && !document.querySelector("#busy-dialog").open);
}

test("Browser: automatische PDF-Gliederung funktioniert offline mit Navigation und entfernten Seiten", { timeout: 90000 }, async (t) => {
  const b = await browser(t, { prefix: "/PDFHelper/" });
  await b.wait(() => !!navigator.serviceWorker.controller, 60000);
  await b.offline(true);
  await b.navigate();
  await b.wait(() => document.readyState === "complete" && !!document.querySelector("#welcome .icon"));
  await openChapters(b);
  await b.wait(() => document.querySelectorAll("#outline-list .outline-link").length === 3);
  assert.deepEqual(await b.evaluate(() => [...document.querySelectorAll("#outline-list .outline-link")].map((link) => link.textContent)), ["Einleitung", "Ergebnisse", "Ausblick"]);
  await b.evaluate(() => document.querySelector('#outline-list [title="Ausblick"]').click());
  await b.wait(() => document.querySelector("#current-page").value === "3");
  assert.equal(await b.evaluate(() => document.querySelector("#outline-list [aria-current=true]").textContent), "Ausblick");
  await b.evaluate(() => document.querySelector("#page-list .page-item.current .thumbnail").dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
  await b.wait(() => document.querySelector('#outline-list [title="Seite nicht mehr im Dokument"]')?.textContent === "Ausblick");
  await openBlankDocument(b);
  await b.wait(() => document.querySelector("[data-side-section=outline]").hidden);
  assert.equal(await b.evaluate(() => document.querySelectorAll("#outline-list .outline-link").length), 0);
  await selectDocument(b, 0);
  await b.wait(() => document.querySelectorAll("#outline-list .outline-link").length === 3);
  assert.deepEqual(b.errors, []);
});

test("Browser: Dokumentwechsel entfernt alte Einträge und ignoriert verspätete Analysen", { timeout: 90000 }, async (t) => {
  const b = await browser(t);
  await openChapters(b);
  await b.wait(() => document.querySelectorAll("#outline-list .outline-link").length === 3);
  await b.evaluate(async () => {
    const { Renderer } = await import("./src/pdf/renderer.js");
    const original = Renderer.prototype.source;
    window.outlineGate = new Promise((resolve) => { window.releaseOutline = resolve; });
    Renderer.prototype.source = async function (id) {
      const pdf = await original.call(this, id);
      if (this.sources.get(id)?.file.name === "Verzoegert.pdf" && !pdf.outlineDelayed) {
        pdf.outlineDelayed = true;
        const getPage = pdf.getPage.bind(pdf);
        pdf.getPage = async (number) => {
          const page = await getPage(number);
          if (!page.outlineDelayed) {
            page.outlineDelayed = true;
            const getTextContent = page.getTextContent.bind(page);
            page.getTextContent = async (options) => {
              if (options?.includeMarkedContent) {
                window.outlineStarted = true;
                await window.outlineGate;
              }
              return getTextContent(options);
            };
          }
          return page;
        };
      }
      return pdf;
    };
    const outline = Renderer.prototype.outline;
    Renderer.prototype.outline = function (id) {
      const result = outline.call(this, id);
      if (this.sources.get(id)?.file.name === "Verzoegert.pdf") window.delayedOutline = result;
      return result;
    };
  });
  await openChapters(b, "Verzoegert.pdf");
  await b.wait(() => window.outlineStarted);
  assert.equal(await b.evaluate(() => document.querySelectorAll("#outline-list .outline-link").length), 0);
  await openBlankDocument(b);
  await b.evaluate(async () => {
    window.releaseOutline();
    await window.delayedOutline;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(await b.evaluate(() => ({
    hidden: document.querySelector("[data-side-section=outline]").hidden,
    count: document.querySelectorAll("#outline-list .outline-link").length,
  })), { hidden: true, count: 0 });
  await selectDocument(b, 1);
  await b.wait(() => document.querySelectorAll("#outline-list .outline-link").length === 3);
  assert.deepEqual(b.errors, []);
});

test("Browser: PDF-Strukturmarkierungen werden mit dem echten PDF.js ausgewertet", { timeout: 90000 }, async (t) => {
  const b = await browser(t);
  const result = await b.evaluate(async () => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const { Renderer } = await import("./src/pdf/renderer.js");
    const lib = await pdfLib(), doc = await lib.PDFDocument.create(), context = doc.context;
    const root = context.nextRef(), headings = [], parents = [];
    for (const [index, title] of ["Einleitung", "Details", "Ergebnisse"].entries()) {
      const page = doc.addPage([595, 842]);
      page.drawText(title, { x: 40, y: 700, size: 12 });
      const contents = page.node.Contents().asArray();
      page.node.set(lib.PDFName.of("Contents"), context.obj([
        context.register(context.flateStream("/H1 <</MCID 0>> BDC\n")),
        ...contents,
        context.register(context.flateStream("\nEMC\n")),
      ]));
      page.node.set(lib.PDFName.of("StructParents"), lib.PDFNumber.of(index));
      const heading = context.register(context.obj({
        Type: "StructElem", S: index === 1 ? "H2" : "H1", P: root, Pg: page.ref, K: 0,
      }));
      headings.push(heading);
      parents.push(index, [heading]);
    }
    context.assign(root, context.obj({
      Type: "StructTreeRoot", K: headings,
      ParentTree: context.register(context.obj({ Nums: parents })),
    }));
    doc.catalog.set(lib.PDFName.of("StructTreeRoot"), root);
    doc.catalog.set(lib.PDFName.of("MarkInfo"), context.obj({ Marked: true }));
    const file = new File([await doc.save()], "Markiert.pdf", { type: "application/pdf" });
    const renderer = new Renderer(new Map([["tagged", { file }]]), new Map());
    try {
      return await renderer.outline("tagged");
    } finally {
      renderer.destroy();
    }
  });
  assert.deepEqual(result, [
    { title: "Einleitung", index: 0, open: true, items: [{ title: "Details", index: 1, open: true, items: [] }] },
    { title: "Ergebnisse", index: 2, open: true, items: [] },
  ]);
  assert.deepEqual(b.errors, []);
});

test("Browser: verlinktes Inhaltsverzeichnis funktioniert offline mit Hierarchie und Originalzielen", { timeout: 90000 }, async (t) => {
  const b = await browser(t, { prefix: "/PDFHelper/" });
  await b.wait(() => !!navigator.serviceWorker.controller, 60000);
  await b.offline(true);
  await b.navigate();
  await b.wait(() => document.readyState === "complete" && !!document.querySelector("#welcome .icon"));
  await openLinkedContents(b, { rotated: true });
  assert.deepEqual(await b.evaluate(async () => {
    const { Renderer } = await import("./src/pdf/renderer.js");
    const renderer = new Renderer(new Map([["linked", { file: window.linkedContentsFile }]]), new Map());
    try {
      return await renderer.outline("linked");
    } finally {
      renderer.destroy();
    }
  }), [
    { title: "1 Einleitung", index: 3, items: [{ title: "1.1 Ein langer Kapiteltitel", index: 3, items: [], open: true }], open: true },
    { title: "2 Ergebnisse", index: 4, items: [], open: true },
    { title: "3 Ausblick", index: 5, items: [], open: true },
  ]);
  await b.wait(() => document.querySelectorAll("#outline-list .outline-link").length === 4);
  assert.deepEqual(await b.evaluate(() => [...document.querySelectorAll("#outline-list .outline-link")].map((link) => ({
    title: link.textContent, index: link.dataset.index,
  }))), [
    { title: "1 Einleitung", index: "3" }, { title: "1.1 Ein langer Kapiteltitel", index: "3" },
    { title: "2 Ergebnisse", index: "4" }, { title: "3 Ausblick", index: "5" },
  ]);
  assert.equal(await b.evaluate(() => document.querySelector("#outline-list li > ul .outline-link").textContent), "1.1 Ein langer Kapiteltitel");
  await b.evaluate(() => document.querySelector('#outline-list [title="2 Ergebnisse"]').click());
  await b.wait(() => document.querySelector("#current-page").value === "5");
  await b.evaluate(() => document.querySelector('#outline-list [title="3 Ausblick"]').click());
  await b.wait(() => document.querySelector("#current-page").value === "6");
  await b.evaluate(() => document.querySelector("#page-list .page-item.current .thumbnail").dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
  await b.wait(() => document.querySelector('#outline-list [title="Seite nicht mehr im Dokument"]')?.textContent === "3 Ausblick");
  await openBlankDocument(b);
  await b.wait(() => document.querySelector("[data-side-section=outline]").hidden);
  await selectDocument(b, 0);
  await b.wait(() => document.querySelectorAll("#outline-list .outline-link").length === 4);
  assert.deepEqual(b.errors, []);
});

test("Browser: echte PDF-Lesezeichen behalten Vorrang vor verlinktem Verzeichnis und Überschriften", { timeout: 90000 }, async (t) => {
  const b = await browser(t);
  await openLinkedContents(b, { bookmarks: true });
  await b.wait(() => document.querySelectorAll("#outline-list .outline-link").length === 2);
  assert.deepEqual(await b.evaluate(() => [...document.querySelectorAll("#outline-list .outline-link")].map((link) => link.textContent)), ["Originalkapitel", "Originaldetails"]);
  await b.evaluate(() => document.querySelector('#outline-list [title="Originaldetails"]').click());
  await b.wait(() => document.querySelector("#current-page").value === "6");
  const result = await b.evaluate(async () => {
    const { Renderer } = await import("./src/pdf/renderer.js");
    const renderer = new Renderer(new Map([["original", { file: window.linkedContentsFile }]]), new Map());
    try {
      const pdf = await renderer.source("original");
      pdf.getPage = () => { throw new Error("Keine Seitenanalyse bei vorhandenen Lesezeichen"); };
      return await renderer.outline("original");
    } finally {
      renderer.destroy();
    }
  });
  assert.deepEqual(result, [{
    title: "Originalkapitel", index: 4, open: true,
    items: [{ title: "Originaldetails", index: 5, items: [], open: false }],
  }]);
  assert.deepEqual(b.errors, []);
});
