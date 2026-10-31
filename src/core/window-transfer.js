import { documentTransferVersion } from "./document-transfer.js";

export const documentDragType = "application/x-pdfhelper-document";
const transferTimeout = 30000;

export function parseDocumentDrag(value) {
  try {
    const data = JSON.parse(value);
    if (data?.version === documentTransferVersion &&
        [data.windowId, data.documentId, data.transferId].every((id) => typeof id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(id))) return data;
  } catch {}
  return null;
}

export function setupWindowTransfer({ channel, prepare, receive, release, lock, report, timeout = transferTimeout }) {
  const windowId = crypto.randomUUID(), outgoing = new Map(), incoming = new Map(), finished = new Set();
  let closed = false;

  function send(type, to, transferId, data = {}) {
    if (closed) throw new Error("Die Fensterverbindung wurde geschlossen.");
    channel.postMessage({ version: documentTransferVersion, type, from: windowId, to, transferId, ...data });
  }

  function remember(id) {
    finished.add(id);
    if (finished.size > 200) finished.delete(finished.values().next().value);
  }

  function cleanup(map, id) {
    const entry = map.get(id);
    if (!entry) return;
    map.delete(id);
    clearTimeout(entry.timer);
    remember(id);
    if (entry.locked) lock(false);
  }

  function fail(map, id, error, notify = true) {
    const entry = map.get(id);
    if (!entry) return;
    entry.controller?.abort();
    entry.rollback?.();
    if (notify && entry.peer) {
      try { send("cancel", entry.peer, id, { message: error.message }); } catch {}
    }
    cleanup(map, id);
    entry.reject?.(error);
    if (map === outgoing && entry.locked) report(error);
  }

  function timer(map, id) {
    return setTimeout(() => fail(map, id, new Error("Die Übergabe wurde nicht rechtzeitig bestätigt. Das PDF bleibt im Ausgangsfenster.")), timeout);
  }

  function offer(documentId) {
    const data = { version: documentTransferVersion, windowId, documentId, transferId: crypto.randomUUID() };
    outgoing.set(data.transferId, { data, timer: setTimeout(() => cleanup(outgoing, data.transferId), timeout), locked: false });
    return data;
  }

  function withdraw(data) {
    if (!outgoing.get(data?.transferId)?.locked) cleanup(outgoing, data?.transferId);
  }

  function request(data, position) {
    if (closed || !data || data.windowId === windowId || incoming.size || [...outgoing.values()].some((entry) => entry.locked) || finished.has(data.transferId))
      return Promise.reject(new Error("Die Dokumentübergabe ist derzeit nicht möglich."));
    return new Promise((resolve, reject) => {
      const entry = { peer: data.windowId, documentId: data.documentId, position, resolve, reject, controller: new AbortController(), locked: false };
      incoming.set(data.transferId, entry);
      entry.timer = timer(incoming, data.transferId);
      try {
        lock(true);
        entry.locked = true;
        send("request", entry.peer, data.transferId, { documentId: data.documentId });
      } catch (error) { fail(incoming, data.transferId, error); }
    });
  }

  async function message({ data }) {
    if (closed || data?.version !== documentTransferVersion || data.to !== windowId || typeof data.from !== "string" || typeof data.transferId !== "string") return;
    const id = data.transferId;
    try {
      if (data.type === "request") {
        const entry = outgoing.get(id);
        if (!entry || entry.locked || entry.data.documentId !== data.documentId || finished.has(id)) return;
        entry.peer = data.from;
        if (incoming.size || [...outgoing.values()].some((other) => other.locked)) throw new Error("Eine andere Dokumentübergabe läuft bereits.");
        lock(true);
        entry.locked = true;
        entry.phase = "preparing";
        entry.controller = new AbortController();
        clearTimeout(entry.timer);
        entry.timer = timer(outgoing, id);
        const packet = await prepare(data.documentId, entry.controller.signal);
        if (outgoing.get(id) === entry) {
          entry.phase = "offered";
          send("packet", entry.peer, id, { packet });
        }
      } else if (data.type === "packet") {
        const entry = incoming.get(id);
        if (!entry || entry.peer !== data.from || entry.receiving) return;
        entry.receiving = true;
        if (data.packet?.document?.id !== entry.documentId) throw new Error("Das angeforderte PDF stimmt nicht mit der Übergabe überein.");
        const result = await receive(data.packet, entry.position, entry.controller.signal);
        if (incoming.get(id) !== entry) { result.rollback(); return; }
        entry.rollback = result.rollback;
        entry.commit = result.commit;
        send("ready", entry.peer, id);
      } else if (data.type === "ready") {
        const entry = outgoing.get(id);
        if (entry?.phase !== "offered" || entry.peer !== data.from) return;
        entry.phase = "committing";
        send("commit", entry.peer, id);
      } else if (data.type === "commit") {
        const entry = incoming.get(id);
        if (!entry?.commit || entry.committed || entry.peer !== data.from) return;
        entry.commit();
        entry.committed = true;
        entry.rollback = null;
        send("accepted", entry.peer, id);
      } else if (data.type === "accepted") {
        const entry = outgoing.get(id);
        if (entry?.phase !== "committing" || entry.peer !== data.from) return;
        send("complete", entry.peer, id);
        release(entry.data.documentId);
        cleanup(outgoing, id);
      } else if (data.type === "complete") {
        const entry = incoming.get(id);
        if (!entry?.committed || entry.peer !== data.from) return;
        cleanup(incoming, id);
        entry.resolve();
      } else if (data.type === "cancel") {
        const error = new Error(typeof data.message === "string" ? data.message : "Die Übergabe wurde abgebrochen.");
        for (const map of [incoming, outgoing])
          if (map.get(id)?.peer === data.from) fail(map, id, error, false);
      }
    } catch (error) {
      for (const map of [incoming, outgoing])
        if (map.get(id)?.peer === data.from) fail(map, id, error);
    }
  }

  channel.addEventListener("message", message);
  return {
    windowId, offer, withdraw, request,
    cancel(data) {
      fail(outgoing, data?.transferId, new Error("Das Zielfenster wurde geschlossen oder hat die Übergabe nicht bestätigt."));
    },
    isClaimed: (data) => outgoing.get(data?.transferId)?.locked || finished.has(data?.transferId),
    close() {
      for (const map of [incoming, outgoing])
        for (const id of [...map.keys()]) fail(map, id, new Error("Das andere PDFHelper-Fenster wurde geschlossen."));
      closed = true;
      channel.removeEventListener("message", message);
      channel.close();
    },
  };
}
