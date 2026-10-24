import { togglePin } from "./helpers/panels.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";
import { openBlankDocument, selectDocument } from "./helpers/documents.mjs";
test(
  "Browser: Import, Seitenverwaltung, Bearbeitung, Formulare und Export",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t, { prefix: "/PDFHelper/" });
    await b.screenshot("/tmp/pdfhelper-welcome.png");
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js"),
        lib = await pdfLib(),
        doc = await lib.PDFDocument.create();
      const first = doc.addPage([595.3, 841.9]);
      first.drawText("PDFHelper Test", { x: 40, y: 760, size: 24 });
      const second = doc.addPage([595.3, 841.9]);
      second.drawText("Zweite Seite", { x: 40, y: 760, size: 24 });
      const field = doc.getForm().createTextField("Testfeld");
      field.addToPage(first, { x: 40, y: 600, width: 220, height: 30 });
      const file = new File([await doc.save()], "Testdokument.pdf", {
          type: "application/pdf",
        }),
        transfer = new DataTransfer();
      transfer.items.add(file);
      document.querySelector("#file-input").files = transfer.files;
      document.querySelector("#file-input").dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        document.querySelectorAll(".page-item").length === 2 &&
        !document.querySelector("#busy-dialog").open &&
        document.querySelector("#page-loading").hidden,
    );
    await b.wait(
      () =>
        document.querySelector("#page-canvas").width > 0 &&
        document.querySelector("#page-loading").hidden,
    );
    await b.evaluate(() => {
      const input = document.querySelector("#form-layer input");
      input.focus();
      input.value = "Prüfung Ω";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(
      await b.evaluate(() => document.querySelector("#form-layer input").value),
      "Prüfung Ω",
    );
    await b.evaluate(() => {
      const [first, second] = document.querySelectorAll("#page-list .page-item"),
        rect = first.getBoundingClientRect(),
        x = rect.x + rect.width / 2,
        y = rect.y + rect.height / 2,
        dataTransfer = new DataTransfer();
      const fire = (target, type) =>
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer,
          }),
        );
      fire(second, "dragstart");
      fire(first, "dragover");
      fire(first, "drop");
      fire(second, "dragend");
      document.querySelector("[data-action=select-all]").click();
    });
    assert.equal(
      await b.evaluate(() => document.querySelectorAll(".group-label").length),
      1,
    );
    const landscape = () => {
      const canvas = document.querySelector("#page-canvas");
      return (
        document.querySelector("#page-loading").hidden &&
        canvas.width > canvas.height
      );
    };
    const portrait = () => {
      const canvas = document.querySelector("#page-canvas");
      return (
        document.querySelector("#page-loading").hidden &&
        canvas.width > 0 &&
        canvas.width < canvas.height
      );
    };
    assert.equal(
      await b.evaluate(() =>
        [
          "[data-action=duplicate]",
          "#rotate-all",
          "[data-rotation]",
        ].some((selector) => document.querySelector(selector)),
      ),
      false,
    );
    assert.deepEqual(
      await b.evaluate(() => ["select-all", "select-none"].map((action) => {
        const button = document.querySelector(`[data-action="${action}"]`);
        return { label: button.getAttribute("aria-label"), title: button.title, text: button.textContent.trim(), icon: !!button.querySelector(".icon") };
      })),
      [
        { label: "Alle Seiten auswählen", title: "Alle Seiten auswählen", text: "", icon: true },
        { label: "Seitenauswahl aufheben", title: "Seitenauswahl aufheben", text: "", icon: true },
      ],
    );
    await b.evaluate(() =>
      document
        .querySelector("#page-list .page-item.current .thumbnail")
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "r", bubbles: true }),
        ),
    );
    await b.wait(landscape);
    await b.evaluate(() =>
      document.querySelector("[data-action=undo]").click(),
    );
    await b.wait(portrait);
    assert.deepEqual(
      await b.evaluate(() => {
        const redo = document.querySelector("#redo-button");
        return [redo.disabled, redo.title];
      }),
      [false, "Wiederholen: Seiten drehen (Strg/⌘ Umschalt Z)"],
    );
    await b.evaluate(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Z",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    await b.wait(landscape);
    await b.evaluate(() =>
      document.querySelector("[data-action=toggle-history]").click(),
    );
    assert.deepEqual(
      await b.evaluate(() =>
        [...document.querySelectorAll("#history-menu button")].map((item) => [
          item.textContent,
          item.getAttribute("aria-current"),
        ]),
      ),
      [
        ["Ausgangszustand", null],
        ["Formularfeld ausfüllen", null],
        ["Seiten gruppieren", null],
        ["Seiten drehen", "step"],
      ],
    );
    await b.evaluate(() =>
      document.querySelectorAll("#history-menu button")[0].click(),
    );
    assert.deepEqual(
      await b.evaluate(() => [
        document.querySelectorAll(".group-label").length,
        document.querySelector("#form-layer input").value,
        document.querySelector("#history-menu").matches(":popover-open"),
      ]),
      [0, "", false],
    );
    await b.evaluate(() => {
      document.querySelector("[data-action=toggle-history]").click();
      document.querySelectorAll("#history-menu button")[2].click();
    });
    assert.deepEqual(
      await b.evaluate(() => [
        document.querySelectorAll(".page-item").length,
        document.querySelectorAll(".group-label").length,
        document.querySelector("#undo-button").title,
      ]),
      [2, 1, "Rückgängig: Seiten gruppieren (Strg/⌘ Z)"],
    );
    await b.evaluate(() => document.querySelectorAll(".thumbnail")[0].click());
    await b.wait(() => document.querySelector("#page-loading").hidden);
    await b.evaluate(() => document.querySelector("[data-tool=text]").click());
    const point = await b.evaluate(() => {
      const rect = document
        .querySelector("#page-stage")
        .getBoundingClientRect();
      return { x: rect.x + rect.width * 0.35, y: rect.y + rect.height * 0.4 };
    });
    await b.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await b.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    assert.deepEqual(
      await b.evaluate(() => {
        const field = document.querySelector(".annotation .inline-text");
        return {
          focused: document.activeElement === field,
          selected: field.value.slice(field.selectionStart, field.selectionEnd),
        };
      }),
      { focused: true, selected: "Text" },
    );
    await b.command("Input.insertText", { text: "Zusatztext" });
    await b.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      modifiers: 2,
      windowsVirtualKeyCode: 13,
    });
    assert.deepEqual(
      await b.evaluate(() => ({
        editing: !!document.querySelector(".inline-text"),
        text: document.querySelector(".annotation").textContent,
      })),
      { editing: false, text: "Zusatztext" },
    );
    await b.evaluate(() => document.querySelector("[data-tool=select]").click());
    const textBox = await b.evaluate(() => {
      const rect = document
        .querySelector(".annotation[data-type=text]")
        .getBoundingClientRect();
      return { x: rect.x + 10, y: rect.y + 10 };
    });
    for (const clickCount of [1, 2])
      for (const type of ["mousePressed", "mouseReleased"])
        await b.command("Input.dispatchMouseEvent", {
          type,
          ...textBox,
          button: "left",
          clickCount,
        });
    assert.equal(
      await b.evaluate(
        () =>
          document.activeElement ===
            document.querySelector(".annotation .inline-text") &&
          document.activeElement.value,
      ),
      "Zusatztext",
    );
    await b.command("Input.insertText", { text: " verworfen" });
    await b.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    assert.deepEqual(
      await b.evaluate(() => ({
        editing: !!document.querySelector(".inline-text"),
        text: document.querySelector(".annotation[data-type=text]")
          .textContent,
        settings: !!document.querySelector(
          "#element-text, #tool-color, [data-settings-group=editing]",
        ),
      })),
      { editing: false, text: "Zusatztext", settings: false },
    );
    await b.screenshot("/tmp/pdfhelper-editor.png");
    await b.evaluate(() => {
      window.downloads = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download)
          window.downloads.push({ url: this.href, name: this.download });
        else click.call(this);
      };
      document.querySelector("[data-action=export]").click();
      document.querySelector("#export-password").value = "test-secret";
      document.querySelector("#export-password-confirm").value = "test-secret";
      document.querySelector("#export-form").requestSubmit();
    });
    await b.wait(() => window.downloads?.length === 1);
    const result = await b.evaluate(async () => {
      const { pdfLib, pdfJs, renderOptions } =
          await import("./src/pdf/vendors.js"),
        lib = await pdfLib(),
        data = new Uint8Array(
          await (await fetch(window.downloads[0].url)).arrayBuffer(),
        );
      const doc = await lib.PDFDocument.load(data, { password: "test-secret" });
      const values = doc
        .getForm()
        .getFields()
        .filter((field) => field instanceof lib.PDFTextField)
        .map((field) => field.getText());
      const js = await pdfJs(),
        task = js.getDocument({
          ...renderOptions(),
          data: data.slice(),
          password: "test-secret",
        });
      let texts = [],
        widgets = [],
        notes = [];
      try {
        const opened = await task.promise;
        for (let i = 1; i <= opened.numPages; i++) {
          const page = await opened.getPage(i);
          texts.push(
            ...(await page.getTextContent()).items.map((item) => item.str),
          );
          const annotations = await page.getAnnotations();
          widgets.push(
            ...annotations
              .filter((item) => item.subtype === "Widget")
              .map((item) => item.fieldValue),
          );
          notes.push(
            ...annotations
              .filter((item) => item.subtype === "FreeText")
              .map((item) => item.contentsObj.str),
          );
        }
      } finally {
        await task.destroy();
      }
      return {
        pages: doc.getPageCount(),
        values,
        texts,
        widgets,
        notes,
        name: window.downloads[0].name,
      };
    });
    assert.equal(result.pages, 2);
    assert.ok(result.values.includes("Prüfung Ω"));
    assert.ok(result.widgets.includes("Prüfung Ω"));
    assert.ok(result.notes.includes("Zusatztext"));
    assert.equal(result.name, "Testdokument.pdf");
    assert.deepEqual(b.errors, []);
  },
);
test(
  "PWA: Unterpfad, vollständiger Cache und Offline-Neustart",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t, { prefix: "/PDFHelper/" });
    await b.wait(() => !!navigator.serviceWorker.controller, 60000);
    await b.offline(true);
    await b.navigate();
    await b.wait(
      () =>
        !!navigator.serviceWorker.controller &&
        document.readyState === "complete" &&
        !!document.querySelector("#welcome .icon"),
    );
    await openBlankDocument(b);
    await b.wait(
      () =>
        document.querySelector("#page-canvas")?.width > 0 &&
        document.querySelector("#page-loading").hidden,
    );
    await b.evaluate(() => {
      window.downloads = [];
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.downloads.push(this.href);
      };
      document.querySelector("[data-action=export]").click();
      document.querySelector("#export-form").requestSubmit();
    });
    await b.wait(() => window.downloads?.length === 1);
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Bilder, Zusammenführen, Drucklayout, Unterschrift, ZIP, JPG und Drucken",
  { timeout: 180000 },
  async (t) => {
    const b = await browser(t);
    await b.evaluate(async () => {
      const data = await (await fetch("./assets/icon-192.png")).arrayBuffer(),
        transfer = new DataTransfer();
      transfer.items.add(new File([data], "Bild.png", { type: "image/png" }));
      transfer.items.add(
        new File(["ungültig"], "Ungueltig.pdf", { type: "application/pdf" }),
      );
      document.querySelector("#file-input").files = transfer.files;
      document.querySelector("#file-input").dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        document.querySelectorAll(".page-item").length === 1 &&
        !document.querySelector("#busy-dialog").open,
    );
    assert.equal(
      await b.evaluate(
        () =>
          document.querySelectorAll("#file-list li")
            .length,
      ),
      1,
    );
    await openBlankDocument(b);
    await b.evaluate(() => {
      const item = document.querySelector("#page-list .page-item");
      item.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
      [...document.querySelectorAll("#context-menu button")]
        .find((button) => /^In „.+“ kopieren$/.test(button.textContent))
        .click();
    });
    await b.wait(
      () => document.querySelector("#undo-button").title.includes("Seiten einfügen"),
    );
    await b.evaluate(() => document.querySelector("[data-action=merge]").click());
    assert.equal(
      await b.evaluate(() => document.querySelectorAll(".page-item").length),
      3,
    );
    await b.evaluate(() => {
      document.querySelector("[data-action=open-layout]").click();
      document.querySelector("#layout-students").value = "1";
      document.querySelector("#layout-view").click();
    });
    await b.wait(
      () =>
        document.querySelectorAll(".page-item").length === 2 &&
        !document.querySelector("#busy-dialog").open,
    );
    assert.ok(
      await b.evaluate(() =>
        document.querySelector("#file-list [aria-current=true]").textContent.includes("1 mal drucken"),
      ),
    );
    assert.equal(
      await b.evaluate(
        () =>
          document.querySelectorAll(
            "[data-tool=image], [data-tool=signature], #signature-dialog, #image-input",
          ).length,
      ),
      0,
    );
    const filesBeforeSave = await b.evaluate(
      () => document.querySelectorAll("#file-list .file-open").length,
    );
    await b.evaluate(() => {
      window.downloads = [];
      HTMLAnchorElement.prototype.click = function () {
        if (this.download)
          window.downloads.push({ url: this.href, name: this.download });
      };
      document.querySelector("[data-action=open-layout]").click();
      document.querySelector("#layout-students").value = "1";
      document.querySelector("#layout-form").requestSubmit();
    });
    await b.wait(
      () =>
        window.downloads?.length === 1 &&
        !document.querySelector("#busy-dialog").open,
    );
    const savedLayout = await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js");
      const lib = await pdfLib();
      const pdf = await lib.PDFDocument.load(
        await (await fetch(window.downloads[0].url)).arrayBuffer(),
      );
      return {
        name: window.downloads[0].name,
        pages: pdf.getPageCount(),
        files: document.querySelectorAll("#file-list .file-open").length,
        dialogOpen: document.querySelector("#layout-dialog").open,
      };
    });
    assert.match(savedLayout.name, /mal drucken.*\.pdf$/);
    assert.equal(savedLayout.pages, 1);
    assert.equal(savedLayout.files, filesBeforeSave);
    assert.equal(savedLayout.dialogOpen, false);
    await b.evaluate(() => {
      window.downloads = [];
      HTMLAnchorElement.prototype.click = function () {
        if (this.download)
          window.downloads.push({ url: this.href, name: this.download });
      };
      document.querySelector("[data-action=select-all]").click();
      document.querySelector("[data-action=export]").click();
      document.querySelector("#export-split").value = "groups";
      document.querySelector("#export-form").requestSubmit();
    });
    await b.wait(() => window.downloads?.length === 1);
    const zip = await b.evaluate(async () => {
      await import("./vendor/jszip/3.10.2/jszip.min.js");
      const archive = await JSZip.loadAsync(
        await (await fetch(window.downloads[0].url)).arrayBuffer(),
      );
      return Object.keys(archive.files);
    });
    assert.equal(zip.length, 2);
    assert.ok(zip.every((name) => name.endsWith(".pdf")));
    await b.evaluate(() => {
      document.querySelector("[data-action=export]").click();
      document.querySelector("#export-format").value = "jpg";
      document
        .querySelector("#export-format")
        .dispatchEvent(new Event("change"));
      document.querySelector("#export-dpi").value = "72";
      document.querySelector("#export-form").requestSubmit();
    });
    await b.wait(() => window.downloads.length === 2);
    assert.equal(
      await b.evaluate(async () => {
        const zip = await JSZip.loadAsync(
          await (await fetch(window.downloads[1].url)).arrayBuffer(),
        );
        const file = Object.values(zip.files)[0],
          bytes = await file.async("uint8array");
        return bytes[0] === 255 && bytes[1] === 216;
      }),
      true,
    );
    await b.evaluate(() => {
      window.print = () => {
        window.printedPages =
          document.querySelectorAll(".print-page img").length;
        window.dispatchEvent(new Event("afterprint"));
      };
      document.querySelector("[data-action=print]").click();
    });
    await b.wait(() => window.printedPages === 2);
    assert.equal(
      await b.evaluate(() => document.querySelectorAll(".print-area").length),
      0,
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "PWA: Offene Dokumente in anderem Fenster verhindern ein Update",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await b.wait(() => !!navigator.serviceWorker.controller, 60000);
    await openBlankDocument(b);
    await b.evaluate(() => {
      window.marker = "first";
    });
    const second = await b.newTab();
    for (let i = 0; i < 100; i++) {
      if (
        await second(
          () =>
            !!navigator.serviceWorker.controller &&
            document.readyState === "complete" &&
            !!document.querySelector("#welcome .icon"),
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const { readFile } = await import("node:fs/promises");
    const precache = await readFile(
      new URL("../precache.js", import.meta.url),
      "utf8",
    );
    b.override(
      "precache.js",
      precache.replace(
        /self.PDFHELPER_VERSION="[^"]+"/,
        'self.PDFHELPER_VERSION="browser-update-test"',
      ),
    );
    await second(async () => {
      window.marker = "second";
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
    });
    for (let i = 0; i < 200; i++) {
      if (await second(() => !document.querySelector("#update-banner").hidden))
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await second(() =>
      document.querySelector("[data-action=update-now]").click(),
    );
    for (let i = 0; i < 100; i++) {
      if (
        await second(() =>
          document
            .querySelector("#toast")
            .textContent.includes("anderes PDFHelper"),
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(await second(() => window.marker), "second");
    assert.equal(
      await b.evaluate(() => document.querySelectorAll(".page-item").length),
      1,
    );
    assert.ok(
      await second(() =>
        document
          .querySelector("#toast")
          .textContent.includes("anderes PDFHelper"),
      ),
    );
    await b.evaluate(() =>
      document.querySelector("#file-list li.active [data-action=close-document]").click(),
    );
    await second(() =>
      document.querySelector("[data-action=update-now]").click(),
    );
    await b.wait(
      () => window.marker === undefined && document.querySelector("#welcome"),
    );
    for (let i = 0; i < 100; i++) {
      if (
        await second(
          () =>
            window.marker === undefined && !!document.querySelector("#welcome"),
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(await second(() => window.marker), undefined);
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: geschützter Import, großes Dokument, Abbruch und mobile Dunkelansicht",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t, { viewport: { width: 390, height: 844 } });
    await b.command("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    await b.wait(() => document.documentElement.dataset.theme === "dark");
    assert.equal(
      await b.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await b.screenshot("/tmp/pdfhelper-mobile-dark.png");
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js"),
        lib = await pdfLib(),
        doc = await lib.PDFDocument.create();
      for (let i = 0; i < 120; i++) doc.addPage([595.3, 841.9]);
      doc.encrypt({
        userPassword: "test-secret",
        ownerPassword: "test-owner",
        algorithm: "AES-256",
      });
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([await doc.save()], "Viele-Seiten.pdf", {
          type: "application/pdf",
        }),
      );
      document.querySelector("#file-input").files = transfer.files;
      document.querySelector("#file-input").dispatchEvent(new Event("change"));
    });
    await b.wait(() => document.querySelector("#password-dialog").open);
    await b.evaluate(() => {
      document.querySelector("#input-password").value = "test-secret";
      document.querySelector("#password-form").requestSubmit();
    });
    await b.wait(
      () =>
        document.querySelectorAll(".page-item").length === 120 &&
        document.querySelector("#page-loading").hidden,
    );
    for (let i = 0; i < 7; i++) {
      await b.evaluate(
        (i) => (document.querySelector("#page-list").scrollTop = i * 1800),
        i,
      );
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    assert.ok(
      await b.evaluate(
        () => document.querySelectorAll("#page-list canvas").length <= 32,
      ),
    );
    await b.evaluate(() => {
      window.downloads = [];
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.downloads.push(this.href);
      };
      document.querySelector("[data-action=export]").click();
      document.querySelector("#export-form").requestSubmit();
      document.querySelector("#cancel-job").click();
    });
    await b.wait(() => !document.querySelector("#busy-dialog").open);
    assert.equal(await b.evaluate(() => window.downloads.length), 0);
    assert.equal(
      await b.evaluate(() => document.querySelectorAll(".page-item").length),
      120,
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: LatexHelper-Design, alte Darstellungseinstellung und responsive Bedienung",
  { timeout: 120000 },
  async (t) => {
    for (const viewport of [
      { width: 1440, height: 960 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await t.test(`${viewport.width}px`, async (t) => {
        const b = await browser(t, { viewport, prefix: "/PDFHelper/" });
        await b.command("Emulation.setEmulatedMedia", {
          features: [
            { name: "prefers-color-scheme", value: "light" },
            { name: "prefers-reduced-motion", value: "reduce" },
          ],
        });
        await b.command("Page.addScriptToEvaluateOnNewDocument", {
          source: 'localStorage.setItem("pdfhelper:theme", "light");',
        });
        await b.navigate();
        await b.wait(
          () =>
            document.readyState === "complete" &&
            document.querySelector("#welcome .icon") &&
            localStorage.getItem("pdfhelper:theme") === "light",
        );
        await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 150, y: 20 });
        assert.deepEqual(
          await b.evaluate(() => ({
            theme: document.documentElement.dataset.theme,
            scheme: getComputedStyle(document.documentElement).colorScheme,
            accent: getComputedStyle(document.documentElement)
              .getPropertyValue("--accent")
              .trim(),
            themePicker: !!document.querySelector("#theme"),
            themeApi: typeof window.pdfHelperTheme,
            header: !!document.querySelector(
              ".document-bar, header, [role=tablist], .new-tab",
            ),
            navigationInPill:
              !!document.querySelector(
                "#editor > #view-pill #page-navigation #current-page",
              ) &&
              !document.querySelector("#pages-panel #current-page") &&
              !document.querySelector("#editor-topbar #current-page"),
            pagesHeading: !!document.querySelector(
              "#pages-panel .panel-heading",
            ),
            zoomSelect: !!document.querySelector("#zoom-controls select"),
            zoomOverlay:
              !!document.querySelector("#editor > #view-pill #zoom-controls") &&
              !document.querySelector("#editor-topbar #zoom-controls"),
            fitIcons: [
              ...document.querySelectorAll("#zoom-controls [data-zoom]"),
            ].map((button) => button.dataset.icon),
            toolbarTop: document
              .querySelector("#editor-topbar")
              .getBoundingClientRect().top,
            iconActions: [
              ...document.querySelectorAll(
                "#editor-topbar [data-action=print], #editor-topbar [data-action=open-layout], #editor-topbar [data-action=export]",
              ),
            ].every(
              (button) =>
                button.textContent.trim() === "" &&
                !!button.querySelector(".icon"),
            ),
            toolbarHeight: document
              .querySelector("#editor-topbar")
              .getBoundingClientRect().height,
          })),
          {
            theme: "dark",
            scheme: "dark",
            accent: "#5aa9f0",
            themePicker: false,
            themeApi: "undefined",
            header: false,
            navigationInPill: true,
            pagesHeading: false,
            zoomSelect: false,
            zoomOverlay: true,
            fitIcons: ["fit-width", "fit-page"],
            toolbarTop: 0,
            iconActions: true,
            toolbarHeight: 43,
          },
        );
        await b.screenshot(
          `/tmp/pdfhelper-design-${viewport.width}-welcome.png`,
        );
        await openBlankDocument(b, 2);
        assert.deepEqual(
          await b.evaluate(() => {
            const width = document
                .querySelector("#page-stage")
                .getBoundingClientRect().width,
              available = document.querySelector("#page-scroll").clientWidth;
            return {
              pressed: [...document.querySelectorAll("[data-zoom]")].map(
                (button) => button.getAttribute("aria-pressed"),
              ),
              fitsWidth:
                width <= available && (available - width < 100 || width === 120),
            };
          }),
          { pressed: ["true", "false"], fitsWidth: true },
        );
        await b.evaluate(() => {
          const thumb = () =>
            document.querySelector("#page-list .page-item.current .thumbnail");
          thumb().dispatchEvent(
            new KeyboardEvent("keydown", { key: "r", bubbles: true }),
          );
          thumb().dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "R",
              shiftKey: true,
              bubbles: true,
            }),
          );
        });
        await openBlankDocument(b);
        await b.wait(
          () =>
            document.querySelectorAll("#file-list li")
              .length === 2 && document.querySelector("#page-loading").hidden,
        );
        assert.deepEqual(
          await b.evaluate(() => ({
            documents: document.querySelectorAll(
              "#file-list li",
            ).length,
            dirty: document.querySelectorAll(
              '#file-list li[data-dirty="true"]',
            ).length,
            selected:
              document.querySelectorAll("#file-list [aria-current=true]").length,
          })),
          { documents: 2, dirty: 1, selected: 1 },
        );
        await b.screenshot(`/tmp/pdfhelper-design-${viewport.width}-tabs.png`);
        const activeDirty = () =>
          b.evaluate(
            () =>
              document.querySelector("#file-list [aria-current=true]")
                .closest("li").dataset.dirty,
          );
        await selectDocument(b, 0);
        assert.equal(
          await b.evaluate(
            () => document.querySelectorAll(".page-item").length,
          ),
          2,
        );
        assert.equal(await activeDirty(), "true");
        await selectDocument(b, 1);
        assert.equal(
          await b.evaluate(
            () => document.querySelectorAll(".page-item").length,
          ),
          1,
        );
        assert.notEqual(await activeDirty(), "true");
        await b.evaluate(() =>
          document.querySelector("#file-list li.active [data-action=close-document]").click(),
        );
        assert.equal(
          await b.evaluate(
            () =>
              document.querySelectorAll(
                "#file-list li",
              ).length,
          ),
          1,
        );
        await b.evaluate(() =>
          document.querySelector("#file-list li.active [data-action=close-document]").click(),
        );
        await b.wait(() => document.querySelector("#confirm-dialog").open);
        await b.evaluate(() =>
          document.querySelector("#confirm-dialog [value=cancel]").click(),
        );
        assert.equal(
          await b.evaluate(
            () =>
              document.querySelectorAll(
                "#file-list li",
              ).length,
          ),
          1,
        );
        await b.evaluate(() => {
          const page = document.querySelector("#current-page");
          page.value = "1";
          page.dispatchEvent(new Event("change"));
          const next = document.querySelector("[data-action=next]");
          next.scrollIntoView({ block: "nearest", inline: "nearest" });
          next.click();
        });
        await b.wait(
          () =>
            document.querySelector("#current-page").value === "2" &&
            document.querySelector("#page-loading").hidden,
        );
        await b.evaluate(() => {
          const button = document.querySelector("[data-action=fit-width]");
          button.scrollIntoView({ block: "nearest", inline: "nearest" });
          button.click();
        });
        await b.wait(() => {
          const width = document
            .querySelector("#page-stage")
            .getBoundingClientRect().width;
          const available = document.querySelector("#page-scroll").clientWidth;
          return (
            width > 0 &&
            width <= available &&
            available - width < 100 &&
            document.querySelector("#page-loading").hidden
          );
        });
        assert.deepEqual(
          await b.evaluate(() =>
            [...document.querySelectorAll("[data-zoom]")].map((button) =>
              button.getAttribute("aria-pressed"),
            ),
          ),
          ["true", "false"],
        );
        const fittedWidth = await b.evaluate(
          () =>
            document.querySelector("#page-stage").getBoundingClientRect().width,
        );
        await b.evaluate(() =>
          document.querySelector("[data-action=zoom-in]").click(),
        );
        await b.wait(
          (before) =>
            document.querySelector("#page-stage").getBoundingClientRect()
              .width > before && document.querySelector("#page-loading").hidden,
          30000,
          fittedWidth,
        );
        assert.deepEqual(
          await b.evaluate(() =>
            [...document.querySelectorAll("[data-zoom]")].map((button) =>
              button.getAttribute("aria-pressed"),
            ),
          ),
          ["false", "false"],
        );
        await b.evaluate(() =>
          document.querySelector("[data-action=fit-page]").click(),
        );
        await b.wait(() => {
          const page = document
            .querySelector("#page-stage")
            .getBoundingClientRect();
          const viewport = document.querySelector("#page-scroll");
          return (
            page.width <= viewport.clientWidth &&
            page.height <= viewport.clientHeight &&
            document.querySelector("#page-loading").hidden
          );
        });
        assert.deepEqual(
          await b.evaluate(() =>
            [...document.querySelectorAll("[data-zoom]")].map((button) =>
              button.getAttribute("aria-pressed"),
            ),
          ),
          ["false", "true"],
        );
        await b.evaluate(() => {
          const button = document.querySelector("[data-tool=text]");
          button.scrollIntoView({ block: "nearest", inline: "nearest" });
          button.click();
        });
        assert.equal(
          await b.evaluate(() =>
            document
              .querySelector("[data-tool=text]")
              .getAttribute("aria-pressed"),
          ),
          "true",
        );
        await togglePin(b, "sidebar");
        assert.equal(await b.evaluate(() => document.querySelector("#workspace").classList.contains("sidebar-reserved")), false);
        await togglePin(b, "sidebar");
        assert.equal(await b.evaluate(() => document.querySelector("#workspace").classList.contains("sidebar-reserved")), true);
        assert.equal(
          await b.evaluate(
            () =>
              document.documentElement.scrollWidth <= innerWidth &&
              [...document.querySelectorAll("#editor-topbar > button")].every(
                (button) => {
                  const rect = button.getBoundingClientRect();
                  return (
                    rect.left >= 0 &&
                    rect.right <= innerWidth &&
                    rect.width >= 24
                  );
                },
              ),
          ),
          true,
        );
        await b.evaluate(() =>
          document.querySelector("[data-action=export]").click(),
        );
        await b.wait(() => document.querySelector("#export-dialog").open);
        assert.equal(
          await b.evaluate(() => {
            const dialog = document.querySelector("#export-dialog");
            const rect = dialog.getBoundingClientRect();
            return (
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              dialog.scrollWidth <= dialog.clientWidth
            );
          }),
          true,
        );
        await b.screenshot(
          `/tmp/pdfhelper-design-${viewport.width}-export.png`,
        );
        await b.evaluate(() =>
          document.querySelector("#export-dialog [data-close]").click(),
        );
        await b.evaluate(() =>
          document
            .querySelector("#pages-panel")
            .focus(),
        );
        await b.command("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
        });
        assert.equal(
          await b.evaluate(
            () =>
              document.activeElement.matches(":focus-visible") &&
              getComputedStyle(document.activeElement).outlineStyle === "solid",
          ),
          true,
        );
        if (viewport.width === 1440) {
          await b.command("Emulation.setDeviceMetricsOverride", {
            width: 390, height: 844, deviceScaleFactor: 1, mobile: false,
          });
          await b.wait(() => innerWidth === 390);
          assert.equal(await b.evaluate(() => document.querySelector("#workspace").classList.contains("sidebar-reserved")), true);
          assert.ok(await b.evaluate(() => document.querySelector("#pages-panel").getBoundingClientRect().width <= innerWidth / 2));
        }
        assert.deepEqual(b.errors, []);
      });
    }
  },
);
test(
  "Browser: Formulare im Auswahlmodus behalten Fokus, Verknüpfungen und Exportwerte",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    const commandModifier = await b.evaluate(() => /Mac/.test(navigator.platform) ? 4 : 2);
    async function position(selector, index = 0) {
      if (await b.evaluate((selector) => !!document.querySelector(selector)?.closest("#editor-topbar"), selector))
        await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 150, y: 10 });
      return b.evaluate(
        ({ selector, index }) => {
          const node = document.querySelectorAll(selector)[index];
          node.scrollIntoView({ block: "nearest", inline: "nearest" });
          const rect = node.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        },
        { selector, index },
      );
    }
    async function click(selector, index = 0, modifiers = 0) {
      const point = await position(selector, index);
      await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await b.command("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...point,
        button: "left",
        clickCount: 1,
        modifiers,
      });
      await b.command("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...point,
        button: "left",
        clickCount: 1,
        modifiers,
      });
    }
    async function key(key, code, windowsVirtualKeyCode, modifiers = 0, text) {
      await b.command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code,
        windowsVirtualKeyCode,
        modifiers,
        ...(text ? { text } : {}),
        ...(key === "a" && modifiers === commandModifier ? { commands: ["selectAll"] } : {}),
      });
      await b.command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
        windowsVirtualKeyCode,
        modifiers,
      });
    }
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js");
      const lib = await pdfLib();
      const pdf = await lib.PDFDocument.create();
      const first = pdf.addPage([400, 600]);
      const second = pdf.addPage([400, 600]);
      const form = pdf.getForm();
      const text = form.createTextField("Text");
      text.setText("Start");
      text.addToPage(first, { x: 30, y: 540, width: 160, height: 24 });
      text.addToPage(first, { x: 220, y: 540, width: 150, height: 24 });
      text.addToPage(second, { x: 30, y: 540, width: 160, height: 24 });
      const multiline = form.createTextField("Mehrzeilig");
      multiline.enableMultiline();
      multiline.addToPage(first, { x: 30, y: 460, width: 200, height: 50 });
      const readonly = form.createTextField("Geschuetzt");
      readonly.setText("Fest");
      readonly.enableReadOnly();
      readonly.addToPage(first, { x: 30, y: 420, width: 180, height: 24 });
      const checkbox = form.createCheckBox("Haken");
      checkbox.addToPage(first, { x: 30, y: 380, width: 20, height: 20 });
      checkbox.addToPage(first, { x: 80, y: 380, width: 20, height: 20 });
      const radio = form.createRadioGroup("Wahl");
      radio.disableOffToggling();
      radio.addOptionToPage("A", first, {
        x: 30,
        y: 340,
        width: 20,
        height: 20,
      });
      radio.addOptionToPage("B", first, {
        x: 80,
        y: 340,
        width: 20,
        height: 20,
      });
      const select = form.createDropdown("Auswahl");
      select.addOptions(["Eins", "Zwei", "Drei"]);
      select.addToPage(first, { x: 30, y: 290, width: 160, height: 24 });
      const list = form.createOptionList("Liste");
      list.addOptions(["Eins", "Zwei", "Drei"]);
      list.enableMultiselect();
      list.addToPage(first, { x: 30, y: 190, width: 160, height: 70 });
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([await pdf.save()], "Formular.pdf", {
          type: "application/pdf",
        }),
      );
      const input = document.querySelector("#file-input");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        document.querySelectorAll("#form-layer [data-field]").length === 10 &&
        document.querySelector("#page-loading").hidden,
    );
    assert.equal(
      await b.evaluate(() => !!document.querySelector('[data-tool="form"]')),
      false,
    );
    assert.equal(
      await b.evaluate(
        () => document.querySelector("#page-stage").dataset.tool,
      ),
      "select",
    );
    await b.evaluate(() => {
      window.formControls = [
        ...document.querySelectorAll("#form-layer [data-field]"),
      ];
    });
    await click('#form-layer [data-field="Text"]');
    assert.equal(
      await b.evaluate(() => document.activeElement.dataset.field),
      "Text",
    );
    assert.deepEqual(
      await b.evaluate(() => ({
        color: getComputedStyle(document.activeElement).color,
        background: getComputedStyle(document.activeElement).backgroundColor,
        readonlyColor: getComputedStyle(
          document.querySelector('#form-layer [data-field="Geschuetzt"]'),
        ).color,
      })),
      {
        color: "rgb(0, 0, 0)",
        background: "rgb(255, 255, 255)",
        readonlyColor: "rgb(0, 0, 0)",
      },
    );
    await key("a", "KeyA", 65, commandModifier);
    await b.command("Input.insertText", { text: "Direkt" });
    await key("Tab", "Tab", 9);
    assert.deepEqual(
      await b.evaluate(() => ({
        duplicateFocused:
          document.activeElement ===
          document.querySelectorAll('#form-layer [data-field="Text"]')[1],
        values: [
          ...document.querySelectorAll('#form-layer [data-field="Text"]'),
        ].map((input) => input.value),
        sameNodes: window.formControls.every((input) => input.isConnected),
      })),
      {
        duplicateFocused: true,
        values: ["Direkt", "Direkt"],
        sameNodes: true,
      },
    );
    await key("Tab", "Tab", 9);
    assert.equal(
      await b.evaluate(() => document.activeElement.dataset.field),
      "Mehrzeilig",
    );
    await b.command("Input.insertText", { text: "Zeile eins\nZeile zwei" });
    await click('#form-layer [data-field="Haken"]');
    assert.deepEqual(
      await b.evaluate(() =>
        [...document.querySelectorAll('#form-layer [data-field="Haken"]')].map(
          (input) => input.checked,
        ),
      ),
      [true, true],
    );
    assert.equal(
      await b.evaluate(() => document.activeElement === window.formControls[4]),
      true,
    );
    await click('[data-action="undo"]');
    assert.deepEqual(
      await b.evaluate(() =>
        [...document.querySelectorAll('#form-layer [data-field="Haken"]')].map(
          (input) => input.checked,
        ),
      ),
      [false, false],
    );
    await click('#form-layer [data-field="Haken"]');
    await click('#form-layer [data-field="Wahl"]', 1);
    assert.deepEqual(
      await b.evaluate(() =>
        [...document.querySelectorAll('#form-layer [data-field="Wahl"]')].map(
          (input) => input.checked,
        ),
      ),
      [false, true],
    );
    assert.equal(
      await b.evaluate(() => document.activeElement.dataset.field),
      "Wahl",
    );
    await click('#form-layer [data-field="Auswahl"]');
    await b.evaluate(() => {
      const select = document.querySelector('#form-layer [data-field="Auswahl"]');
      select.value = "Drei";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click('#form-layer [data-field="Liste"] option', 0);
    await b.evaluate(() => {
      const select = document.querySelector('#form-layer [data-field="Liste"]');
      for (const option of select.options) option.selected = ["Eins", "Drei"].includes(option.value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.deepEqual(
      await b.evaluate(() => ({
        dropdown: document.querySelector('#form-layer [data-field="Auswahl"]')
          .value,
        list: [
          ...document.querySelector('#form-layer [data-field="Liste"]')
            .selectedOptions,
        ].map((option) => option.value),
        readonly: document.querySelector(
          '#form-layer [data-field="Geschuetzt"]',
        ).disabled,
        multiline: document.querySelector(
          '#form-layer [data-field="Mehrzeilig"]',
        ).value,
      })),
      {
        dropdown: "Drei",
        list: ["Eins", "Drei"],
        readonly: true,
        multiline: "Zeile eins\nZeile zwei",
      },
    );
    await click('#form-layer [data-field="Geschuetzt"]');
    assert.equal(
      await b.evaluate(
        () => document.activeElement.dataset.field === "Geschuetzt",
      ),
      false,
    );
    for (const tool of ["draw", "highlight", "text"]) {
      await b.evaluate(
        (tool) => document.querySelector(`[data-tool=${tool}]`).click(),
        tool,
      );
      assert.equal(
        await b.evaluate(() =>
          [...document.querySelectorAll("#form-layer [data-field]")].every(
            (input) => input.disabled,
          ),
        ),
        true,
      );
      const point = await position('#form-layer [data-field="Text"]');
      assert.equal(
        await b.evaluate(
          (point) => document.elementFromPoint(point.x, point.y).id,
          point,
        ),
        "interaction-layer",
      );
    }
    await click('#form-layer [data-field="Text"]');
    assert.equal(
      await b.evaluate(() => !!document.querySelector(".annotation.selected")),
      true,
    );
    assert.equal(
      await b.evaluate(
        () =>
          getComputedStyle(
            document.querySelector(".annotation.selected"),
            "::before",
          ).content,
      ),
      "none",
    );
    await b.evaluate(() =>
      document.querySelector('[data-tool="select"]').click(),
    );
    await click(".annotation");
    assert.equal(
      await b.evaluate(
        () =>
          !!document.querySelector(".annotation.selected") &&
          !document.activeElement.closest("#form-layer"),
      ),
      true,
    );
    await click('#form-layer [data-field="Wahl"]', 1);
    assert.equal(
      await b.evaluate(
        () =>
          !document.querySelector(".annotation.selected") &&
          document.activeElement.dataset.field === "Wahl",
      ),
      true,
    );
    await click(".annotation");
    const annotation = await b.evaluate(() => {
      const rect = document
        .querySelector(".annotation")
        .getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const dragStart = await position(".annotation");
    await b.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...dragStart,
      button: "left",
      clickCount: 1,
    });
    await b.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: dragStart.x + 20,
      y: dragStart.y + 20,
      buttons: 1,
    });
    await b.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: dragStart.x + 20,
      y: dragStart.y + 20,
      button: "left",
      clickCount: 1,
    });
    assert.equal(
      await b.evaluate(
        (before) =>
          document.querySelector(".annotation").getBoundingClientRect().x >
          before.x + 10,
        annotation,
      ),
      true,
    );
    const handle = await position(".resize-handle");
    await b.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...handle,
      button: "left",
      clickCount: 1,
    });
    await b.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: handle.x + 20,
      y: handle.y + 20,
      buttons: 1,
    });
    await b.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: handle.x + 20,
      y: handle.y + 20,
      button: "left",
      clickCount: 1,
    });
    assert.equal(
      await b.evaluate(
        (before) =>
          document.querySelector(".annotation").getBoundingClientRect().width >
          before.width + 10,
        annotation,
      ),
      true,
    );
    await b.evaluate(() =>
      document.querySelector('[data-action="delete-element"]').click(),
    );
    await b.evaluate(() =>
      document
        .querySelector("#page-list .page-item.current .thumbnail")
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "r", bubbles: true }),
        ),
    );
    await b.wait(() => document.querySelector("#page-loading").hidden);
    await click('#form-layer [data-field="Text"]');
    assert.equal(
      await b.evaluate(() => document.activeElement.dataset.field),
      "Text",
    );
    await b.evaluate(() =>
      document
        .querySelector("#page-list .page-item.current .thumbnail")
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "R", shiftKey: true, bubbles: true }),
        ),
    );
    await b.wait(() => document.querySelector("#page-loading").hidden);
    await b.evaluate(() =>
      document.querySelector('[data-action="next"]').click(),
    );
    await b.wait(
      () =>
        document.querySelectorAll('#form-layer [data-field="Text"]').length ===
          1 && document.querySelector("#page-loading").hidden,
    );
    assert.equal(
      await b.evaluate(
        () => document.querySelector('#form-layer [data-field="Text"]').value,
      ),
      "Direkt",
    );
    await b.evaluate(() =>
      document.querySelector('[data-action="previous"]').click(),
    );
    await b.wait(
      () =>
        document.querySelectorAll('#form-layer [data-field="Text"]').length ===
          2 && document.querySelector("#page-loading").hidden,
    );
    await b.command("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await b.command("Emulation.setTouchEmulationEnabled", { enabled: true });
    await b.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await b.wait(() => document.querySelector("#page-loading").hidden &&
      !document.querySelector("#page-stage").style.scale &&
      Math.abs(document.querySelector("#page-canvas").width - document.querySelector("#page-stage").getBoundingClientRect().width) < 2);
    const touch = await position('#form-layer [data-field="Text"]');
    await b.command("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch],
    });
    await b.command("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await b.wait(() => document.activeElement.dataset.field === "Text");
    await b.screenshot("/tmp/pdfhelper-select-form-mobile.png");
    await b.evaluate(() => {
      window.formDownloads = [];
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.formDownloads.push(this.href);
      };
    });
    for (const flatten of [false, true]) {
      await b.evaluate((flatten) => {
        document.querySelector('[data-action="export"]').click();
        document.querySelector("#export-flatten").checked = flatten;
        document.querySelector("#export-form").requestSubmit();
      }, flatten);
      await b.wait(
        (count) => window.formDownloads.length === count,
        30000,
        flatten ? 2 : 1,
      );
      const result = await b.evaluate(async (flatten) => {
        const { pdfLib, pdfJs, renderOptions } =
          await import("./src/pdf/vendors.js");
        const lib = await pdfLib();
        const bytes = new Uint8Array(
          await (await fetch(window.formDownloads.at(-1))).arrayBuffer(),
        );
        const pdf = await lib.PDFDocument.load(bytes);
        const fields = pdf.getForm().getFields();
        if (!flatten) {
          const field = (name) =>
            fields.find((field) => field.getName().split(".").at(-1) === name);
          return {
            text: field("Text").getText(),
            multiline: field("Mehrzeilig").getText(),
            readonly: field("Geschuetzt").getText(),
            checkbox: field("Haken").isChecked(),
            radio: field("Wahl").getSelected(),
            dropdown: field("Auswahl").getSelected(),
            list: field("Liste").getSelected(),
          };
        }
        const js = await pdfJs();
        const task = js.getDocument({ ...renderOptions(), data: bytes });
        try {
          const opened = await task.promise;
          const text = (await (await opened.getPage(1)).getTextContent()).items
            .map((item) => item.str)
            .join(" ");
          return {
            fields: fields.length,
            text:
              text.includes("Direkt") &&
              text.includes("Zeile eins") &&
              text.includes("Fest"),
          };
        } finally {
          await task.destroy();
        }
      }, flatten);
      assert.deepEqual(
        result,
        flatten
          ? { fields: 0, text: true }
          : {
              text: "Direkt",
              multiline: "Zeile eins\nZeile zwei",
              readonly: "Fest",
              checkbox: true,
              radio: "B",
              dropdown: ["Drei"],
              list: ["Eins", "Drei"],
            },
      );
    }
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Text ist markierbar und Links sind anklickbar",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t, { prefix: "/PDFHelper/" });
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js"),
        lib = await pdfLib(),
        doc = await lib.PDFDocument.create();
      const first = doc.addPage([595.3, 841.9]);
      first.drawText("Markierbarer Beispieltext", { x: 40, y: 760, size: 24 });
      const second = doc.addPage([595.3, 841.9]);
      second.drawText("Zielseite", { x: 40, y: 760, size: 24 });
      for (const entry of [
        {
          Rect: [40, 680, 240, 710],
          A: {
            Type: "Action",
            S: "URI",
            URI: lib.PDFString.of("https://example.com/"),
          },
        },
        {
          Rect: [40, 620, 240, 650],
          Dest: [second.ref, lib.PDFName.of("Fit")],
        },
        {
          Rect: [40, 560, 240, 590],
          A: {
            Type: "Action",
            S: "URI",
            URI: lib.PDFString.of("javascript:alert(1)"),
          },
        },
      ])
        first.node.addAnnot(
          doc.context.register(
            doc.context.obj({
              Type: "Annot",
              Subtype: "Link",
              Border: [0, 0, 0],
              ...entry,
            }),
          ),
        );
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([await doc.save()], "Links.pdf", { type: "application/pdf" }),
      );
      document.querySelector("#file-input").files = transfer.files;
      document.querySelector("#file-input").dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        document.querySelectorAll("#link-layer a").length === 2 &&
        [...document.querySelectorAll("#text-layer span")].some((span) =>
          span.textContent.includes("Beispieltext"),
        ),
    );
    assert.deepEqual(
      await b.evaluate(() =>
        [...document.querySelectorAll("#link-layer a")].map((anchor) => ({
          href: anchor.getAttribute("href"),
          target: anchor.target,
          title: anchor.title,
        })),
      ),
      [
        { href: "https://example.com/", target: "_blank", title: "https://example.com/" },
        { href: "#", target: "", title: "Seite 2" },
      ],
    );
    const box = await b.evaluate(() => {
      const span = [...document.querySelectorAll("#text-layer span")].find(
        (candidate) => candidate.textContent.includes("Beispieltext"),
      );
      const rect = span.getBoundingClientRect();
      return {
        left: rect.left + 2,
        right: rect.right - 2,
        y: rect.top + rect.height / 2,
      };
    });
    await b.evaluate(() => {
      window.addEventListener("mouseup", (event) => {
        window.pdfSelectionMouseUpPrevented = event.defaultPrevented;
      }, { once: true });
    });
    for (const [type, x] of [
      ["mousePressed", box.left],
      ["mouseMoved", (box.left + box.right) / 2],
      ["mouseMoved", box.right],
      ["mouseReleased", box.right],
    ])
      await b.command("Input.dispatchMouseEvent", {
        type,
        x,
        y: box.y,
        button: "left",
        buttons: type === "mouseReleased" ? 0 : 1,
        clickCount: 1,
      });
    assert.match(
      await b.evaluate(() => getSelection().toString()),
      /Beispieltext/,
    );
    assert.equal(await b.evaluate(() => window.pdfSelectionMouseUpPrevented), true);
    assert.equal(await b.evaluate(() => {
      const event = new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 2 });
      document.querySelector("#text-layer span").dispatchEvent(event);
      return event.defaultPrevented;
    }), false);
    await b.wait(
      () => document.querySelector("#annotation-count").textContent === "2",
    );
    assert.deepEqual(
      await b.evaluate(() => ({
        hidden: document.querySelector("[data-side-section=annotations]")
          .hidden,
        entries: [...document.querySelectorAll(".annotation-entry")].map(
          (entry) => [
            entry.querySelector(".annotation-name").textContent,
            entry.querySelector(".annotation-page").textContent,
          ],
        ),
        filters: [
          ...document.querySelectorAll("[data-annotation-filter]:not([hidden])"),
        ].map((button) => button.dataset.annotationFilter),
      })),
      {
        hidden: false,
        entries: [
          ["https://example.com/", "S. 1"],
          ["Zu Seite 2", "S. 1"],
        ],
        filters: ["all", "link"],
      },
    );
    await b.evaluate(() =>
      document.querySelectorAll(".annotation-entry")[1].click(),
    );
    await b.wait(
      () => !!document.querySelector('#link-layer a[data-link="1"].flash'),
    );
    await b.screenshot("/tmp/pdfhelper-text-selection.png");
    await b.evaluate(() =>
      document.querySelectorAll("#link-layer a")[1].click(),
    );
    await b.wait(
      () =>
        document.querySelector("#current-page").value === "2" &&
        [...document.querySelectorAll("#text-layer span")].some((span) =>
          span.textContent.includes("Zielseite"),
        ),
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Link-Rücksprünge erhalten Leseposition und Dokumentverlauf",
  { timeout: 90000 },
  async (t) => {
    const b = await browser(t);
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js"),
        lib = await pdfLib(),
        doc = await lib.PDFDocument.create(),
        pages = Array.from({ length: 3 }, () => doc.addPage([600, 1800])),
        root = doc.context.nextRef(),
        refs = pages.map(() => doc.context.nextRef());
      pages.forEach((page, index) => {
        const next = pages[(index + 1) % pages.length];
        for (const [target, y] of [[next, 1600], [page, 1500]])
          page.node.addAnnot(doc.context.register(doc.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [40, y, 240, y + 30],
            Dest: [target.ref, lib.PDFName.of("Fit")],
          })));
        page.node.addAnnot(doc.context.register(doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [40, 1400, 240, 1430],
          A: { S: "URI", URI: lib.PDFString.of("https://example.com/") },
        })));
        doc.context.assign(refs[index], doc.context.obj({
          Title: lib.PDFHexString.fromText(`Ziel ${index + 1}`),
          Parent: root,
          Dest: [page.ref, lib.PDFName.of("Fit")],
          ...(index > 0 ? { Prev: refs[index - 1] } : {}),
          ...(index < 2 ? { Next: refs[index + 1] } : {}),
        }));
      });
      doc.context.assign(root, doc.context.obj({
        Type: "Outlines", First: refs[0], Last: refs[2], Count: 3,
      }));
      doc.catalog.set(lib.PDFName.of("Outlines"), root);
      const transfer = new DataTransfer();
      transfer.items.add(new File([await doc.save()], "Navigation.pdf", { type: "application/pdf" }));
      const input = document.querySelector("#file-input");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    });
    const waitPage = (number) => b.wait((number) =>
      document.querySelector("#current-page").value === String(number) &&
      document.querySelector("#page-loading").hidden &&
      document.querySelectorAll("#link-layer a").length === 3,
      undefined, number,
    );
    const click = (selector) => b.evaluate((selector) => document.querySelector(selector).click(), selector);
    const backDisabled = () => b.evaluate(() => document.querySelector("#navigation-back").disabled);
    const position = () => b.evaluate(() => {
      const scroller = document.querySelector("#page-scroll"),
        slot = document.querySelector("#page-stage").parentElement;
      return {
        page: slot.dataset.page,
        top: (scroller.scrollTop - slot.offsetTop) / slot.offsetHeight,
        left: (scroller.scrollLeft - slot.offsetLeft) / slot.offsetWidth,
        width: slot.offsetWidth,
      };
    });
    const setPosition = async (top, left = 0) => {
      await b.evaluate(({ top, left }) => {
        const scroller = document.querySelector("#page-scroll"),
          slot = document.querySelector("#page-stage").parentElement;
        scroller.scrollTop = slot.offsetTop + top * slot.offsetHeight;
        scroller.scrollLeft = left;
      }, { top, left });
      await b.evaluate(() => new Promise(requestAnimationFrame));
      return position();
    };
    const expectPosition = async (expected) => {
      await b.wait((expected) => {
        const scroller = document.querySelector("#page-scroll"),
          slot = document.querySelector("#page-stage").parentElement;
        return slot.dataset.page === expected.page &&
          Math.abs((scroller.scrollTop - slot.offsetTop) / slot.offsetHeight - expected.top) < 0.003 &&
          Math.abs((scroller.scrollLeft - slot.offsetLeft) / slot.offsetWidth - expected.left) < 0.003;
      }, undefined, expected);
    };
    await waitPage(1);
    assert.equal(await backDisabled(), true);
    await click('#link-layer a[title="Seite 1"]');
    assert.equal(await backDisabled(), true);
    await b.evaluate(() => {
      const external = document.querySelector('#link-layer a[target="_blank"]');
      external.addEventListener("click", (event) => event.preventDefault(), { once: true });
      external.click();
    });
    assert.equal(await backDisabled(), true);
    await click('[data-action="fit-width"]');
    await waitPage(1);
    const first = await setPosition(0.12);
    await click('#link-layer a[title="Seite 2"]');
    await waitPage(2);
    assert.equal(await backDisabled(), false);
    const second = await setPosition(0.16);
    await click('#outline-list [title="Ziel 3"]');
    await waitPage(3);
    await click("#navigation-back");
    await waitPage(2);
    await expectPosition(second);
    await click("#navigation-back");
    await waitPage(1);
    await expectPosition(first);
    assert.equal(await backDisabled(), true);
    await click('#link-layer a[title="Seite 1"]');
    await waitPage(1);
    assert.equal(await backDisabled(), false);
    await click("#navigation-back");
    await expectPosition(first);
    assert.equal(await backDisabled(), true);
    await click('[data-action="next"]');
    await waitPage(2);
    await setPosition(0.1);
    assert.equal(await backDisabled(), true);
    await click('[data-action="previous"]');
    await waitPage(1);
    await click('[data-action="zoom-in"]');
    await click('[data-action="zoom-in"]');
    await waitPage(1);
    const zoomed = await setPosition(0.13, 80);
    await click('#outline-list [title="Ziel 2"]');
    await waitPage(2);
    await click('[data-action="zoom-in"]');
    await waitPage(2);
    const zoomWidth = (await position()).width;
    await click("#navigation-back");
    await waitPage(1);
    await expectPosition(zoomed);
    assert.equal((await position()).width, zoomWidth);
    assert.ok(zoomWidth > zoomed.width);
    await click('#outline-list [title="Ziel 2"]');
    await waitPage(2);
    await openBlankDocument(b, 2);
    assert.equal(await backDisabled(), true);
    await selectDocument(b, 0);
    await waitPage(2);
    assert.equal(await backDisabled(), false);
    await click("#navigation-back");
    await waitPage(1);
    assert.equal(await backDisabled(), true);
    await click('#outline-list [title="Ziel 2"]');
    await waitPage(2);
    await click('#outline-list [title="Ziel 3"]');
    await waitPage(3);
    await b.evaluate(() => {
      const thumb = document.querySelectorAll(".thumbnail")[1];
      thumb.click();
      thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    await b.wait(() => document.querySelectorAll(".page-item").length === 2);
    await click("#navigation-back");
    await b.wait(() => document.querySelector("#current-page").value === "1");
    assert.equal(await backDisabled(), true);
    await click('[data-action="undo"]');
    await b.wait(() => document.querySelectorAll(".page-item").length === 3);
    assert.equal(await backDisabled(), true);
    await click('#outline-list [title="Ziel 3"]');
    await waitPage(3);
    await b.evaluate(() => {
      const thumb = document.querySelectorAll(".thumbnail")[1];
      thumb.click();
      thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    await b.wait(() => document.querySelectorAll(".page-item").length === 2);
    assert.equal(await backDisabled(), true);
    await b.command("Emulation.setDeviceMetricsOverride", {
      width: 320, height: 720, deviceScaleFactor: 1, mobile: false,
    });
    await b.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await b.evaluate(() => {
      const buttons = [...document.querySelectorAll("#view-pill button")];
      return buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth;
      });
    }), true);
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Ordner-Symbol öffnet Dateien und merkt sich zuletzt geöffnete",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t, { prefix: "/PDFHelper/" });
    await b.wait(() => !!document.querySelector("#open-group .icon"));
    assert.deepEqual(
      await b.evaluate(() => ({
        icon: document.querySelector("#editor-topbar [data-action=open]")
          .dataset.icon,
        recentVisible: !document.querySelector("#recent-button").hidden,
      })),
      { icon: "folder-open", recentVisible: true },
    );
    await b.evaluate(() => document.querySelector("#recent-button").click());
    await b.wait(() => !document.querySelector("#recent-menu").hidden);
    assert.equal(
      await b.evaluate(
        () => document.querySelector("#recent-menu .recent-empty")?.textContent,
      ),
      "Noch keine Dateien geöffnet.",
    );
    await b.evaluate(async () => {
      document.querySelector("#recent-button").click();
      const { pdfLib } = await import("./src/pdf/vendors.js"),
        { rememberFile } = await import("./src/core/recent.js"),
        lib = await pdfLib(),
        root = await navigator.storage.getDirectory();
      for (const name of ["Erste.pdf", "Zweite.pdf"]) {
        const doc = await lib.PDFDocument.create();
        doc.addPage([300, 400]).drawText(name, { x: 20, y: 350, size: 18 });
        const handle = await root.getFileHandle(name, { create: true }),
          writable = await handle.createWritable();
        await writable.write(await doc.save());
        await writable.close();
        await rememberFile(handle);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await rememberFile(await root.getFileHandle("Erste.pdf"));
    });
    await b.evaluate(() => document.querySelector("#recent-button").click());
    await b.wait(
      () => document.querySelectorAll("#recent-menu .recent-item").length === 2,
    );
    assert.deepEqual(
      await b.evaluate(() =>
        [...document.querySelectorAll("#recent-menu .recent-item strong")].map(
          (item) => item.textContent,
        ),
      ),
      ["Erste.pdf", "Zweite.pdf"],
    );
    await b.screenshot("/tmp/pdfhelper-recent-menu.png");
    await b.evaluate(() =>
      document.querySelectorAll("#recent-menu .recent-item")[1].click(),
    );
    await b.wait(
      () =>
        document.querySelector("#recent-menu").hidden &&
        document.querySelectorAll(".page-item").length === 1 &&
        document.querySelector("#file-list [aria-current=true]")
          .textContent.includes("Zweite"),
    );
    await b.wait(async () => {
      const { recentFiles } = await import("./src/core/recent.js");
      return (await recentFiles())[0]?.name === "Zweite.pdf";
    });
    await b.evaluate(() => {
      document.querySelector("#recent-button").click();
    });
    await b.wait(() => !!document.querySelector("#recent-menu .recent-clear"));
    await b.evaluate(() =>
      document.querySelector("#recent-menu .recent-clear").click(),
    );
    await b.wait(async () => {
      const { recentFiles } = await import("./src/core/recent.js");
      return (await recentFiles()).length === 0;
    });
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Eigenes Kontextmenü mit Kopieren und Einfügen",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t, { prefix: "/PDFHelper/" });
    await b.evaluate(async () => {
      window.clipboardText = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.clipboardText = text;
          },
          readText: async () => window.clipboardText,
        },
      });
      window.contextEvents = [];
      window.addEventListener("contextmenu", (event) =>
        window.contextEvents.push(event.defaultPrevented),
      );
      const { pdfLib } = await import("./src/pdf/vendors.js"),
        lib = await pdfLib(),
        doc = await lib.PDFDocument.create();
      const page = doc.addPage([595.3, 841.9]);
      page.drawText("Kopierbarer Inhalt", { x: 40, y: 760, size: 24 });
      doc
        .getForm()
        .createTextField("Feld")
        .addToPage(page, { x: 40, y: 600, width: 220, height: 30 });
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([await doc.save()], "Kontext.pdf", {
          type: "application/pdf",
        }),
      );
      document.querySelector("#file-input").files = transfer.files;
      document.querySelector("#file-input").dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        !!document.querySelector("#form-layer input") &&
        [...document.querySelectorAll("#text-layer span")].some((span) =>
          span.textContent.includes("Inhalt"),
        ),
    );
    const menuState = () =>
      b.evaluate(() => {
        const menu = document.querySelector("#context-menu");
        return {
          open: menu.matches(":popover-open"),
          items: [...menu.querySelectorAll("button")].map((button) => ({
            label: button.textContent,
            disabled: button.disabled,
          })),
        };
      });
    const rightClick = async (x, y) => {
      for (const type of ["mousePressed", "mouseReleased"])
        await b.command("Input.dispatchMouseEvent", {
          type,
          x,
          y,
          button: "right",
          buttons: type === "mousePressed" ? 2 : 0,
          clickCount: 1,
        });
    };
    const box = await b.evaluate(() => {
      const span = [...document.querySelectorAll("#text-layer span")].find(
          (candidate) => candidate.textContent.includes("Inhalt"),
        ),
        rect = span.getBoundingClientRect(),
        stage = document.querySelector("#page-stage").getBoundingClientRect();
      return {
        left: rect.left + 2,
        right: rect.right - 2,
        y: rect.top + rect.height / 2,
        emptyX: stage.left + stage.width / 2,
        emptyY: stage.top + stage.height - 40,
      };
    });
    await rightClick(box.emptyX, box.emptyY);
    assert.equal((await menuState()).open, false);
    assert.deepEqual(
      await b.evaluate(() => window.contextEvents),
      [true],
    );
    for (const [type, x] of [
      ["mousePressed", box.left],
      ["mouseMoved", box.right],
      ["mouseReleased", box.right],
    ])
      await b.command("Input.dispatchMouseEvent", {
        type,
        x,
        y: box.y,
        button: "left",
        buttons: type === "mouseReleased" ? 0 : 1,
        clickCount: 1,
      });
    await rightClick((box.left + box.right) / 2, box.y);
    assert.deepEqual(await menuState(), {
      open: true,
      items: [{ label: "Kopieren", disabled: false }],
    });
    await b.screenshot("/tmp/pdfhelper-context-menu.png");
    await b.evaluate(() =>
      document.querySelector("#context-menu button").click(),
    );
    assert.match(await b.evaluate(() => window.clipboardText), /Kopierbarer Inhalt/);
    assert.equal((await menuState()).open, false);
    const field = await b.evaluate(() => {
      const rect = document
        .querySelector("#form-layer input")
        .getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await rightClick(field.x, field.y);
    assert.deepEqual(await menuState(), {
      open: true,
      items: [
        { label: "Kopieren", disabled: true },
        { label: "Einfügen", disabled: false },
        { label: "Formular zurücksetzen", disabled: true },
      ],
    });
    await b.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    assert.equal((await menuState()).open, false);
    await rightClick(field.x, field.y);
    await b.evaluate(() =>
      document.querySelectorAll("#context-menu button")[1].click(),
    );
    await b.wait(
      () =>
        document.querySelector("#form-layer input").value ===
          "Kopierbarer Inhalt" &&
        !document.querySelector("#undo-button").disabled,
    );
    await b.evaluate(() => document.querySelector("[data-action=export]").click());
    await b.wait(() => document.querySelector("#export-dialog").open);
    const exportName = await b.evaluate(() => {
      const input = document.querySelector("#export-name");
      input.value = "";
      const rect = input.getBoundingClientRect();
      return { x: rect.left + 20, y: rect.top + rect.height / 2 };
    });
    await rightClick(exportName.x, exportName.y);
    assert.equal(
      await b.evaluate(() => {
        const menu = document.querySelector("#context-menu");
        const item = menu.querySelectorAll("button")[1].getBoundingClientRect();
        return (
          menu.matches(":popover-open") &&
          menu.closest("dialog") === document.querySelector("#export-dialog") &&
          document.elementFromPoint(
            item.left + item.width / 2,
            item.top + item.height / 2,
          ) === menu.querySelectorAll("button")[1]
        );
      }),
      true,
    );
    await b.screenshot("/tmp/pdfhelper-context-menu-dialog.png");
    await b.evaluate(() =>
      document.querySelectorAll("#context-menu button")[1].click(),
    );
    await b.wait(
      () =>
        document.querySelector("#export-name").value === "Kopierbarer Inhalt",
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: PDFs aus dem Betriebssystem öffnen (Datei-Handler)",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t, { prefix: "/PDFHelper/" });
    assert.deepEqual(
      await b.evaluate(async () => {
        const manifest = await (await fetch("./manifest.webmanifest")).json();
        return {
          action: manifest.file_handlers[0].action,
          accept: manifest.file_handlers[0].accept,
          clientMode: manifest.launch_handler.client_mode,
        };
      }),
      {
        action: "./",
        accept: { "application/pdf": [".pdf"], "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"], "image/tiff": [".tif", ".tiff"], "image/svg+xml": [".svg"], "application/epub+zip": [".epub"] },
        clientMode: ["focus-existing", "auto"],
      },
    );
    await b.command("Page.addScriptToEvaluateOnNewDocument", {
      source: `Object.defineProperty(window, "launchQueue", {
        configurable: true,
        value: { setConsumer(consumer) { window.launchConsumer = consumer; } },
      });`,
    });
    await b.navigate();
    await b.wait(
      () =>
        document.readyState === "complete" &&
        typeof window.launchConsumer === "function" &&
        !!document.querySelector("#welcome .icon"),
    );
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js"),
        lib = await pdfLib(),
        root = await navigator.storage.getDirectory();
      window.launchHandles = [];
      for (const [name, pages] of [
        ["Doppelklick.pdf", 2],
        ["Zweitstart.pdf", 1],
      ]) {
        const doc = await lib.PDFDocument.create();
        for (let i = 0; i < pages; i++) doc.addPage([300, 400]);
        const handle = await root.getFileHandle(name, { create: true }),
          writable = await handle.createWritable();
        await writable.write(await doc.save());
        await writable.close();
        window.launchHandles.push(handle);
      }
      window.launchConsumer({ files: [window.launchHandles[0]] });
      window.launchConsumer({ files: [window.launchHandles[1]] });
    });
    await b.wait(
      () =>
        document.querySelectorAll("#file-list li").length === 2 &&
        document.querySelector("#file-list [aria-current=true]")
          .textContent.includes("Zweitstart") &&
        !document.querySelector("#busy-dialog").open,
    );
    await b.wait(async () => {
      const { recentFiles } = await import("./src/core/recent.js");
      return (await recentFiles())
        .map((entry) => entry.name)
        .sort()
        .join() === "Doppelklick.pdf,Zweitstart.pdf";
    });
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Seiten stehen fortlaufend untereinander und folgen dem Scrollen",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t, { prefix: "/PDFHelper/" });
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js"),
        lib = await pdfLib(),
        doc = await lib.PDFDocument.create();
      for (let i = 0; i < 3; i++)
        doc
          .addPage([595.3, 841.9])
          .drawText(`Seite ${i + 1}`, { x: 40, y: 760, size: 24 });
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([await doc.save()], "Fortlaufend.pdf", {
          type: "application/pdf",
        }),
      );
      document.querySelector("#file-input").files = transfer.files;
      document.querySelector("#file-input").dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        document.querySelectorAll(".page-item").length === 3 &&
        !document.querySelector("#busy-dialog").open &&
        document.querySelector("#page-loading").hidden,
    );
    const layout = await b.evaluate(() => {
      const slots = [...document.querySelectorAll("#page-flow .page-slot")],
        rects = slots.map((slot) => slot.getBoundingClientRect());
      return {
        count: slots.length,
        stageInFirst: slots[0].contains(document.querySelector("#page-stage")),
        gaps: rects.slice(1).map((rect, i) => rect.top - rects[i].bottom),
      };
    });
    assert.equal(layout.count, 3);
    assert.equal(layout.stageInFirst, true);
    assert.deepEqual(layout.gaps, [16, 16]);
    await b.evaluate(() => {
      const scroller = document.querySelector("#page-scroll"),
        slot = document.querySelectorAll("#page-flow .page-slot")[1];
      scroller.scrollTop = slot.offsetTop - 20;
    });
    await b.wait(
      () =>
        document.querySelector("#current-page").value === "2" &&
        document
          .querySelectorAll("#page-flow .page-slot")[1]
          .contains(document.querySelector("#page-stage")) &&
        document.querySelector(".page-item.current")?.dataset.page ===
          document.querySelectorAll("#page-flow .page-slot")[1].dataset.page,
    );
    await b.wait(
      () =>
        document.querySelectorAll("#page-flow .page-slot")[0].querySelector(
          ".page-preview",
        )?.width > 0,
    );
    await b.evaluate(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }),
      ),
    );
    await b.wait(() => {
      const scroller = document.querySelector("#page-scroll"),
        slot = document.querySelectorAll("#page-flow .page-slot")[2],
        top = slot.offsetTop - scroller.scrollTop;
      return (
        document.querySelector("#current-page").value === "3" &&
        top < scroller.clientHeight &&
        top + slot.offsetHeight > 0
      );
    });
    await b.evaluate(() =>
      document.querySelector(".page-item .thumbnail").click(),
    );
    await b.wait(
      () =>
        document.querySelector("#current-page").value === "1" &&
        document.querySelector("#page-scroll").scrollTop === 0,
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Dateiliste und klickbares Inhaltsverzeichnis in der Sidebar",
  { timeout: 90000 },
  async (t) => {
    const b = await browser(t, { prefix: "/PDFHelper/" });
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js"),
        lib = await pdfLib(),
        doc = await lib.PDFDocument.create(),
        context = doc.context;
      const pages = [1, 2, 3].map((number) => {
        const page = doc.addPage([300, 400]);
        page.drawText(`Seite ${number}`, { x: 20, y: 350, size: 18 });
        return page;
      });
      const root = context.nextRef(),
        [intro, main, details, end] = [1, 2, 3, 4].map(() =>
          context.nextRef(),
        );
      const entry = (title, page, extra) =>
        context.obj({
          Title: lib.PDFHexString.fromText(title),
          Dest: [pages[page].ref, lib.PDFName.of("Fit")],
          ...extra,
        });
      context.assign(intro, entry("Einleitung", 0, { Parent: root, Next: main }));
      context.assign(
        main,
        entry("Hauptteil", 1, {
          Parent: root,
          Prev: intro,
          Next: end,
          First: details,
          Last: details,
          Count: 1,
        }),
      );
      context.assign(details, entry("Details", 1, { Parent: main }));
      context.assign(end, entry("Schluss", 2, { Parent: root, Prev: main }));
      context.assign(
        root,
        context.obj({ Type: "Outlines", First: intro, Last: end, Count: 3 }),
      );
      doc.catalog.set(lib.PDFName.of("Outlines"), root);
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([await doc.save()], "Inhalt.pdf", { type: "application/pdf" }),
      );
      document.querySelector("#file-input").files = transfer.files;
      document.querySelector("#file-input").dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        !document.querySelector("[data-side-section=outline]").hidden &&
        document.querySelectorAll(".page-item").length === 3,
    );
    assert.deepEqual(
      await b.evaluate(() => ({
        files: document.querySelector("[data-side-section=files]").hidden,
        expanded: document
          .querySelector("#pages-panel")
          .classList.contains("expanded"),
        inLeftPanel: !!document.querySelector("#pages-panel #outline-list"),
      })),
      { files: true, expanded: true, inLeftPanel: true },
    );
    const outlineState = () =>
      b.evaluate(() => ({
        open: document.querySelector("[data-side-section=outline]").open,
        hidden: document.querySelector("[data-side-section=outline]").hidden,
        titles: [...document.querySelectorAll("#outline-list .outline-link")].map(
          (link) => link.textContent,
        ),
        disabled: [
          ...document.querySelectorAll("#outline-list .outline-link:disabled"),
        ].map((link) => link.textContent),
        current:
          document.querySelector("#outline-list [aria-current=true]")
            ?.textContent ?? null,
        page: document.querySelector("#current-page").value,
      }));
    assert.deepEqual(await outlineState(), {
      open: true,
      hidden: false,
      titles: ["Einleitung", "Hauptteil", "Details", "Schluss"],
      disabled: [],
      current: "Einleitung",
      page: "1",
    });
    assert.equal(
      await b.evaluate(
        () =>
          document
            .querySelector("#outline-list .outline-link[title=Details]")
            .closest("ul").hidden,
      ),
      false,
    );
    await b.evaluate(() =>
      [...document.querySelectorAll("#outline-list .outline-link")]
        .find((link) => link.textContent === "Hauptteil")
        .click(),
    );
    await b.wait(() => document.querySelector("#current-page").value === "2");
    assert.equal((await outlineState()).current, "Hauptteil");
    const pressInOutline = (title, key) =>
      b.evaluate(
        ([title, key]) =>
          [...document.querySelectorAll("#outline-list .outline-link")]
            .find((link) => link.textContent === title)
            .dispatchEvent(
              new KeyboardEvent("keydown", { key, bubbles: true }),
            ),
        [title, key],
      );
    await pressInOutline("Hauptteil", "End");
    await b.wait(() => document.querySelector("#current-page").value === "3");
    assert.equal((await outlineState()).current, "Schluss");
    await pressInOutline("Schluss", "Home");
    await b.wait(() => document.querySelector("#current-page").value === "1");
    await pressInOutline("Einleitung", "ArrowDown");
    await b.wait(() => document.querySelector("#current-page").value === "2");
    assert.equal((await outlineState()).current, "Hauptteil");
    await b.screenshot("/tmp/pdfhelper-sidebar-outline.png");
    await b.evaluate(() => document.querySelector("[data-action=next]").click());
    await b.wait(() => document.querySelector("#current-page").value === "3");
    assert.equal((await outlineState()).current, "Schluss");
    await b.evaluate(() =>
      document
        .querySelector("#page-list .page-item.current .thumbnail")
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
        ),
    );
    await b.wait(() => document.querySelectorAll(".page-item").length === 2);
    await b.wait(
      () =>
        document.querySelector("#outline-list .outline-link:disabled")
          ?.textContent === "Schluss",
    );
    await openBlankDocument(b);
    const fileState = await b.evaluate(() => ({
      files: [...document.querySelectorAll("#file-list .file-open")].map(
        (button) => button.textContent,
      ),
      active: document.querySelector("#file-list [aria-current=true]")
        .textContent,
      dirty: [
        ...document.querySelectorAll('#file-list li[data-dirty="true"]'),
      ].map((item) => item.querySelector(".file-open").textContent),
    }));
    assert.equal(fileState.files.length, 2);
    assert.equal(
      await b.evaluate(
        () =>
          !document.querySelector("[data-side-section=files]").hidden &&
          document.querySelector("#file-count").textContent,
      ),
      "2",
    );
    assert.equal(fileState.files[0], "Inhalt");
    assert.match(fileState.files[1], /^Dokument-\d+$/);
    assert.equal(fileState.active, fileState.files[1]);
    assert.deepEqual(fileState.dirty, ["Inhalt"]);
    await b.wait(
      () => document.querySelector("[data-side-section=outline]").hidden,
    );
    await selectDocument(b, 0);
    await b.wait(
      () => !document.querySelector("[data-side-section=outline]").hidden,
    );
    await b.screenshot("/tmp/pdfhelper-sidebar-files.png");
    await b.evaluate(() =>
      document
        .querySelector("#file-list li.active [data-action=close-document]")
        .click(),
    );
    await b.wait(() => document.querySelector("#confirm-dialog").open);
    await b.evaluate(() =>
      document.querySelector("#confirm-dialog [value=yes]").click(),
    );
    await b.wait(
      () =>
        document.querySelectorAll("#file-list li").length === 1 &&
        document.querySelector("[data-side-section=outline]").hidden &&
        document.querySelector("[data-side-section=files]").hidden &&
        !document.querySelector("#pages-panel").classList.contains("expanded"),
    );
    await b.evaluate(() => {
      document
        .querySelector("#document-title")
        .dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      [...document.querySelectorAll("#context-menu button")]
        .find((button) => button.textContent === "Schließen")
        .click();
    });
    await b.wait(() => document.querySelectorAll("#file-list li").length === 0);
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Startseite zeigt zuletzt geöffnete Dateien",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t, { prefix: "/PDFHelper/" });
    assert.equal(
      await b.evaluate(() => document.querySelector("#welcome-recent").hidden),
      true,
    );
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js"),
        { rememberFile } = await import("./src/core/recent.js"),
        lib = await pdfLib(),
        root = await navigator.storage.getDirectory();
      for (const name of ["Start-Erste.pdf", "Start-Zweite.pdf"]) {
        const doc = await lib.PDFDocument.create();
        doc.addPage([300, 400]);
        const handle = await root.getFileHandle(name, { create: true }),
          writable = await handle.createWritable();
        await writable.write(await doc.save());
        await writable.close();
        await rememberFile(handle);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    });
    await b.navigate();
    await b.wait(
      () =>
        document.querySelectorAll("#welcome-recent .recent-item").length ===
          2 && !document.querySelector("#welcome-recent").hidden,
    );
    assert.deepEqual(
      await b.evaluate(() =>
        [
          ...document.querySelectorAll("#welcome-recent .recent-item strong"),
        ].map((item) => item.textContent),
      ),
      ["Start-Zweite.pdf", "Start-Erste.pdf"],
    );
    await b.screenshot("/tmp/pdfhelper-welcome-recent.png");
    await b.evaluate(() =>
      document.querySelectorAll("#welcome-recent .recent-item")[1].click(),
    );
    await b.wait(
      () =>
        document.querySelector("#welcome").hidden &&
        document.querySelectorAll(".page-item").length === 1 &&
        document.querySelector("#page-loading").hidden,
    );
    await b.evaluate(() => {
      document.querySelector("#recent-button").click();
    });
    await b.wait(() => !!document.querySelector("#recent-menu .recent-clear"));
    await b.evaluate(() =>
      document.querySelector("#recent-menu .recent-clear").click(),
    );
    await b.wait(async () => {
      const { recentFiles } = await import("./src/core/recent.js");
      return (await recentFiles()).length === 0;
    });
    await b.wait(
      () =>
        document.querySelector("#welcome-recent").hidden &&
        !document.querySelector("#welcome-recent .recent-item"),
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Eigene Suche mit Strg F, Trefferzähler und Navigation",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
      for (const type of ["keyDown", "keyUp"])
        await b.command("Input.dispatchKeyEvent", {
          type,
          key,
          code,
          windowsVirtualKeyCode,
          modifiers,
        });
    }
    const state = () =>
      b.evaluate(() => ({
        count: document.querySelector("#search-count").textContent,
        page: document.querySelector("#current-page").value,
        current: CSS.highlights.get("search-current")?.size ?? 0,
        matches: CSS.highlights.get("search-match")?.size ?? 0,
      }));
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js");
      const lib = await pdfLib();
      const pdf = await lib.PDFDocument.create();
      for (const text of ["Alpha Beta", "Gamma", "beta BETA"])
        pdf.addPage([595.3, 841.9]).drawText(text, { x: 40, y: 760, size: 24 });
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([await pdf.save()], "Suche.pdf", { type: "application/pdf" }),
      );
      const input = document.querySelector("#file-input");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        document.querySelectorAll(".page-item").length === 3 &&
        !document.querySelector("#busy-dialog").open &&
        document.querySelector("#page-loading").hidden &&
        document.querySelector("#text-layer").dataset.page,
    );
    await key("f", "KeyF", 70, 2);
    assert.equal(
      await b.evaluate(
        () =>
          !document.querySelector("#search-bar").hidden &&
          document.activeElement === document.querySelector("#search-input"),
      ),
      true,
    );
    await b.command("Input.insertText", { text: "beta" });
    await b.wait(
      () => document.querySelector("#search-count").textContent === "1/3",
    );
    await b.wait(() => CSS.highlights.get("search-current")?.size === 1);
    assert.deepEqual(await state(), {
      count: "1/3",
      page: "1",
      current: 1,
      matches: 0,
    });
    await key("Enter", "Enter", 13);
    await b.wait(
      () =>
        document.querySelector("#current-page").value === "3" &&
        document.querySelector("#text-layer").dataset.page &&
        CSS.highlights.get("search-current")?.size === 1,
    );
    assert.deepEqual(await state(), {
      count: "2/3",
      page: "3",
      current: 1,
      matches: 1,
    });
    await key("F3", "F3", 114);
    await b.wait(
      () => document.querySelector("#search-count").textContent === "3/3",
    );
    await key("F3", "F3", 114);
    await b.wait(
      () =>
        document.querySelector("#search-count").textContent === "1/3" &&
        document.querySelector("#current-page").value === "1",
    );
    await key("Enter", "Enter", 13, 8);
    await b.wait(
      () =>
        document.querySelector("#search-count").textContent === "3/3" &&
        document.querySelector("#current-page").value === "3",
    );
    await b.evaluate(() => {
      const input = document.querySelector("#search-input");
      input.value = "fehlt";
      input.dispatchEvent(new Event("input"));
    });
    await b.wait(
      () =>
        document.querySelector("#search-count").textContent ===
          "Keine Treffer" &&
        document.querySelector("#search-input").classList.contains("no-match"),
    );
    await key("Escape", "Escape", 27);
    assert.deepEqual(
      await b.evaluate(() => ({
        hidden: document.querySelector("#search-bar").hidden,
        focus: document.activeElement.id,
        highlights: CSS.highlights.size,
      })),
      { hidden: true, focus: "search-button", highlights: 0 },
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Radierer löscht überstrichene Elemente in einem Schritt",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b);
    await b.wait(
      () =>
        document.querySelector("#page-canvas").width > 0 &&
        document.querySelector("#page-loading").hidden,
    );
    const stage = await b.evaluate(() => {
      const rect = document
        .querySelector("#page-stage")
        .getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    async function drag(points) {
      const [first, ...rest] = points.map(([x, y]) => ({
        x: stage.x + x,
        y: stage.y + y,
      }));
      await b.command("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...first,
        button: "left",
        clickCount: 1,
      });
      for (const point of rest)
        await b.command("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...point,
          button: "left",
          buttons: 1,
        });
      await b.command("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...rest.at(-1),
        button: "left",
        clickCount: 1,
      });
    }
    const count = () =>
      b.evaluate(() => document.querySelectorAll(".annotation").length);
    const useTool = (tool) =>
      b.evaluate(
        (tool) => document.querySelector(`[data-tool=${tool}]`).click(),
        tool,
      );
    await useTool("draw");
    await drag([
      [40, 40],
      [140, 40],
      [140, 140],
    ]);
    await useTool("highlight");
    await drag([
      [40, 200],
      [140, 240],
    ]);
    assert.equal(await count(), 2);
    await useTool("erase");
    assert.deepEqual(
      await b.evaluate(() => ({
        pressed: document
          .querySelector("[data-tool=erase]")
          .getAttribute("aria-pressed"),
        tool: document.querySelector("#page-stage").dataset.tool,
      })),
      { pressed: "true", tool: "erase" },
    );
    await drag([
      [60, 100],
      [100, 120],
    ]);
    assert.equal(await count(), 2);
    await drag([
      [90, 20],
      [90, 220],
    ]);
    assert.equal(await count(), 0);
    await b.evaluate(() =>
      document.querySelector("[data-action=undo]").click(),
    );
    assert.equal(await count(), 2);
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Textmarker markiert überstrichenen PDF-Text zeilengenau",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    async function drag(from, to) {
      await b.command("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...from,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      for (let step = 1; step <= 6; step++)
        await b.command("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: from.x + ((to.x - from.x) * step) / 6,
          y: from.y + ((to.y - from.y) * step) / 6,
          button: "left",
          buttons: 1,
        });
      await b.command("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...to,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
    }
    const spans = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#text-layer span")]
          .filter((span) => span.textContent.trim())
          .map((span) => {
            const rect = span.getBoundingClientRect();
            return {
              text: span.textContent,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              y: rect.top + rect.height / 2,
            };
          }),
      );
    const highlights = () =>
      b.evaluate(() =>
        [...document.querySelectorAll('.annotation[data-type="highlight"]')].map(
          (item) =>
            [...item.querySelectorAll(".highlight-part")].map((part) => {
              const rect = part.getBoundingClientRect();
              return { left: rect.left, right: rect.right, top: rect.top };
            }),
        ),
      );
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js");
      const lib = await pdfLib();
      const pdf = await lib.PDFDocument.create();
      const page = pdf.addPage([595.3, 841.9]);
      page.drawText("Markierbarer Beispieltext", { x: 40, y: 760, size: 24 });
      page.drawText("Zweite Zeile mit Text", { x: 40, y: 720, size: 24 });
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([await pdf.save()], "Marker.pdf", { type: "application/pdf" }),
      );
      const input = document.querySelector("#file-input");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        !document.querySelector("#busy-dialog").open &&
        document.querySelector("#page-loading").hidden &&
        document.querySelector("#text-layer").dataset.page &&
        document.querySelectorAll("#text-layer span").length >= 2,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    await b.evaluate(() => document.querySelector("[data-action=fit-page]").click());
    await b.wait(
      () =>
        document.querySelector("#page-loading").hidden &&
        document.querySelector("#text-layer").dataset.page &&
        document.querySelectorAll("#text-layer span").length >= 2,
    );
    await b.evaluate(() => {
      document.querySelector('[data-tool="highlight"]').click();
      const toggle = document.querySelector('[data-style-tool="highlight"]');
      toggle.click();
      document.querySelector("#tool-style-return").click();
      toggle.click();
    });
    const [first, second] = await spans();
    assert.equal(first.text, "Markierbarer Beispieltext");
    await drag({ x: first.left + 1, y: first.y }, { x: first.right - 1, y: first.y });
    let marked = await highlights();
    assert.equal(marked.length, 1);
    assert.equal(marked[0].length, 1);
    assert.ok(Math.abs(marked[0][0].left - first.left) < 4);
    assert.ok(Math.abs(marked[0][0].right - first.right) < 4);
    assert.equal(
      await b.evaluate(() => getSelection().isCollapsed || !getSelection().rangeCount),
      true,
    );
    await b.evaluate(() => document.querySelector("#undo-button").click());
    assert.equal((await highlights()).length, 0);
    await b.wait(
      () =>
        document.querySelector("#page-loading").hidden &&
        document.querySelector("#text-layer").dataset.page &&
        document.querySelectorAll("#text-layer span").length >= 2,
    );
    await drag(
      { x: (first.left + first.right) / 2, y: first.y },
      { x: (second.left + second.right) / 2, y: second.y },
    );
    marked = await highlights();
    assert.equal(marked.length, 1);
    assert.equal(marked[0].length, 2);
    assert.ok(marked[0][0].top < marked[0][1].top);
    assert.ok(Math.abs(marked[0][0].right - first.right) < 4);
    assert.ok(Math.abs(marked[0][1].left - second.left) < 4);
    const blank = await b.evaluate(() => {
      const rect = document.querySelector("#page-stage").getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.7 };
    });
    const strokes = () =>
      b.evaluate(() =>
        [...document.querySelectorAll('.annotation[data-type="draw"]')].map(
          (item) => {
            const path = item.querySelector("path");
            return {
              label: item.dataset.label,
              stroke: path.getAttribute("stroke"),
              width: path.getAttribute("stroke-width"),
              opacity: item.style.opacity,
            };
          },
        ),
      );
    await drag(blank, { x: blank.x + 80, y: blank.y + 30 });
    assert.equal((await highlights()).length, 1);
    assert.deepEqual(await strokes(), [
      { label: "Textmarker", stroke: "#f1ce54", width: "14", opacity: "0.35" },
    ]);
    await b.evaluate(() => {
      document.querySelector('[data-tool="select"]').click();
      const span = [...document.querySelectorAll("#text-layer span")].find(
        (node) => node.textContent === "Zweite Zeile mit Text",
      );
      getSelection().selectAllChildren(span);
    });
    const button = await b.evaluate(() => {
      const rect = document
        .querySelector('[data-tool="highlight"]')
        .getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await drag(button, button);
    marked = await highlights();
    assert.equal(marked.length, 2);
    assert.equal(marked[1].length, 1);
    assert.ok(Math.abs(marked[1][0].left - second.left) < 4);
    const menuState = () =>
      b.evaluate(() => {
        const menu = document.querySelector("#tool-style-menu");
        return {
          open: menu.matches(":popover-open"),
          label: menu.getAttribute("aria-label"),
          tool: document.querySelector("#page-stage").dataset.tool,
          expanded: [...document.querySelectorAll("[data-style-tool]")]
            .filter((toggle) => toggle.getAttribute("aria-expanded") === "true")
            .map((toggle) => toggle.dataset.styleTool),
          textOnly: !document.querySelector("#tool-style-text-only-row").hidden,
          colors: [...menu.querySelectorAll(".tool-style-swatch")].length,
        };
      });
    const chooseStyle = (color, width) =>
      b.evaluate(
        ([color, width]) => {
          document
            .querySelector(`#tool-style-menu input[value="${color}"]`)
            .click();
          const range = document.querySelector("#tool-style-width");
          range.value = width;
          range.dispatchEvent(new Event("input", { bubbles: true }));
        },
        [color, width],
      );
    await b.evaluate(() => document.querySelector("[data-tool=select]").click());
    await b.evaluate(() =>
      document.querySelector('[data-style-tool="highlight"]').click(),
    );
    assert.deepEqual(await menuState(), {
      open: true,
      label: "Textmarker-Optionen",
      tool: "highlight",
      expanded: ["highlight"],
      textOnly: true,
      colors: 5,
    });
    await chooseStyle("#7ee05e", 20);
    assert.deepEqual(
      await b.evaluate(() => {
        const path = document.querySelector("#tool-style-preview");
        return [path.getAttribute("stroke"), path.getAttribute("stroke-width")];
      }),
      ["#7ee05e", "20"],
    );
    await b.evaluate(() =>
      document.activeElement.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    assert.equal((await menuState()).open, false);
    assert.equal(
      await b.evaluate(() => document.activeElement.dataset.styleTool),
      "highlight",
    );
    const lower = { x: blank.x, y: blank.y + 60 };
    await drag(lower, { x: lower.x + 80, y: lower.y + 20 });
    assert.deepEqual((await strokes())[1], {
      label: "Textmarker",
      stroke: "#7ee05e",
      width: "20",
      opacity: "0.35",
    });
    await b.evaluate(() =>
      document.querySelector('[data-style-tool="highlight"]').click(),
    );
    await b.evaluate(() =>
      document.querySelector("#tool-style-text-only").click(),
    );
    await b.evaluate(() =>
      document.querySelector('[data-style-tool="highlight"]').click(),
    );
    assert.equal((await menuState()).open, false);
    await drag(lower, { x: lower.x + 60, y: lower.y + 40 });
    assert.equal((await strokes()).length, 2);
    await drag(
      { x: first.left + 4, y: first.y },
      { x: first.right - 4, y: first.y },
    );
    assert.equal((await highlights()).length, 3);
    assert.equal(
      await b.evaluate(
        () =>
          [...document.querySelectorAll(".highlight-part")].at(-1).style
            .background,
      ),
      "rgb(126, 224, 94)",
    );
    await b.evaluate(() =>
      document.querySelector('[data-style-tool="draw"]').click(),
    );
    assert.deepEqual(await menuState(), {
      open: true,
      label: "Stift-Optionen",
      tool: "draw",
      expanded: ["draw"],
      textOnly: false,
      colors: 6,
    });
    await chooseStyle("#d93a3a", 6);
    await drag(lower, { x: lower.x + 60, y: lower.y + 40 });
    assert.equal((await menuState()).open, false);
    assert.deepEqual((await strokes())[2], {
      label: "Zeichnung",
      stroke: "#d93a3a",
      width: "6",
      opacity: "1",
    });
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Strg und Mausrad zoomen",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b);
    await b.wait(
      () =>
        document.querySelector("#page-canvas").width > 0 &&
        document.querySelector("#page-loading").hidden,
    );
    const width = () =>
      b.evaluate(
        () =>
          document.querySelector("#page-stage").getBoundingClientRect().width,
      );
    const point = await b.evaluate(() => {
      const rect = document
        .querySelector("#page-stage")
        .getBoundingClientRect();
      return {
        x: rect.x + rect.width / 2,
        y: Math.min(rect.y + rect.height / 2, innerHeight / 2),
      };
    });
    const wheel = (deltaY, modifiers) =>
      b.command("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        ...point,
        deltaX: 0,
        deltaY,
        modifiers,
      });
    const before = await width();
    await wheel(-100, 2);
    await b.wait(
      (before) =>
        document.querySelector("#page-stage").getBoundingClientRect().width >
        before * 1.1,
      30000,
      before,
    );
    const zoomed = await width();
    await wheel(100, 2);
    await b.wait(
      (zoomed) =>
        document.querySelector("#page-stage").getBoundingClientRect().width <
        zoomed * 0.9,
      30000,
      zoomed,
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Seitenansicht wechselt zwischen einer und zwei Seiten nebeneinander",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b, 3);
    await b.wait(
      () => document.querySelectorAll("#page-flow .page-slot").length === 3,
    );
    const layout = () =>
      b.evaluate(() => {
        const [first, second, third] = [
            ...document.querySelectorAll("#page-flow .page-slot"),
          ].map((slot) => slot.getBoundingClientRect()),
          scroller = document
            .querySelector("#page-scroll")
            .getBoundingClientRect();
        return {
          pressed: document
            .querySelector("#page-view-button")
            .getAttribute("aria-pressed"),
          sideBySide:
            Math.abs(first.top - second.top) < 1 &&
            second.left >= first.right,
          stacked: second.top >= first.bottom && third.top >= second.bottom,
          thirdUnderFirst:
            third.top >= first.bottom && Math.abs(third.left - first.left) < 1,
          fits: first.left >= scroller.left && second.right <= scroller.right,
        };
      });
    await b.evaluate(() =>
      document.querySelector("[data-action=toggle-page-view]").click(),
    );
    assert.deepEqual(await layout(), {
      pressed: "true",
      sideBySide: true,
      stacked: false,
      thirdUnderFirst: true,
      fits: true,
    });
    await b.screenshot("/tmp/pdfhelper-two-pages.png");
    await b.evaluate(() =>
      document.querySelector("[data-action=toggle-page-view]").click(),
    );
    assert.deepEqual(await layout(), {
      pressed: "false",
      sideBySide: false,
      stacked: true,
      thirdUnderFirst: true,
      fits: true,
    });
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Speichern steht als Symbol rechts und zeigt ungespeicherte Änderungen",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b);
    const state = () =>
      b.evaluate(() => {
        const button = document.querySelector("#save-button");
        return {
          lastButton: button.nextElementSibling === null,
          text: button.textContent.trim(),
          label: button.getAttribute("aria-label"),
          dirty: button.classList.contains("dirty"),
        };
      });
    assert.deepEqual(await state(), {
      lastButton: true,
      text: "",
      label: "Speichern",
      dirty: false,
    });
    await b.evaluate(() =>
      document.querySelector("#editor-topbar [data-action=rotate-page]").click(),
    );
    await b.wait(() =>
      document.querySelector("#save-button").classList.contains("dirty"),
    );
    await b.evaluate(() => document.querySelector("[data-action=undo]").click());
    await b.wait(
      () => !document.querySelector("#save-button").classList.contains("dirty"),
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Vollbild-Button in der Ansichtsleiste schaltet die ganze App um",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b);
    const state = () =>
      b.evaluate(() => {
        const button = document.querySelector("#fullscreen-button");
        return {
          visible: button.checkVisibility(),
          fullscreen: document.fullscreenElement === document.documentElement,
          pressed: button.getAttribute("aria-pressed"),
          label: button.getAttribute("aria-label"),
        };
      });
    const click = async () => {
      const point = await b.evaluate(() => {
        const rect = document
          .querySelector("#fullscreen-button")
          .getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      await b.command("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...point,
      });
      await b.wait(() =>
        document.querySelector("#view-pill").classList.contains("revealed"),
      );
      for (const type of ["mousePressed", "mouseReleased"])
        await b.command("Input.dispatchMouseEvent", {
          type,
          ...point,
          button: "left",
          clickCount: 1,
        });
    };
    assert.deepEqual(await state(), {
      visible: true,
      fullscreen: false,
      pressed: "false",
      label: "Vollbildmodus starten",
    });
    await click();
    await b.wait(
      () =>
        !!document.fullscreenElement &&
        document
          .querySelector("#fullscreen-button")
          .getAttribute("aria-pressed") === "true",
    );
    assert.deepEqual(await state(), {
      visible: true,
      fullscreen: true,
      pressed: "true",
      label: "Vollbildmodus beenden",
    });
    await b.wait(
      () =>
        getComputedStyle(document.querySelector("#fullscreen-button"))
          .backgroundColor === "rgb(51, 87, 125)",
    );
    await click();
    await b.wait(
      () =>
        !document.fullscreenElement &&
        document
          .querySelector("#fullscreen-button")
          .getAttribute("aria-pressed") === "false",
    );
    assert.deepEqual(await state(), {
      visible: true,
      fullscreen: false,
      pressed: "false",
      label: "Vollbildmodus starten",
    });
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Speichern überschreibt die Ursprungsdatei und fragt sonst nach einem Ziel",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
      for (const type of ["keyDown", "keyUp"])
        await b.command("Input.dispatchKeyEvent", {
          type,
          key,
          code,
          windowsVirtualKeyCode,
          modifiers,
        });
    }
    const dirty = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#file-list li")].map(
          (item) => item.dataset.dirty,
        ),
      );
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js");
      const lib = await pdfLib();
      const pdf = await lib.PDFDocument.create();
      const page = pdf.addPage([400, 600]);
      pdf
        .getForm()
        .createTextField("Name")
        .addToPage(page, { x: 30, y: 520, width: 200, height: 30 });
      const file = new File([await pdf.save()], "Formular.pdf", {
        type: "application/pdf",
      });
      window.writes = [];
      window.savePicks = 0;
      const fakeHandle = (name, source) => {
        const handle = {
          kind: "file",
          name,
          getFile: async () => source,
          queryPermission: async () => "granted",
          requestPermission: async () => "granted",
          isSameEntry: async (other) => other === handle,
          createWritable: async () => {
            const chunks = [];
            return {
              write: async (chunk) => chunks.push(chunk),
              close: async () =>
                window.writes.push({ name, blob: new Blob(chunks) }),
              abort: async () => {},
            };
          },
        };
        return handle;
      };
      window.showOpenFilePicker = async () => [fakeHandle("Formular.pdf", file)];
      window.showSaveFilePicker = async () => {
        window.savePicks++;
        return fakeHandle("Neu.pdf", null);
      };
      document.querySelector('[data-action="open"]').click();
    });
    await b.wait(
      () =>
        document.querySelectorAll('#form-layer [data-field="Name"]').length ===
          1 && document.querySelector("#page-loading").hidden,
    );
    await b.evaluate(() =>
      document.querySelector('#form-layer [data-field="Name"]').focus(),
    );
    await b.command("Input.insertText", { text: "Erika" });
    await key("s", "KeyS", 83, 2);
    await b.wait(() => window.writes.length === 1);
    assert.deepEqual(
      await b.evaluate(async () => {
        const { pdfLib } = await import("./src/pdf/vendors.js");
        const lib = await pdfLib();
        const saved = await lib.PDFDocument.load(
          await window.writes[0].blob.arrayBuffer(),
        );
        return {
          name: window.writes[0].name,
          value: saved.getForm().getTextField("Name").getText(),
          picks: window.savePicks,
          focused: document.activeElement.dataset.field,
        };
      }),
      { name: "Formular.pdf", value: "Erika", picks: 0, focused: "Name" },
    );
    assert.deepEqual(await dirty(), ["false"]);
    await b.evaluate(() => document.querySelector("#undo-button").click());
    assert.deepEqual(await dirty(), ["true"]);
    await key("s", "KeyS", 83, 2);
    await b.wait(() => window.writes.length === 2);
    assert.deepEqual(await dirty(), ["false"]);
    await openBlankDocument(b);
    await key("s", "KeyS", 83, 2);
    await b.wait(() => window.writes.length === 3);
    assert.deepEqual(
      await b.evaluate(() => ({
        name: window.writes[2].name,
        picks: window.savePicks,
        title: document.querySelector("#file-list [aria-current=true]")
          .textContent,
      })),
      { name: "Neu.pdf", picks: 1, title: "Neu" },
    );
    await key("s", "KeyS", 83, 2);
    await b.wait(() => window.writes.length === 4);
    assert.equal(await b.evaluate(() => window.savePicks), 1);
    await key("S", "KeyS", 83, 10);
    assert.equal(
      await b.evaluate(() => document.querySelector("#export-dialog").open),
      true,
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Dateiname in Toolbar, Dateiliste und Startansicht umbenennen und kopieren",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
      for (const type of ["keyDown", "keyUp"])
        await b.command("Input.dispatchKeyEvent", {
          type,
          key,
          code,
          windowsVirtualKeyCode,
          modifiers,
        });
    }
    async function rightClick(selector, index = 0) {
      if (await b.evaluate((selector) => !!document.querySelector(selector)?.closest("#editor-topbar"), selector))
        await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 500, y: 10 });
      const point = await b.evaluate(
        ({ selector, index }) => {
          const rect = document
            .querySelectorAll(selector)
            [index].getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        },
        { selector, index },
      );
      await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      for (const type of ["mousePressed", "mouseReleased"])
        await b.command("Input.dispatchMouseEvent", {
          type,
          ...point,
          button: "right",
          clickCount: 1,
        });
      await b.wait(() =>
        document.querySelector("#context-menu").matches(":popover-open"),
      );
    }
    const menu = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#context-menu button")].map(
          (button) => button.textContent,
        ),
      );
    const choose = (label) =>
      b.evaluate(
        (label) =>
          [...document.querySelectorAll("#context-menu button")]
            .find((button) => button.textContent === label)
            .click(),
        label,
      );
    async function rename(text) {
      await b.wait(
        () => document.activeElement?.classList.contains("name-editor"),
      );
      await b.command("Input.insertText", { text });
      await key("Enter", "Enter", 13);
    }
    const opfs = () =>
      b.evaluate(async () => {
        const names = [];
        for await (const name of (await navigator.storage.getDirectory()).keys())
          names.push(name);
        return names.sort();
      });
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js");
      const lib = await pdfLib();
      const pdf = await lib.PDFDocument.create();
      pdf.addPage([400, 600]);
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle("Formular.pdf", { create: true });
      const stream = await handle.createWritable();
      await stream.write(await pdf.save());
      await stream.close();
      window.copied = [];
      navigator.clipboard.writeText = async (text) => window.copied.push(text);
      window.showOpenFilePicker = async () => [handle];
      document.querySelector('[data-action="open"]').click();
    });
    await b.wait(
      () =>
        document.querySelector("#document-title .document-title-name")
          ?.textContent === "Formular" &&
        document.querySelector("#page-loading").hidden,
    );
    assert.equal(
      await b.evaluate(() => {
        const title = document.querySelector("#document-title");
        return !title.hidden && !title.classList.contains("collapsed");
      }),
      true,
    );
    await rightClick("#document-title");
    assert.deepEqual(await menu(), [
      "Umbenennen",
      "Dateinamen kopieren",
      "Schließen",
      "Toolbar entpinnen",
    ]);
    await choose("Dateinamen kopieren");
    await b.wait(() => window.copied.length === 1);
    assert.deepEqual(await b.evaluate(() => window.copied), ["Formular.pdf"]);
    await rightClick("#document-title");
    await choose("Umbenennen");
    await rename("Vertrag");
    await b.wait(
      () =>
        document.querySelector("#document-title .document-title-name")
          .textContent === "Vertrag" && !document.querySelector(".name-editor"),
    );
    assert.deepEqual(await opfs(), ["Vertrag.pdf"]);
    await b.evaluate(() =>
      document
        .querySelector("#document-title")
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    await rename("a/b");
    await b.wait(() =>
      document.querySelector("#toast").classList.contains("error"),
    );
    assert.equal(
      await b.evaluate(
        () => document.activeElement.classList.contains("name-editor"),
      ),
      true,
    );
    await key("Escape", "Escape", 27);
    assert.equal(
      await b.evaluate(() => ({
        editor: !!document.querySelector(".name-editor"),
        name: document.querySelector("#document-title .document-title-name")
          .textContent,
      })).then(JSON.stringify),
      JSON.stringify({ editor: false, name: "Vertrag" }),
    );
    assert.deepEqual(await opfs(), ["Vertrag.pdf"]);
    await key("s", "KeyS", 83, 2);
    await b.wait(() => document.querySelector("#toast").textContent.startsWith("Gespeichert"));
    assert.equal(
      await b.evaluate(() => document.querySelector("#toast").textContent),
      "Gespeichert: Vertrag.pdf",
    );
    await openBlankDocument(b);
    const blankIndex = await b.evaluate(
      () => document.querySelectorAll("#file-list .file-open").length - 1,
    );
    await rightClick("#file-list .file-open", blankIndex);
    assert.deepEqual(await menu(), [
      "Umbenennen",
      "Dateinamen kopieren",
      "Schließen",
      "Sidebar entpinnen",
    ]);
    await choose("Umbenennen");
    await rename("Entwurf");
    await b.wait(() =>
      [...document.querySelectorAll("#file-list .file-open")].some(
        (button) => button.textContent === "Entwurf",
      ),
    );
    assert.match(
      await b.evaluate(() => document.querySelector("#toast").textContent),
      /Datei selbst bleibt unverändert/,
    );
    for (let i = 0; i < 2; i++)
      await b.evaluate(() =>
        document.querySelector("#file-list .file-close, [data-action=close-document]").click(),
      );
    await b.wait(
      () =>
        !document.querySelector("#welcome").hidden &&
        [...document.querySelectorAll("#welcome-recent .recent-item strong")].some(
          (item) => item.textContent === "Vertrag.pdf",
        ),
    );
    const recentIndex = await b.evaluate(() =>
      [...document.querySelectorAll("#welcome-recent .recent-item strong")].findIndex(
        (item) => item.textContent === "Vertrag.pdf",
      ),
    );
    await rightClick("#welcome-recent .recent-item", recentIndex);
    assert.deepEqual(await menu(), ["Umbenennen", "Dateinamen kopieren"]);
    await choose("Umbenennen");
    await rename("Archiv");
    await b.wait(() =>
      [...document.querySelectorAll("#welcome-recent .recent-item strong")].some(
        (item) => item.textContent === "Archiv.pdf",
      ),
    );
    assert.deepEqual(await opfs(), ["Archiv.pdf"]);
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Gespeicherte Elemente sind nach dem Öffnen wieder auswählbar",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await b.evaluate(async () => {
      const { assemble } = await import("./src/pdf/engine.js");
      const { pdfLib } = await import("./src/pdf/vendors.js");
      const lib = await pdfLib();
      const blank = await lib.PDFDocument.create();
      blank.addPage([595.3, 841.9]);
      const { data } = await assemble({
        sources: [{ id: "source", data: await blank.save() }],
        document: {
          formValues: {},
          pages: [
            {
              id: "page",
              sourceId: "source",
              index: 0,
              width: 595.3,
              height: 841.9,
              rotation: 0,
              baseRotation: 0,
              elements: [
                {
                  id: "draw",
                  type: "draw",
                  x: 100,
                  y: 700,
                  width: 200,
                  height: 100,
                  angle: 0,
                  color: "#354a63",
                  opacity: 1,
                  strokeWidth: 4,
                  points: [
                    [0, 0],
                    [1, 1],
                  ],
                },
              ],
            },
          ],
        },
        options: {},
      });
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([data], "Gespeichert.pdf", { type: "application/pdf" }),
      );
      const input = document.querySelector("#file-input");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        document.querySelectorAll(".annotation[data-type=draw]").length === 1 &&
        document.querySelector("#page-loading").hidden,
    );
    const point = await b.evaluate(() => {
      const rect = document
        .querySelector(".annotation[data-type=draw]")
        .getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    for (const type of ["mousePressed", "mouseReleased"])
      await b.command("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "left",
        clickCount: 1,
      });
    assert.equal(
      await b.evaluate(
        () =>
          document.querySelector(".annotation.selected")?.dataset.type ?? null,
      ),
      "draw",
    );
    assert.equal(
      await b.evaluate(
        () => document.querySelector("#file-list li.active").dataset.dirty,
      ),
      "false",
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Seite in der Seitenleiste durch kreisförmiges Ziehen live drehen",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js");
      const lib = await pdfLib();
      const pdf = await lib.PDFDocument.create();
      for (let i = 0; i < 3; i++)
        pdf
          .addPage([595.3, 841.9])
          .drawRectangle({ x: 0, y: 641.9, width: 200, height: 200 });
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([await pdf.save()], "Kreis.pdf", { type: "application/pdf" }),
      );
      const input = document.querySelector("#file-input");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        document.querySelectorAll("#page-list .page-item").length === 3 &&
        !document.querySelector("#busy-dialog").open,
    );
    const corners = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#page-list .thumbnail")].map((thumb) => {
          const source = thumb.querySelector("canvas");
          if (!source) return null;
          const canvas = document.createElement("canvas");
          canvas.width = source.width;
          canvas.height = source.height;
          const context = canvas.getContext("2d");
          context.drawImage(source, 0, 0);
          const right = canvas.width - 4,
            bottom = canvas.height - 4;
          const dark = ([x, y]) => context.getImageData(x, y, 1, 1).data[0] < 100;
          return [
            source.width > source.height ? "quer" : "hoch",
            Object.entries({
              tl: [3, 3],
              tr: [right, 3],
              bl: [3, bottom],
              br: [right, bottom],
            })
              .filter(([, point]) => dark(point))
              .map(([name]) => name)
              .join(""),
          ];
        }),
      );
    async function expectCorners(expected) {
      const start = Date.now();
      let last;
      while (Date.now() - start < 15000) {
        last = await corners();
        if (JSON.stringify(last) === JSON.stringify(expected)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.deepEqual(last, expected);
    }
    const drag = (options) =>
      b.evaluate(({ index, arc = 0, dropIndex, cancel = false }) => {
        const items = [...document.querySelectorAll("#page-list .page-item")],
          item = items[index],
          thumb = item.querySelector(".thumbnail"),
          rect = thumb.getBoundingClientRect(),
          cx = rect.x + rect.width / 2,
          cy = rect.y + rect.height / 2,
          dataTransfer = new DataTransfer();
        const fire = (target, type, x, y) =>
          target.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              dataTransfer,
            }),
          );
        const at = (degrees) => [
          cx + 40 * Math.cos((degrees * Math.PI) / 180),
          cy + 40 * Math.sin((degrees * Math.PI) / 180),
        ];
        const state = () => ({
          angle: thumb.style.transform
            ? Math.round(parseFloat(thumb.style.transform.slice(7)))
            : 0,
          snapped: item.classList.contains("drop-rotate"),
        });
        fire(item, "dragstart", ...at(-90));
        const steps = Math.max(1, Math.round(Math.abs(arc) / 15));
        for (let i = 0; i <= steps; i++) {
          const [x, y] = at(-90 + (arc * i) / steps);
          fire(document.elementFromPoint(x, y), "dragover", x, y);
        }
        const result = { during: state() };
        let [x, y] = at(-90 + arc),
          target = document.elementFromPoint(x, y);
        if (dropIndex !== undefined) {
          target = items[dropIndex];
          const box = target.getBoundingClientRect();
          x = box.x + box.width / 2;
          y = box.y + box.height * 0.9;
          fire(target, "dragover", x, y);
          result.over = state();
        }
        if (!cancel) fire(target, "drop", x, y);
        fire(item, "dragend", x, y);
        result.after = state();
        return result;
      }, options);
    const order = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#page-list .page-item")].map(
          (item) => item.dataset.page,
        ),
      );
    const undo = () =>
      b.evaluate(() => document.querySelector("[data-action=undo]").click());
    const portrait = ["hoch", "tl"];
    const unchanged = [portrait, portrait, portrait];
    const near = ({ angle, snapped }, expected) => {
      assert.ok(Math.abs(angle - expected.angle) <= 3, `${angle}°`);
      assert.equal(snapped, expected.snapped);
    };
    await expectCorners(unchanged);
    const quarter = await drag({ index: 1, arc: 90 });
    near(quarter.during, { angle: 90, snapped: true });
    await expectCorners([portrait, ["quer", "tr"], portrait]);
    assert.equal(
      await b.evaluate(() => document.querySelector("#undo-button").title),
      "Rückgängig: Seiten drehen (Strg/⌘ Z)",
    );
    await undo();
    await expectCorners(unchanged);
    near((await drag({ index: 1, arc: -90 })).during, {
      angle: -90,
      snapped: true,
    });
    await expectCorners([portrait, ["quer", "bl"], portrait]);
    await undo();
    await expectCorners(unchanged);
    await drag({ index: 1, arc: 180 });
    await expectCorners([portrait, ["hoch", "br"], portrait]);
    await undo();
    await expectCorners(unchanged);
    near((await drag({ index: 1, arc: 20 })).during, {
      angle: 0,
      snapped: false,
    });
    near((await drag({ index: 1, arc: 35 })).during, {
      angle: 35,
      snapped: false,
    });
    const cancelled = await drag({ index: 1, arc: 90, cancel: true });
    assert.deepEqual(cancelled.after, { angle: 0, snapped: false });
    assert.equal(
      await b.evaluate(() => document.querySelectorAll(".turning").length),
      0,
    );
    await expectCorners(unchanged);
    let before = await order();
    const moved = await drag({ index: 1, arc: 90, dropIndex: 2 });
    assert.deepEqual(moved.over, { angle: 0, snapped: false });
    assert.deepEqual(await order(), [before[0], before[2], before[1]]);
    await expectCorners(unchanged);
    await undo();
    await b.evaluate(() =>
      document.querySelector("[data-action=select-all]").click(),
    );
    await drag({ index: 0, arc: 90 });
    await expectCorners([
      ["quer", "tr"],
      ["quer", "tr"],
      ["quer", "tr"],
    ]);
    await undo();
    await b.evaluate(() =>
      document.querySelector("[data-action=select-none]").click(),
    );
    await expectCorners(unchanged);
    before = await order();
    await drag({ index: 0, dropIndex: 2 });
    assert.deepEqual(await order(), [before[1], before[2], before[0]]);
    await expectCorners(unchanged);
    assert.equal(
      await b.evaluate(() => document.querySelector("#undo-button").title),
      "Rückgängig: Seiten verschieben (Strg/⌘ Z)",
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Seiten über das Kontextmenü der Seitenleiste entfernen",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b, 4);
    const order = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#page-list .page-item")].map(
          (item) => item.dataset.page,
        ),
      );
    const openMenu = (index) =>
      b.evaluate((index) => {
        const item = document.querySelectorAll("#page-list .page-item")[index],
          rect = item.getBoundingClientRect();
        item.querySelector(".thumbnail").dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: rect.x + rect.width / 2,
            clientY: rect.y + rect.height / 2,
          }),
        );
        return [...document.querySelectorAll("#context-menu button")].map(
          (button) => button.textContent,
        );
      }, index);
    const choose = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#context-menu button")]
          .find((button) => button.textContent.endsWith("entfernen"))
          .click(),
      );
    const actions = [
      "Links drehen",
      "Rechts drehen",
      "Nach vorne",
      "Nach hinten",
      "In neues Dokument kopieren",
    ];
    const pages = await order();
    assert.deepEqual(await openMenu(1), [...actions, "Seite entfernen", "Sidebar entpinnen"]);
    await choose();
    await b.wait(
      () => document.querySelectorAll("#page-list .page-item").length === 3,
    );
    assert.deepEqual(await order(), [pages[0], pages[2], pages[3]]);
    assert.equal(
      await b.evaluate(() => document.querySelector("#undo-button").title),
      "Rückgängig: Seiten löschen (Strg/⌘ Z)",
    );
    await b.evaluate(() => {
      document.querySelector("[data-action=select-none]").click();
      const checks = document.querySelectorAll("#page-list .page-check");
      checks[1].click();
      checks[2].click();
    });
    assert.deepEqual(await openMenu(1), [...actions, "2 Seiten entfernen", "Sidebar entpinnen"]);
    await choose();
    await b.wait(
      () => document.querySelectorAll("#page-list .page-item").length === 1,
    );
    assert.deepEqual(await order(), [pages[0]]);
    await b.evaluate(() => document.querySelector("[data-action=undo]").click());
    await b.wait(
      () => document.querySelectorAll("#page-list .page-item").length === 3,
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Dateien in der Sidebar sortieren und zusammenführen",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b);
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js"),
        lib = await pdfLib(),
        doc = await lib.PDFDocument.create();
      doc.addPage([841.9, 595.3]);
      doc.addPage([841.9, 595.3]);
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([await doc.save()], "Quer.pdf", { type: "application/pdf" }),
      );
      document.querySelector("#file-input").files = transfer.files;
      document.querySelector("#file-input").dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        document.querySelector("#file-list [aria-current=true]")
          ?.textContent === "Quer" &&
        document.querySelector("#page-loading").hidden,
    );
    const names = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#file-list .file-open")].map(
          (button) => button.textContent,
        ),
      );
    const [first] = await names();
    assert.equal(
      await b.evaluate(
        () =>
          !document.querySelector("[data-side-section=files]").hidden &&
          document
            .querySelector("[data-side-section=files] [data-action=merge]")
            .getBoundingClientRect().height > 0,
      ),
      true,
    );
    await b.evaluate(() => {
      const [target, dragged] = document.querySelectorAll("#file-list li"),
        rect = target.getBoundingClientRect(),
        dataTransfer = new DataTransfer(),
        fire = (element, type, clientY) =>
          element.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer,
              clientX: rect.left + 10,
              clientY,
            }),
          );
      fire(dragged, "dragstart", 0);
      fire(target, "dragover", rect.top + 2);
      fire(target, "drop", rect.top + 2);
      fire(dragged, "dragend", 0);
    });
    assert.deepEqual(await names(), ["Quer", first]);
    const press = (key) =>
      b.evaluate((key) => {
        document
          .querySelector('#file-list .file-open[aria-current="true"]')
          .dispatchEvent(
            new KeyboardEvent("keydown", { key, altKey: true, bubbles: true }),
          );
        return document.activeElement?.textContent;
      }, key);
    assert.equal(await press("ArrowDown"), "Quer");
    assert.deepEqual(await names(), [first, "Quer"]);
    await press("ArrowUp");
    assert.deepEqual(await names(), ["Quer", first]);
    await selectDocument(b, 1);
    await b.wait(() => {
      const canvas = document.querySelector("#page-canvas");
      return (
        document.querySelector("#file-list [aria-current=true]")
          ?.textContent !== "Quer" && canvas.height > canvas.width
      );
    });
    await b.evaluate(() =>
      document
        .querySelector("[data-side-section=files] [data-action=merge]")
        .click(),
    );
    await b.wait(() => {
      const canvas = document.querySelector("#page-canvas");
      return (
        document.querySelector("#file-list [aria-current=true]")
          ?.textContent === "Zusammengeführt" &&
        document.querySelectorAll("#page-list .page-item").length === 3 &&
        canvas.width > canvas.height
      );
    });
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Gruppen per Ziehen in der Seitenleiste bilden, ändern und auflösen",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b, 4);
    const order = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#page-list .page-item")].map(
          (item) => item.dataset.page,
        ),
      );
    const drag = (from, to, fraction) =>
      b.evaluate(
        ({ from, to, fraction }) => {
          const items = document.querySelectorAll("#page-list .page-item"),
            rect = items[to].getBoundingClientRect(),
            x = rect.x + rect.width / 2,
            y = rect.y + rect.height * fraction,
            dataTransfer = new DataTransfer();
          const fire = (target, type) =>
            target.dispatchEvent(
              new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                dataTransfer,
              }),
            );
          fire(items[from], "dragstart");
          fire(items[to], "dragover");
          fire(items[to], "drop");
          fire(items[from], "dragend");
        },
        { from, to, fraction },
      );
    const sidebar = () =>
      b.evaluate(() => ({
        labels: [...document.querySelectorAll(".group-label span")].map(
          (label) => label.textContent,
        ),
        grouped: [...document.querySelectorAll("#page-list .page-item")].map(
          (item) => item.classList.contains("grouped"),
        ),
        split: !document.querySelector(".page-bulk [data-action=split]").hidden,
        undo: document.querySelector("#undo-button").title,
      }));
    assert.equal(
      await b.evaluate(
        () => !!document.querySelector("[data-settings-group=groups]"),
      ),
      false,
    );
    const [a, bPage, c, d] = await order();
    assert.equal((await sidebar()).split, false);
    await drag(3, 0, 0.5);
    assert.deepEqual(await order(), [a, d, bPage, c]);
    assert.deepEqual(await sidebar(), {
      labels: ["Gruppe 1"],
      grouped: [true, true, false, false],
      split: true,
      undo: "Rückgängig: Seiten gruppieren (Strg/⌘ Z)",
    });
    await drag(2, 1, 0.1);
    assert.deepEqual(await order(), [a, bPage, d, c]);
    assert.deepEqual((await sidebar()).grouped, [true, true, true, false]);
    await drag(2, 3, 0.9);
    assert.deepEqual(await order(), [a, bPage, c, d]);
    assert.deepEqual(await sidebar(), {
      labels: ["Gruppe 1"],
      grouped: [true, true, false, false],
      split: true,
      undo: "Rückgängig: Seiten verschieben (Strg/⌘ Z)",
    });
    assert.deepEqual(
      await b.evaluate(() => {
        document.querySelector(".page-bulk [data-action=split]").click();
        const dialog = document.querySelector("#export-dialog"),
          result = [
            dialog.open,
            dialog.querySelector("h2").textContent,
            document.querySelector("#export-scope").value,
            document.querySelector("#export-split").value,
          ];
        dialog.close();
        return result;
      }),
      [true, "Dokument aufteilen", "all", "groups"],
    );
    await b.evaluate(() =>
      document.querySelector(".group-label button").click(),
    );
    assert.deepEqual(await sidebar(), {
      labels: [],
      grouped: [false, false, false, false],
      split: false,
      undo: "Rückgängig: Gruppe auflösen (Strg/⌘ Z)",
    });
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Seiten über Kontextmenü und Tastatur verwalten",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b, 3);
    const order = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#page-list .page-item")].map(
          (item) => item.dataset.page,
        ),
      );
    const initial = await order();
    const press = (index, init) =>
      b.evaluate(
        ({ index, init }) => {
          const thumbs = document.querySelectorAll("#page-list .thumbnail");
          thumbs[index].focus();
          thumbs[index].dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, ...init }),
          );
          return document.activeElement?.dataset.page;
        },
        { index, init },
      );
    assert.equal(
      await press(0, { key: "ArrowDown", altKey: true }),
      initial[0],
    );
    assert.deepEqual(await order(), [initial[1], initial[0], initial[2]]);
    await press(1, { key: "ArrowUp", altKey: true });
    assert.deepEqual(await order(), initial);
    const menu = (index) =>
      b.evaluate((index) => {
        const item = document.querySelectorAll("#page-list .page-item")[index],
          rect = item.getBoundingClientRect();
        item.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 5,
            clientY: rect.top + 5,
          }),
        );
        return [...document.querySelectorAll("#context-menu button")].map(
          (button) => [button.textContent, button.disabled],
        );
      }, index);
    const choose = (label) =>
      b.evaluate(
        (label) =>
          [...document.querySelectorAll("#context-menu button")]
            .find((button) => button.textContent === label)
            .click(),
        label,
      );
    assert.deepEqual(await menu(2), [
      ["Links drehen", false],
      ["Rechts drehen", false],
      ["Nach vorne", false],
      ["Nach hinten", true],
      ["In neues Dokument kopieren", false],
      ["Seite entfernen", false],
      ["Sidebar entpinnen", false],
    ]);
    await choose("Nach vorne");
    assert.deepEqual(await order(), [initial[0], initial[2], initial[1]]);
    await menu(0);
    await choose("Links drehen");
    assert.match(
      await b.evaluate(() => document.querySelector("#undo-button").title),
      /Seiten drehen/,
    );
    await press(0, { key: "Delete" });
    await b.wait(() => document.querySelectorAll(".page-item").length === 2);
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Seite in der Seitenleiste vor die erste Seite ziehen",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b, 3);
    const order = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#page-list .page-item")].map(
          (item) => item.dataset.page,
        ),
      );
    const initial = await order();
    const dropAt = (index, where) =>
      b.evaluate(
        ({ index, where }) => {
          const list = document.querySelector("#page-list"),
            items = list.querySelectorAll(".page-item"),
            item = items[index],
            listRect = list.getBoundingClientRect(),
            first = items[0].getBoundingClientRect(),
            last = items[items.length - 1].getBoundingClientRect(),
            x = first.left + first.width / 2,
            y = where === "top" ? listRect.top + 4 : last.bottom + 6,
            dataTransfer = new DataTransfer(),
            fire = (target, type) =>
              target.dispatchEvent(
                new DragEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  clientX: x,
                  clientY: y,
                  dataTransfer,
                }),
              );
          fire(item, "dragstart");
          fire(list, "dragover");
          const indicator = items[where === "top" ? 0 : items.length - 1]
            .classList.contains(where === "top" ? "drop-before" : "drop-after");
          fire(list, "drop");
          fire(item, "dragend");
          return indicator;
        },
        { index, where },
      );
    assert.equal(
      await b.evaluate(() => {
        const list = document.querySelector("#page-list"),
          first = list.querySelector(".page-item").getBoundingClientRect();
        return first.top - list.getBoundingClientRect().top >= 10;
      }),
      true,
    );
    assert.equal(await dropAt(2, "top"), true);
    assert.deepEqual(await order(), [initial[2], initial[0], initial[1]]);
    assert.equal(await dropAt(0, "bottom"), true);
    assert.deepEqual(await order(), [initial[0], initial[1], initial[2]]);
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Werkzeug-Cursor zeigen Symbol und Farbe des aktiven Werkzeugs",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b);
    const cursorFor = (tool) =>
      b.evaluate((tool) => {
        document.querySelector(`button[data-tool=${tool}]`).click();
        return getComputedStyle(document.querySelector("#interaction-layer"))
          .cursor;
      }, tool);
    assert.equal(await cursorFor("text"), "text");
    const draw = await cursorFor("draw");
    assert.match(draw, /^url\("data:image\/svg\+xml,.*%23354a63.*"\) 3 21, crosshair$/);
    assert.match(
      await cursorFor("highlight"),
      /^url\("data:image\/svg\+xml,.*%23f1ce54.*"\) 4 19, crosshair$/,
    );
    assert.match(
      await cursorFor("erase"),
      /^url\("data:image\/svg\+xml,.*"\) 4 18, crosshair$/,
    );
    await b.evaluate(() => {
      document.querySelector('button[data-tool="draw"]').click();
      document.querySelector('[data-style-tool="draw"]').click();
      const swatch = [
        ...document.querySelectorAll("#tool-style-swatches .tool-style-swatch"),
      ].find((input) => input.value === "#d93a3a");
      swatch.checked = true;
      swatch.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const red = await cursorFor("draw");
    assert.notEqual(red, draw);
    assert.match(red, /%23d93a3a/);
    await b.evaluate(() => {
      document.querySelector('button[data-tool="highlight"]').click();
      document.querySelector('[data-style-tool="highlight"]').click();
      document.querySelector("#tool-style-text-only").click();
    });
    assert.equal(await cursorFor("highlight"), "default");
    await b.evaluate(() => document.querySelector("#tool-style-text-only").click());
    assert.match(await cursorFor("highlight"), /^url\(/);
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Verschieben in der Seitenleiste dreht nicht mit",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t, { viewport: { width: 1440, height: 1400 } });
    await openBlankDocument(b, 4);
    const order = () =>
      b.evaluate(() =>
        [...document.querySelectorAll("#page-list .page-item")].map(
          (item) => item.dataset.page,
        ),
      );
    const undoTitle = () =>
      b.evaluate(() => document.querySelector("#undo-button").title);
    const gesture = async (index, path, cancel = false) => {
      await b.wait(() => [...document.querySelectorAll("#page-list .thumbnail")].every((thumb) => thumb.querySelector("canvas")));
      const result = await b.evaluate(
        ({ index, path, cancel }) => {
          const list = document.querySelector("#page-list"),
            item = list.querySelectorAll(".page-item")[index],
            thumbs = [...list.querySelectorAll(".thumbnail")].map((thumb) =>
              thumb.getBoundingClientRect(),
            ),
            own = thumbs[index],
            dataTransfer = new DataTransfer(),
            points = path.map(([ref, fx, fy, radius, degrees]) => {
              const rect = thumbs[ref];
              if (radius === undefined)
                return [
                  rect.left + rect.width * fx,
                  rect.top + rect.height * fy,
                ];
              const cx = rect.left + rect.width / 2,
                cy = rect.top + rect.height / 2,
                angle = (degrees * Math.PI) / 180;
              return [
                cx + radius * Math.cos(angle),
                cy + radius * Math.sin(angle),
              ];
            }),
            fire = (target, type, [x, y]) =>
              target.dispatchEvent(
                new DragEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  clientX: x,
                  clientY: y,
                  dataTransfer,
                }),
              ),
            targetAt = ([x, y]) => document.elementFromPoint(x, y) || list,
            thumb = item.querySelector(".thumbnail"),
            states = [];
          const nativeImages = [],
            setDragImage = dataTransfer.setDragImage.bind(dataTransfer);
          dataTransfer.setDragImage = (image, x, y) => {
            nativeImages.push({
              width: image.width,
              height: image.height,
              transparent: image.getContext("2d").getImageData(0, 0, 1, 1).data[3] === 0,
              connected: image.isConnected,
              x,
              y,
            });
            setDragImage(image, x, y);
          };
          fire(item, "dragstart", points[0]);
          const preview = document.querySelector(".page-drag-preview"),
            source = thumb.querySelector("canvas"),
            copy = preview.querySelector("canvas"),
            snapshot = {
              samePixels: source.toDataURL() === copy.toDataURL(),
              width: parseFloat(preview.style.width),
              height: parseFloat(preview.style.height),
              pointerEvents: getComputedStyle(preview).pointerEvents,
              hidden: !preview.checkVisibility(),
              inert: preview.inert,
              ariaHidden: preview.getAttribute("aria-hidden"),
            };
          for (const point of points) {
            fire(targetAt(point), "dragover", point);
            const rect = preview.getBoundingClientRect();
            states.push({
              inside: point[1] < (thumbs[index + 1]?.top ?? Infinity),
              turning: !!thumb.style.transform,
              moving: preview.checkVisibility(),
              anchored: preview.hidden || (
                Math.abs(rect.left - (Math.trunc(point[0]) - Math.trunc(points[0][0]) + own.left)) < 1 &&
                Math.abs(rect.top - (Math.trunc(point[1]) - Math.trunc(points[0][1]) + own.top)) < 1
              ),
            });
          }
          const last = points.at(-1);
          if (!cancel) fire(targetAt(last), "drop", last);
          fire(item, "dragend", last);
          return {
            states,
            snapshot,
            nativeImages,
            cleaned: !document.querySelector(".page-drag-preview,.page-drag-image,.page-item.turning,.page-item.drop-rotate"),
          };
        },
        { index, path, cancel },
      );
      assert.deepEqual(result.nativeImages, [{ width: 1, height: 1, transparent: true, connected: true, x: 0, y: 0 }]);
      assert.deepEqual(result.snapshot, { samePixels: true, width: 116, height: 160, pointerEvents: "none", hidden: true, inert: true, ariaHidden: "true" });
      assert.ok(result.states.every((state) => !(state.turning && state.moving)));
      assert.ok(result.states.every((state) => state.anchored));
      assert.equal(result.cleaned, true);
      return result;
    };
    const pages = await order();
    const straight = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => [
      0,
      0.9,
      0.1 + f * 0.8,
    ]);
    const moved = await gesture(0, [
      ...straight,
      [1, 0.9, 0.5],
      [2, 0.9, 0.5],
      [2, 0.5, 0.95],
    ]);
    const firstOutside = moved.states.findIndex((state) => !state.inside);
    assert.ok(firstOutside > 0);
    assert.deepEqual(
      moved.states.slice(firstOutside).map((state) => state.turning),
      moved.states.slice(firstOutside).map(() => false),
    );
    assert.ok(moved.states.slice(firstOutside).every((state) => state.moving));
    assert.deepEqual(await order(), [pages[1], pages[2], pages[0], pages[3]]);
    assert.equal(
      await undoTitle(),
      "Rückgängig: Seiten verschieben (Strg/⌘ Z)",
    );
    const circle = (ref, radius, from, to, steps = 12) =>
      Array.from({ length: steps + 1 }, (_, i) => [
        ref,
        0,
        0,
        radius,
        from + ((to - from) * i) / steps,
      ]);
    const turned = await gesture(1, circle(1, 72, 0, 100));
    assert.ok(turned.states.some((state) => state.turning));
    assert.ok(turned.states.every((state) => !state.moving));
    assert.equal(await undoTitle(), "Rückgängig: Seiten drehen (Strg/⌘ Z)");
    const before = await order();
    const returned = await gesture(1, [
      [1, 0.9, 0.1],
      [2, 0.5, 0.5],
      ...circle(1, 40, -90, 10),
    ]);
    assert.ok(returned.states.every((state) => !state.turning));
    assert.ok(returned.states.slice(1).every((state) => state.moving));
    assert.deepEqual(await order(), before);
    assert.equal(await undoTitle(), "Rückgängig: Seiten drehen (Strg/⌘ Z)");
    const switched = await gesture(1, [
      ...circle(1, 40, -90, 10),
      [2, 0.5, 0.5],
      ...circle(1, 40, -90, 10),
    ]);
    assert.ok(switched.states.some((state) => state.turning));
    const firstMove = switched.states.findIndex((state) => state.moving);
    assert.ok(firstMove > 0);
    assert.ok(switched.states.slice(firstMove).every((state) => state.moving && !state.turning));
    await gesture(1, circle(1, 40, -90, 10), true);
    await gesture(1, [[1, 0.5, 0.5], [2, 0.5, 0.5]], true);
    assert.deepEqual(await order(), before);
    assert.equal(await undoTitle(), "Rückgängig: Seiten drehen (Strg/⌘ Z)");
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Nach dem Erstellen zurück zur Auswahl, abschaltbar je Werkzeug",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b);
    const stroke = async (tool, dx = 0) => {
      const box = await b.evaluate(() => {
        const rect = document
          .querySelector("#page-stage")
          .getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      });
      await b.evaluate(
        (tool) => document.querySelector(`button[data-tool=${tool}]`).click(),
        tool,
      );
      const points = [
        [80 + dx, 120],
        [160 + dx, 150],
        [240 + dx, 140],
      ];
      for (const [index, [x, y]] of points.entries())
        await b.command("Input.dispatchMouseEvent", {
          type: index === 0 ? "mousePressed" : "mouseMoved",
          x: box.x + x,
          y: box.y + y,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
      await b.command("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: box.x + points.at(-1)[0],
        y: box.y + points.at(-1)[1],
        button: "left",
        clickCount: 1,
      });
    };
    const state = () =>
      b.evaluate(() => ({
        tool: document.querySelector("#page-stage").dataset.tool,
        selected:
          document.querySelector(".annotation.selected")?.dataset.type ?? null,
        editing: document.activeElement?.classList.contains("inline-text"),
        count: document.querySelectorAll(".annotation").length,
      }));
    await stroke("draw");
    assert.deepEqual(await state(), {
      tool: "select",
      selected: "draw",
      editing: false,
      count: 1,
    });
    await stroke("highlight", 0);
    assert.deepEqual(await state(), {
      tool: "select",
      selected: "draw",
      editing: false,
      count: 2,
    });
    await stroke("text", 40);
    assert.deepEqual(await state(), {
      tool: "select",
      selected: "text",
      editing: true,
      count: 3,
    });
    await b.evaluate(() => {
      document.activeElement.blur();
      document.querySelector('button[data-tool="text"]').click();
      document.querySelector('[data-style-tool="text"]').click();
    });
    assert.deepEqual(
      await b.evaluate(() => {
        const menu = document.querySelector("#tool-style-menu");
        return {
          open: menu.matches(":popover-open"),
          label: menu.getAttribute("aria-label"),
          colors: menu.querySelector(".tool-style-colors").hidden,
          swatches: menu.querySelectorAll(".tool-style-swatch").length,
          font: document.querySelector("#tool-style-font-row").hidden,
          size: document.querySelector("#tool-style-font-size").value,
          width: menu.querySelector(".tool-style-width").hidden,
          preview: getComputedStyle(menu.querySelector(".tool-style-preview"))
            .display,
          textOnly: document.querySelector("#tool-style-text-only-row").hidden,
          returns: document.querySelector("#tool-style-return").checked,
          returnLabel: document.querySelector('label[for="tool-style-return"]')
            .textContent,
          focused: document.activeElement.value,
        };
      }),
      {
        open: true,
        label: "Text-Optionen",
        colors: false,
        swatches: 6,
        font: false,
        size: "16 pt",
        width: true,
        preview: "none",
        textOnly: true,
        returns: true,
        returnLabel: "Nach Erstellen zu Auswahl\u2011Tool",
        focused: "#354a63",
      },
    );
    const textFont = () =>
      b.evaluate(() =>
        [...document.querySelectorAll('.annotation[data-type="text"]')].map(
          (item) => ({
            size: parseFloat(item.style.fontSize),
            color: getComputedStyle(item).color,
          }),
        ),
      );
    assert.deepEqual(
      await b.evaluate(() => {
        const up = document.querySelector("#tool-style-font-up"),
          down = document.querySelector("#tool-style-font-down"),
          size = () => document.querySelector("#tool-style-font-size").value;
        up.click();
        up.click();
        down.click();
        const stepped = size();
        for (let i = 0; i < 20; i++) down.click();
        const smallest = [size(), down.disabled];
        for (let i = 0; i < 20; i++) up.click();
        const largest = [size(), up.disabled];
        for (let i = 0; i < 8; i++) down.click();
        const swatch = [
          ...document.querySelectorAll("#tool-style-swatches .tool-style-swatch"),
        ].find((input) => input.value === "#d93a3a");
        swatch.checked = true;
        swatch.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector("#tool-style-return").click();
        document.querySelector('[data-style-tool="text"]').click();
        return { stepped, smallest, largest, final: size() };
      }),
      {
        stepped: "18 pt",
        smallest: ["8 pt", true],
        largest: ["72 pt", true],
        final: "18 pt",
      },
    );
    await stroke("text", 80);
    assert.equal((await state()).tool, "text");
    await b.evaluate(() => document.activeElement.blur());
    const [plain, styled] = await textFont();
    assert.ok(Math.abs(styled.size / plain.size - 18 / 16) < 0.01);
    assert.equal(styled.color, "rgb(217, 58, 58)");
    assert.notEqual(plain.color, styled.color);
    await b.evaluate(() => {
      document.querySelector('button[data-tool="draw"]').click();
      document.querySelector('[data-style-tool="draw"]').click();
    });
    assert.equal(
      await b.evaluate(() => document.querySelector("#tool-style-return").checked),
      true,
    );
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Annotationen in der Sidebar auflisten, filtern und anspringen",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b, 3);
    const section = () =>
      b.evaluate(() => {
        const details = document.querySelector(
          "[data-side-section=annotations]",
        );
        return {
          hidden: details.hidden,
          open: details.open,
          count: document.querySelector("#annotation-count").textContent,
          entries: [...document.querySelectorAll(".annotation-entry")].map(
            (entry) => [
              entry.querySelector(".annotation-name").textContent,
              entry.querySelector(".annotation-page").textContent,
            ],
          ),
          filters: [
            ...document.querySelectorAll(
              "[data-annotation-filter]:not([hidden])",
            ),
          ].map((button) => button.dataset.annotationFilter),
        };
      });
    assert.equal((await section()).hidden, true);
    const stage = () =>
      b.evaluate(() => {
        const rect = document
          .querySelector("#page-stage")
          .getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      });
    const mouse = (type, point) =>
      b.command("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "left",
        buttons: type === "mouseMoved" ? 1 : undefined,
        clickCount: 1,
      });
    const showPage = async (index) => {
      await b.evaluate(
        (index) => document.querySelectorAll(".thumbnail")[index].click(),
        index,
      );
      await b.wait(
        (index) =>
          document.querySelector("#current-page").value ===
            String(index + 1) &&
          document.querySelector("#page-loading").hidden,
        undefined,
        index,
      );
    };
    await b.evaluate(() => document.querySelector("[data-tool=text]").click());
    let origin = await stage();
    await mouse("mousePressed", { x: origin.x + 80, y: origin.y + 80 });
    await mouse("mouseReleased", { x: origin.x + 80, y: origin.y + 80 });
    await b.command("Input.insertText", { text: "Notiz Alpha" });
    for (const type of ["keyDown", "keyUp"])
      await b.command("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        modifiers: 2,
        windowsVirtualKeyCode: 13,
      });
    await showPage(2);
    await b.evaluate(() => document.querySelector("[data-tool=draw]").click());
    origin = await stage();
    await mouse("mousePressed", { x: origin.x + 60, y: origin.y + 300 });
    for (const [x, y] of [
      [120, 320],
      [180, 360],
    ])
      await mouse("mouseMoved", { x: origin.x + x, y: origin.y + y });
    await mouse("mouseReleased", { x: origin.x + 180, y: origin.y + 360 });
    await showPage(0);
    assert.deepEqual(await section(), {
      hidden: false,
      open: false,
      count: "2",
      entries: [
        ["Notiz Alpha", "S. 1"],
        ["Zeichnung", "S. 3"],
      ],
      filters: ["all", "text", "draw"],
    });
    await b.evaluate(() => {
      document.querySelector("[data-side-section=annotations] > summary").click();
      document.querySelector('[data-annotation-filter="draw"]').click();
    });
    assert.deepEqual((await section()).entries, [["Zeichnung", "S. 3"]]);
    await b.evaluate(() => {
      document.querySelector('[data-annotation-filter="all"]').click();
      document.querySelector("#annotation-search-toggle").click();
      const search = document.querySelector("#annotation-search");
      search.value = "alpha";
      search.dispatchEvent(new Event("input"));
    });
    assert.deepEqual((await section()).entries, [["Notiz Alpha", "S. 1"]]);
    await b.evaluate(() => {
      const search = document.querySelector("#annotation-search");
      search.value = "";
      search.dispatchEvent(new Event("input"));
      [...document.querySelectorAll(".annotation-entry")]
        .find((entry) => entry.textContent.includes("Zeichnung"))
        .click();
    });
    assert.deepEqual(
      await b.evaluate(() => ({
        page: document.querySelector("#current-page").value,
        selected: document.querySelector(".annotation.selected")?.dataset.type,
        flash: !!document.querySelector(".annotation.selected.flash"),
        current: document
          .querySelector(".annotation-entry[aria-current=true]")
          ?.querySelector(".annotation-name").textContent,
      })),
      { page: "3", selected: "draw", flash: true, current: "Zeichnung" },
    );
    const selected = () => b.evaluate(() =>
      [...document.querySelectorAll('.annotation-entry[aria-pressed="true"]')].map((entry) => entry.querySelector(".annotation-name").textContent),
    );
    const choose = (index, modifiers = {}) => b.evaluate(({ index, modifiers }) => {
      document.querySelectorAll(".annotation-entry")[index].dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers }));
    }, { index, modifiers });
    const history = async (action, count) => {
      await b.evaluate((action) => document.querySelector(`[data-action="${action}"]`).click(), action);
      await b.wait((count) => document.querySelector("#annotation-count").textContent === String(count), undefined, count);
      assert.deepEqual(await selected(), []);
    };
    const context = (selector, index = 0) => b.evaluate(({ selector, index }) => {
      document.querySelectorAll(selector)[index].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      return [...document.querySelectorAll("#context-menu button")].map((button) => button.textContent);
    }, { selector, index });
    const closeContext = () => b.evaluate(() => document.querySelector("#context-menu").dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    await b.evaluate(() => document.querySelector("#annotation-search-toggle").click());
    assert.equal(await b.evaluate(() => document.querySelector("#annotation-search").hidden), true);
    await b.evaluate(() => document.querySelector("#annotation-search-toggle").click());
    assert.deepEqual(await b.evaluate(() => ({
      focused: document.activeElement.id,
      expanded: document.querySelector("#annotation-search-toggle").getAttribute("aria-expanded"),
      visible: document.querySelector("#annotation-search").getBoundingClientRect().height > 0,
    })), { focused: "annotation-search", expanded: "true", visible: true });
    await choose(1);
    await choose(0, { ctrlKey: true });
    assert.deepEqual(await selected(), ["Notiz Alpha", "Zeichnung"]);
    assert.equal(await b.evaluate(() => document.querySelector("#current-page").value), "3");
    await choose(0, { ctrlKey: true });
    assert.deepEqual(await selected(), ["Zeichnung"]);
    await choose(0, { metaKey: true });
    await choose(1, { shiftKey: true });
    assert.deepEqual(await selected(), ["Notiz Alpha", "Zeichnung"]);
    assert.equal(await b.evaluate(() => document.querySelector("#annotation-selection-count").textContent), "2 ausgewählt");
    await b.evaluate(() => document.querySelector('[data-annotation-filter="text"]').click());
    assert.deepEqual(await selected(), []);
    await choose(0, { shiftKey: true });
    assert.deepEqual(await selected(), ["Notiz Alpha"]);
    await b.evaluate(() => {
      document.querySelector('[data-annotation-filter="all"]').click();
      const search = document.querySelector("#annotation-search");
      search.value = "alpha";
      search.dispatchEvent(new Event("input"));
    });
    await choose(0);
    await b.evaluate(() => document.querySelector("#annotation-search-toggle").click());
    assert.deepEqual(await selected(), []);
    assert.equal((await section()).entries.length, 2);
    assert.equal(await b.evaluate(() => document.querySelector("#annotation-search").value), "");
    await choose(0);
    await choose(1, { shiftKey: true });
    await showPage(2);
    assert.deepEqual(await selected(), ["Notiz Alpha", "Zeichnung"]);
    assert.deepEqual(await context(".annotation-entry", 0), ["2 Annotationen löschen", "Sidebar entpinnen"]);
    await closeContext();
    assert.deepEqual(await context("#element-layer .annotation"), ["2 Annotationen löschen"]);
    await b.evaluate(() => document.querySelector("#context-menu button").click());
    assert.equal((await section()).count, "0");
    await history("undo", 2);
    await history("redo", 0);
    await history("undo", 2);
    assert.deepEqual(await context(".annotation-entry", 0), ["Annotation löschen", "Sidebar entpinnen"]);
    await b.evaluate(() => document.querySelector("#context-menu button").click());
    assert.deepEqual((await section()).entries, [["Zeichnung", "S. 3"]]);
    await history("undo", 2);
    await choose(0);
    await choose(1, { ctrlKey: true });
    await b.evaluate(() => document.querySelector("#annotation-delete-selection").click());
    assert.equal((await section()).count, "0");
    await history("undo", 2);
    for (const key of ["Delete", "Backspace"]) {
      await choose(0);
      await choose(1, { metaKey: true });
      await b.evaluate((key) => {
        const entry = document.querySelector(".annotation-entry");
        entry.focus();
        entry.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
      }, key);
      assert.equal((await section()).count, "0");
      await history("undo", 2);
    }
    await choose(0);
    await openBlankDocument(b);
    await selectDocument(b, 0);
    assert.deepEqual(await selected(), []);
    await choose(0);
    await b.wait(() => document.querySelector("#page-loading").hidden);
    await b.evaluate(() => {
      const item = document.querySelector('.annotation[data-type="text"]'),
        rect = item.getBoundingClientRect();
      item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: rect.x + 4, clientY: rect.y + 4 }));
    });
    await b.wait(() => !!document.querySelector(".inline-text"));
    assert.deepEqual(await context(".inline-text"), ["Kopieren", "Einfügen"]);
    await closeContext();
    await b.evaluate(() => document.querySelector(".inline-text")?.blur());
    await history("undo", 1);
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Optionen-Menü ändert das ausgewählte Element und die Vorgabe",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b);
    const stroke = async (tool, dy = 0) => {
      const box = await b.evaluate(() => {
        const rect = document
          .querySelector("#page-stage")
          .getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      });
      await b.evaluate(
        (tool) => document.querySelector(`button[data-tool=${tool}]`).click(),
        tool,
      );
      const points = [
        [80, 120 + dy],
        [160, 150 + dy],
        [240, 140 + dy],
      ];
      for (const [index, [x, y]] of points.entries())
        await b.command("Input.dispatchMouseEvent", {
          type: index === 0 ? "mousePressed" : "mouseMoved",
          x: box.x + x,
          y: box.y + y,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
      await b.command("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: box.x + points.at(-1)[0],
        y: box.y + points.at(-1)[1],
        button: "left",
        clickCount: 1,
      });
    };
    const menuState = () =>
      b.evaluate(() => ({
        tool: document.querySelector("#page-stage").dataset.tool,
        selected:
          document.querySelector(".annotation.selected")?.dataset.type ?? null,
        color: document.querySelector(".tool-style-swatch:checked")?.value,
      }));
    const paths = () =>
      b.evaluate(() =>
        [...document.querySelectorAll('.annotation[data-type="draw"]')].map(
          (item) => {
            const path = item.querySelector("path");
            return [path.getAttribute("stroke"), path.getAttribute("stroke-width")];
          },
        ),
      );
    await stroke("draw");
    await b.evaluate(() =>
      document.querySelector('[data-style-tool="draw"]').click(),
    );
    assert.deepEqual(await menuState(), {
      tool: "select",
      selected: "draw",
      color: "#354a63",
    });
    await b.evaluate(() => {
      const swatch = [
        ...document.querySelectorAll("#tool-style-swatches .tool-style-swatch"),
      ].find((input) => input.value === "#d93a3a");
      swatch.checked = true;
      swatch.dispatchEvent(new Event("change", { bubbles: true }));
      const width = document.querySelector("#tool-style-width");
      for (const value of [4, 6, 8]) {
        width.value = String(value);
        width.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    assert.deepEqual(await paths(), [["#d93a3a", "8"]]);
    assert.equal(
      await b.evaluate(() => document.querySelector("#tool-style-menu").matches(":popover-open")),
      true,
    );
    await b.evaluate(() =>
      document.querySelector("[data-action=toggle-history]").click(),
    );
    assert.deepEqual(
      await b.evaluate(() =>
        [...document.querySelectorAll("#history-menu button")]
          .map((item) => item.textContent)
          .slice(-3),
      ),
      ["Zeichnung hinzufügen", "Farbe ändern", "Stärke ändern"],
    );
    await b.evaluate(() => {
      document.querySelector("[data-action=toggle-history]").click();
      document.querySelector("[data-action=undo]").click();
      document.querySelector('[data-style-tool="draw"]').click();
    });
    assert.deepEqual(await paths(), [["#d93a3a", "2"]]);
    await stroke("draw", 120);
    assert.deepEqual(await paths(), [
      ["#d93a3a", "2"],
      ["#d93a3a", "8"],
    ]);
    await stroke("text", 260);
    await b.evaluate(() => document.activeElement.blur());
    const fontSize = () =>
      b.evaluate(() =>
        [...document.querySelectorAll('.annotation[data-type="text"]')].map(
          (item) => parseFloat(item.style.fontSize),
        ),
      );
    const [before] = await fontSize();
    await b.evaluate(() => {
      document.querySelector('[data-style-tool="text"]').click();
      document.querySelector("#tool-style-font-up").click();
    });
    assert.deepEqual(await menuState(), {
      tool: "select",
      selected: "text",
      color: "#354a63",
    });
    assert.equal(
      await b.evaluate(() => document.querySelector("#tool-style-font-size").value),
      "18 pt",
    );
    const [after] = await fontSize();
    assert.ok(Math.abs(after / before - 18 / 16) < 0.01);
    await b.evaluate(() => {
      document.querySelector('[data-style-tool="text"]').click();
      document.querySelector("[data-tool=select]").click();
      document.querySelector('[data-style-tool="highlight"]').click();
    });
    assert.deepEqual(await menuState(), {
      tool: "highlight",
      selected: null,
      color: "#f1ce54",
    });
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Seitenleiste klappt ohne Dokument und bei einer einzelnen Seite ein",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t);
    const state = () =>
      b.evaluate(() => ({
        hidden: !document.querySelector("#workspace").classList.contains("sidebar-visible"),
        expanded: String(document.querySelector("#workspace").classList.contains("sidebar-reserved")),
      }));
    const closeActive = () =>
      b.evaluate(() =>
        document
          .querySelector("#file-list li.active [data-action=close-document]")
          .click(),
      );
    await openBlankDocument(b);
    assert.deepEqual(await state(), { hidden: true, expanded: "false" });
    await openBlankDocument(b);
    assert.deepEqual(await state(), { hidden: false, expanded: "true" });
    await closeActive();
    await b.wait(() => document.querySelectorAll("#file-list li").length === 1);
    assert.deepEqual(await state(), { hidden: true, expanded: "false" });
    await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 150 });
    assert.deepEqual(await state(), { hidden: false, expanded: "false" });
    await b.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 600, y: 300 });
    await closeActive();
    await b.wait(() => !document.querySelector("#file-list li"));
    assert.deepEqual(await state(), { hidden: true, expanded: "false" });
    await openBlankDocument(b, 3);
    assert.deepEqual(await state(), { hidden: false, expanded: "true" });
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Seite über die Toolbar drehen",
  { timeout: 60000 },
  async (t) => {
    const b = await browser(t);
    assert.equal(
      await b.evaluate(
        () => document.querySelector("#editor-topbar [data-action=rotate-page]").disabled,
      ),
      true,
    );
    await openBlankDocument(b, 2);
    const canvas = () =>
      b.evaluate(() => {
        const canvas = document.querySelector("#page-canvas");
        return canvas.width > canvas.height ? "quer" : "hoch";
      });
    assert.equal(await canvas(), "hoch");
    await b.evaluate(() =>
      document.querySelector("#editor-topbar [data-action=rotate-page]").click(),
    );
    await b.wait(() => {
      const canvas = document.querySelector("#page-canvas");
      return (
        document.querySelector("#page-loading").hidden &&
        canvas.width > canvas.height
      );
    });
    assert.equal(
      await b.evaluate(() => document.querySelector("#undo-button").title),
      "Rückgängig: Seiten drehen (Strg/⌘ Z)",
    );
    await b.evaluate(() => {
      document.querySelector("[data-action=select-none]").click();
      document.querySelector("#editor-topbar [data-action=rotate-page]").click();
    });
    await b.wait(() => {
      const canvas = document.querySelector("#page-canvas");
      return (
        document.querySelector("#page-loading").hidden &&
        canvas.height > canvas.width
      );
    });
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Kommentare setzen, in der Sidebar bearbeiten, erledigen und speichern",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    await openBlankDocument(b);
    const clickPage = async (x, y) => {
      const box = await b.evaluate(() => {
        const rect = document.querySelector("#page-stage").getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      });
      for (const type of ["mousePressed", "mouseReleased"])
        await b.command("Input.dispatchMouseEvent", {
          type,
          x: box.x + x,
          y: box.y + y,
          button: "left",
          clickCount: 1,
        });
    };
    const state = () =>
      b.evaluate(() => ({
        tool: document.querySelector("#page-stage").dataset.tool,
        panel: !document.querySelector("#comments-panel").hidden,
        badge: document.querySelector("#comments-badge").hidden
          ? null
          : document.querySelector("#comments-badge").textContent,
        pins: [...document.querySelectorAll('.annotation[data-type="comment"]')].map(
          (pin) => ({
            title: pin.title,
            done: pin.classList.contains("done"),
            selected: pin.classList.contains("selected"),
          }),
        ),
        cards: [...document.querySelectorAll("#comment-list .comment-card")].map(
          (card) => ({
            text: card.querySelector("textarea").value,
            page: card.querySelector(".comment-page").textContent,
            done: card.classList.contains("done"),
            selected: card.classList.contains("selected"),
          }),
        ),
        focused: document.activeElement?.classList.contains("comment-text"),
      }));
    assert.equal(
      await b.evaluate(() => document.querySelector("#comments-panel").hidden),
      true,
    );
    await b.evaluate(() =>
      document.querySelector('button[data-tool="comment"]').click(),
    );
    assert.match(
      await b.evaluate(
        () =>
          getComputedStyle(document.querySelector("#interaction-layer")).cursor,
      ),
      /^url\("data:image\/svg\+xml,.*"\) 12 12, crosshair$/,
    );
    assert.equal((await state()).panel, true);
    await clickPage(120, 160);
    assert.deepEqual(await state(), {
      tool: "select",
      panel: true,
      badge: "1",
      pins: [{ title: "Leerer Kommentar", done: false, selected: true }],
      cards: [{ text: "", page: "S. 1", done: false, selected: true }],
      focused: true,
    });
    await b.command("Input.insertText", { text: "Bitte Absatz prüfen" });
    await b.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      modifiers: 2,
    });
    let current = await state();
    assert.equal(current.pins[0].title, "Bitte Absatz prüfen");
    assert.equal(current.cards[0].text, "Bitte Absatz prüfen");
    assert.equal(current.focused, false);
    assert.equal(
      await b.evaluate(() => document.querySelector("#undo-button").title),
      "Rückgängig: Kommentar bearbeiten (Strg/⌘ Z)",
    );
    assert.deepEqual(
      await b.evaluate(() => ({
        entries: [...document.querySelectorAll(".annotation-entry")].map(
          (entry) => [
            entry.querySelector(".annotation-name").textContent,
            entry.querySelector(".annotation-page").textContent,
          ],
        ),
        filters: [
          ...document.querySelectorAll("[data-annotation-filter]:not([hidden])"),
        ].map((button) => button.dataset.annotationFilter),
      })),
      {
        entries: [["Bitte Absatz prüfen", "S. 1"]],
        filters: ["all", "comment"],
      },
    );
    await b.evaluate(() => document.querySelector(".comment-done").click());
    current = await state();
    assert.equal(current.badge, null);
    assert.equal(current.pins[0].done, true);
    assert.equal(current.cards[0].done, true);
    await b.evaluate(() => {
      const toggle = document.querySelector("#comments-hide-done");
      toggle.click();
    });
    assert.equal((await state()).cards.length, 0);
    assert.equal(
      await b.evaluate(() => document.querySelector("#comments-empty").textContent.trim()),
      "Alle Kommentare sind erledigt.",
    );
    await b.evaluate(() => {
      document.querySelector("#comments-hide-done").click();
      document.querySelector(".comment-done").click();
    });
    await clickPage(300, 400);
    assert.equal((await state()).pins[0].selected, false);
    await b.evaluate(() => document.querySelector(".comment-card .comment-head").click());
    current = await state();
    assert.equal(current.pins[0].selected, true);
    assert.equal(current.cards[0].selected, true);
    await b.evaluate(() => document.querySelector(".comment-delete").click());
    assert.deepEqual((await state()).pins, []);
    await b.evaluate(() => document.querySelector("[data-action=undo]").click());
    assert.equal((await state()).pins.length, 1);
    await b.evaluate(() =>
      document
        .querySelector("#comments-panel [data-action=toggle-comments]")
        .click(),
    );
    assert.equal((await state()).panel, false);
    await b.evaluate(() =>
      document.querySelector('button[data-tool="comment"]').click(),
    );
    current = await state();
    assert.equal(current.tool, "comment");
    assert.equal(current.panel, true);
    const pageBox = await b.evaluate(() => {
      const rect = document.querySelector("#page-stage").getBoundingClientRect();
      return { x: rect.x + 300, y: rect.y + 300 };
    });
    for (const type of ["mousePressed", "mouseReleased"])
      await b.command("Input.dispatchMouseEvent", {
        type,
        ...pageBox,
        button: "right",
        clickCount: 1,
      });
    current = await state();
    assert.equal(current.tool, "select");
    assert.equal(current.panel, true);
    assert.equal(current.pins.length, 1);
    assert.equal(
      await b.evaluate(() =>
        document.querySelector("#context-menu").matches(":popover-open"),
      ),
      false,
    );
    await b.evaluate(() => {
      document.querySelector('[data-style-tool="comment"]').click();
    });
    assert.deepEqual(
      await b.evaluate(() => ({
        tool: document.querySelector("#page-stage").dataset.tool,
        colors: document.querySelector(".tool-style-colors").hidden,
        font: document.querySelector("#tool-style-font-row").hidden,
        returnChecked: document.querySelector("#tool-style-return").checked,
      })),
      { tool: "comment", colors: true, font: true, returnChecked: true },
    );
    await b.evaluate(() => document.querySelector("#tool-style-return").click());
    await b.evaluate(() =>
      document.querySelector('[data-style-tool="comment"]').click(),
    );
    await clickPage(200, 240);
    current = await state();
    assert.equal(current.tool, "comment");
    assert.equal(current.pins.length, 2);
    await b.evaluate(() => document.querySelector("[data-action=undo]").click());
    await b.evaluate(() => {
      document.querySelector('[data-style-tool="comment"]').click();
      document.querySelector("#tool-style-return").click();
      document.querySelector('[data-style-tool="comment"]').click();
      document.querySelector('button[data-tool="select"]').click();
    });
    current = await state();
    assert.equal(current.tool, "select");
    assert.equal(current.pins.length, 1);
    await b.evaluate(() => {
      document.querySelector(".comment-done").click();
      window.downloads = [];
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.downloads.push(this.href);
      };
      document.querySelector("[data-action=export]").click();
      document.querySelector("#export-form").requestSubmit();
    });
    await b.wait(() => window.downloads?.length === 1);
    await b.evaluate(async () => {
      const blob = await (await fetch(window.downloads[0])).blob();
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([blob], "Wieder.pdf", { type: "application/pdf" }),
      );
      const input = document.querySelector("#file-input");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        document.querySelector("#file-list [aria-current=true]")?.textContent ===
          "Wieder" &&
        document.querySelector("#page-loading").hidden &&
        document.querySelectorAll('.annotation[data-type="comment"]').length === 1,
    );
    current = await state();
    assert.deepEqual(current.cards, [
      { text: "Bitte Absatz prüfen", page: "S. 1", done: true, selected: false },
    ]);
    assert.equal(current.pins[0].done, true);
    assert.deepEqual(b.errors, []);
  },
);
test(
  "Browser: Formulare mit Pflichtfeldern, Tab über Seiten, Zurücksetzen und freien Eingaben",
  { timeout: 120000 },
  async (t) => {
    const b = await browser(t);
    async function press(key, code, windowsVirtualKeyCode, modifiers = 0) {
      for (const type of ["keyDown", "keyUp"])
        await b.command("Input.dispatchKeyEvent", {
          type,
          key,
          code,
          windowsVirtualKeyCode,
          modifiers,
        });
    }
    async function click(selector, index = 0) {
      const point = await b.evaluate(
        ({ selector, index }) => {
          const node = document.querySelectorAll(selector)[index];
          node.scrollIntoView({ block: "nearest", inline: "nearest" });
          const rect = node.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        },
        { selector, index },
      );
      for (const type of ["mousePressed", "mouseReleased"])
        await b.command("Input.dispatchMouseEvent", {
          type,
          ...point,
          button: "left",
          clickCount: 1,
        });
    }
    const field = (name) => `#form-layer [data-field="${name}"]`;
    await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js");
      const lib = await pdfLib();
      const pdf = await lib.PDFDocument.create();
      const first = pdf.addPage([400, 600]),
        second = pdf.addPage([400, 600]);
      const form = pdf.getForm();
      const name = form.createTextField("Name");
      name.enableRequired();
      name.addToPage(first, { x: 30, y: 540, width: 160, height: 24 });
      const secret = form.createTextField("Kennwort");
      secret.enablePassword();
      secret.addToPage(first, { x: 30, y: 500, width: 160, height: 24 });
      const radio = form.createRadioGroup("Ampel");
      radio.addOptionToPage("Rot", first, { x: 30, y: 460, width: 20, height: 20 });
      radio.addOptionToPage("Gruen", first, { x: 80, y: 460, width: 20, height: 20 });
      const country = form.createDropdown("Land");
      country.addOptions(["Deutschland", "Schweiz"]);
      country.enableEditing();
      country.addToPage(first, { x: 30, y: 410, width: 160, height: 24 });
      const city = form.createTextField("Ort");
      city.setText("Berlin");
      city.addToPage(first, { x: 30, y: 370, width: 160, height: 24 });
      form.createTextField("Weiter").addToPage(second, { x: 30, y: 540, width: 160, height: 24 });
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([await pdf.save()], "Verhalten.pdf", { type: "application/pdf" }),
      );
      const input = document.querySelector("#file-input");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    });
    await b.wait(
      () =>
        document.querySelectorAll("#form-layer [data-field]").length === 6 &&
        document.querySelector("#page-loading").hidden,
    );
    assert.deepEqual(
      await b.evaluate(() => ({
        order: [...document.querySelectorAll("#form-layer [data-field]")].map(
          (input) => input.dataset.field,
        ),
        password: document.querySelector('[data-field="Kennwort"]').type,
        list: !!document.querySelector('[data-field="Land"]').list,
        missing: document
          .querySelector('[data-field="Name"]')
          .classList.contains("field-missing"),
        tint: getComputedStyle(document.querySelector('[data-field="Ort"]'))
          .backgroundImage,
      })),
      {
        order: ["Name", "Kennwort", "Ampel", "Ampel", "Land", "Ort"],
        password: "password",
        list: true,
        missing: true,
        tint: "linear-gradient(rgba(90, 169, 240, 0.12), rgba(90, 169, 240, 0.12))",
      },
    );
    await click(field("Ampel"));
    assert.equal(await b.evaluate(() => document.querySelector('[data-field="Ampel"]').checked), true);
    await click(field("Ampel"));
    assert.equal(await b.evaluate(() => document.querySelector('[data-field="Ampel"]').checked), false);
    await b.evaluate(() => {
      for (const [name, value] of [
        ["Land", "Freiland"],
        ["Ort", "Hamburg"],
      ]) {
        const input = document.querySelector(`[data-field="${name}"]`);
        input.value = value;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const fitted = await b.evaluate(() => {
      const input = document.querySelector('[data-field="Ort"]'),
        size = () => parseFloat(input.style.fontSize);
      const before = size();
      input.value = "Ein sehr langer Ortsname, der nicht in das Feld passt";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const shrunk = size();
      input.value = "Hamburg";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return { shrunk: shrunk < before, restored: size() === before };
    });
    assert.deepEqual(fitted, { shrunk: true, restored: true });
    await click(field("Ort"));
    await press("Tab", "Tab", 9);
    await b.wait(
      () =>
        document.querySelector("#current-page").value === "2" &&
        document.activeElement?.dataset.field === "Weiter",
    );
    await press("Tab", "Tab", 9, 8);
    await b.wait(
      () =>
        document.querySelector("#current-page").value === "1" &&
        document.activeElement?.dataset.field === "Ort",
    );
    await b.evaluate(() => {
      const input = document.querySelector('[data-field="Ort"]'),
        rect = input.getBoundingClientRect();
      input.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: rect.x + 4,
          clientY: rect.y + 4,
        }),
      );
      [...document.querySelectorAll("#context-menu button")]
        .find((button) => button.textContent === "Formular zurücksetzen")
        .click();
    });
    await b.wait(
      () =>
        document.querySelector('[data-field="Ort"]').value === "Berlin" &&
        document.querySelector('[data-field="Land"]').value === "",
    );
    await b.evaluate(() => document.querySelector("#undo-button").click());
    await b.wait(
      () =>
        document.querySelector('[data-field="Ort"]').value === "Hamburg" &&
        document.querySelector('[data-field="Land"]').value === "Freiland",
    );
    await b.evaluate(() => document.querySelector("[data-action=export]").click());
    await b.wait(() => document.querySelector("#confirm-dialog").open);
    assert.equal(
      await b.evaluate(() => document.querySelector("#confirm-message").textContent),
      "Ein Pflichtfeld ist noch leer.",
    );
    await b.evaluate(() =>
      document.querySelector('#confirm-dialog [value="cancel"]').click(),
    );
    await b.wait(
      () =>
        !document.querySelector("#confirm-dialog").open &&
        document.activeElement?.dataset.field === "Name",
    );
    await b.evaluate(() => {
      const input = document.querySelector('[data-field="Name"]');
      input.value = "Erika";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      window.downloads = [];
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.downloads.push(this.href);
      };
      document.querySelector("[data-action=export]").click();
      document.querySelector("#export-form").requestSubmit();
    });
    assert.equal(await b.evaluate(() => document.querySelector('[data-field="Name"]').classList.contains("field-missing")), false);
    await b.wait(() => window.downloads?.length === 1);
    const values = await b.evaluate(async () => {
      const { pdfLib } = await import("./src/pdf/vendors.js");
      const lib = await pdfLib();
      const form = (
        await lib.PDFDocument.load(
          new Uint8Array(await (await fetch(window.downloads[0])).arrayBuffer()),
        )
      ).getForm();
      const find = (name) =>
        form.getFields().find((entry) => entry.getName().split(".").at(-1) === name);
      return {
        name: find("Name").getText(),
        city: find("Ort").getText(),
        country: find("Land").acroField.getValues().map((value) => value.decodeText()),
        radio: find("Ampel").getSelected() ?? null,
      };
    });
    assert.deepEqual(values, {
      name: "Erika",
      city: "Hamburg",
      country: ["Freiland"],
      radio: null,
    });
    assert.deepEqual(b.errors, []);
  },
);
