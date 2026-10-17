const databaseName = "pdfhelper";
const storeName = "recent-files";
const limit = 10;
export const recentSupported = () =>
  typeof window.showOpenFilePicker === "function" &&
  typeof indexedDB !== "undefined";
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(storeName, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction(mode, run) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      const request = run(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    database.close();
  }
}
export async function recentFiles() {
  const entries = await transaction("readonly", (store) => store.getAll());
  return entries.sort((a, b) => b.openedAt - a.openedAt);
}
export async function rememberFile(handle) {
  const entries = await recentFiles();
  const kept = [];
  for (const entry of entries)
    if (!(await entry.handle.isSameEntry(handle).catch(() => false)))
      kept.push(entry);
  const removed = entries.filter(
    (entry) => !kept.slice(0, limit - 1).includes(entry),
  );
  await transaction("readwrite", (store) => {
    for (const entry of removed) store.delete(entry.id);
    store.put({
      id: crypto.randomUUID(),
      name: handle.name,
      handle,
      openedAt: Date.now(),
    });
  });
}
export async function forgetFile(id) {
  await transaction("readwrite", (store) => store.delete(id));
}
export async function clearRecentFiles() {
  await transaction("readwrite", (store) => store.clear());
}
export async function readRecentFile(entry) {
  const options = { mode: "read" };
  if (
    (await entry.handle.queryPermission(options)) !== "granted" &&
    (await entry.handle.requestPermission(options)) !== "granted"
  )
    throw new Error("Der Zugriff auf die Datei wurde nicht erlaubt.");
  try {
    return await entry.handle.getFile();
  } catch {
    await forgetFile(entry.id);
    throw new Error(
      `${entry.name} wurde nicht gefunden und aus der Liste entfernt.`,
    );
  }
}
export async function recentIdsFor(handle) {
  const ids = [];
  for (const entry of await recentFiles())
    if (await entry.handle.isSameEntry(handle).catch(() => false))
      ids.push(entry.id);
  return ids;
}
export async function updateRecent(ids, handle) {
  const entries = (await recentFiles()).filter((entry) =>
    ids.includes(entry.id),
  );
  await transaction("readwrite", (store) => {
    for (const entry of entries)
      store.put({ ...entry, name: handle.name, handle });
  });
}
