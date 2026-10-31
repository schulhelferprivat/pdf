import { historyLimit, limits, uid } from "./model.js";

export const documentTransferVersion = 1;

function states(doc) {
  return [doc, ...doc.history.past.map((entry) => entry.state), ...doc.history.future.map((entry) => entry.state)];
}

function references(doc) {
  const sources = new Set(), assets = new Set();
  for (const state of states(doc))
    for (const page of state.pages) {
      if (page.sourceId) sources.add(page.sourceId);
      for (const element of page.elements)
        if (element.type === "image") assets.add(element.assetId);
    }
  return { sources, assets };
}

export function packDocument(doc, sources, assets) {
  if (doc.kind !== "pdf") throw new Error("Nur PDFs können zwischen Fenstern verschoben werden.");
  const refs = references(doc);
  if (sources.has(doc.origin)) refs.sources.add(doc.origin);
  return {
    version: documentTransferVersion,
    document: structuredClone(doc),
    sources: [...refs.sources].map((id) => {
      const source = sources.get(id);
      if (!source) throw new Error("Eine PDF-Quelle fehlt.");
      const { file, password, fingerprint, handle } = source;
      return { id, file, password, fingerprint, handle };
    }),
    assets: [...refs.assets].map((id) => {
      const asset = assets.get(id);
      if (!asset) throw new Error("Ein Bild fehlt.");
      return { id, file: asset.file, mime: asset.mime };
    }),
  };
}

export function validateDocumentPackage(packet, sources = new Map(), assets = new Map()) {
  const invalid = () => { throw new Error("Das Dokumentpaket ist ungültig oder nicht kompatibel."); };
  if (packet?.version !== documentTransferVersion) invalid();
  const doc = packet.document;
  if (!doc || doc.kind !== "pdf" || typeof doc.id !== "string" || !doc.id || typeof doc.name !== "string" ||
      !Array.isArray(doc.history?.past) || !Array.isArray(doc.history?.future) ||
      doc.history.past.length + doc.history.future.length > historyLimit ||
      !Array.isArray(packet.sources) || !Array.isArray(packet.assets)) invalid();
  for (const state of states(doc)) {
    if (!state || !Array.isArray(state.pages) || state.pages.length > limits.pages ||
        !Array.isArray(state.selected) || !Array.isArray(state.groups) ||
        !state.formValues || typeof state.formValues !== "object") invalid();
    const ids = new Set();
    for (const page of state.pages) {
      if (!page || typeof page.id !== "string" || ids.has(page.id) || !Array.isArray(page.elements) ||
          !page.elements.every((element) => element && typeof element.type === "string") ||
          (page.sourceId && (!Number.isInteger(page.index) || page.index < 0)) ||
          !Number.isFinite(page.width) || page.width <= 0 || !Number.isFinite(page.height) || page.height <= 0) invalid();
      ids.add(page.id);
    }
    if ((state.current !== null && !ids.has(state.current)) || state.selected.some((id) => !ids.has(id)) ||
        state.groups.some((group) => !Array.isArray(group) || group.some((id) => !ids.has(id)))) invalid();
  }
  const refs = references(doc), sourceIds = new Set(), assetIds = new Set();
  let bytes = [...sources.values(), ...assets.values()].reduce((sum, entry) => sum + entry.file.size, 0);
  for (const [entries, ids, limit] of [[packet.sources, sourceIds, limits.pdfBytes], [packet.assets, assetIds, limits.imageBytes]])
    for (const entry of entries) {
      if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) ||
          !(entry.file instanceof Blob) || !entry.file.size || entry.file.size > limit) invalid();
      ids.add(entry.id);
      bytes += entry.file.size;
    }
  if ([...refs.sources].some((id) => !sourceIds.has(id)) || [...refs.assets].some((id) => !assetIds.has(id))) invalid();
  for (const source of packet.sources)
    if (typeof source.password !== "string" || (source.handle && source.handle.kind !== "file")) invalid();
  for (const asset of packet.assets)
    if (!["image/png", "image/jpeg", "image/webp"].includes(asset.mime)) invalid();
  if (bytes > limits.totalBytes) throw new Error("Die geöffneten Quelldateien und Bilder wären zusammen größer als 150 MiB.");
  return packet;
}

export function unpackDocument(packet, sources, assets) {
  validateDocumentPackage(packet, sources, assets);
  const doc = structuredClone(packet.document), sourceIds = new Map(), assetIds = new Map();
  const nextSources = new Map(packet.sources.map((source) => {
    const id = uid();
    sourceIds.set(source.id, id);
    return [id, { ...source, id }];
  }));
  const nextAssets = new Map(packet.assets.map((asset) => {
    const id = uid();
    assetIds.set(asset.id, id);
    return [id, { ...asset, id, url: URL.createObjectURL(asset.file) }];
  }));
  doc.origin = sourceIds.get(doc.origin);
  for (const state of states(doc))
    for (const page of state.pages) {
      if (page.sourceId) page.sourceId = sourceIds.get(page.sourceId);
      for (const element of page.elements)
        if (element.type === "image") element.assetId = assetIds.get(element.assetId);
    }
  return { document: doc, sources: nextSources, assets: nextAssets };
}
