import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";

async function openRenameDocument(b, scenario) {
  await b.evaluate(async (scenario) => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib();
    const pdf = await lib.PDFDocument.create();
    pdf.addPage([400, 600]).drawText("Umbenennen testen", { x: 20, y: 550 });
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("Original.pdf", { create: true });
    const stream = await handle.createWritable();
    await stream.write(await pdf.save());
    await stream.close();
    window.renamePermission = scenario === "delayed" || scenario === "denied" ? "prompt" : "granted";
    window.renamePermissionRequests = [];
    window.renameMoves = [];
    window.renamePicks = [];
    window.renameRoot = root;
    window.renameHandle = handle;
    window.renameDirectory = root;
    const move = handle.move.bind(handle);
    handle.queryPermission = async () => window.renamePermission;
    handle.requestPermission = async (options) => {
      window.renamePermissionRequests.push({ mode: options.mode, active: navigator.userActivation.isActive });
      if (scenario === "delayed") await new Promise((resolve) => setTimeout(resolve, 5500));
      window.renamePermission = scenario === "denied" ? "denied" : "granted";
      return window.renamePermission;
    };
    handle.move = async (destination, name) => {
      const directory = typeof destination !== "string";
      window.renameMoves.push({ directory, name: directory ? name : destination, active: navigator.userActivation.isActive });
      if ((!directory && scenario !== "delayed") || !navigator.userActivation.isActive)
        throw new DOMException("Umbenennen erfordert Ordnerzugriff oder einen direkten Klick.", "NotAllowedError");
      return directory ? move(destination, name) : move(destination);
    };
    window.showOpenFilePicker = async () => [handle];
    window.showDirectoryPicker = async (options) => {
      window.renamePicks.push({ mode: options.mode, startIn: options.startIn === handle, active: navigator.userActivation.isActive });
      if (window.abortRenamePicker) throw new DOMException("Abgebrochen", "AbortError");
      return window.renameDirectory;
    };
    document.querySelector('[data-action="open"]').click();
  }, scenario);
  await b.wait(() => document.querySelector("#document-title .document-title-name")?.textContent === "Original" && document.querySelector("#page-loading").hidden);
}

async function enterName(b, name) {
  await b.evaluate(() => {
    if (!document.querySelector(".name-editor"))
      document.querySelector("#document-title").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = document.querySelector(".name-editor");
    input.focus();
    input.select();
  });
  await b.command("Input.insertText", { text: name });
  for (const type of ["keyDown", "keyUp"])
    await b.command("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

async function confirmRename(b, value = "yes") {
  await b.wait(() => document.querySelector("#confirm-dialog").open);
  const point = await b.evaluate((value) => {
    const button = document.querySelector(`#confirm-dialog [value="${value}"]`);
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, value);
  for (const type of ["mousePressed", "mouseReleased"])
    await b.command("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
}

test("Browser: Umbenennen per Enter funktioniert nach einer langen Schreibfreigabe", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openRenameDocument(b, "delayed");
  await enterName(b, "Umbenannt");
  await b.wait(() => document.querySelector("#confirm-dialog").open);
  assert.deepEqual(await b.evaluate(() => ({
    requests: window.renamePermissionRequests,
    moves: window.renameMoves,
    title: document.querySelector("#confirm-title").textContent,
    editor: document.querySelector(".name-editor").value,
  })), {
    requests: [{ mode: "readwrite", active: true }],
    moves: [{ directory: false, name: "Umbenannt.pdf", active: false }],
    title: "Datei umbenennen",
    editor: "Umbenannt",
  });
  await confirmRename(b);
  await b.wait(() => document.querySelector("#document-title .document-title-name")?.textContent === "Umbenannt" && !document.querySelector(".name-editor"));
  assert.deepEqual(await b.evaluate(async () => ({
    names: [...await Array.fromAsync((await navigator.storage.getDirectory()).keys())],
    moves: window.renameMoves,
    picks: window.renamePicks.length,
    requests: window.renamePermissionRequests.length,
  })), {
    names: ["Umbenannt.pdf"],
    moves: [
      { directory: false, name: "Umbenannt.pdf", active: false },
      { directory: false, name: "Umbenannt.pdf", active: true },
    ],
    picks: 0,
    requests: 1,
  });
  await b.evaluate(() => document.querySelector('[data-action="save"]').click());
  await b.wait(() => document.querySelector("#toast").textContent === "Gespeichert: Umbenannt.pdf");
  assert.deepEqual(b.errors, []);
});

test("Browser: Umbenennen mit Ordnerfreigabe prüft den Ordner und schützt vorhandene Dateien", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openRenameDocument(b, "parent");
  await b.evaluate(async () => {
    window.renameDirectory = await window.renameRoot.getDirectoryHandle("AndererOrdner", { create: true });
  });
  await enterName(b, "Umbenannt");
  await b.wait(() => document.querySelector("#confirm-title").textContent === "Ordner für das Umbenennen freigeben");
  await confirmRename(b);
  await b.wait(() => !document.querySelector(".name-editor").disabled);
  assert.deepEqual(await b.evaluate(() => ({
    name: window.renameHandle.name,
    editor: document.querySelector(".name-editor").value,
    directoryMoves: window.renameMoves.filter((move) => move.directory).length,
    message: document.querySelector("#toast").textContent.includes("Ordner auswählen, in dem die Datei liegt"),
  })), { name: "Original.pdf", editor: "Umbenannt", directoryMoves: 0, message: true });
  await b.evaluate(async () => {
    window.renameDirectory = window.renameRoot;
    const conflict = await window.renameRoot.getFileHandle("Umbenannt.pdf", { create: true });
    const stream = await conflict.createWritable();
    await stream.write("Synthetischer vorhandener Inhalt");
    await stream.close();
  });
  await enterName(b, "Umbenannt");
  await confirmRename(b);
  await b.wait(() => !document.querySelector(".name-editor").disabled);
  assert.deepEqual(await b.evaluate(async () => ({
    name: window.renameHandle.name,
    content: await (await (await window.renameRoot.getFileHandle("Umbenannt.pdf")).getFile()).text(),
    directoryMoves: window.renameMoves.filter((move) => move.directory).length,
    conflict: document.querySelector("#toast").textContent.includes("bereits eine Datei mit diesem Namen"),
  })), { name: "Original.pdf", content: "Synthetischer vorhandener Inhalt", directoryMoves: 0, conflict: true });
  await b.evaluate(async () => {
    await window.renameRoot.removeEntry("Umbenannt.pdf");
    window.abortRenamePicker = true;
  });
  await enterName(b, "Umbenannt");
  await confirmRename(b);
  await b.wait(() => !document.querySelector(".name-editor").disabled);
  assert.equal(await b.evaluate(() => window.renameHandle.name), "Original.pdf");
  await b.evaluate(() => { window.abortRenamePicker = false; });
  await enterName(b, "Umbenannt");
  await confirmRename(b);
  await b.wait(() => document.querySelector("#document-title .document-title-name")?.textContent === "Umbenannt" && !document.querySelector(".name-editor"));
  assert.deepEqual(await b.evaluate(async () => ({
    names: (await Array.fromAsync(window.renameRoot.keys())).sort(),
    picks: window.renamePicks,
    directoryMoves: window.renameMoves.filter((move) => move.directory).length,
    requests: window.renamePermissionRequests.length,
    bytes: (await window.renameHandle.getFile()).size > 0,
  })), {
    names: ["AndererOrdner", "Umbenannt.pdf"],
    picks: Array.from({ length: 4 }, () => ({ mode: "readwrite", startIn: true, active: true })),
    directoryMoves: 1,
    requests: 0,
    bytes: true,
  });
  await b.wait(async () => {
    const { recentFiles } = await import("./src/core/recent.js");
    return (await recentFiles()).some((entry) => entry.name === "Umbenannt.pdf");
  });
  assert.deepEqual(b.errors, []);
});

test("Browser: Abgelehnte und unzureichende Schreibrechte behalten den eingegebenen Namen", { timeout: 60000 }, async (t) => {
  const b = await browser(t);
  await openRenameDocument(b, "denied");
  await enterName(b, "Umbenannt");
  await b.wait(() => !document.querySelector(".name-editor").disabled);
  assert.deepEqual(await b.evaluate(() => ({
    name: window.renameHandle.name,
    input: document.querySelector(".name-editor").value,
    moves: window.renameMoves.length,
    permissionError: document.querySelector("#toast").textContent.includes("keine Schreibberechtigung"),
  })), { name: "Original.pdf", input: "Umbenannt", moves: 0, permissionError: true });
  await b.evaluate(() => {
    window.renamePermission = "granted";
    delete window.showDirectoryPicker;
  });
  await enterName(b, "Umbenannt");
  await b.wait(() => !document.querySelector(".name-editor").disabled);
  assert.deepEqual(await b.evaluate(() => ({
    name: window.renameHandle.name,
    input: document.querySelector(".name-editor").value,
    permissionGranted: document.querySelector("#toast").textContent.includes("Schreibberechtigung ist erteilt"),
    asksForPermissionAgain: document.querySelector("#toast").textContent.includes("Schreibberechtigung erlauben"),
  })), { name: "Original.pdf", input: "Umbenannt", permissionGranted: true, asksForPermissionAgain: false });
  assert.deepEqual(b.errors, []);
});
