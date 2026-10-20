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
