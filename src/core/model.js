export const limits = Object.freeze({
  pdfBytes: 100 * 1024 ** 2,
  totalBytes: 150 * 1024 ** 2,
  pages: 500,
  imageBytes: 25 * 1024 ** 2,
  imagePixels: 48 * 1024 ** 2,
});
export const historyLimit = 100;
export const uid = () => crypto.randomUUID();
export const normalizeAngle = (value) => ((value % 360) + 360) % 360;
export const clone = (value) => structuredClone(value);
export const fieldKey = (page, name) => `${page.formGroup}:${name}`;
export function createDocument(name, pages = []) {
  return {
    id: uid(),
    kind: "pdf",
    originalType: "application/pdf",
    extension: ".pdf",
    name: name.replace(/\.pdf$/i, ""),
    pages,
    formValues: {},
    dirty: false,
    history: { past: [], future: [] },
    selected: pages.slice(0, 1).map((page) => page.id),
    current: pages[0]?.id ?? null,
    groups: [],
    revision: 0,
  };
}
export function createPage(sourceId, index, info, formGroup) {
  const { elements = [], ...rest } = info;
  return {
    id: uid(),
    sourceId,
    index,
    formGroup,
    ...clone(rest),
    rotation: 0,
    elements: elements.map((element) => ({ ...clone(element), id: uid() })),
  };
}
export function displayedSize(page) {
  const width = page.crop?.width ?? page.width;
  const height = page.crop?.height ?? page.height;
  return normalizeAngle((page.baseRotation || 0) + page.rotation) % 180
    ? { width: height, height: width }
    : { width, height };
}
function snapshot(document) {
  return {
    pages: clone(document.pages),
    formValues: clone(document.formValues),
    groups: clone(document.groups),
    selected: [...document.selected],
    current: document.current,
    dirty: document.dirty,
  };
}
export function edit(document, label, operation, group = null) {
  const { past } = document.history;
  const merging = group !== null && past.at(-1)?.group === group;
  const previous = merging ? null : snapshot(document);
  operation(document);
  if (previous) {
    past.push({ label, group, state: previous });
    if (past.length > historyLimit) past.splice(0, past.length - historyLimit);
  }
  document.history.future = [];
  document.dirty = true;
  document.revision += 1;
  reconcile(document);
}
function restore(document, from, to) {
  const entry = from.pop();
  if (!entry) return false;
  to.push({ label: entry.label, group: null, state: snapshot(document) });
  Object.assign(document, entry.state, { revision: document.revision + 1 });
  reconcile(document);
  return true;
}
export function undo(document) {
  const { past, future } = document.history;
  return restore(document, past, future);
}
export function redo(document) {
  const { past, future } = document.history;
  return restore(document, future, past);
}
export function travel(document, steps) {
  const step = steps < 0 ? undo : redo;
  let moved = 0;
  while (moved < Math.abs(steps) && step(document)) moved++;
  return moved;
}
export function reconcile(document) {
  const ids = new Set(document.pages.map((page) => page.id));
  document.selected = document.selected.filter((id) => ids.has(id));
  if (!ids.has(document.current))
    document.current = document.pages[0]?.id ?? null;
  document.groups = document.groups
    .map((group) => group.filter((id) => ids.has(id)))
    .filter((group) => group.length > 1);
  if (!document.selected.length && document.current)
    document.selected = [document.current];
}
export function orderedSelection(document, all = false) {
  return document.pages.filter(
    (page) => all || document.selected.includes(page.id),
  );
}
export function splitGroups(document, all = false) {
  const chosen = new Set(
    orderedSelection(document, all).map((page) => page.id),
  );
  const seen = new Set();
  return document.pages.flatMap((page) => {
    if (seen.has(page.id)) return [];
    const group = document.groups.find((group) => group.includes(page.id)) || [
      page.id,
    ];
    group.forEach((id) => seen.add(id));
    const entries = group.filter((id) => chosen.has(id));
    return entries.length ? [entries] : [];
  });
}
export function assignGroup(document, ids) {
  const chosen = new Set(ids);
  document.groups = document.groups
    .map((group) => group.filter((id) => !chosen.has(id)))
    .filter((group) => group.length > 1);
  if (ids.length > 1) document.groups.push([...ids]);
}
function sortGroups(document) {
  const order = new Map(document.pages.map((page, index) => [page.id, index]));
  document.groups = document.groups
    .map((group) =>
      group
        .filter((id) => order.has(id))
        .sort((a, b) => order.get(a) - order.get(b)),
    )
    .filter((group) => group.length > 1);
}
function placePages(document, ids, target, after) {
  const chosen = new Set(ids);
  const moving = document.pages.filter((page) => chosen.has(page.id));
  document.pages = document.pages.filter((page) => !chosen.has(page.id));
  const index = document.pages.findIndex((page) => page.id === target);
  document.pages.splice(index + (after ? 1 : 0), 0, ...moving);
  return moving.map((page) => page.id);
}
export function groupWith(document, ids, target) {
  if (!ids.length || ids.includes(target)) return;
  const members = (
    document.groups.find((group) => group.includes(target)) || [target]
  ).filter((id) => !ids.includes(id));
  const moved = placePages(document, ids, target, true);
  assignGroup(document, [...members, ...moved]);
  sortGroups(document);
}
export function moveWithGroups(document, ids, target, after) {
  if (!ids.length || ids.includes(target)) return;
  const moved = placePages(document, ids, target, after);
  const start = document.pages.findIndex((page) => page.id === moved[0]),
    before = document.pages[start - 1]?.id,
    next = document.pages[start + moved.length]?.id;
  const groupOf = (id) =>
    document.groups.findIndex((group) => group.includes(id));
  const outer = groupOf(before);
  const joined = outer >= 0 && outer === groupOf(next);
  document.groups = document.groups.map((group, index) => {
    if (joined && index === outer)
      return [...group.filter((id) => !moved.includes(id)), ...moved];
    return group.filter(
      (id) =>
        !moved.includes(id) ||
        (!joined &&
          (group.some((other) => other !== id && moved.includes(other)) ||
            group.includes(before) ||
            group.includes(next))),
    );
  });
  sortGroups(document);
}
export function copyPages(document, pages, target) {
  const namespaces = new Map();
  const copied = pages.map((page) => {
    if (!namespaces.has(page.formGroup)) namespaces.set(page.formGroup, uid());
    const next = {
      ...clone(page),
      id: uid(),
      formGroup: namespaces.get(page.formGroup),
    };
    for (const widget of next.widgets || []) {
      const key = fieldKey(page, widget.name);
      if (key in document.formValues)
        target.formValues[fieldKey(next, widget.name)] = clone(
          document.formValues[key],
        );
    }
    next.elements.forEach((element) => {
      element.id = uid();
    });
    return next;
  });
  return copied;
}
export function safeName(value, extension = "pdf") {
  const name = String(value || "Dokument")
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "-")
    .trim()
    .replace(/[. ]+$/, "")
    .replace(/\.(pdf|zip|png|jpe?g|webp|tiff?|svg|epub)$/i, "");
  return `${name || "Dokument"}.${extension}`;
}
