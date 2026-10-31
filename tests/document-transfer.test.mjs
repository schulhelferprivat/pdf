import test from "node:test";
import assert from "node:assert/strict";
import { createDocument, createPage, edit, undo, limits } from "../src/core/model.js";
import { packDocument, unpackDocument, validateDocumentPackage } from "../src/core/document-transfer.js";
import { parseDocumentDrag, setupWindowTransfer } from "../src/core/window-transfer.js";

function fixture() {
  const sources = new Map(["source-a", "source-b"].map((id) => [id, {
    id, file: new File(["%PDF-1.7"], `${id}.pdf`, { type: "application/pdf" }), password: "", fingerprint: id, handle: null,
  }]));
  const assets = new Map([["image-a", { file: new File(["image"], "bild.png", { type: "image/png" }), mime: "image/png", url: "blob:old-window", bitmap: {} }]]);
  const pages = [...sources.keys()].map((id) => createPage(id, 0, { width: 595, height: 842 }, "form-group"));
  const doc = createDocument("Dokument", pages);
  doc.origin = "source-a";
  edit(doc, "Bild hinzufügen", () => {
    doc.pages[1].elements.push({ id: "image-element", type: "image", assetId: "image-a" });
    doc.formValues["form-group:Feld"] = "Testwert";
  });
  edit(doc, "Seite entfernen", () => { doc.pages.pop(); });
  undo(doc);
  undo(doc);
  return { doc, sources, assets };
}

test("Dokumentpakete erhalten Historie, Formulare und sämtliche Quellen und Bilder", () => {
  const { doc, sources, assets } = fixture();
  const packet = packDocument(doc, sources, assets);
  assert.equal(packet.sources.length, 2);
  assert.equal(packet.assets.length, 1);
  assert.ok(!("url" in packet.assets[0]));
  assert.ok(!("bitmap" in packet.assets[0]));
  const restored = unpackDocument(structuredClone(packet), new Map(), new Map());
  try {
    assert.equal(restored.document.id, doc.id);
    assert.equal(restored.document.current, doc.current);
    assert.deepEqual(restored.document.selected, doc.selected);
    assert.equal(restored.document.dirty, doc.dirty);
    assert.equal(restored.document.history.future.length, 2);
    assert.notEqual(restored.document.origin, doc.origin);
    assert.equal(restored.document.history.future[0].state.formValues["form-group:Feld"], "Testwert");
    const image = restored.document.history.future.at(-1).state.pages[1].elements[0];
    assert.ok(restored.assets.has(image.assetId));
    assert.notEqual(image.assetId, "image-a");
    for (const state of [restored.document, ...restored.document.history.future.map((entry) => entry.state)])
      for (const page of state.pages) assert.ok(restored.sources.has(page.sourceId));
    assert.equal(doc.pages[0].sourceId, "source-a");
  } finally {
    for (const asset of restored.assets.values()) URL.revokeObjectURL(asset.url);
  }
});

test("Dokumentpakete weisen falsche Versionen, fehlende Ressourcen und Grenzüberschreitungen zurück", () => {
  const { doc, sources, assets } = fixture();
  const packet = packDocument(doc, sources, assets);
  assert.throws(() => validateDocumentPackage({ ...packet, version: 0 }), /kompatibel/);
  assert.throws(() => validateDocumentPackage({ ...packet, sources: [] }), /ungültig/);
  assert.throws(() => validateDocumentPackage({ ...packet, assets: [] }), /ungültig/);
  const oversized = structuredClone(packet);
  oversized.document.pages = Array.from({ length: limits.pages + 1 }, () => structuredClone(doc.pages[0]));
  assert.throws(() => validateDocumentPackage(oversized), /ungültig/);
  assert.throws(() => validateDocumentPackage(packet, new Map([["existing", { file: { size: limits.totalBytes } }]])), /150 MiB/);
  assert.throws(() => packDocument({ ...doc, kind: "epub" }, sources, assets), /Nur PDFs/);
});

class TestChannel extends EventTarget {
  constructor(peers) {
    super();
    this.peers = peers;
    peers.add(this);
    this.sent = [];
  }
  postMessage(data) {
    const copy = structuredClone(data);
    this.sent.push(copy);
    for (const peer of this.peers)
      if (peer !== this) queueMicrotask(() => peer.dispatchEvent(new MessageEvent("message", { data: copy })));
  }
  close() { this.peers.delete(this); }
}

function connection(t, options = {}) {
  const peers = new Set(), sourceChannel = new TestChannel(peers), targetChannel = new TestChannel(peers);
  const state = { sourceLocked: false, targetLocked: false, released: 0, committed: 0, rolledBack: 0, errors: [] };
  const source = setupWindowTransfer({
    channel: sourceChannel,
    prepare: options.prepare || (() => ({ document: { id: "document-a" } })),
    release: () => { state.released++; },
    lock: (value) => { state.sourceLocked = value; },
    report: (error) => state.errors.push(error.message),
    timeout: options.timeout || 1000,
  });
  const target = setupWindowTransfer({
    channel: targetChannel,
    receive: options.receive || (async () => ({ commit: () => { state.committed++; }, rollback: () => { state.rolledBack++; } })),
    lock: (value) => { state.targetLocked = value; },
    report: (error) => state.errors.push(error.message),
    timeout: options.timeout || 1000,
  });
  t.after(() => { source.close(); target.close(); });
  return { source, target, state, sourceChannel, targetChannel };
}

test("Fensterübergabe entfernt das Original erst nach Bestätigung und übernimmt es genau einmal", async (t) => {
  const { source, target, state, sourceChannel, targetChannel } = connection(t);
  const data = source.offer("document-a");
  assert.deepEqual(parseDocumentDrag(JSON.stringify(data)), data);
  assert.equal(parseDocumentDrag("document-a"), null);
  assert.equal(parseDocumentDrag(JSON.stringify({ ...data, version: 0 })), null);
  await target.request(data, { target: null, after: true });
  assert.deepEqual(state, { sourceLocked: false, targetLocked: false, released: 1, committed: 1, rolledBack: 0, errors: [] });
  for (const message of [...sourceChannel.sent, ...targetChannel.sent]) {
    sourceChannel.dispatchEvent(new MessageEvent("message", { data: message }));
    targetChannel.dispatchEvent(new MessageEvent("message", { data: message }));
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.released, 1);
  assert.equal(state.committed, 1);
  await assert.rejects(target.request(data), /derzeit/);
});

test("Fehler beim Klonen oder Übernehmen erhalten das Original und entsperren beide Fenster", async (t) => {
  for (const options of [
    { prepare: () => ({ document: { id: "document-a" }, invalid: () => {} }) },
    { receive: async () => { throw new Error("Ungültige PDF"); } },
    { prepare: () => ({ document: { id: "another-document" } }) },
  ]) {
    const { source, target, state } = connection(t, options);
    await assert.rejects(target.request(source.offer("document-a")));
    assert.equal(state.released, 0);
    assert.equal(state.committed, 0);
    assert.equal(state.sourceLocked, false);
    assert.equal(state.targetLocked, false);
  }
});

test("Zeitüberschreitung verwirft verspätete Übernahmen und erhält das Original", async (t) => {
  let finish, rolledBack = 0;
  const { source, target, state } = connection(t, {
    timeout: 30,
    receive: () => new Promise((resolve) => { finish = resolve; }),
  });
  await assert.rejects(target.request(source.offer("document-a")), /rechtzeitig/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.released, 0);
  assert.equal(state.sourceLocked, false);
  assert.equal(state.targetLocked, false);
  finish({ commit: () => assert.fail("Verspätete Übernahme"), rollback: () => { rolledBack++; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rolledBack, 1);
});

test("Geschlossenes Zielfenster bricht die Übergabe ab und erhält das Original", async (t) => {
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const { source, target, state } = connection(t, { receive: () => { started(); return new Promise(() => {}); } });
  const pending = target.request(source.offer("document-a"));
  await ready;
  target.close();
  await assert.rejects(pending, /geschlossen/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.released, 0);
  assert.equal(state.sourceLocked, false);
  assert.equal(state.targetLocked, false);
});

test("Verlorene Bestätigung verwirft keine bereits übernommene Kopie", async (t) => {
  const { source, target, state, targetChannel } = connection(t, { timeout: 30 });
  const postMessage = targetChannel.postMessage.bind(targetChannel);
  targetChannel.postMessage = (data) => { if (data.type !== "accepted") postMessage(data); };
  await assert.rejects(target.request(source.offer("document-a")), /rechtzeitig/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.released, 0);
  assert.equal(state.committed, 1);
  assert.equal(state.rolledBack, 0);
  assert.equal(state.sourceLocked, false);
  assert.equal(state.targetLocked, false);
});
