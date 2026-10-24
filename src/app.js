import { describeError, describeRenameError } from "./core/errors.js";
import {
  uid,
  limits,
  createDocument,
  createPage,
  edit,
  undo,
  redo,
  travel,
  copyPages,
  fieldKey,
  displayedSize,
  normalizeAngle,
  orderedSelection,
  splitGroups,
  groupWith,
  moveWithGroups,
  safeName,
} from "./core/model.js";
import {
  pagePoint,
  displayPoint,
  displayRect,
  lineRects,
  sweepStep,
  snapTurn,
  fitFontSize,
} from "./core/geometry.js";
import { findMatches, normalizeQuery } from "./core/search.js";
import { validateFile, normalizeImage, readBytes, fileTypes, fileAccept, fileExtension, documentName } from "./core/files.js";
import { openEpub } from "./epub/reader.js";
import {
  recentSupported,
  recentFiles,
  rememberFile,
  clearRecentFiles,
  readRecentFile,
  recentIdsFor,
  updateRecent,
} from "./core/recent.js";
import { processPdf } from "./pdf/client.js";
import { Renderer } from "./pdf/renderer.js";
import { darkTextColor } from "./pdf/dark.js";
import {
  buildPdf,
  download,
  zipOutputs,
  renderOutput,
  printOutputs,
  cleanupExports,
} from "./pdf/export.js";
import { layoutPlan } from "./pdf/layout.js";
import { icon, installIcons, cursorIcon } from "./ui/icons.js";
import { setupPwa } from "./pwa/app.js";
import { setHidden, setupDisclosures, fadeContent, cancelContentFade, holdEntrance } from "./ui/motion.js";
import { setupPanelResizing } from "./ui/panels.js";
import { setupToolbar } from "./ui/toolbar.js";
import { setupSidebar } from "./ui/sidebar.js";
import { readPdfDark, writePdfDark } from "./ui/settings.js";
const $ = (id) => document.getElementById(id);
const sources = new Map(),
  assets = new Map();
const documents = [];
const linkHistory = new WeakMap();
let updating = false;
let splitting = false;
let activeId = null,
  tool = "select",
  selectedElement = null,
  scale = 1,
  zoom = "fit-width",
  twoPages = false,
  pdfDark = readPdfDark(),
  historyMenuState = null,
  perSheet = 2,
  busy = null,
  renderGeneration = 0,
  pendingPageReveal = null,
  textLayer = null,
  thumbnailGeneration = 0,
  toastTimer,
  pageDrag = null,
  fileDrag = null;
const renderer = new Renderer(sources, assets);
const active = () => documents.find((doc) => doc.id === activeId);
const current = () =>
  active()?.pages.find((page) => page.id === active().current);
const element = () =>
  current()?.elements.find((el) => el.id === selectedElement);
installIcons();
$("pdf-dark-button").setAttribute("aria-pressed", String(pdfDark));
$("page-flow").classList.toggle("pdf-dark", pdfDark);
setupDisclosures();
const sidebar = setupSidebar(() => documents.length > 0 &&
  !(documents.length === 1 && documents[0].kind === "pdf" && documents[0].pages.length <= 1));
const syncSidebar = sidebar.sync;
setupPanelResizing();
const toolbar = setupToolbar();
function message(text, error = false) {
  const toast = $("toast");
  clearTimeout(toastTimer);
  toast.textContent = text;
  toast.classList.toggle("error", error);
  setHidden(toast, false);
  toastTimer = setTimeout(
    () => setHidden(toast, true),
    error ? 11000 : 5000,
  );
}
function report(error) {
  if (error?.name === "AbortError") message("Vorgang abgebrochen.");
  else message(describeError(error), true);
}
async function confirmAction(title, text, acceptLabel = "Fortfahren") {
  const dialog = $("confirm-dialog");
  $("confirm-title").textContent = title;
  $("confirm-message").textContent = text;
  dialog.querySelector('[value="yes"]').textContent = acceptLabel;
  dialog.returnValue = "cancel";
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "yes"),
      { once: true },
    ),
  );
}
async function runJob(title, operation, { silent = false } = {}) {
  if (busy) throw new Error("Bitte den laufenden Vorgang zuerst abschließen.");
  const controller = new AbortController();
  busy = controller;
  if (!silent) {
    $("busy-title").textContent = title;
    $("busy-message").textContent = "Die Verarbeitung läuft auf deinem Gerät.";
    $("busy-progress").removeAttribute("value");
    $("busy-dialog").showModal();
  }
  const progress = (value) => {
    if (!silent && !controller.signal.aborted) $("busy-progress").value = value;
  };
  try {
    return await operation({ signal: controller.signal, progress });
  } finally {
    if (busy === controller) {
      busy = null;
      if (!silent) $("busy-dialog").close();
    }
  }
}
$("cancel-job").addEventListener("click", () => busy?.abort());
$("busy-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  busy?.abort();
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-close]");
  if (button) button.closest("dialog").close("cancel");
});
function activate(doc) {
  const animate = activeId !== doc.id;
  finishTextEdit();
  closeToolStyle();
  closeHistory();
  activeId = doc.id;
  selectedElement = null;
  renderAll({ animate });
}
function changed() {
  selectedElement = element()?.id || null;
  renderAll();
  collectResources();
}
function modify(label, operation) {
  const doc = active();
  if (!doc) return;
  edit(doc, label, operation);
  changed();
}
let enteringDocument = null,
  entrance = null;
const entranceDelay = 400;
function startEntrance(doc) {
  dropEntrance();
  const animation = holdEntrance($("page-flow"));
  if (animation)
    entrance = {
      documentId: doc.id,
      animation,
      timer: setTimeout(playEntrance, entranceDelay),
    };
}
function playEntrance() {
  if (!entrance) return;
  clearTimeout(entrance.timer);
  entrance.animation.play();
  entrance = null;
}
function dropEntrance() {
  if (!entrance) return;
  clearTimeout(entrance.timer);
  cancelContentFade($("page-flow"));
  entrance = null;
}
function addDocument(doc) {
  enteringDocument = doc.id;
  documents.push(doc);
  syncSidebar();
  activate(doc);
}
function revealSection(name, visible, open = true) {
  const section = document.querySelector(`[data-side-section="${name}"]`);
  if (visible && section.hidden) section.open = open;
  setHidden(section, !visible);
  $("pages-panel").classList.toggle(
    "expanded",
    !!document.querySelector(
      '.side-section:not([hidden], [data-side-section="annotations"])',
    ),
  );
}
const commentColor = "#f5c542";
let commentsOpen = false;
function commentEntries(doc) {
  return (doc?.pages || []).flatMap((page, index) =>
    page.elements
      .filter((el) => el.type === "comment")
      .map((el) => ({
        page,
        number: index + 1,
        el,
        position: displayPoint(page, el.x, el.y),
      }))
      .sort((a, b) => a.position[1] - b.position[1] || a.position[0] - b.position[0]),
  );
}
function findComment(id) {
  for (const page of active()?.pages || []) {
    const el = page.elements.find((item) => item.id === id);
    if (el?.type === "comment") return { page, el };
  }
  return null;
}
function commentCard({ el, number }) {
  const card = document.createElement("li");
  card.className = "comment-card";
  card.dataset.id = el.id;
  card.classList.toggle("done", !!el.done);
  card.style.setProperty("--comment", el.color);
  const head = document.createElement("div");
  head.className = "comment-head";
  const page = document.createElement("span");
  page.className = "comment-page";
  page.textContent = `S. ${number}`;
  const meta = document.createElement("span");
  meta.className = "comment-meta";
  const date = el.date ? new Date(el.date) : null;
  meta.textContent = [
    el.author,
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString("de-DE")
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  head.append(page, meta);
  const text = document.createElement("textarea");
  text.className = "comment-text";
  text.value = el.text;
  text.rows = Math.min(8, Math.max(2, el.text.split("\n").length));
  text.placeholder = "Kommentar schreiben…";
  text.setAttribute("aria-label", `Kommentar auf Seite ${number}`);
  const actions = document.createElement("div");
  actions.className = "comment-actions";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "comment-done";
  done.setAttribute("aria-pressed", String(!!el.done));
  done.innerHTML = `${icon("check")}<span>${el.done ? "Erledigt" : "Als erledigt markieren"}</span>`;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button comment-delete";
  remove.innerHTML = icon("trash");
  remove.setAttribute("aria-label", "Kommentar löschen");
  remove.title = "Kommentar löschen";
  actions.append(done, remove);
  card.append(head, text, actions);
  return card;
}
function renderComments() {
  const doc = active(),
    entries = commentEntries(doc),
    open = entries.filter((entry) => !entry.el.done).length,
    visible = !!doc?.pages.length && commentsOpen;
  $("comments-badge").textContent = String(open);
  $("comments-badge").hidden = !open;
  $("comments-count").textContent = String(entries.length);
  document
    .querySelector('button[data-tool="comment"]')
    .setAttribute("aria-label", open ? `Kommentar (${open} offen)` : "Kommentar");
  $("comments-panel").hidden = !visible;
  $("workspace").classList.toggle("comments-open", visible);
  const list = $("comment-list"),
    focused = document.activeElement,
    editing =
      list.contains(focused) && focused.matches("textarea")
        ? {
            id: focused.closest(".comment-card").dataset.id,
            value: focused.value,
            start: focused.selectionStart,
            end: focused.selectionEnd,
          }
        : null;
  const hideDone = $("comments-hide-done").checked,
    shown = entries.filter((entry) => !hideDone || !entry.el.done);
  list.replaceChildren(...shown.map(commentCard));
  $("comments-empty").hidden = shown.length > 0;
  $("comments-empty").textContent = entries.length
    ? "Alle Kommentare sind erledigt."
    : "Noch keine Kommentare. Mit dem Kommentar-Werkzeug auf die Seite klicken.";
  if (editing) {
    const field = list.querySelector(
      `.comment-card[data-id="${editing.id}"] textarea`,
    );
    if (field) {
      field.value = editing.value;
      field.focus();
      field.setSelectionRange(editing.start, editing.end);
    }
  }
  syncCommentSelection();
}
function syncCommentSelection() {
  for (const card of $("comment-list").children) {
    const current = card.dataset.id === selectedElement;
    card.classList.toggle("selected", current);
    if (current && commentsOpen && !card.contains(document.activeElement))
      card.scrollIntoView({ block: "nearest" });
  }
}
function showComments(open = !commentsOpen) {
  commentsOpen = open;
  renderComments();
}
function focusComment(id) {
  const field = $("comment-list").querySelector(
    `.comment-card[data-id="${id}"] textarea`,
  );
  if (!field) return;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}
function changeComment(id, label, change) {
  const doc = active(),
    found = findComment(id);
  if (!doc || !found) return;
  edit(doc, label, () => change(found));
  renderDocuments();
  renderElements();
  renderThumbnails();
  updateHistoryControls();
}
function createComment(point) {
  const created = addElement(
    {
      type: "comment",
      width: 20,
      height: 20,
      color: commentColor,
      text: "",
      done: false,
      date: new Date().toISOString(),
    },
    point.x - 10,
    point.y - 10,
  );
  if (!created) return;
  selectedElement = created.id;
  returnToSelect("comment");
  renderElements();
  showComments(true);
  focusComment(created.id);
}
$("comment-list").addEventListener("click", (event) => {
  const card = event.target.closest(".comment-card");
  if (!card) return;
  const id = card.dataset.id,
    found = findComment(id);
  if (!found) return;
  if (event.target.closest(".comment-done"))
    changeComment(
      id,
      found.el.done ? "Kommentar wieder geöffnet" : "Kommentar erledigt",
      ({ el }) => (el.done = !el.done),
    );
  else if (event.target.closest(".comment-delete")) {
    if (selectedElement === id) selectedElement = null;
    changeComment(id, "Kommentar löschen", ({ page }) => {
      page.elements = page.elements.filter((el) => el.id !== id);
    });
  } else if (!event.target.closest("textarea")) jumpToAnnotation(found.page.id, id);
});
$("comment-list").addEventListener("focusin", (event) => {
  const card = event.target.closest?.(".comment-card");
  if (!card || !event.target.matches("textarea") || selectedElement === card.dataset.id)
    return;
  const found = findComment(card.dataset.id);
  if (!found) return;
  if (active().current === found.page.id) {
    selectedElement = card.dataset.id;
    renderElements();
  } else jumpToAnnotation(found.page.id, card.dataset.id);
  focusComment(card.dataset.id);
});
$("comment-list").addEventListener("change", (event) => {
  const card = event.target.closest(".comment-card");
  if (!card || !event.target.matches("textarea")) return;
  const value = event.target.value,
    found = findComment(card.dataset.id);
  if (!found || found.el.text === value) return;
  changeComment(card.dataset.id, "Kommentar bearbeiten", ({ el }) => {
    el.text = value;
    el.date = new Date().toISOString();
  });
});
$("comment-list").addEventListener("keydown", (event) => {
  if (!event.target.matches("textarea")) return;
  event.stopPropagation();
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    event.target.blur();
  } else if (event.key === "Escape") {
    event.preventDefault();
    const found = findComment(event.target.closest(".comment-card").dataset.id);
    if (found) event.target.value = found.el.text;
    event.target.blur();
  }
});
$("comment-list").addEventListener("input", (event) => {
  if (!event.target.matches("textarea")) return;
  event.target.rows = Math.min(8, Math.max(2, event.target.value.split("\n").length));
});
$("comments-hide-done").addEventListener("change", renderComments);
function renderDocuments() {
  const list = $("file-list");
  list.replaceChildren();
  for (const doc of documents) {
    const item = document.createElement("li");
    item.classList.toggle("active", doc.id === activeId);
    item.dataset.dirty = String(doc.dirty);
    item.dataset.document = doc.id;
    item.draggable = true;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "file-open";
    open.dataset.document = doc.id;
    open.textContent = doc.name;
    open.title = doc.dirty
      ? `${doc.name} · Nicht gespeicherte Änderungen`
      : doc.name;
    if (doc.id === activeId) open.setAttribute("aria-current", "true");
    open.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    open.addEventListener("click", () => {
      if (doc.id !== activeId) activate(doc);
    });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-button file-close";
    close.dataset.action = "close-document";
    close.dataset.document = doc.id;
    close.setAttribute("aria-label", `${doc.name} schließen`);
    close.title = `${doc.name} schließen`;
    close.innerHTML = icon("close");
    item.append(open, close);
    list.append(item);
  }
  $("file-count").textContent = String(documents.length);
  revealSection("files", documents.length > 1);
  document.querySelector('[data-action="merge"]').disabled = documents.filter((doc) => doc.kind === "pdf").length < 2;
  renderTitle();
  renderAnnotations();
  renderComments();
}
let annotationFilter = "all",
  annotationSelectionDocument = null,
  annotationAnchor = null;
const annotationSelection = new Set();
function clearAnnotationSelection() {
  annotationSelection.clear();
  annotationAnchor = null;
}
function syncAnnotationBulk() {
  $("annotation-bulk").hidden = !annotationSelection.size;
  $("annotation-selection-count").textContent = `${annotationSelection.size} ausgewählt`;
}
function deleteAnnotations(ids = [...annotationSelection]) {
  const doc = active(),
    targets = new Set(ids);
  if (!doc || !annotationEntries(doc).some(({ el }) => targets.has(el.id))) return;
  const focused = document.activeElement?.closest(".annotation-entry"),
    restoreFocus = !!document.activeElement?.closest("#annotation-list, #annotation-bulk"),
    entries = [...$("annotation-list").querySelectorAll(".annotation-entry")],
    index = entries.indexOf(focused);
  modify(targets.size > 1 ? "Annotationen löschen" : "Annotation löschen", () => {
    for (const page of doc.pages)
      page.elements = page.elements.filter((el) => !targets.has(el.id));
    if (targets.has(selectedElement)) selectedElement = null;
    clearAnnotationSelection();
  });
  if (restoreFocus) {
    const remaining = $("annotation-list").querySelectorAll(".annotation-entry");
    (
      remaining[Math.min(Math.max(0, index), remaining.length - 1)] ||
      $("pages-panel")
    )?.focus();
  }
}
const annotationKinds = {
  text: { label: "Text", icon: "text" },
  mark: { label: "Markierung", icon: "highlighter" },
  draw: { label: "Zeichnung", icon: "pen" },
  image: { label: "Bild", icon: "image" },
  comment: { label: "Kommentar", icon: "message" },
  link: { label: "Link", icon: "link" },
};
function annotationKind(el) {
  if (el.type === "highlight" || (el.type === "draw" && el.marker))
    return "mark";
  return el.type in annotationKinds && el.type !== "link" ? el.type : null;
}
const pageLinks = new Map();
let loadingLinks = false,
  pendingLinkFlash = null;
const linkKey = (page) => `${page.sourceId}:${page.index}`;
async function loadPageLinks(doc) {
  if (loadingLinks) return;
  const missing = (doc?.pages || []).filter(
    (page) => page.sourceId && !pageLinks.has(linkKey(page)),
  );
  if (!missing.length) return;
  loadingLinks = true;
  try {
    for (const page of missing)
      if (!pageLinks.has(linkKey(page)))
        pageLinks.set(
          linkKey(page),
          await renderer.links(page).catch(() => []),
        );
  } finally {
    loadingLinks = false;
  }
  renderAnnotations();
}
function linkTarget(doc, link) {
  return doc.pages.find(
    (candidate) =>
      candidate.sourceId === link.sourceId && candidate.index === link.index,
  );
}
function linkLabel(doc, link) {
  if (link.url) return safeUrl(link.url);
  const target = linkTarget(doc, link);
  return target ? `Zu Seite ${doc.pages.indexOf(target) + 1}` : null;
}
function annotationEntries(doc) {
  return (doc?.pages || []).flatMap((page, index) =>
    [
      ...page.elements
        .filter((el) => annotationKind(el))
        .map((el) => {
          const kind = annotationKind(el),
            [x, y] = displayPoint(page, el.x, el.y);
          return {
            el,
            kind,
            x,
            y,
            label:
              ((kind === "text" || kind === "comment") &&
                (el.text || "").trim().split("\n")[0]) ||
              annotationKinds[kind].label,
          };
        }),
      ...(pageLinks.get(linkKey(page)) || []).flatMap((link, linkIndex) => {
        const label = linkLabel(doc, link);
        if (!label) return [];
        const rect = displayRect(page, link.rect);
        return [
          {
            el: { id: null, text: label },
            link: linkIndex,
            kind: "link",
            x: rect.x,
            y: rect.y,
            label,
          },
        ];
      }),
    ]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((entry) => ({ ...entry, page, number: index + 1 })),
  );
}
function renderAnnotations() {
  if (annotationSelectionDocument !== active()?.id) {
    clearAnnotationSelection();
    annotationSelectionDocument = active()?.id;
  }
  void loadPageLinks(active());
  const entries = annotationEntries(active()),
    query = $("annotation-search").value.trim().toLowerCase(),
    kinds = new Set(entries.map((entry) => entry.kind));
  const existing = new Set(entries.map(({ el }) => el.id));
  for (const id of annotationSelection)
    if (!existing.has(id)) annotationSelection.delete(id);
  if (!existing.has(annotationAnchor)) annotationAnchor = null;
  syncAnnotationBulk();
  if (annotationFilter !== "all" && !kinds.has(annotationFilter))
    annotationFilter = "all";
  document.querySelectorAll("[data-annotation-filter]").forEach((button) => {
    const kind = button.dataset.annotationFilter;
    button.hidden = kind !== "all" && !kinds.has(kind);
    button.setAttribute("aria-pressed", String(kind === annotationFilter));
  });
  const visible = entries.filter(
    (entry) =>
      (annotationFilter === "all" || entry.kind === annotationFilter) &&
      (!query ||
        [entry.label, entry.el.text || "", annotationKinds[entry.kind].label]
          .join(" ")
          .toLowerCase()
          .includes(query)),
  );
  $("annotation-list").replaceChildren(
    ...visible.map(({ page, number, el, kind, label, link }) => {
      const item = document.createElement("li"),
        button = document.createElement("button"),
        swatch = document.createElement("span"),
        name = document.createElement("span"),
        pageLabel = document.createElement("span");
      button.type = "button";
      button.className = "annotation-entry";
      button.dataset.page = page.id;
      if (link === undefined) {
        button.dataset.id = el.id;
        button.setAttribute(
          "aria-pressed",
          String(annotationSelection.has(el.id)),
        );
      } else button.dataset.link = String(link);
      button.title = `${label} · Seite ${number}`;
      if (el.id && el.id === selectedElement)
        button.setAttribute("aria-current", "true");
      button.innerHTML = icon(annotationKinds[kind].icon);
      swatch.className = "annotation-swatch";
      swatch.style.background = el.color || "transparent";
      swatch.hidden = !el.color;
      name.className = "annotation-name";
      name.textContent = label;
      pageLabel.className = "annotation-page";
      pageLabel.textContent = `S. ${number}`;
      button.append(swatch, name, pageLabel);
      item.append(button);
      return item;
    }),
  );
  if (entries.length && !visible.length) {
    const empty = document.createElement("li");
    empty.className = "annotation-empty";
    empty.textContent = "Keine Treffer";
    $("annotation-list").append(empty);
  }
  $("annotation-count").textContent = String(entries.length);
  revealSection("annotations", entries.length > 0, false);
}
function syncAnnotationSelection() {
  $("annotation-list")
    .querySelectorAll(".annotation-entry")
    .forEach((button) => {
      if (button.dataset.id)
        button.setAttribute(
          "aria-pressed",
          String(annotationSelection.has(button.dataset.id)),
        );
      if (button.dataset.id && button.dataset.id === selectedElement)
        button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  syncAnnotationBulk();
}
function jumpToAnnotation(pageId, id) {
  if (tool !== "select") setTool("select");
  if (active()?.current !== pageId) selectPage(pageId);
  else scrollToPage(pageId);
  selectedElement = id;
  renderElements();
  renderSettings();
  const target = $("element-layer").querySelector(
    `.annotation[data-id="${id}"]`,
  );
  if (target) flashTarget(target);
}
function flashTarget(target) {
  requestAnimationFrame(() =>
    target.scrollIntoView({ block: "nearest", inline: "nearest" }),
  );
  target.classList.remove("flash");
  void target.offsetWidth;
  target.classList.add("flash");
  target.addEventListener(
    "animationend",
    () => target.classList.remove("flash"),
    { once: true },
  );
}
function jumpToListedLink(pageId, index) {
  if (tool !== "select") setTool("select");
  pendingLinkFlash = { pageId, index };
  if (active()?.current !== pageId) selectPage(pageId);
  else {
    scrollToPage(pageId);
    flashPendingLink();
  }
}
function flashPendingLink() {
  if (!pendingLinkFlash) return;
  const { pageId, index } = pendingLinkFlash;
  if (current()?.id !== pageId) {
    pendingLinkFlash = null;
    return;
  }
  const target = $("link-layer").querySelector(`a[data-link="${index}"]`);
  if (!target) return;
  pendingLinkFlash = null;
  flashTarget(target);
}
$("annotation-list").addEventListener("click", (event) => {
  const button = event.target.closest(".annotation-entry");
  if (!button) return;
  if (button.dataset.link !== undefined) {
    clearAnnotationSelection();
    jumpToListedLink(button.dataset.page, Number(button.dataset.link));
    syncAnnotationSelection();
    return;
  }
  const id = button.dataset.id;
  if (event.shiftKey) {
    const ids = [...$("annotation-list").querySelectorAll(".annotation-entry")]
        .map((entry) => entry.dataset.id)
        .filter(Boolean),
      end = ids.indexOf(id),
      anchor = ids.indexOf(annotationAnchor),
      start = anchor < 0 ? end : anchor;
    if (!event.ctrlKey && !event.metaKey) annotationSelection.clear();
    for (const value of ids.slice(Math.min(start, end), Math.max(start, end) + 1))
      annotationSelection.add(value);
    if (anchor < 0) annotationAnchor = id;
  } else if (event.ctrlKey || event.metaKey) {
    if (annotationSelection.has(id)) annotationSelection.delete(id);
    else annotationSelection.add(id);
    annotationAnchor = id;
  } else {
    clearAnnotationSelection();
    annotationSelection.add(id);
    annotationAnchor = id;
    jumpToAnnotation(button.dataset.page, id);
  }
  syncAnnotationSelection();
});
document.querySelectorAll("[data-annotation-filter]").forEach((button) =>
  button.addEventListener("click", () => {
    clearAnnotationSelection();
    annotationFilter = button.dataset.annotationFilter;
    renderAnnotations();
  }),
);
$("annotation-search").addEventListener("input", () => {
  clearAnnotationSelection();
  renderAnnotations();
});
$("annotation-search-toggle").addEventListener("click", () => {
  const input = $("annotation-search"),
    opening = input.hidden;
  input.hidden = !opening;
  $("annotation-search-toggle").setAttribute("aria-expanded", String(opening));
  if (opening) input.focus();
  else {
    input.value = "";
    clearAnnotationSelection();
    renderAnnotations();
  }
});
$("annotation-delete-selection").addEventListener("click", () =>
  deleteAnnotations(),
);
$("annotation-list").addEventListener("keydown", (event) => {
  if (!["Delete", "Backspace"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  deleteAnnotations();
});
function fileName(doc) {
  return doc.handle?.name ?? `${doc.name}${doc.extension}`;
}
function renderTitle() {
  const title = $("document-title"),
    doc = active();
  $("save-button").classList.toggle("dirty", !!doc?.dirty);
  if (title.nextElementSibling?.classList.contains("name-editor")) return;
  title.hidden = !doc;
  if (!doc) return;
  title.querySelector(".document-title-name").textContent = doc.name;
  title.classList.toggle("dirty", doc.dirty);
  title.title = doc.dirty
    ? `${fileName(doc)} · Nicht gespeicherte Änderungen`
    : fileName(doc);
}
function validName(input) {
  const name = documentName(String(input).trim()).trim();
  if (!name || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
    message(
      'Bitte einen gültigen Dateinamen ohne \\ / : * ? " < > | eingeben.',
      true,
    );
    return null;
  }
  return name;
}
function editName(button, value, commit) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "name-editor";
  input.value = value;
  input.spellcheck = false;
  input.setAttribute("aria-label", "Neuer Dateiname");
  let done = false;
  const close = () => {
    done = true;
    input.remove();
    button.hidden = false;
    if (button.isConnected) button.focus({ preventScroll: true });
    renderTitle();
    if (welcomeRecentStale) {
      welcomeRecentStale = false;
      void renderWelcomeRecent();
    }
  };
  const finish = async (keep) => {
    if (done) return;
    if (!keep || input.value.trim() === value) return close();
    done = true;
    input.disabled = true;
    let accepted = true;
    try {
      accepted = await commit(input.value);
    } catch (error) {
      accepted = false;
      report(error);
    }
    if (accepted === false) {
      done = false;
      input.disabled = false;
      input.focus();
      input.select();
      return;
    }
    close();
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      void finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      void finish(false);
    }
  });
  input.addEventListener("blur", () => void finish(true));
  button.hidden = true;
  button.after(input);
  input.focus();
  input.select();
}
async function renameFile(handle, name) {
  await writable(handle);
  const owners = [];
  for (const doc of documents)
    if (
      doc.handle &&
      (doc.handle === handle ||
        (await doc.handle.isSameEntry(handle).catch(() => false)))
    )
      owners.push(doc);
  const target = owners[0]?.handle ?? handle;
  const ids = recentSupported()
    ? await recentIdsFor(target).catch(() => [])
    : [];
  await detachSources(target);
  try {
    if (!(await moveFile(target, `${name}${fileExtension(target.name)}`))) return false;
  } catch (error) {
    if (error.name === "AbortError") return false;
    const writeGranted = await hasWritePermission(target);
    throw new Error(describeRenameError(error, { writeGranted }));
  }
  for (const doc of owners) {
    doc.handle = target;
    doc.name = name;
  }
  if (ids.length) await updateRecent(ids, target).catch(() => {});
  return true;
}
async function hasWritePermission(handle) {
  try {
    return (await handle.queryPermission?.({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}
async function moveFile(handle, name) {
  try {
    await handle.move(name);
    return true;
  } catch (error) {
    if (error.name !== "NotAllowedError" || !(await hasWritePermission(handle))) throw error;
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      if (!(await confirmAction("Datei umbenennen", `„${handle.name}“ in „${name}“ umbenennen?`, "Umbenennen"))) return false;
      try {
        await handle.move(name);
        return true;
      } catch (retryError) {
        if (retryError.name !== "NotAllowedError" || !(await hasWritePermission(handle))) throw retryError;
      }
    }
    if (typeof window.showDirectoryPicker !== "function") throw error;
    if (!(await confirmAction(
      "Ordner für das Umbenennen freigeben",
      "Die Schreibberechtigung für die Datei ist erteilt. Der Browser benötigt zusätzlich Zugriff auf ihren Ordner. Bitte wähle im nächsten Dialog den Ordner aus, in dem die Datei liegt.",
      "Ordner auswählen",
    ))) return false;
    const directory = await window.showDirectoryPicker({
      id: "pdfhelper-rename",
      mode: "readwrite",
      startIn: handle,
    });
    const path = await directory.resolve(handle);
    if (!path || path.length !== 1)
      throw new Error("Bitte den Ordner auswählen, in dem die Datei liegt. Es wurde nichts umbenannt.");
    try {
      const existing = await directory.getFileHandle(name);
      if (!(await existing.isSameEntry(handle)))
        throw new DOMException("Eine Datei mit diesem Namen existiert bereits.", "InvalidModificationError");
    } catch (conflict) {
      if (conflict.name === "TypeMismatchError")
        throw new DOMException("Ein Ordner mit diesem Namen existiert bereits.", "InvalidModificationError");
      if (conflict.name !== "NotFoundError") throw conflict;
    }
    await handle.move(directory, name);
    return true;
  }
}
async function renameDocument(doc, input) {
  const name = validName(input);
  if (!name) return false;
  if (doc.handle?.move) {
    if (!(await renameFile(doc.handle, name))) return false;
    message(`Umbenannt in ${fileName(doc)}.`);
  } else {
    doc.name = name;
    message("Name in PDFHelper geändert; die Datei selbst bleibt unverändert.");
  }
  renderDocuments();
  void renderWelcomeRecent();
  return true;
}
async function renameRecent(entry, input) {
  const name = validName(input);
  if (!name) return false;
  if (!entry.handle?.move)
    throw new Error("Dieser Browser kann Dateien nicht umbenennen.");
  if (!(await renameFile(entry.handle, name))) return false;
  message(`Umbenannt in ${entry.handle.name}.`);
  if (!$("recent-menu").hidden) closeRecent();
  renderDocuments();
  void renderWelcomeRecent();
  return true;
}
function nameMenu(event, name, rename, close, extra = []) {
  showContextMenu(event, {}, [
    contextItem("Umbenennen", false, async () => rename()),
    contextItem("Dateinamen kopieren", false, () =>
      copyContext({ text: name }),
    ),
    ...extra,
    ...(close ? [contextItem("Schließen", false, async () => close())] : []),
  ]);
}
$("document-title").addEventListener("dblclick", () => {
  const doc = active();
  if (doc)
    editName($("document-title"), doc.name, (value) =>
      renameDocument(doc, value),
    );
});
$("file-list").addEventListener("dblclick", (event) => {
  const button = event.target.closest(".file-open"),
    doc = documents.find((doc) => doc.id === button?.dataset.document);
  if (doc) editName(button, doc.name, (value) => renameDocument(doc, value));
});
function moveDocument(id, index) {
  const from = documents.findIndex((doc) => doc.id === id);
  if (from < 0) return;
  const [doc] = documents.splice(from, 1);
  documents.splice(Math.max(0, Math.min(documents.length, index)), 0, doc);
  renderDocuments();
}
const fileItem = (event) => event.target.closest?.("#file-list li");
const fileDropAfter = (event, item) => {
  const rect = item.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
};
$("file-list").addEventListener("dragstart", (event) => {
  const item = fileItem(event);
  if (!item) return;
  fileDrag = item.dataset.document;
  item.classList.add("dragging");
  event.dataTransfer.setData("application/x-pdfhelper-document", fileDrag);
  event.dataTransfer.effectAllowed = "move";
});
$("file-list").addEventListener("dragover", (event) => {
  if (!fileDrag) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  clearDropIndicators();
  const item = fileItem(event);
  if (item && item.dataset.document !== fileDrag)
    item.classList.add(fileDropAfter(event, item) ? "drop-after" : "drop-before");
});
$("file-list").addEventListener("drop", (event) => {
  if (!fileDrag) return;
  event.preventDefault();
  const item = fileItem(event),
    dragged = fileDrag;
  endFileDrag();
  if (!item || item.dataset.document === dragged) return;
  const after = fileDropAfter(event, item),
    rest = documents.filter((doc) => doc.id !== dragged),
    target = rest.findIndex((doc) => doc.id === item.dataset.document);
  moveDocument(dragged, target + (after ? 1 : 0));
});
function endFileDrag() {
  fileDrag = null;
  clearDropIndicators();
  $("file-list")
    .querySelectorAll(".dragging")
    .forEach((item) => item.classList.remove("dragging"));
}
$("file-list").addEventListener("dragend", endFileDrag);
$("file-list").addEventListener("keydown", (event) => {
  const button = event.target.closest(".file-open");
  if (
    !button ||
    !event.altKey ||
    !["ArrowUp", "ArrowDown"].includes(event.key)
  )
    return;
  event.preventDefault();
  const id = button.dataset.document,
    index = documents.findIndex((doc) => doc.id === id);
  moveDocument(id, index + (event.key === "ArrowUp" ? -1 : 1));
  $("file-list").querySelector(`.file-open[data-document="${id}"]`).focus();
});
async function closeDocument(doc) {
  if (
    doc.dirty &&
    !(await confirmAction(
      "Dokument schließen?",
      `Nicht gespeicherte Änderungen an „${doc.name}“ gehen verloren.`,
    ))
  )
    return;
  linkHistory.delete(doc);
  documents.splice(documents.indexOf(doc), 1);
  doc.reader?.destroy();
  const animate = doc.id === activeId;
  if (animate) activeId = documents.at(-1)?.id ?? null;
  selectedElement = null;
  syncSidebar();
  renderAll({ animate });
  collectResources();
}
let thumbnailObserver;
const thumbnailQueue = [];
let renderingThumbnail = false;
function renderThumbnails() {
  const doc = active();
  thumbnailGeneration++;
  thumbnailQueue.length = 0;
  thumbnailObserver?.disconnect();
  renderer.clearThumbnails();
  $("page-list").replaceChildren();
  document.querySelector(".page-bulk [data-action=split]").hidden =
    !doc?.groups.length;
  if (!doc) return;
  const groupIndex = (id) =>
    doc.groups.findIndex((group) => group.includes(id));
  thumbnailObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !entry.target.querySelector("canvas")) {
          const page = doc.pages.find(
            (page) => page.id === entry.target.dataset.page,
          );
          if (page && !thumbnailQueue.some((job) => job.page.id === page.id))
            thumbnailQueue.push({
              page,
              target: entry.target,
              doc,
              generation: thumbnailGeneration,
            });
        }
      }
      void drainThumbnails();
    },
    { root: $("page-list"), rootMargin: "180px" },
  );
  doc.pages.forEach((page, index) => {
    const item = document.createElement("div");
    item.className = `page-item${doc.selected.includes(page.id) ? " selected" : ""}${doc.current === page.id ? " current" : ""}`;
    item.dataset.page = page.id;
    item.draggable = true;
    const thumb = document.createElement("div");
    thumb.className = "thumbnail";
    thumb.dataset.page = page.id;
    thumb.role = "button";
    thumb.tabIndex = 0;
    thumb.setAttribute("aria-label", `Seite ${index + 1} auswählen`);
    thumb.setAttribute(
      "aria-keyshortcuts",
      "Alt+ArrowUp Alt+ArrowDown R Shift+R Delete",
    );
    thumb.setAttribute("aria-pressed", String(doc.selected.includes(page.id)));
    const placeholder = document.createElement("span");
    placeholder.className = "thumb-placeholder";
    placeholder.innerHTML = icon("file");
    thumb.append(placeholder);
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "page-check";
    check.checked = doc.selected.includes(page.id);
    check.setAttribute(
      "aria-label",
      `Seite ${index + 1} zur Auswahl hinzufügen`,
    );
    check.addEventListener("click", (event) => {
      event.stopPropagation();
      selectPage(page.id, { ctrlKey: true });
    });
    thumb.addEventListener("click", (event) => selectPage(page.id, event));
    thumb.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectPage(page.id, event);
      }
    });
    const caption = document.createElement("div");
    caption.className = "page-caption";
    const pageLabel = document.createElement("label");
    pageLabel.className = "page-select";
    pageLabel.append(check, `${index + 1}`);
    caption.append(pageLabel);
    const group = groupIndex(page.id);
    if (group >= 0) {
      const first = groupIndex(doc.pages[index - 1]?.id) !== group,
        last = groupIndex(doc.pages[index + 1]?.id) !== group;
      item.classList.add("grouped");
      item.classList.toggle("group-first", first);
      item.classList.toggle("group-last", last);
      if (first) item.append(groupLabel(group));
    }
    item.append(thumb, caption);
    $("page-list").append(item);
    thumbnailObserver.observe(thumb);
  });
}
function groupLabel(index) {
  const label = document.createElement("div");
  label.className = "group-label";
  const name = document.createElement("span");
  name.textContent = `Gruppe ${index + 1}`;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button";
  remove.innerHTML = icon("close");
  remove.setAttribute("aria-label", `Gruppe ${index + 1} auflösen`);
  remove.title = "Gruppe auflösen";
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    modify("Gruppe auflösen", (doc) => {
      doc.groups.splice(index, 1);
    });
  });
  label.append(name, remove);
  return label;
}
async function drainThumbnails() {
  if (renderingThumbnail) return;
  renderingThumbnail = true;
  try {
    while (thumbnailQueue.length) {
      const job = thumbnailQueue.shift();
      if (job.generation !== thumbnailGeneration || !job.target.isConnected)
        continue;
      const canvas = document.createElement("canvas");
      try {
        await renderer.render(
          job.page,
          canvas,
          Math.min(
            116 / displayedSize(job.page).width,
            156 / displayedSize(job.page).height,
          ),
          { document: job.doc, darkMode: pdfDark },
        );
        if (job.generation === thumbnailGeneration && job.target.isConnected) {
          job.target.querySelector("canvas")?.remove();
          job.target.prepend(canvas);
          job.target.querySelector(".thumb-placeholder")?.remove();
          renderer.retainThumbnail(job.page.id, canvas);
        } else {
          canvas.width = 0;
          canvas.height = 0;
        }
      } catch {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  } finally {
    renderingThumbnail = false;
  }
}
function selectPage(id, event = {}) {
  const doc = active();
  if (!doc) return;
  const animate = doc.current !== id;
  if (event.shiftKey) {
    const start = doc.pages.findIndex((page) => page.id === doc.current),
      end = doc.pages.findIndex((page) => page.id === id);
    doc.selected = doc.pages
      .slice(Math.min(start, end), Math.max(start, end) + 1)
      .map((page) => page.id);
  } else if (event.ctrlKey || event.metaKey) {
    doc.selected = doc.selected.includes(id)
      ? doc.selected.filter((value) => value !== id)
      : [...doc.selected, id];
  } else doc.selected = [id];
  doc.current = id;
  selectedElement = null;
  updateSelection();
  void renderPage({ animate });
  renderSettings();
  scrollToPage(id);
}
function followPage(id) {
  const doc = active();
  if (!doc || doc.current === id) return;
  if (doc.selected.length === 1 && doc.selected[0] === doc.current)
    doc.selected = [id];
  doc.current = id;
  selectedElement = null;
  updateSelection();
  void renderPage();
  renderSettings();
  $("page-list")
    .querySelector(`.page-item[data-page="${id}"]`)
    ?.scrollIntoView({ block: "nearest" });
}
function updateSelection() {
  const doc = active();
  for (const item of $("page-list").children) {
    item.classList.toggle("selected", doc.selected.includes(item.dataset.page));
    item.classList.toggle("current", doc.current === item.dataset.page);
    const checkbox = item.querySelector("input");
    if (checkbox) checkbox.checked = doc.selected.includes(item.dataset.page);
    item
      .querySelector("[role=button]")
      ?.setAttribute(
        "aria-pressed",
        String(doc.selected.includes(item.dataset.page)),
      );
  }
}
let renderedViewport = "";
function viewportKey() {
  const scroller = $("page-scroll");
  return `${scroller.clientWidth}x${scroller.clientHeight}`;
}
function desiredScale(page) {
  const size = displayedSize(page),
    value = zoom,
    columns = twoPages ? 2 : 1,
    gap = parseFloat(getComputedStyle($("page-flow")).columnGap) || 0;
  const width = Math.max(
      120,
      ($("page-scroll").clientWidth - 80 - (columns - 1) * gap) / columns,
    ),
    height = Math.max(150, $("page-scroll").clientHeight - 65);
  return value === "fit-width"
    ? width / size.width
    : value === "fit-page"
      ? Math.min(width / size.width, height / size.height)
      : Number(value);
}
const previewQueue = new Set(),
  previewControllers = new Map(),
  nearSlots = new WeakSet();
let renderingPreview = false,
  mainCanvasPage = null;
const slotFor = (id) =>
  [...$("page-flow").children].find((slot) => slot.dataset.page === id);
const previewObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        nearSlots.add(entry.target);
        schedulePreview(entry.target);
      } else {
        nearSlots.delete(entry.target);
        releasePreview(entry.target);
      }
    }
  },
  { root: $("page-scroll"), rootMargin: "100% 0px" },
);
function freeCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}
function releasePreview(slot) {
  previewQueue.delete(slot);
  previewControllers.get(slot)?.abort();
  previewControllers.delete(slot);
  freeCanvas(slot.querySelector(".page-preview"));
  delete slot.dataset.preview;
}
function previewKey(doc, page, slot) {
  return JSON.stringify([
    pdfDark,
    slot.dataset.scale,
    page.sourceId,
    page.index,
    page.rotation,
    page.baseRotation,
    page.elements,
    (page.widgets || []).map(
      (widget) => doc.formValues[fieldKey(page, widget.name)],
    ),
  ]);
}
function schedulePreview(slot) {
  const doc = active(),
    page = doc?.pages.find((candidate) => candidate.id === slot.dataset.page);
  if (
    !page ||
    page.id === doc.current ||
    !nearSlots.has(slot) ||
    slot.dataset.preview === previewKey(doc, page, slot)
  )
    return;
  previewQueue.add(slot);
  void drainPreviews();
}
async function drainPreviews() {
  if (renderingPreview) return;
  renderingPreview = true;
  try {
    while (previewQueue.size) {
      const slot = previewQueue.values().next().value;
      previewQueue.delete(slot);
      const doc = active(),
        page = doc?.pages.find((candidate) => candidate.id === slot.dataset.page);
      if (!page || !slot.isConnected || page.id === doc.current) continue;
      const key = previewKey(doc, page, slot);
      if (slot.dataset.preview === key) continue;
      const canvas = document.createElement("canvas"),
        controller = new AbortController();
      canvas.className = "page-preview";
      previewControllers.set(slot, controller);
      try {
        await renderer.render(
          page,
          canvas,
          Number(slot.dataset.scale) * Math.min(devicePixelRatio || 1, 2),
          { preview: true, document: doc, darkMode: pdfDark, signal: controller.signal },
        );
        if (controller.signal.aborted || !slot.isConnected)
          freeCanvas(canvas);
        else {
          const previous = slot.querySelector(".page-preview");
          if (!previous && entrance?.documentId !== doc.id)
            canvas.classList.add("appearing");
          freeCanvas(previous);
          slot.prepend(canvas);
          slot.dataset.preview = key;
        }
      } catch {
        freeCanvas(canvas);
      } finally {
        if (previewControllers.get(slot) === controller)
          previewControllers.delete(slot);
      }
    }
  } finally {
    renderingPreview = false;
  }
}
function removeSlot(slot) {
  previewObserver.unobserve(slot);
  nearSlots.delete(slot);
  releasePreview(slot);
  slot.remove();
}
function scrollToPage(id) {
  const slot = slotFor(id),
    scroller = $("page-scroll");
  if (!slot || scroller.hidden) return;
  scroller.scrollTop =
    slot.offsetTop - parseFloat(getComputedStyle(scroller).paddingTop);
}
function validLinkHistory(doc = active()) {
  if (!doc) return [];
  const ids = new Set(doc.pages.map((page) => page.id)),
    history = (linkHistory.get(doc) || []).filter((position) =>
      ids.has(position.pageId),
    );
  linkHistory.set(doc, history);
  return history;
}
function updateBackButton() {
  $("navigation-back").disabled = !validLinkHistory().length;
}
function readingPosition() {
  const page = current(),
    slot = page && slotFor(page.id),
    scroller = $("page-scroll");
  if (!slot) return null;
  return {
    pageId: page.id,
    top: (scroller.scrollTop - slot.offsetTop) / slot.offsetHeight,
    left: (scroller.scrollLeft - slot.offsetLeft) / slot.offsetWidth,
  };
}
function jumpToLink(pageId) {
  const doc = active(),
    target = slotFor(pageId),
    position = readingPosition(),
    scroller = $("page-scroll");
  if (!doc?.pages.some((page) => page.id === pageId) || !target || !position)
    return;
  const targetTop = Math.max(
    0,
    Math.min(
      scroller.scrollHeight - scroller.clientHeight,
      target.offsetTop - parseFloat(getComputedStyle(scroller).paddingTop),
    ),
  );
  if (doc.current === pageId && Math.abs(scroller.scrollTop - targetTop) < 1)
    return;
  const history = validLinkHistory(doc);
  history.push(position);
  if (history.length > 100) history.shift();
  selectPage(pageId);
}
function navigateBack() {
  const doc = active(),
    position = validLinkHistory(doc).pop();
  if (!position) return;
  selectPage(position.pageId);
  const generation = renderGeneration;
  const restore = () => {
    if (
      active() !== doc ||
      generation !== renderGeneration ||
      doc.current !== position.pageId
    )
      return;
    const slot = slotFor(position.pageId),
      scroller = $("page-scroll");
    if (!slot) return;
    scroller.scrollTop = slot.offsetTop + position.top * slot.offsetHeight;
    scroller.scrollLeft = slot.offsetLeft + position.left * slot.offsetWidth;
  };
  restore();
  requestAnimationFrame(restore);
}
function visibleHeight(slot, top, bottom) {
  return Math.max(
    0,
    Math.min(bottom, slot.offsetTop + slot.offsetHeight) -
      Math.max(top, slot.offsetTop),
  );
}
function keepStageCanvas(slot) {
  if (!slot?.isConnected || slot.querySelector(".page-preview")) return;
  if (mainCanvasPage !== slot.dataset.page) return;
  const canvas = $("page-canvas"),
    replacement = document.createElement("canvas");
  replacement.id = "page-canvas";
  canvas.replaceWith(replacement);
  canvas.removeAttribute("id");
  canvas.className = "page-preview";
  slot.prepend(canvas);
}
function sizeSlot(slot, page, pageScale) {
  const size = displayedSize(page),
    width = `${size.width * pageScale}px`,
    height = `${size.height * pageScale}px`;
  slot.dataset.scale = String(pageScale);
  if (slot.style.width === width && slot.style.height === height) return false;
  slot.style.width = width;
  slot.style.height = height;
  return true;
}
function dropStaleCanvases() {
  for (const canvas of $("page-stage").querySelectorAll("canvas.stale"))
    freeCanvas(canvas);
}
function followViewport() {
  const doc = active(),
    page = current(),
    stage = $("page-stage"),
    scroller = $("page-scroll"),
    anchor = stage.parentElement;
  if (!page || typeof zoom !== "string" || !anchor?.classList.contains("page-slot"))
    return;
  const pages = new Map(doc.pages.map((candidate) => [candidate.id, candidate])),
    slots = [...$("page-flow").children],
    scales = slots.map((slot) => {
      const candidate = pages.get(slot.dataset.page);
      return candidate && desiredScale(candidate);
    }),
    next = scales[slots.indexOf(anchor)],
    offset = scroller.scrollTop - anchor.offsetTop,
    height = anchor.offsetHeight;
  if (!next) return;
  let resized = false;
  slots.forEach((slot, index) => {
    if (scales[index] && sizeSlot(slot, pages.get(slot.dataset.page), scales[index]))
      resized = true;
  });
  stage.style.scale = next === scale ? "" : String(next / scale);
  if (resized)
    scroller.scrollTop =
      anchor.offsetTop +
      (offset < 0 ? offset : (offset / height) * anchor.offsetHeight);
}
function renderFlow(doc, page) {
  const flow = $("page-flow"),
    scroller = $("page-scroll"),
    stage = $("page-stage");
  if (!doc || !page) {
    scroller.append(stage);
    for (const slot of [...flow.children]) removeSlot(slot);
    delete flow.dataset.document;
    return;
  }
  const fresh = flow.dataset.document !== doc.id;
  if (fresh) {
    scroller.append(stage);
    for (const slot of [...flow.children]) removeSlot(slot);
    flow.dataset.document = doc.id;
  }
  const existing = new Map(
      [...flow.children].map((slot) => [slot.dataset.page, slot]),
    ),
    previousSlot = stage.parentElement.classList.contains("page-slot")
      ? stage.parentElement
      : null,
    anchorSlot = previousSlot && !fresh ? previousSlot : null,
    anchorRatio = anchorSlot
      ? (scroller.scrollTop - anchorSlot.offsetTop) / anchorSlot.offsetHeight
      : 0;
  let resized = false;
  const slots = doc.pages.map((candidate) => {
    let slot = existing.get(candidate.id);
    existing.delete(candidate.id);
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "page-slot";
      slot.dataset.page = candidate.id;
      previewObserver.observe(slot);
    }
    if (sizeSlot(slot, candidate, candidate === page ? scale : desiredScale(candidate)))
      resized = true;
    return slot;
  });
  const target = slots[doc.pages.indexOf(page)];
  if (previousSlot !== target) {
    keepStageCanvas(previousSlot);
    dropStaleCanvases();
  }
  target.append(stage);
  if (
    slots.length !== flow.children.length ||
    slots.some((slot, index) => flow.children[index] !== slot)
  )
    flow.replaceChildren(...slots);
  for (const slot of existing.values()) removeSlot(slot);
  for (const slot of slots) schedulePreview(slot);
  if (fresh) scrollToPage(page.id);
  else if (resized && anchorSlot?.isConnected)
    scroller.scrollTop =
      anchorSlot.offsetTop + anchorRatio * anchorSlot.offsetHeight;
  if (
    !fresh &&
    visibleHeight(
      target,
      scroller.scrollTop,
      scroller.scrollTop + scroller.clientHeight,
    ) === 0
  )
    scrollToPage(page.id);
}
let scrollFrame = 0;
function followScroll() {
  scrollFrame = 0;
  const doc = active(),
    scroller = $("page-scroll");
  if (!doc || scroller.hidden) return;
  const top = scroller.scrollTop,
    bottom = top + scroller.clientHeight,
    currentSlot = slotFor(doc.current);
  let best = null,
    bestHeight = 0;
  for (const slot of $("page-flow").children) {
    if (slot.offsetTop > bottom) break;
    const height = visibleHeight(slot, top, bottom);
    if (height > bestHeight) {
      best = slot;
      bestHeight = height;
    }
  }
  if (
    best &&
    best !== currentSlot &&
    !(currentSlot && visibleHeight(currentSlot, top, bottom) >= bestHeight)
  )
    followPage(best.dataset.page);
}
$("page-scroll").addEventListener(
  "scroll",
  () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(followScroll);
  },
  { passive: true },
);
$("page-flow").addEventListener("pointerdown", (event) => {
  const slot = event.target.closest(".page-slot");
  if (slot && !slot.contains($("page-stage"))) followPage(slot.dataset.page);
});
async function renderPage({ animate = false, preserveNavigation = false } = {}) {
  if (textEditor && textEditor.page !== current()) finishTextEdit();
  const generation = ++renderGeneration;
  cancelContentFade($("page-stage"));
  cancelContentFade($("welcome"));
  renderer.cancelMain();
  textLayer?.cancel();
  textLayer = null;
  $("text-layer").replaceChildren();
  delete $("text-layer").dataset.page;
  $("link-layer").replaceChildren();
  const page = current(),
    doc = active();
  if (entrance && entrance.documentId !== doc?.id) dropEntrance();
  const entering = !!page && enteringDocument === doc?.id;
  if (doc?.id === enteringDocument) enteringDocument = null;
  const reveal = animate || (
    preserveNavigation && pendingPageReveal !== null &&
    pendingPageReveal?.documentId === doc?.id &&
    pendingPageReveal?.pageId === page?.id
  );
  pendingPageReveal = reveal && page ? { documentId: doc.id, pageId: page.id } : null;
  markOutline();
  updateBackButton();
  setHidden($("welcome"), !!page || doc?.kind === "epub");
  $("epub-reader").hidden = doc?.kind !== "epub";
  $("epub-reader").inert = doc?.kind !== "epub";
  $("epub-reader").setAttribute("aria-hidden", String(doc?.kind !== "epub"));
  $("editor").setAttribute("aria-label", doc?.kind === "epub" ? "EPUB-Leseansicht" : "PDF-Bearbeitungsfläche");
  setHidden($("page-scroll"), !page);
  setHidden($("view-pill"), !page);
  updateHistoryControls();
  document
    .querySelectorAll(".document-action")
    .forEach((button) => (button.disabled = !page));
  $("total-pages").textContent = String(doc?.pages.length || 0);
  $("current-page").value = page ? doc.pages.indexOf(page) + 1 : 1;
  $("current-page").max = doc?.pages.length || 1;
  if (!page) {
    void renderWelcomeRecent();
    renderFlow(null);
    $("element-layer").replaceChildren();
    $("form-layer").replaceChildren();
    if (doc?.kind === "epub") {
      try {
        await doc.reader.show($("epub-books"), () => {
          if (active() === doc) updateEpubControls();
        }, report);
      } catch (error) {
        if (active() === doc) report(error);
      }
      if (active() !== doc) doc.reader.hide();
    } else if (animate) fadeContent($("welcome"));
    return;
  }
  scale = desiredScale(page);
  renderFlow(doc, page);
  if (entering) startEntrance(doc);
  renderedViewport = viewportKey();
  const size = displayedSize(page);
  const stage = $("page-stage");
  stage.style.width = `${size.width * scale}px`;
  stage.style.height = `${size.height * scale}px`;
  stage.style.scale = "";
  stage.dataset.tool = tool;
  const old = $("page-canvas"),
    canvas = document.createElement("canvas"),
    keep =
      mainCanvasPage === page.id &&
      Math.abs(old.width / old.height - size.width / size.height) < 0.01;
  mainCanvasPage = null;
  canvas.id = "page-canvas";
  canvas.className = "pending";
  if (keep) {
    old.removeAttribute("id");
    old.className = "stale";
    old.after(canvas);
  } else {
    dropStaleCanvases();
    old.replaceWith(canvas);
  }
  $("page-loading").hidden = false;
  renderElements();
  renderForms();
  const layersReady = Promise.all([
    renderTextLayer(page, generation),
    renderLinks(page, generation),
  ]);
  try {
    await renderer.render(
      page,
      canvas,
      scale * Math.min(devicePixelRatio || 1, 2),
      { main: true, darkMode: pdfDark },
    );
    await layersReady;
    if (generation === renderGeneration) {
      canvas.classList.remove("pending");
      dropStaleCanvases();
      $("page-loading").hidden = true;
      mainCanvasPage = page.id;
      pendingPageReveal = null;
      if (entrance?.documentId === doc.id) playEntrance();
      else if (reveal) fadeContent(stage);
    }
  } catch (error) {
    if (generation === renderGeneration) {
      canvas.classList.remove("pending");
      dropStaleCanvases();
      pendingPageReveal = null;
      playEntrance();
      $("page-loading").hidden = true;
      if (
        error.name !== "RenderingCancelledException" &&
        error.name !== "AbortException"
      )
        report(
          new Error(
            "Die Vorschau konnte nicht geladen werden. " + describeError(error),
          ),
        );
    }
  } finally {
    if (!old.isConnected) {
      old.width = 0;
      old.height = 0;
    }
  }
}
async function renderTextLayer(page, generation) {
  const container = document.createElement("div");
  container.id = "text-layer";
  container.className = "textLayer";
  container.style.setProperty("--total-scale-factor", String(scale));
  let layer;
  try {
    layer = await renderer.textLayer(page, container, scale);
    if (!layer || generation !== renderGeneration) return;
    $("text-layer").replaceWith(container);
    textLayer = layer;
    await layer.render();
  } catch {
    return;
  }
  if (generation !== renderGeneration) return;
  const end = document.createElement("div");
  end.className = "endOfContent";
  container.append(end);
  container.dataset.page = page.id;
  container.addEventListener("pointerdown", () =>
    container.classList.add("selecting"),
  );
  applySearchHighlights();
}
const search = {
  query: "",
  documentId: null,
  generation: 0,
  results: [],
  total: 0,
  pending: false,
  active: null,
  reveal: false,
  timer: 0,
};
function searchOpen() {
  return !$("search-bar").hidden;
}
function matchNumber() {
  if (!search.active) return 0;
  let number = 0;
  for (const result of search.results) {
    if (result.pageId === search.active.pageId)
      return number + search.active.ordinal + 1;
    number += result.count;
  }
  return 0;
}
function matchAt(number) {
  for (const result of search.results) {
    if (number < result.count)
      return { pageId: result.pageId, ordinal: number };
    number -= result.count;
  }
  return null;
}
function updateSearchCount() {
  let text = "";
  if (search.query && search.total)
    text = `${matchNumber()}/${search.total}${search.pending ? " …" : ""}`;
  else if (search.query) text = search.pending ? "Suche …" : "Keine Treffer";
  $("search-count").textContent = text;
  $("search-input").classList.toggle(
    "no-match",
    !!search.query && !search.pending && !search.total,
  );
}
function revealRange(range) {
  const scroller = $("page-scroll"),
    rect = range.getBoundingClientRect(),
    box = scroller.getBoundingClientRect(),
    margin = Math.min(60, box.height / 4);
  if (rect.top < box.top + margin)
    scroller.scrollTop -= box.top + margin - rect.top;
  else if (rect.bottom > box.bottom - margin)
    scroller.scrollTop += rect.bottom - box.bottom + margin;
  if (rect.left < box.left + margin)
    scroller.scrollLeft -= box.left + margin - rect.left;
  else if (rect.right > box.right - margin)
    scroller.scrollLeft += rect.right - box.right + margin;
}
function applySearchHighlights() {
  CSS.highlights?.delete("search-match");
  CSS.highlights?.delete("search-current");
  const doc = active(),
    layer = $("text-layer");
  if (
    !doc ||
    !searchOpen() ||
    !search.query ||
    layer.dataset.page !== doc.current
  )
    return;
  const nodes = [],
    segments = [],
    walker = document.createTreeWalker(
      layer,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) {
      nodes.push(node);
      segments.push(node.data);
    } else if (node.tagName === "BR") {
      nodes.push(null);
      segments.push("\n");
    }
  }
  const ranges = findMatches(segments, search.query).map(({ start, end }) => {
    const range = document.createRange();
    range.setStart(nodes[start.segment], start.offset);
    range.setEnd(nodes[end.segment], end.offset);
    return range;
  });
  const selected =
    search.active?.pageId === doc.current
      ? ranges[Math.min(search.active.ordinal, ranges.length - 1)]
      : null;
  if (CSS.highlights) {
    CSS.highlights.set(
      "search-match",
      new Highlight(...ranges.filter((range) => range !== selected)),
    );
    if (selected) CSS.highlights.set("search-current", new Highlight(selected));
  }
  if (selected && search.reveal) {
    search.reveal = false;
    revealRange(selected);
  }
}
function showMatch() {
  const doc = active();
  if (!doc || !search.active) return;
  search.reveal = true;
  if (doc.current !== search.active.pageId) selectPage(search.active.pageId);
  else applySearchHighlights();
}
async function runSearch({ fresh = false, jump = false } = {}) {
  clearTimeout(search.timer);
  const generation = ++search.generation,
    doc = active(),
    query = normalizeQuery($("search-input").value),
    previous = fresh ? null : search.active;
  search.query = query;
  search.documentId = doc?.id ?? null;
  search.results = [];
  search.total = 0;
  search.active = null;
  search.pending = !!(doc && query && searchOpen());
  if (!search.pending) {
    updateSearchCount();
    applySearchHighlights();
    return;
  }
  updateSearchCount();
  const start = doc.pages.findIndex((page) => page.id === doc.current);
  for (const [index, page] of doc.pages.entries()) {
    let segments = null;
    try {
      segments = await renderer.pageText(page);
    } catch {}
    if (generation !== search.generation) return;
    const count = segments ? findMatches(segments, query).length : 0;
    if (count) {
      search.results.push({ pageId: page.id, count });
      search.total += count;
      if (!previous && !search.active && index >= start) {
        search.active = { pageId: page.id, ordinal: 0 };
        updateSearchCount();
        if (jump) showMatch();
        else applySearchHighlights();
      }
    }
    if (index % 50 === 49) updateSearchCount();
  }
  search.pending = false;
  const kept = previous
    ? search.results.find((result) => result.pageId === previous.pageId)
    : null;
  if (kept)
    search.active = {
      pageId: kept.pageId,
      ordinal: Math.min(previous.ordinal, kept.count - 1),
    };
  else if (!search.active && search.results.length) {
    search.active = { pageId: search.results[0].pageId, ordinal: 0 };
    if (jump) showMatch();
  }
  updateSearchCount();
  applySearchHighlights();
}
function stepMatch(delta) {
  const doc = active();
  if (!doc || !search.total) return;
  if (search.active?.pageId === doc.current)
    search.active = matchAt(
      (matchNumber() - 1 + delta + search.total) % search.total,
    );
  else {
    const position = new Map(doc.pages.map((page, index) => [page.id, index])),
      currentIndex = position.get(doc.current),
      candidates =
        delta > 0
          ? search.results.filter(
              (result) => position.get(result.pageId) >= currentIndex,
            )
          : search.results.filter(
              (result) => position.get(result.pageId) <= currentIndex,
            ),
      result =
        delta > 0
          ? candidates[0] || search.results[0]
          : candidates.at(-1) || search.results.at(-1);
    search.active = {
      pageId: result.pageId,
      ordinal: delta > 0 ? 0 : result.count - 1,
    };
  }
  updateSearchCount();
  showMatch();
}
function openSearch() {
  if (!current()) return;
  const input = $("search-input"),
    selection = getSelection(),
    selected = selection?.toString().trim() ?? "",
    wasOpen = searchOpen();
  let refill = false;
  if (
    selected &&
    !selected.includes("\n") &&
    $("text-layer").contains(selection.anchorNode)
  ) {
    refill = normalizeQuery(selected) !== normalizeQuery(input.value);
    input.value = selected;
  }
  setHidden($("search-bar"), false);
  $("search-button").setAttribute("aria-expanded", "true");
  input.focus();
  input.select();
  if (!wasOpen || refill) void runSearch({ fresh: true, jump: true });
}
function closeSearch(restoreFocus = false) {
  if (!searchOpen()) return;
  const focused = $("search-bar").contains(document.activeElement);
  clearTimeout(search.timer);
  search.generation++;
  setHidden($("search-bar"), true);
  $("search-button").setAttribute("aria-expanded", "false");
  search.query = "";
  search.results = [];
  search.total = 0;
  search.pending = false;
  search.active = null;
  applySearchHighlights();
  if (restoreFocus || focused) $("search-button").focus();
}
$("search-input").addEventListener("input", () => {
  clearTimeout(search.timer);
  search.timer = setTimeout(
    () => void runSearch({ fresh: true, jump: true }),
    200,
  );
});
$("search-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (normalizeQuery($("search-input").value) !== search.query)
      void runSearch({ fresh: true, jump: true });
    else stepMatch(event.shiftKey ? -1 : 1);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeSearch(true);
  }
});
$("page-stage").addEventListener("mouseup", (event) => {
  if (
    event.button !== 0 ||
    event.target.closest("input, textarea, [contenteditable=true]")
  )
    return;
  const selection = getSelection(),
    layer = $("text-layer");
  if (
    selection?.toString().trim() &&
    layer.contains(selection.anchorNode) &&
    layer.contains(selection.focusNode)
  )
    event.preventDefault();
});
document.addEventListener("pointerup", () =>
  $("text-layer").classList.remove("selecting"),
);
async function renderLinks(page, generation) {
  let links;
  try {
    links = await renderer.links(page);
  } catch {
    return;
  }
  const doc = active();
  if (generation !== renderGeneration || !doc) return;
  for (const [index, link] of links.entries()) {
    const anchor = document.createElement("a");
    anchor.dataset.link = String(index);
    if (link.url) {
      const url = safeUrl(link.url);
      if (!url) continue;
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.title = url;
    } else {
      const target = linkTarget(doc, link);
      if (!target) continue;
      anchor.href = "#";
      anchor.title = `Seite ${doc.pages.indexOf(target) + 1}`;
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        jumpToLink(target.id);
      });
    }
    anchor.setAttribute("aria-label", anchor.title);
    const rect = displayRect(page, link.rect);
    anchor.style.left = `${rect.x * scale}px`;
    anchor.style.top = `${rect.y * scale}px`;
    anchor.style.width = `${rect.width * scale}px`;
    anchor.style.height = `${rect.height * scale}px`;
    $("link-layer").append(anchor);
  }
  flashPendingLink();
}
function addSelectionControls(item) {
  const handle = document.createElement("span");
  handle.className = "resize-handle";
  if (item.dataset.type === "comment") handle.hidden = true;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "annotation-delete";
  remove.dataset.action = "delete-element";
  remove.setAttribute("aria-label", "Element löschen");
  remove.title = "Element löschen (Entf)";
  remove.innerHTML = icon("trash");
  item.append(handle, remove);
}
function renderElements() {
  const page = current(),
    field = textEditor?.field,
    refocus = !!field && document.activeElement === field,
    caret = field && [field.selectionStart, field.selectionEnd];
  $("element-layer").replaceChildren();
  if (!page) return;
  for (const el of page.elements) {
    const item = document.createElement("div");
    item.className = `annotation${el.id === selectedElement ? " selected" : ""}`;
    item.dataset.id = el.id;
    item.dataset.type = el.type;
    item.dataset.label = {
      text: "Text",
      image: "Bild",
      highlight: "Textmarker",
      draw: el.marker ? "Textmarker" : "Zeichnung",
      comment: "Kommentar",
    }[el.type];
    const [x, y] = displayPoint(page, el.x, el.y);
    item.style.left = `${x * scale}px`;
    item.style.top = `${y * scale}px`;
    item.style.width = `${el.width * scale}px`;
    item.style.height = `${el.height * scale}px`;
    item.style.transform = `rotate(${normalizeAngle((page.baseRotation || 0) + page.rotation - el.angle)}deg)`;
    if (el.type === "text") {
      if (textEditor?.id === el.id) {
        item.classList.add("editing");
        item.append(textEditor.field);
      } else item.textContent = el.text;
      item.style.fontSize = `${el.fontSize * scale}px`;
      item.style.fontWeight = el.bold ? "700" : "400";
      item.style.color = pdfDark ? darkTextColor(el.color) : el.color;
      item.style.opacity = el.opacity ?? 1;
    }
    if (el.type === "highlight") {
      if (el.rects)
        for (const [rx, ry, rw, rh] of el.rects) {
          const part = document.createElement("span");
          part.className = "highlight-part";
          part.style.left = `${rx * 100}%`;
          part.style.top = `${ry * 100}%`;
          part.style.width = `${rw * 100}%`;
          part.style.height = `${rh * 100}%`;
          part.style.background = el.color;
          item.append(part);
        }
      else item.style.background = el.color;
      item.style.opacity = el.opacity ?? 0.35;
    }
    if (el.type === "image") {
      const img = document.createElement("img");
      img.alt = "Eingefügtes Bild";
      const asset = assets.get(el.assetId);
      if (asset) img.src = asset.url;
      item.append(img);
      item.style.opacity = el.opacity ?? 1;
    }
    if (el.type === "draw") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", `0 0 ${el.width} ${el.height}`);
      svg.setAttribute("preserveAspectRatio", "none");
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute(
        "d",
        (el.paths || [el.points])
          .map((points) =>
            points
              .map(
                ([px, py], i) =>
                  `${i ? "L" : "M"}${px * el.width} ${py * el.height}`,
              )
              .join(" "),
          )
          .join(" "),
      );
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", el.color);
      path.setAttribute("stroke-width", el.strokeWidth || 2);
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.append(path);
      item.append(svg);
      item.style.opacity = el.opacity ?? 1;
    }
    if (el.type === "comment") {
      const summary = el.text.trim().split("\n")[0] || "Leerer Kommentar";
      item.classList.toggle("done", !!el.done);
      item.style.width = item.style.height = "26px";
      item.style.setProperty("--comment", el.color);
      item.innerHTML = icon(el.done ? "check" : "message");
      item.title = summary;
      item.setAttribute("aria-label", `Kommentar: ${summary}`);
    }
    if (el.id === selectedElement) addSelectionControls(item);
    $("element-layer").append(item);
  }
  syncAnnotationSelection();
  syncCommentSelection();
  if (refocus && field.isConnected) {
    field.focus();
    field.setSelectionRange(...caret);
  }
}
let pendingFieldFocus = null;
const formControls = "input:not(:disabled), select:not(:disabled), textarea:not(:disabled)";
function blankValue(value) {
  return value == null || value === "" || (Array.isArray(value) && !value.length);
}
function choiceLabel(widget, value) {
  const index = widget.options.indexOf(value);
  return index < 0 ? value : (widget.labels?.[index] ?? value);
}
const measureContext = document.createElement("canvas").getContext("2d");
function fitFormControl(input, widget, width, height) {
  if (
    !(widget.type === "text" || (widget.type === "select" && widget.editable)) ||
    widget.comb
  )
    return;
  const size = fitFontSize(
    widget.password ? "•".repeat(input.value.length) : input.value,
    {
      width,
      height,
      size: widget.fontSize,
      multiline: widget.multiline,
      measure: (text, value) => {
        measureContext.font = `${value}px Noto`;
        return measureContext.measureText(text).width;
      },
    },
  );
  input.style.fontSize = `${size * scale}px`;
}
function updateFormControl(input, widget, value) {
  if (widget.type === "checkbox" || widget.type === "radio")
    input.checked = widget.on !== "" && value === widget.on;
  else if (widget.type === "select" && widget.editable)
    input.value = choiceLabel(widget, [value].flat()[0] ?? "");
  else if (widget.type === "select" || widget.type === "list") {
    for (const option of input.options)
      option.selected = Array.isArray(value)
        ? value.includes(option.value)
        : value === option.value;
  } else input.value = value ?? "";
  input.classList.toggle("field-missing", widget.required && blankValue(value));
}
function renderForms() {
  $("form-layer").replaceChildren();
  const page = current(),
    doc = active();
  if (!page) return;
  const controls = [];
  for (const [index, widget] of (page.widgets || []).entries()) {
    if (widget.type === "unsupported") continue;
    const key = fieldKey(page, widget.name),
      value = doc.formValues[key] ?? widget.value;
    const width = widget.rect[2] - widget.rect[0],
      height = widget.rect[3] - widget.rect[1],
      fontSize = widget.fontSize || Math.min(12, height * 0.72);
    let input;
    if (widget.type === "select" && widget.editable) {
      input = document.createElement("input");
      input.type = "text";
      const list = document.createElement("datalist");
      list.id = `form-options-${index}`;
      widget.options.forEach((option, i) =>
        list.append(new Option(widget.labels?.[i] ?? option)),
      );
      input.setAttribute("list", list.id);
      $("form-layer").append(list);
    } else if (widget.type === "select" || widget.type === "list") {
      input = document.createElement("select");
      input.multiple = widget.type === "list" && widget.multiSelect;
      if (widget.type === "list") input.size = Math.max(2, widget.options.length);
      else input.add(new Option("", ""));
      widget.options.forEach((option, i) => {
        const entry = new Option(widget.labels?.[i] ?? option, option);
        input.add(entry);
      });
      for (const entry of [value].flat())
        if (entry && !widget.options.includes(entry))
          input.add(new Option(entry, entry));
    } else if (widget.type === "text" && widget.multiline)
      input = document.createElement("textarea");
    else {
      input = document.createElement("input");
      input.type =
        widget.type === "checkbox"
          ? "checkbox"
          : widget.type === "radio"
            ? "radio"
            : widget.password
              ? "password"
              : "text";
    }
    input.setAttribute("aria-label", widget.name);
    input.title = widget.name;
    input.dataset.field = widget.name;
    input.dataset.widget = String(index);
    input.disabled = widget.readonly || tool !== "select";
    input.required = widget.required;
    input.spellcheck = widget.spellcheck ?? true;
    if (widget.type === "text" && widget.maxLength)
      input.maxLength = widget.maxLength;
    if (widget.type === "radio") {
      input.name = key;
      input.value = widget.on;
    }
    updateFormControl(input, widget, value);
    controls.push({ input, widget, key, width, height });
    const [left, top] = displayPoint(page, widget.rect[0], widget.rect[3]);
    input.style.left = `${left * scale}px`;
    input.style.top = `${top * scale}px`;
    input.style.width = `${width * scale}px`;
    input.style.height = `${height * scale}px`;
    input.style.transformOrigin = "0 0";
    input.style.transform = `rotate(${normalizeAngle((page.baseRotation || 0) + page.rotation)}deg)`;
    input.style.fontSize = `${fontSize * scale}px`;
    fitFormControl(input, widget, width, height);
    input.addEventListener("input", () =>
      fitFormControl(input, widget, width, height),
    );
    input.style.textAlign = widget.align || "left";
    if (widget.color) input.style.setProperty("--field-color", widget.color);
    if (widget.background) input.style.setProperty("--field-bg", widget.background);
    if (widget.border) input.style.setProperty("--field-border", widget.border);
    if (widget.comb && widget.maxLength) {
      const cell = (width * scale) / widget.maxLength,
        spacing = Math.max(0, cell - fontSize * scale * 0.6);
      input.classList.add("comb");
      input.style.letterSpacing = `${spacing}px`;
      input.style.paddingLeft = `${spacing / 2}px`;
      input.style.textAlign = "left";
    }
    const commit = (next) => {
      edit(doc, "Formularfeld ausfüllen", () => {
        doc.formValues[key] = next;
      });
      renderDocuments();
      renderThumbnails();
      updateHistoryControls();
      for (const control of controls)
        if (control.key === key) {
          updateFormControl(control.input, control.widget, next);
          fitFormControl(control.input, control.widget, control.width, control.height);
        }
    };
    input.addEventListener("focus", () => {
      if (selectedElement) {
        selectedElement = null;
        renderElements();
        renderSettings();
      }
    });
    if (widget.type === "radio" && widget.toggleOff) {
      let wasChecked = false;
      input.addEventListener("pointerdown", () => {
        wasChecked = input.checked;
      });
      input.addEventListener("click", () => {
        if (!wasChecked || input.disabled) return;
        wasChecked = false;
        input.checked = false;
        commit("");
      });
    }
    input.addEventListener("change", () => {
      if (input.disabled) return;
      if (widget.type === "select" && widget.editable) {
        const index = widget.labels.indexOf(input.value);
        commit(
          input.value
            ? [index < 0 ? input.value : widget.options[index]]
            : [],
        );
        return;
      }
      commit(
        widget.type === "checkbox"
          ? input.checked
            ? widget.on
            : ""
          : widget.type === "radio"
            ? input.value
            : widget.type === "select" || widget.type === "list"
              ? [...input.selectedOptions]
                  .map((option) => option.value)
                  .filter(Boolean)
              : input.value,
      );
    });
    $("form-layer").append(input);
  }
  if (pendingFieldFocus) {
    const target = pendingFieldFocus([
      ...$("form-layer").querySelectorAll(formControls),
    ]);
    pendingFieldFocus = null;
    target?.focus();
  }
}
$("form-layer").addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey)
    return;
  const fields = [...$("form-layer").querySelectorAll(formControls)],
    edge = event.shiftKey ? fields[0] : fields.at(-1);
  if (
    !edge ||
    (event.target !== edge &&
      !(event.target.type === "radio" && event.target.name === edge.name))
  )
    return;
  const doc = active(),
    step = event.shiftKey ? -1 : 1;
  let index = doc.pages.findIndex((page) => page.id === doc.current) + step;
  while (
    index >= 0 &&
    index < doc.pages.length &&
    !(doc.pages[index].widgets || []).some(
      (widget) => widget.type !== "unsupported" && !widget.readonly,
    )
  )
    index += step;
  if (index < 0 || index >= doc.pages.length) return;
  event.preventDefault();
  event.target.blur();
  pendingFieldFocus = (inputs) => (event.shiftKey ? inputs.at(-1) : inputs[0]);
  selectPage(doc.pages[index].id);
});
function missingRequired(doc) {
  const missing = new Map();
  for (const page of doc.pages)
    for (const widget of page.widgets || []) {
      const key = fieldKey(page, widget.name);
      if (
        widget.required &&
        !widget.readonly &&
        widget.type !== "unsupported" &&
        !missing.has(key) &&
        blankValue(doc.formValues[key] ?? widget.value)
      )
        missing.set(key, { page, widget });
    }
  return [...missing.values()];
}
async function confirmRequired(doc, acceptLabel) {
  commitPendingInput();
  const missing = doc?.kind === "pdf" ? missingRequired(doc) : [];
  if (!missing.length) return true;
  if (
    await confirmAction(
      "Pflichtfelder offen",
      missing.length === 1
        ? "Ein Pflichtfeld ist noch leer."
        : `${missing.length} Pflichtfelder sind noch leer.`,
      acceptLabel,
    )
  )
    return true;
  const [{ page, widget }] = missing;
  pendingFieldFocus = (inputs) =>
    inputs.find((input) => input.dataset.field === widget.name);
  if (doc.current === page.id) renderForms();
  else selectPage(page.id);
  return false;
}
function resetForm(doc) {
  if (!Object.keys(doc.formValues).length) return;
  if (doc === active()) commitPendingInput();
  edit(doc, "Formular zurücksetzen", () => {
    doc.formValues = {};
  });
  if (doc === active()) changed();
  else renderDocuments();
}
function resetFormItem(doc) {
  return doc?.kind === "pdf" &&
    doc.pages.some((page) => page.widgets?.length)
    ? [
        contextItem(
          "Formular zurücksetzen",
          !Object.keys(doc.formValues).length,
          async () => resetForm(doc),
        ),
      ]
    : [];
}
const toolStyles = {
  text: { color: "#354a63", fontSize: 16, returnToSelect: true },
  highlight: {
    color: "#f1ce54",
    strokeWidth: 14,
    textOnly: false,
    returnToSelect: true,
  },
  draw: { color: "#354a63", strokeWidth: 2, returnToSelect: true },
  comment: { returnToSelect: true },
};
const markerOpacity = 0.35;
function updateToolCursors() {
  const stage = $("page-stage");
  stage.style.setProperty(
    "--cursor-draw",
    cursorIcon("pen", { color: toolStyles.draw.color, hotspot: [3, 21] }),
  );
  stage.style.setProperty(
    "--cursor-highlight",
    cursorIcon("highlighter", {
      color: toolStyles.highlight.color,
      hotspot: [4, 19],
    }),
  );
  stage.style.setProperty(
    "--cursor-comment",
    cursorIcon("message", { color: commentColor, hotspot: [12, 12] }),
  );
  stage.style.setProperty(
    "--cursor-erase",
    cursorIcon("eraser", { hotspot: [4, 18] }),
  );
  stage.classList.toggle("text-only", !!toolStyles.highlight.textOnly);
}
updateToolCursors();
const fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const toolStyleOptions = {
  text: {
    label: "Text",
    colors: [
      ["#1f1f1f", "Schwarz"],
      ["#354a63", "Dunkelblau"],
      ["#2f6fdf", "Blau"],
      ["#2e9a4e", "Grün"],
      ["#d93a3a", "Rot"],
      ["#e08a1e", "Orange"],
    ],
  },
  highlight: {
    label: "Textmarker",
    colors: [
      ["#f1ce54", "Gelb"],
      ["#7ee05e", "Grün"],
      ["#6fd0f2", "Cyan"],
      ["#f59ad3", "Pink"],
      ["#f05a5a", "Rot"],
    ],
    widths: [4, 30],
  },
  draw: {
    label: "Stift",
    colors: [
      ["#1f1f1f", "Schwarz"],
      ["#354a63", "Dunkelblau"],
      ["#2f6fdf", "Blau"],
      ["#2e9a4e", "Grün"],
      ["#d93a3a", "Rot"],
      ["#e08a1e", "Orange"],
    ],
    widths: [1, 12],
  },
  comment: { label: "Kommentar" },
};
function renderSettings() {
  const threePages = active()?.pages.length === 3;
  $("sheet-options").querySelector('[data-sheet="3"]').disabled = !threePages;
  if (perSheet === 3 && !threePages) selectSheet(2);
  else updateLayoutSummary();
}
function selectSheet(value) {
  perSheet = value;
  for (const button of $("sheet-options").querySelectorAll("[data-sheet]")) {
    const selected = Number(button.dataset.sheet) === value;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  updateLayoutSummary();
}
function updateLayoutSummary() {
  let valid = false;
  try {
    const doc = active();
    if (!doc?.pages.length) {
      $("layout-summary").textContent =
        "Öffne ein Dokument, um ein Drucklayout zu erstellen.";
      return;
    }
    const plan = layoutPlan(doc.pages.length, layoutOptions());
    $("layout-summary").textContent =
      `${plan.sheets.length} Ausgabeblätter${plan.copies ? ` · ${plan.copies} mal drucken` : ""}`;
    valid = true;
  } catch (error) {
    $("layout-summary").textContent = error.message;
  } finally {
    $("layout-submit").disabled = !valid;
    $("layout-view").disabled = !valid;
  }
}
function layoutOptions() {
  return {
    perSheet: perSheet === 3 ? 2 : perSheet,
    special: perSheet === 3,
    padding: $("layout-padding").value,
    students: $("layout-students").value
      ? Number($("layout-students").value)
      : null,
    autoOrientation: $("layout-auto").checked,
  };
}
let outlineGeneration = 0;
let outlineDocumentId = null;
function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function outlineEntry(doc, sourceId, entry, depth) {
  const item = document.createElement("li");
  const row = document.createElement("div");
  row.className = "outline-row";
  row.style.setProperty("--depth", depth);
  let children;
  if (entry.items.length) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "icon-button outline-toggle";
    toggle.innerHTML = icon("right");
    toggle.setAttribute("aria-label", `${entry.title} auf-/zuklappen`);
    children = document.createElement("ul");
    setHidden(children, !entry.open);
    toggle.setAttribute("aria-expanded", String(!children.hidden));
    toggle.addEventListener("click", () => {
      setHidden(children, !children.hidden);
      toggle.setAttribute("aria-expanded", String(!children.hidden));
    });
    row.append(toggle);
  }
  let link;
  const url = entry.url && safeUrl(entry.url);
  if (url) {
    link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  } else {
    link = document.createElement("button");
    link.type = "button";
    const target = doc.pages.find(
      (page) => page.sourceId === sourceId && page.index === entry.index,
    );
    if (target) {
      link.dataset.page = target.id;
      link.dataset.source = sourceId;
      link.dataset.index = String(entry.index);
      link.addEventListener("click", () => jumpToLink(target.id));
    } else link.disabled = true;
  }
  link.className = "outline-link";
  link.textContent = entry.title;
  link.title = link.disabled ? "Seite nicht mehr im Dokument" : entry.title;
  row.append(link);
  item.append(row);
  if (children) {
    for (const child of entry.items)
      children.append(outlineEntry(doc, sourceId, child, depth + 1));
    item.append(children);
  }
  return item;
}
async function renderOutline() {
  const generation = ++outlineGeneration,
    doc = active();
  if (outlineDocumentId !== (doc?.id ?? null)) {
    outlineDocumentId = doc?.id ?? null;
    $("outline-list").replaceChildren();
    revealSection("outline", false);
  }
  if (doc?.kind === "epub") {
    const list = $("outline-list");
    list.replaceChildren();
    const entries = doc.reader.outline();
    const append = (parent, items, depth = 0) => {
      for (const entry of items) {
        const item = document.createElement("li"), button = document.createElement("button");
        button.type = "button";
        button.className = "outline-link epub-outline-link";
        button.style.paddingLeft = `${12 + depth * 14}px`;
        button.textContent = entry.title;
        button.addEventListener("click", () => void doc.reader.go(entry.href).catch(report));
        item.append(button);
        if (entry.items.length) {
          const children = document.createElement("ul");
          append(children, entry.items, depth + 1);
          item.append(children);
        }
        parent.append(item);
      }
    };
    const tree = document.createElement("ul");
    append(tree, entries);
    list.append(tree);
    revealSection("outline", entries.length > 0);
    return;
  }
  const sourceIds = [
    ...new Set(
      (doc?.pages || []).map((page) => page.sourceId).filter(Boolean),
    ),
  ];
  const outlines = await Promise.all(
    sourceIds.map((id) => renderer.outline(id)),
  );
  if (generation !== outlineGeneration) return;
  const list = $("outline-list");
  list.replaceChildren();
  const filled = sourceIds
    .map((id, index) => [id, outlines[index]])
    .filter(([, entries]) => entries.length);
  for (const [sourceId, entries] of filled) {
    if (filled.length > 1) {
      const heading = document.createElement("p");
      heading.className = "outline-source";
      heading.textContent = sources.get(sourceId)?.file.name || "Quelle";
      list.append(heading);
    }
    const tree = document.createElement("ul");
    for (const entry of entries)
      tree.append(outlineEntry(doc, sourceId, entry, 0));
    list.append(tree);
  }
  revealSection("outline", filled.length > 0);
  markOutline();
}
function markOutline() {
  const page = current();
  let best = null;
  for (const link of $("outline-list").querySelectorAll(
    ".outline-link[data-page]",
  )) {
    link.removeAttribute("aria-current");
    const index = Number(link.dataset.index);
    if (
      page &&
      link.dataset.source === page.sourceId &&
      index <= page.index &&
      (!best || index > Number(best.dataset.index))
    )
      best = link;
  }
  best?.setAttribute("aria-current", "true");
}
function renderAll({ animate = false } = {}) {
  for (const doc of documents) if (doc.kind === "epub" && doc.id !== activeId) doc.reader.hide();
  $("workspace").classList.toggle("reading-epub", active()?.kind === "epub");
  void renderOutline();
  renderDocuments();
  renderThumbnails();
  void renderPage({ animate });
  renderSettings();
  syncSidebar();
  if (!current()) closeSearch();
  else if (searchOpen())
    void runSearch({ fresh: search.documentId !== activeId });
}
function updateEpubControls() {
  const reader = active()?.reader;
  if (!reader) return;
  $("epub-previous").disabled = reader.index <= 0;
  $("epub-next").disabled = reader.index >= reader.chapters.length - 1;
  $("epub-chapter").textContent = `Kapitel ${reader.index + 1} / ${reader.chapters.length}`;
  $("epub-font").value = String(reader.fontSize);
  $("epub-font").disabled = reader.book.packaging.metadata.layout === "pre-paginated";
}
$("epub-previous").addEventListener("click", () => void active()?.reader?.step(-1).catch(report));
$("epub-next").addEventListener("click", () => void active()?.reader?.step(1).catch(report));
$("epub-font").addEventListener("change", () => active()?.reader?.font(Number($("epub-font").value)));
function collectResources() {
  const sourceIds = new Set(),
    assetIds = new Set();
  for (const doc of documents)
    for (const pages of [
      doc.pages,
      ...[...doc.history.past, ...doc.history.future].map(
        (entry) => entry.state.pages,
      ),
    ])
      for (const page of pages) {
        if (page.sourceId) sourceIds.add(page.sourceId);
        page.elements
          .filter((el) => el.type === "image")
          .forEach((el) => assetIds.add(el.assetId));
      }
  for (const [id, source] of sources)
    if (!sourceIds.has(id)) {
      source.password = "";
      sources.delete(id);
    }
  for (const [id, asset] of assets)
    if (!assetIds.has(id)) {
      URL.revokeObjectURL(asset.url);
      asset.bitmap?.close();
      assets.delete(id);
    }
  void renderer.disposeUnused(sourceIds);
}
async function askPassword(name, incorrect = false) {
  const dialog = $("password-dialog");
  $("password-filename").textContent = name;
  $("password-error").textContent = incorrect
    ? "Das Passwort ist nicht korrekt. Bitte erneut versuchen."
    : "";
  $("input-password").value = "";
  dialog.returnValue = "cancel";
  dialog.showModal();
  $("input-password").focus();
  return new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () => {
        const password =
          dialog.returnValue === "submit" ? $("input-password").value : null;
        $("input-password").value = "";
        resolve(password);
      },
      { once: true },
    ),
  );
}
$("password-form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("password-dialog").close("submit");
});
async function importFiles(files, handles = [], failures = []) {
  for (const [index, original] of files.entries()) {
    try {
      const fingerprint = `${original.name}:${original.size}:${original.lastModified}`;
      if (
        [...sources.values(), ...documents.filter((doc) => doc.kind === "epub")].some(
          (source) => source.fingerprint === fingerprint,
        )
      ) {
        failures.push(`${original.name}: bereits geöffnet.`);
        continue;
      }
      const mime = await validateFile(original);
      if (mime === "application/epub+zip") {
        const reader = await runJob("EPUB wird geöffnet", (job) => openEpub(original, job));
        const doc = createDocument(documentName(original.name));
        Object.assign(doc, { kind: "epub", originalType: mime, extension: fileExtension(original.name, ".epub"), reader, fingerprint, handle: handles[index] ?? null });
        addDocument(doc);
        if (handles[index] && recentSupported()) void rememberFile(handles[index]).catch(() => {});
        continue;
      }
      let file = original;
      if (mime === "image/tiff") {
        const converted = await runJob("TIFF wird in PDF umgewandelt", async (job) => processPdf("tiff-pdf", { data: await readBytes(original, job) }, job));
        file = new File([converted.data], safeName(original.name), { type: "application/pdf" });
      } else if (mime !== "application/pdf") {
        const normalized = await normalizeImage(original);
        normalized.bitmap.close();
        const converted = await runJob(
          "Bild wird in PDF umgewandelt",
          async (job) =>
            processPdf(
              "image-pdf",
              {
                data: await readBytes(normalized.file, job),
                mime: normalized.mime,
              },
              job,
            ),
        );
        file = new File([converted.data], safeName(original.name), {
          type: "application/pdf",
        });
      }
      let password = "",
        info,
        passwordAttempts = 0;
      while (true) {
        try {
          info = await runJob("PDF wird geöffnet", async (job) =>
            processPdf(
              "inspect",
              { data: await readBytes(file, job), password },
              job,
            ),
          );
          break;
        } catch (error) {
          if (error.name === "AbortError") throw error;
          if (!/password|encrypted|passwort|verschlüss/i.test(error.message))
            throw error;
          password = await askPassword(original.name, passwordAttempts++ > 0);
          if (password === null)
            throw new DOMException("Abgebrochen", "AbortError");
        }
      }
      if (info.data)
        file = new File([info.data], file.name, {
          type: "application/pdf",
          lastModified: file.lastModified,
        });
      const id = uid(),
        group = uid();
      const handle =
        mime === "application/pdf" && handles[index]?.kind === "file"
          ? handles[index]
          : null;
      sources.set(id, { id, file, password, fingerprint, handle });
      const doc = createDocument(
        documentName(original.name),
        info.pages.map((page, index) => createPage(id, index, page, group)),
      );
      doc.origin = id;
      doc.originalType = mime;
      doc.handle = handle;
      if (mime !== "application/pdf") doc.dirty = true;
      addDocument(doc);
      if (handles[index] && recentSupported())
        void rememberFile(handles[index]).catch(() => {});
      if (info.xfa)
        failures.push(
          `${original.name}: XFA-Formulare werden nicht bearbeitet. Standardfelder bleiben nutzbar.`,
        );
      if (info.signed)
        failures.push(
          `${original.name}: Eine vorhandene digitale Signatur kann durch den Export ungültig werden.`,
        );
    } catch (error) {
      if (error.name === "AbortError") break;
      failures.push(`${original.name}: ${describeError(error)}`);
    }
  }
  if (failures.length)
    message(
      `${failures.slice(0, 5).join("\n")}${failures.length > 5 ? `\n${failures.length - 5} weitere Hinweise.` : ""}`,
      true,
    );
}
$("file-input").addEventListener("change", () => {
  const files = [...$("file-input").files];
  $("file-input").value = "";
  void importFiles(files).catch(report);
});
$("file-input").accept = fileAccept;
let launchedImports = Promise.resolve();
async function importHandles(handles) {
  const results = await Promise.allSettled(handles.map((handle) => handle.getFile()));
  const files = [], readable = [], failures = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      files.push(result.value);
      readable.push(handles[index]);
    } else failures.push(`${handles[index].name}: ${describeError(result.reason)}`);
  }
  await importFiles(files, readable, failures);
}
async function importLaunchedFiles(launchHandles) {
  const handles = launchHandles.filter((handle) => handle.kind === "file");
  if (!handles.length) return;
  while (busy) await new Promise((resolve) => setTimeout(resolve, 200));
  await importHandles(handles);
}
window.launchQueue?.setConsumer((params) => {
  if (!params.files?.length) return;
  launchedImports = launchedImports
    .then(() => importLaunchedFiles([...params.files]))
    .catch(report);
});
async function openFiles() {
  if (!recentSupported()) return $("file-input").click();
  let handles;
  try {
    handles = await window.showOpenFilePicker({
      id: "pdfhelper-open",
      multiple: true,
      types: [
        {
          description: "PDF, Bilder und EPUB",
          accept: fileTypes,
        },
      ],
    });
  } catch (error) {
    if (error.name === "AbortError") return;
    throw error;
  }
  await importHandles(handles);
}
const recentTime = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});
let recentGeneration = 0,
  recentOpening = false;
function closeRecent() {
  recentGeneration++;
  recentOpening = false;
  const menu = $("recent-menu");
  const focused = menu.contains(document.activeElement);
  setHidden(menu, true);
  $("recent-button").setAttribute("aria-expanded", "false");
  if (focused) $("recent-button").focus();
}
function openRecent(entry) {
  void readRecentFile(entry)
    .then((file) => importFiles([file], [entry.handle]))
    .catch((error) => {
      void renderWelcomeRecent();
      report(error);
    });
}
const recentEntries = new WeakMap();
function liveRecentItem(item, entry) {
  if (item.isConnected) return item;
  return (
    [...document.querySelectorAll(".recent-item")].find(
      (candidate) => recentEntries.get(candidate)?.id === entry.id,
    ) ?? item
  );
}
function recentItem(entry, onOpen) {
  const item = document.createElement("button");
  recentEntries.set(item, entry);
  item.type = "button";
  item.className = "recent-item";
  const name = document.createElement("strong");
  name.textContent = entry.name;
  const time = document.createElement("span");
  time.textContent = `Geöffnet am ${recentTime.format(entry.openedAt)}`;
  item.append(name, time);
  item.title = entry.name;
  item.addEventListener("click", () => {
    onOpen();
    openRecent(entry);
  });
  return item;
}
let welcomeRecentGeneration = 0,
  welcomeRecentStale = false;
async function renderWelcomeRecent() {
  const generation = ++welcomeRecentGeneration,
    section = $("welcome-recent");
  if (!recentSupported()) {
    setHidden(section, true);
    return;
  }
  let entries;
  try {
    entries = await recentFiles();
  } catch {
    entries = [];
  }
  if (generation !== welcomeRecentGeneration) return;
  if ($("welcome-recent-list").querySelector(".name-editor")) {
    welcomeRecentStale = true;
    return;
  }
  $("welcome-recent-list").replaceChildren(
    ...entries.map((entry) => recentItem(entry, () => {})),
  );
  setHidden(section, !entries.length);
}
async function toggleRecent() {
  const menu = $("recent-menu");
  if (!menu.hidden || recentOpening) return closeRecent();
  const generation = ++recentGeneration;
  recentOpening = true;
  let entries;
  try {
    entries = await recentFiles();
  } finally {
    if (generation === recentGeneration) recentOpening = false;
  }
  if (generation !== recentGeneration) return;
  menu.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "recent-empty";
    empty.textContent = "Noch keine Dateien geöffnet.";
    menu.append(empty);
  }
  for (const entry of entries) {
    const item = recentItem(entry, closeRecent);
    item.setAttribute("role", "menuitem");
    menu.append(item);
  }
  if (entries.length) {
    const clear = document.createElement("button");
    clear.className = "recent-clear";
    clear.setAttribute("role", "menuitem");
    clear.textContent = "Liste leeren";
    clear.addEventListener("click", () => {
      closeRecent();
      void clearRecentFiles()
        .then(() => {
          void renderWelcomeRecent();
          message("Liste der zuletzt geöffneten Dateien geleert.");
        })
        .catch(report);
    });
    menu.append(clear);
  }
  setHidden(menu, false);
  $("recent-button").setAttribute("aria-expanded", "true");
  menu.querySelector("button")?.focus();
}
$("recent-button").hidden = !recentSupported();
document.addEventListener("pointerdown", (event) => {
  if (
    (!$("recent-menu").hidden || recentOpening) &&
    !event.target.closest("#open-group, #context-menu")
  )
    closeRecent();
});
function menuNavigation(menu, close, toggle) {
  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll("button")],
      index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      toggle.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  });
}
menuNavigation($("recent-menu"), closeRecent, $("recent-button"));
function steppedIndex(key, index, length) {
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[
    key
  ];
  return Math.min(length - 1, Math.max(0, index + step));
}
function listNavigation(list, selector, keys, move) {
  list.addEventListener("keydown", (event) => {
    if (!keys.includes(event.key) || event.altKey) return;
    const items = [...list.querySelectorAll(selector)],
      index = items.indexOf(event.target.closest(selector));
    if (index < 0) return;
    event.preventDefault();
    const next = items[steppedIndex(event.key, index, items.length)];
    if (next !== items[index]) move(next);
  });
}
listNavigation(
  $("annotation-list"),
  ".annotation-entry",
  ["ArrowDown", "ArrowUp", "Home", "End"],
  (button) => button.focus(),
);
listNavigation(
  $("file-list"),
  ".file-open",
  ["ArrowDown", "ArrowUp", "Home", "End"],
  (button) => button.focus(),
);
const pageShortcuts = [
  [
    (event) => event.altKey && ["ArrowUp", "ArrowLeft"].includes(event.key),
    (ids) => movePages(-1, ids),
  ],
  [
    (event) => event.altKey && ["ArrowDown", "ArrowRight"].includes(event.key),
    (ids) => movePages(1, ids),
  ],
  [
    (event) => !event.altKey && event.key.toLowerCase() === "r",
    (ids, event) => rotatePages(event.shiftKey ? -90 : 90, ids),
  ],
  [
    (event) => !event.altKey && ["Delete", "Backspace"].includes(event.key),
    (ids) => deletePages(ids),
  ],
];
$("page-list").addEventListener("keydown", (event) => {
  const thumb = event.target.closest(".thumbnail"),
    doc = active(),
    shortcut = pageShortcuts.find(([matches]) => matches(event));
  if (!thumb || !doc || !shortcut || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  event.stopPropagation();
  const id = thumb.dataset.page;
  shortcut[1](draggedIds(doc, id), event);
  (
    $("page-list").querySelector(`.thumbnail[data-page="${id}"]`) ||
    $("page-list").querySelector(".page-item.current .thumbnail")
  )?.focus();
});
listNavigation(
  $("page-list"),
  ".thumbnail",
  ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"],
  (thumb) => {
    selectPage(thumb.dataset.page);
    thumb.focus();
    thumb.scrollIntoView({ block: "nearest" });
  },
);
function visibleOutlineLinks() {
  return [
    ...$("outline-list").querySelectorAll(".outline-link:not(:disabled)"),
  ].filter((link) => !link.closest("ul[hidden]"));
}
function moveToOutlineLink(link) {
  if (!link) return;
  link.focus();
  if (link.dataset.page) selectPage(link.dataset.page);
}
$("outline-list").addEventListener("keydown", (event) => {
  const row = event.target.closest(".outline-row");
  if (!row || event.altKey) return;
  const toggle = row.querySelector(".outline-toggle"),
    expanded = toggle?.getAttribute("aria-expanded") === "true",
    links = visibleOutlineLinks(),
    index = links.indexOf(row.querySelector(".outline-link"));
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    if (index < 0) return;
    event.preventDefault();
    moveToOutlineLink(links[steppedIndex(event.key, index, links.length)]);
  } else if (event.key === "ArrowRight" && toggle) {
    event.preventDefault();
    if (!expanded) toggle.click();
    else
      moveToOutlineLink(
        row.nextElementSibling?.querySelector(".outline-link:not(:disabled)"),
      );
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (expanded) toggle.click();
    else
      moveToOutlineLink(
        row
          .closest("ul")
          .closest("li")
          ?.querySelector(":scope > .outline-row .outline-link"),
      );
  }
});
function describeHistoryButton(id, entry, verb, shortcut) {
  const button = $(id);
  button.disabled = !entry;
  button.title = entry
    ? `${verb}: ${entry.label} (${shortcut})`
    : `${verb} (${shortcut})`;
  button.setAttribute("aria-label", entry ? `${verb}: ${entry.label}` : verb);
}
function updateHistoryControls() {
  const history = active()?.history,
    previous = history?.past.at(-1),
    next = history?.future.at(-1);
  describeHistoryButton("undo-button", previous, "Rückgängig", "Strg/⌘ Z");
  describeHistoryButton(
    "redo-button",
    next,
    "Wiederholen",
    "Strg/⌘ Umschalt Z",
  );
  $("history-button").disabled = !previous && !next;
  const state = historyState();
  if (!historyMenuState?.every((value, index) => value === state[index]))
    closeHistory();
}
function historyState() {
  const doc = active();
  return [doc, doc?.history.past.at(-1), doc?.history.future.at(-1)];
}
function closeHistory() {
  const menu = $("history-menu");
  historyMenuState = null;
  menu.inert = true;
  if (menu.matches(":popover-open")) menu.hidePopover();
  $("history-button").setAttribute("aria-expanded", "false");
}
function toggleHistory() {
  const menu = $("history-menu"),
    doc = active();
  if (menu.matches(":popover-open") || !doc) return closeHistory();
  const { past, future } = doc.history,
    position = past.length,
    labels = [
      "Ausgangszustand",
      ...past.map((entry) => entry.label),
      ...[...future].reverse().map((entry) => entry.label),
    ];
  menu.replaceChildren(
    ...labels.map((label, index) => {
      const item = document.createElement("button");
      item.className = "history-item";
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      if (index === position) item.setAttribute("aria-current", "step");
      if (index > position) item.classList.add("history-future");
      item.addEventListener("click", () => {
        closeHistory();
        if (travel(doc, index - position)) {
          selectedElement = null;
          changed();
        }
      });
      return item;
    }),
  );
  historyMenuState = historyState();
  menu.inert = false;
  menu.showPopover();
  placeMenu(menu, $("history-button"));
  $("history-button").setAttribute("aria-expanded", "true");
  menu.querySelector("[aria-current]")?.focus();
}
function placeMenu(menu, anchorElement) {
  const anchor = anchorElement.getBoundingClientRect(),
    rect = menu.getBoundingClientRect(),
    toolbar = anchorElement.closest("#editor-topbar"),
    offset = toolbar ? toolbar.parentElement.getBoundingClientRect().top - toolbar.getBoundingClientRect().top : 0;
  menu.style.left = `${Math.max(4, Math.min(anchor.left, innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(anchor.bottom + offset + 6, innerHeight - rect.height - 4))}px`;
}
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#history-menu, #history-button")) closeHistory();
});
menuNavigation($("history-menu"), closeHistory, $("history-button"));
let styledTool = null,
  styledElement = null;
function styleTarget(name) {
  const el = element();
  if (!el) return null;
  if (name === "text") return el.type === "text" ? el : null;
  if (name === "highlight")
    return el.type === "highlight" || (el.type === "draw" && el.marker)
      ? el
      : null;
  if (name === "draw") return el.type === "draw" && !el.marker ? el : null;
  return null;
}
function styledTarget() {
  return (
    current()?.elements.find((el) => el.id === styledElement) ?? null
  );
}
function styleValues() {
  return { ...toolStyles[styledTool], ...styleProperties(styledTarget()) };
}
function styleProperties(el) {
  if (!el) return {};
  return Object.fromEntries(
    ["color", "strokeWidth", "fontSize"]
      .filter((key) => el[key] !== undefined)
      .map((key) => [key, el[key]]),
  );
}
function styleToggle(name) {
  return document.querySelector(`[data-style-tool="${name}"]`);
}
function closeToolStyle() {
  const menu = $("tool-style-menu");
  menu.inert = true;
  if (menu.matches(":popover-open")) menu.hidePopover();
  document
    .querySelectorAll("[data-style-tool]")
    .forEach((toggle) => toggle.setAttribute("aria-expanded", "false"));
  styledTool = null;
  styledElement = null;
}
function renderToolStylePreview() {
  if (!toolStyleOptions[styledTool].widths) return;
  const style = styleValues(),
    preview = $("tool-style-preview");
  preview.setAttribute("stroke", style.color);
  preview.setAttribute("stroke-width", style.strokeWidth);
  preview.setAttribute("opacity", styledTool === "highlight" ? markerOpacity : 1);
}
function renderToolStyle() {
  const { label, colors = [] } = toolStyleOptions[styledTool],
    target = styledTarget(),
    widths =
      target?.type === "highlight"
        ? null
        : toolStyleOptions[styledTool].widths,
    style = styleValues(),
    menu = $("tool-style-menu");
  menu.setAttribute("aria-label", `${label}-Optionen`);
  menu.dataset.tool = styledTool;
  menu
    .querySelector(".tool-style-colors")
    .toggleAttribute("hidden", !colors.length);
  for (const part of menu.querySelectorAll(
    ".tool-style-preview, .tool-style-width",
  ))
    part.toggleAttribute("hidden", !widths);
  $("tool-style-font-row").hidden = styledTool !== "text";
  renderFontSize();
  $("tool-style-swatches").replaceChildren(
    ...colors.map(([value, name]) => {
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "tool-style-color";
      input.value = value;
      input.checked = value === style.color;
      input.className = "tool-style-swatch";
      input.style.setProperty("--swatch", value);
      input.setAttribute("aria-label", name);
      input.title = name;
      return input;
    }),
  );
  if (widths) {
    const width = $("tool-style-width");
    [width.min, width.max] = widths;
    width.value = style.strokeWidth;
  }
  $("tool-style-text-only-row").hidden = styledTool !== "highlight";
  $("tool-style-text-only").checked = !!style.textOnly;
  $("tool-style-return").checked = style.returnToSelect !== false;
  renderToolStylePreview();
}
function toggleToolStyle(toggle) {
  const name = toggle.dataset.styleTool,
    menu = $("tool-style-menu");
  if (styledTool === name) return closeToolStyle();
  closeToolStyle();
  const target = styleTarget(name);
  if (!target && tool !== name) setTool(name);
  styledTool = name;
  styledElement = target?.id ?? null;
  renderToolStyle();
  menu.inert = false;
  menu.showPopover();
  placeMenu(menu, toggle);
  toggle.setAttribute("aria-expanded", "true");
  (
    menu.querySelector(".tool-style-swatch:checked") ||
    menu.querySelector(".tool-style-swatch") ||
    $("tool-style-return")
  ).focus();
}
const styleChangeLabels = {
  color: "Farbe ändern",
  strokeWidth: "Stärke ändern",
  fontSize: "Schriftgröße ändern",
};
function applyStyleToElement(change) {
  const el = styledTarget(),
    doc = active();
  if (!el || !doc) return;
  const allowed = {
    color: true,
    strokeWidth: el.type === "draw",
    fontSize: el.type === "text",
  };
  for (const [key, value] of Object.entries(change)) {
    if (!allowed[key] || el[key] === value) continue;
    edit(doc, styleChangeLabels[key], () => (el[key] = value), `${el.id}:${key}`);
  }
  renderDocuments();
  renderElements();
  renderThumbnails();
  updateHistoryControls();
}
function updateToolStyle(change) {
  if (!styledTool) return;
  Object.assign(toolStyles[styledTool], change);
  applyStyleToElement(change);
  renderToolStylePreview();
  updateToolCursors();
}
$("tool-style-swatches").addEventListener("change", (event) =>
  updateToolStyle({ color: event.target.value }),
);
$("tool-style-width").addEventListener("input", (event) =>
  updateToolStyle({ strokeWidth: Number(event.target.value) }),
);
function renderFontSize() {
  const size =
    styledTool === "text" ? styleValues().fontSize : toolStyles.text.fontSize;
  $("tool-style-font-size").value = `${size} pt`;
  $("tool-style-font-down").disabled = size <= fontSizes[0];
  $("tool-style-font-up").disabled = size >= fontSizes.at(-1);
}
function stepFontSize(direction) {
  const size = styleValues().fontSize,
    next =
      direction > 0
        ? fontSizes.find((value) => value > size)
        : fontSizes.findLast((value) => value < size);
  if (next === undefined) return;
  updateToolStyle({ fontSize: next });
  renderFontSize();
}
$("tool-style-font-down").addEventListener("click", () => stepFontSize(-1));
$("tool-style-font-up").addEventListener("click", () => stepFontSize(1));
$("tool-style-return").addEventListener("change", (event) =>
  updateToolStyle({ returnToSelect: event.target.checked }),
);
$("tool-style-text-only").addEventListener("change", (event) =>
  updateToolStyle({ textOnly: event.target.checked }),
);
$("tool-style-menu").addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  const toggle = styleToggle(styledTool);
  closeToolStyle();
  toggle?.focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#tool-style-menu, [data-style-tool]"))
    closeToolStyle();
});
function stepHistory(step) {
  const doc = active();
  if (doc && step(doc)) {
    clearAnnotationSelection();
    selectedElement = null;
    changed();
  }
}
const editableTypes = ["text", "search", "url", "tel", "password", "email"];
let contextTarget = null;
function editableField(target) {
  const field = target.closest?.("textarea, input");
  if (!field || field.disabled || field.readOnly) return null;
  if (field.tagName === "INPUT" && !editableTypes.includes(field.type))
    return null;
  return field;
}
function contextRegion(target) {
  const element = target.closest?.("#editor-topbar, #pages-panel");
  if (!element) return null;
  return element.id === "editor-topbar"
    ? { element, controller: toolbar, label: "Toolbar" }
    : { element, controller: sidebar, label: "Sidebar" };
}
function restoreContextFocus(target) {
  const element = target?.origin?.isConnected ? target.origin
    : target?.field?.isConnected ? target.field : target?.region;
  element?.focus({ preventScroll: true });
}
function closeContextMenu(restoreFocus = false) {
  const menu = $("context-menu");
  if (!menu.matches(":popover-open")) return;
  menu.inert = true;
  menu.hidePopover();
  if (restoreFocus) restoreContextFocus(contextTarget);
  contextTarget = null;
}
function contextItem(label, disabled, run) {
  const item = document.createElement("button");
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.textContent = label;
  item.disabled = disabled;
  item.addEventListener("pointerdown", (event) => event.preventDefault());
  item.addEventListener("click", () => {
    const target = contextTarget;
    closeContextMenu(target?.keyboard);
    void run(target).catch(report).finally(() => {
      if (target?.keyboard && document.activeElement === document.body)
        restoreContextFocus(target);
    });
  });
  return item;
}
async function copyContext({ text }) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    message("Kopieren nicht möglich. Bitte Strg/⌘ C verwenden.", true);
  }
}
async function pasteContext({ field, start, end }) {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    message("Einfügen nicht möglich. Bitte Strg/⌘ V verwenden.", true);
    return;
  }
  if (field.maxLength >= 0)
    text = text.slice(
      0,
      Math.max(0, field.maxLength - field.value.length + (end - start)),
    );
  field.focus();
  field.setRangeText(text, start, end, "end");
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}
function showContextMenu(event, target, items) {
  const menu = $("context-menu"),
    region = contextRegion(event.target),
    keyboard = event.clientX === 0 && event.clientY === 0;
  if (region) {
    if (items.length) {
      const separator = document.createElement("div");
      separator.setAttribute("role", "separator");
      items.push(separator);
    }
    const item = contextItem(
      `${region.label} ${region.controller.isPinned() ? "entpinnen" : "anpinnen"}`,
      false,
      async () => region.controller.togglePinned(),
    );
    item.dataset.action = region.element.id === "editor-topbar" ? "pin-toolbar" : "pin-sidebar";
    items.push(item);
  }
  (document.querySelector("dialog[open]") || document.body).append(menu);
  menu.replaceChildren(...items);
  contextTarget = {
    ...target,
    keyboard,
    origin: target.field || event.target.closest?.("button, input, textarea, select, a[href], [tabindex]") || event.target,
    region: region?.element,
  };
  menu.inert = false;
  menu.showPopover();
  const anchor = keyboard ? event.target.getBoundingClientRect() : null,
    x = keyboard ? anchor.left : event.clientX,
    y = keyboard ? anchor.bottom : event.clientY,
    rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - rect.height - 4))}px`;
  if (keyboard) menu.querySelector("button:not(:disabled)")?.focus();
}
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  closeContextMenu();
  if (
    tool === "comment" &&
    $("page-scroll").contains(event.target) &&
    !editableField(event.target)
  ) {
    setTool("select");
    return;
  }
  const named = event.target.closest?.(
    "#document-title, #file-list .file-open, .recent-item",
  );
  if (named?.classList.contains("recent-item")) {
    const entry = recentEntries.get(named);
    if (entry)
      nameMenu(event, entry.name, () =>
        editName(
          liveRecentItem(named, entry),
          entry.name.replace(/\.pdf$/i, ""),
          (value) => renameRecent(entry, value),
        ),
      );
    else if (contextRegion(event.target)) showContextMenu(event, {}, []);
    return;
  }
  if (named) {
    const doc =
      named.id === "document-title"
        ? active()
        : documents.find((doc) => doc.id === named.dataset.document);
    if (doc)
      nameMenu(
        event,
        fileName(doc),
        () => editName(named, doc.name, (value) => renameDocument(doc, value)),
        () => closeDocument(doc),
        resetFormItem(doc),
      );
    else if (contextRegion(event.target)) showContextMenu(event, {}, []);
    return;
  }
  const pageEntry = event.target.closest?.("#page-list .page-item"),
    doc = active();
  if (pageEntry && doc) {
    const ids = draggedIds(doc, pageEntry.dataset.page);
    showContextMenu(event, {}, [
      contextItem("Links drehen", false, async () => rotatePages(-90, ids)),
      contextItem("Rechts drehen", false, async () => rotatePages(90, ids)),
      contextItem("Nach vorne", !canMovePages(doc, ids, -1), async () =>
        movePages(-1, ids),
      ),
      contextItem("Nach hinten", !canMovePages(doc, ids, 1), async () =>
        movePages(1, ids),
      ),
      contextItem("In neues Dokument kopieren", false, async () =>
        copySelection(null, ids),
      ),
      ...documents
        .filter((target) => target !== doc && target.kind === "pdf")
        .map((target) =>
          contextItem(`In „${target.name}“ kopieren`, false, async () =>
            copySelection(target, ids),
          ),
        ),
      contextItem(
        ids.length > 1 ? `${ids.length} Seiten entfernen` : "Seite entfernen",
        false,
        async () => deletePages(ids),
      ),
    ]);
    return;
  }
  const annotation = event.target.closest?.(
    "#annotation-list .annotation-entry, #element-layer .annotation",
  );
  if (
    annotation &&
    !editableField(event.target) &&
    !event.target.closest?.("[contenteditable=true]")
  ) {
    const id = annotation.dataset.id;
    if (!annotationSelection.has(id)) {
      clearAnnotationSelection();
      annotationSelection.add(id);
      annotationAnchor = id;
    }
    syncAnnotationSelection();
    const ids = [...annotationSelection];
    showContextMenu(event, { field: annotation }, [
      contextItem(
        ids.length > 1 ? `${ids.length} Annotationen löschen` : "Annotation löschen",
        false,
        async () => deleteAnnotations(ids),
      ),
    ]);
    return;
  }
  const formControl = event.target.closest?.(
    "#form-layer :is(input, select, textarea)",
  );
  const field = editableField(event.target);
  if (formControl && !field) {
    const items = resetFormItem(active());
    if (items.length) showContextMenu(event, {}, items);
    return;
  }
  if (field) {
    const start = field.selectionStart ?? field.value.length,
      end = field.selectionEnd ?? start,
      target = {
        field,
        start,
        end,
        text: field.value.slice(start, end),
      };
    showContextMenu(event, target, [
      contextItem(
        "Kopieren",
        start === end || field.type === "password",
        copyContext,
      ),
      contextItem("Einfügen", false, pasteContext),
      ...(formControl ? resetFormItem(active()) : []),
    ]);
    return;
  }
  if (contextRegion(event.target)) {
    showContextMenu(event, {}, []);
    return;
  }
  const selection = getSelection(),
    text = selection?.toString() ?? "";
  if (
    text.trim() &&
    $("page-stage").contains(selection.anchorNode) &&
    !$("page-stage").hidden
  )
    showContextMenu(event, { text }, [
      contextItem("Kopieren", false, copyContext),
    ]);
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest?.("#context-menu")) closeContextMenu();
});
document.addEventListener(
  "keydown",
  (event) => {
    if ((event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) && contextRegion(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      event.target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      return;
    }
    if (!$("context-menu").matches(":popover-open")) return;
    const items = [
        ...$("context-menu").querySelectorAll("button:not(:disabled)"),
      ],
      index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[
        index < 0
          ? step > 0
            ? 0
            : items.length - 1
          : (index + step + items.length) % items.length
      ]?.focus();
    } else if ((event.key === "Enter" || event.key === " ") && index >= 0) {
      event.preventDefault();
      event.stopPropagation();
      items[index].click();
    } else if (index < 0) closeContextMenu();
  },
  true,
);
window.addEventListener("scroll", () => closeContextMenu(), true);
window.addEventListener("resize", () => closeContextMenu());
window.addEventListener("blur", () => closeContextMenu());
function setTool(value) {
  const pending = value === "highlight" ? textSelection() : null;
  finishTextEdit();
  tool = value;
  selectedElement = null;
  document.querySelectorAll("[data-tool]").forEach((button) => {
    if (button.tagName === "BUTTON") {
      button.classList.toggle("active", button.dataset.tool === tool);
      button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
    }
  });
  $("page-stage").dataset.tool = tool;
  renderSettings();
  renderElements();
  renderForms();
  if (tool === "comment") showComments(true);
  if (pending) highlightRange(pending);
}
function addElement(properties, x, y) {
  const page = current();
  if (!page) return;
  const [px, py] = pagePoint(page, x, y);
  const el = {
    id: uid(),
    type: "text",
    x: px,
    y: py,
    width: 180,
    height: 60,
    angle: normalizeAngle((page.baseRotation || 0) + page.rotation),
    text: "Text",
    fontSize: toolStyles.text.fontSize,
    color: toolStyles[properties.type || "text"]?.color,
    opacity: 1,
    bold: false,
    ...properties,
  };
  edit(
    active(),
    additionLabels[el.marker ? "highlight" : el.type] || "Element hinzufügen",
    () => page.elements.push(el),
  );
  selectedElement = el.id;
  renderDocuments();
  renderElements();
  renderSettings();
  renderThumbnails();
  updateHistoryControls();
  return el;
}
function returnToSelect(type) {
  if (!toolStyles[type]?.returnToSelect || tool === "select") return;
  const id = selectedElement;
  setTool("select");
  selectedElement = id;
  renderElements();
  renderSettings();
}
let textEditor = null;
function editText(id, selectAll = false) {
  const doc = active(),
    page = current(),
    el = page?.elements.find((item) => item.id === id);
  if (!el || el.type !== "text") return;
  finishTextEdit();
  const field = document.createElement("textarea");
  field.className = "inline-text";
  field.value = el.text;
  field.setAttribute("aria-label", "Text bearbeiten");
  field.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      field.value = textEditor?.original ?? field.value;
      finishTextEdit();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finishTextEdit();
    }
  });
  field.addEventListener("blur", () => {
    if (field.isConnected) finishTextEdit();
  });
  textEditor = { id, doc, page, field, original: el.text };
  selectedElement = id;
  $("page-stage").classList.add("text-editing");
  renderElements();
  field.focus();
  if (selectAll) field.select();
  else field.setSelectionRange(field.value.length, field.value.length);
}
function finishTextEdit() {
  if (!textEditor) return;
  const { id, doc, page, field, original } = textEditor;
  textEditor = null;
  $("page-stage").classList.remove("text-editing");
  const el = page.elements.find((item) => item.id === id);
  if (el && field.value !== original) {
    edit(doc, "Text bearbeiten", () => (el.text = field.value));
    renderDocuments();
    renderThumbnails();
    updateHistoryControls();
  }
  renderElements();
}
document.addEventListener(
  "pointerdown",
  (event) => {
    if (
      textEditor &&
      !event.target.closest?.(".inline-text, #context-menu")
    )
      finishTextEdit();
  },
  true,
);
const additionLabels = {
  comment: "Kommentar hinzufügen",
  text: "Text hinzufügen",
  highlight: "Markierung hinzufügen",
  draw: "Zeichnung hinzufügen",
  image: "Bild hinzufügen",
};
let gesture = null;
function stagePosition(event) {
  const rect = $("page-stage").getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / scale,
    y: (event.clientY - rect.top) / scale,
  };
}
$("element-layer").addEventListener("pointerdown", (event) => {
  if (tool !== "select" || event.button !== 0) return;
  const item = event.target.closest(".annotation");
  if (!item || event.target.closest(".inline-text, .annotation-delete")) return;
  event.preventDefault();
  const previous = selectedElement;
  selectedElement = item.dataset.id;
  const el = element(),
    point = stagePosition(event);
  gesture = {
    type: event.target.classList.contains("resize-handle") ? "resize" : "move",
    start: point,
    original: structuredClone(el),
    started: false,
  };
  $("page-stage").setPointerCapture(event.pointerId);
  if (previous !== selectedElement) {
    const old = $("element-layer").querySelector(".annotation.selected");
    old?.classList.remove("selected");
    old?.querySelector(".resize-handle")?.remove();
    old?.querySelector(".annotation-delete")?.remove();
    item.classList.add("selected");
    addSelectionControls(item);
  }
  syncCommentSelection();
  renderSettings();
});
$("page-stage").addEventListener("pointermove", (event) => {
  if (!gesture || !["move", "resize"].includes(gesture.type)) return;
  const point = stagePosition(event),
    el = element();
  if (!el) return;
  const dx = point.x - gesture.start.x,
    dy = point.y - gesture.start.y;
  if (!gesture.started && Math.hypot(dx, dy) < 2) return;
  if (!gesture.started) {
    edit(
      active(),
      gesture.type === "move" ? "Element verschieben" : "Element skalieren",
      () => {},
    );
    gesture.started = true;
  }
  if (gesture.type === "move") {
    const a = pagePoint(current(), gesture.start.x, gesture.start.y),
      b = pagePoint(current(), point.x, point.y);
    el.x = gesture.original.x + b[0] - a[0];
    el.y = gesture.original.y + b[1] - a[1];
  } else {
    const rotation =
      (((current().baseRotation || 0) + current().rotation - el.angle) *
        Math.PI) /
      180;
    el.width = Math.max(
      5,
      gesture.original.width +
        dx * Math.cos(rotation) +
        dy * Math.sin(rotation),
    );
    el.height = Math.max(
      5,
      gesture.original.height -
        dx * Math.sin(rotation) +
        dy * Math.cos(rotation),
    );
  }
  renderElements();
});
function finishElementGesture() {
  if (gesture?.started) {
    renderDocuments();
    renderThumbnails();
    renderSettings();
    updateHistoryControls();
  }
  gesture = null;
}
$("page-stage").addEventListener("pointerup", finishElementGesture);
$("page-stage").addEventListener("pointercancel", finishElementGesture);
$("page-stage").addEventListener("dblclick", (event) => {
  if (tool !== "select") return;
  const pin = event.target.closest?.(".annotation[data-type=comment]");
  if (pin) {
    showComments(true);
    focusComment(pin.dataset.id);
    return;
  }
  const item = document
    .elementsFromPoint(event.clientX, event.clientY)
    .map((node) => node.closest(".annotation[data-type=text]"))
    .find(Boolean);
  if (item) editText(item.dataset.id);
});
$("page-stage").addEventListener("pointerdown", (event) => {
  if (
    tool === "select" &&
    !event.target.closest(".annotation, #interaction-layer")
  ) {
    selectedElement = null;
    renderElements();
    renderSettings();
  }
});
function segmentDistance(point, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy,
    t = length
      ? Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
        )
      : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
function touchesStroke(item, el, point) {
  const svg = item.querySelector("svg"),
    matrix = svg?.getScreenCTM();
  if (!matrix) return false;
  const tolerance = ((el.strokeWidth || 2) * scale) / 2 + 6;
  return (el.paths || [el.points]).some((points) => {
    const screen = points.map(([px, py]) =>
      new DOMPoint(px * el.width, py * el.height).matrixTransform(matrix),
    );
    if (screen.length === 1)
      return segmentDistance(point, screen[0], screen[0]) <= tolerance;
    return screen
      .slice(1)
      .some((end, i) => segmentDistance(point, screen[i], end) <= tolerance);
  });
}
function touchesRect(rect, point) {
  const tolerance = 4;
  return (
    point.x >= rect.left - tolerance &&
    point.x <= rect.right + tolerance &&
    point.y >= rect.top - tolerance &&
    point.y <= rect.bottom + tolerance
  );
}
function touchesElement(item, el, point) {
  if (el.type === "draw") return touchesStroke(item, el, point);
  if (el.type === "highlight" && el.rects)
    return [...item.querySelectorAll(".highlight-part")].some((part) =>
      touchesRect(part.getBoundingClientRect(), point),
    );
  return touchesRect(item.getBoundingClientRect(), point);
}
function eraseAlong(from, to) {
  const page = current();
  if (!page?.elements.length) return;
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4),
  );
  const samples = Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / steps,
    y: from.y + ((to.y - from.y) * i) / steps,
  }));
  const hits = new Set();
  for (const item of $("element-layer").querySelectorAll(".annotation")) {
    const el = page.elements.find((el) => el.id === item.dataset.id);
    if (
      el &&
      el.type !== "comment" &&
      samples.some((point) => touchesElement(item, el, point))
    )
      hits.add(el.id);
  }
  if (!hits.size) return;
  edit(
    active(),
    "Radieren",
    () => {
      page.elements = page.elements.filter((el) => !hits.has(el.id));
    },
    gesture.group,
  );
  gesture.erased = true;
  if (hits.has(selectedElement)) selectedElement = null;
  renderElements();
}
$("interaction-layer").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !current() || tool !== "comment") return;
  event.preventDefault();
  createComment(stagePosition(event));
});
$("interaction-layer").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !current() || tool !== "erase") return;
  event.preventDefault();
  const point = { x: event.clientX, y: event.clientY };
  gesture = { type: "erase", group: uid(), last: point, erased: false };
  $("interaction-layer").setPointerCapture(event.pointerId);
  eraseAlong(point, point);
});
$("interaction-layer").addEventListener("pointermove", (event) => {
  if (gesture?.type !== "erase") return;
  const point = { x: event.clientX, y: event.clientY };
  eraseAlong(gesture.last, point);
  gesture.last = point;
});
function finishErasing() {
  if (gesture?.type !== "erase") return;
  const erased = gesture.erased;
  gesture = null;
  if (!erased) return;
  renderDocuments();
  renderThumbnails();
  renderSettings();
  updateHistoryControls();
}
$("interaction-layer").addEventListener("pointerup", finishErasing);
$("interaction-layer").addEventListener("pointercancel", finishErasing);
function probeText(x, y, requireText = false) {
  const layer = $("text-layer"),
    interaction = $("interaction-layer"),
    annotations = $("element-layer");
  interaction.style.pointerEvents = "none";
  annotations.classList.add("probing");
  try {
    const hit = document.elementFromPoint(x, y);
    if (
      requireText &&
      !(
        hit?.tagName === "SPAN" &&
        layer.contains(hit) &&
        hit.textContent.trim()
      )
    )
      return null;
    const position = document.caretPositionFromPoint
      ? document.caretPositionFromPoint(x, y)
      : document.caretRangeFromPoint?.(x, y);
    const node = position?.offsetNode ?? position?.startContainer,
      offset = position?.offset ?? position?.startOffset;
    return node && layer.contains(node) ? { node, offset } : null;
  } finally {
    interaction.style.pointerEvents = "";
    annotations.classList.remove("probing");
  }
}
function textSelection() {
  const selection = getSelection(),
    layer = $("text-layer");
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  return layer.contains(range.startContainer) ||
    layer.contains(range.endContainer)
    ? range
    : null;
}
function adjustTextSelection(key) {
  const range = textSelection();
  if (!range) return false;
  const layer = $("text-layer"),
    nodes = [],
    lineEnds = [],
    walker = document.createTreeWalker(
      layer,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    ),
    offsetOf = (container, offset) => {
      const probe = document.createRange();
      probe.setStart(layer, 0);
      probe.setEnd(container, offset);
      return probe.toString().length;
    };
  let total = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) {
      nodes.push({ node, start: total });
      total += node.length;
    } else if (node.tagName === "BR") lineEnds.push(total);
  }
  lineEnds.push(total);
  const start = offsetOf(range.startContainer, range.startOffset),
    end = offsetOf(range.endContainer, range.endOffset);
  let target = end;
  if (key === "ArrowRight") target = Math.min(total, end + 1);
  else if (key === "ArrowLeft") target = end - 1;
  else if (key === "ArrowDown")
    target = lineEnds.find((position) => position > end) ?? end;
  else if (key === "ArrowUp")
    target = lineEnds.findLast((position) => position < end) ?? end;
  if (target <= start || target === end) return true;
  const entry = nodes.find((item) => target <= item.start + item.node.length);
  if (!entry) return true;
  getSelection().setBaseAndExtent(
    range.startContainer,
    range.startOffset,
    entry.node,
    target - entry.start,
  );
  return true;
}
function selectionRects(range) {
  const rects = [],
    walker = document.createTreeWalker($("text-layer"), NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.data.trim() || !range.intersectsNode(node)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0)
      part.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0)
      part.setEnd(range.endContainer, range.endOffset);
    if (!part.toString().trim()) continue;
    rects.push(...part.getClientRects());
  }
  return rects;
}
function highlightRange(range) {
  const page = current();
  if (!page) return;
  const stage = $("page-stage").getBoundingClientRect(),
    size = displayedSize(page),
    rects = lineRects(
      selectionRects(range).map((rect) => {
        const left = Math.max(0, (rect.left - stage.left) / scale),
          top = Math.max(0, (rect.top - stage.top) / scale),
          right = Math.min(size.width, (rect.right - stage.left) / scale),
          bottom = Math.min(size.height, (rect.bottom - stage.top) / scale);
        return { x: left, y: top, width: right - left, height: bottom - top };
      }),
    );
  getSelection().removeAllRanges();
  if (!rects.length) return;
  const x = Math.min(...rects.map((rect) => rect.x)),
    y = Math.min(...rects.map((rect) => rect.y)),
    width = Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height = Math.max(...rects.map((rect) => rect.y + rect.height)) - y;
  const created = addElement(
    {
      type: "highlight",
      width,
      height,
      opacity: markerOpacity,
      rects: rects.map((rect) => [
        (rect.x - x) / width,
        (rect.y - y) / height,
        rect.width / width,
        rect.height / height,
      ]),
    },
    x,
    y,
  );
  if (created) returnToSelect("highlight");
}
let hoverFrame = 0;
$("interaction-layer").addEventListener("pointermove", (event) => {
  if (tool !== "highlight" || gesture || hoverFrame) return;
  const { clientX, clientY } = event;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    $("interaction-layer").classList.toggle(
      "over-text",
      tool === "highlight" && !!probeText(clientX, clientY, true),
    );
  });
});
$("interaction-layer").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !current() || tool !== "highlight") return;
  const caret = probeText(event.clientX, event.clientY, true);
  if (!caret) return;
  event.preventDefault();
  gesture = { type: "text-highlight", anchor: caret };
  getSelection().setBaseAndExtent(
    caret.node,
    caret.offset,
    caret.node,
    caret.offset,
  );
  $("interaction-layer").setPointerCapture(event.pointerId);
});
$("interaction-layer").addEventListener("pointermove", (event) => {
  if (gesture?.type !== "text-highlight") return;
  const caret = probeText(event.clientX, event.clientY);
  if (caret?.node.nodeType !== Node.TEXT_NODE) return;
  getSelection().setBaseAndExtent(
    gesture.anchor.node,
    gesture.anchor.offset,
    caret.node,
    caret.offset,
  );
});
function finishTextHighlight(event) {
  if (gesture?.type !== "text-highlight") return;
  gesture = null;
  const range = event.type === "pointerup" ? textSelection() : null;
  if (range) highlightRange(range);
  else getSelection().removeAllRanges();
}
$("interaction-layer").addEventListener("pointerup", finishTextHighlight);
$("interaction-layer").addEventListener("pointercancel", finishTextHighlight);
$("interaction-layer").addEventListener("pointerdown", (event) => {
  if (
    event.button !== 0 ||
    !current() ||
    !["text", "highlight", "draw"].includes(tool) ||
    gesture?.type === "text-highlight" ||
    (tool === "highlight" && toolStyles.highlight.textOnly)
  )
    return;
  event.preventDefault();
  const point = stagePosition(event);
  gesture = {
    type: tool,
    start: point,
    points: [[point.x, point.y]],
    last: point,
  };
  $("interaction-layer").setPointerCapture(event.pointerId);
});
$("interaction-layer").addEventListener("pointermove", (event) => {
  if (!gesture || !["text", "highlight", "draw"].includes(gesture.type)) return;
  const point = stagePosition(event);
  gesture.last = point;
  const stroke = gesture.type === "draw" || gesture.type === "highlight";
  if (
    stroke &&
    gesture.points.length < 20000 &&
    Math.hypot(
      point.x - gesture.points.at(-1)[0],
      point.y - gesture.points.at(-1)[1],
    ) > 0.4
  )
    gesture.points.push([point.x, point.y]);
  const layer = $("interaction-layer");
  layer.replaceChildren();
  const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  preview.style.width = "100%";
  preview.style.height = "100%";
  preview.setAttribute(
    "viewBox",
    `0 0 ${displayedSize(current()).width} ${displayedSize(current()).height}`,
  );
  const node = document.createElementNS(
    preview.namespaceURI,
    stroke ? "path" : "rect",
  );
  if (stroke) {
    const style = toolStyles[gesture.type];
    node.setAttribute(
      "d",
      gesture.points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" "),
    );
    node.setAttribute("fill", "none");
    node.setAttribute("stroke", style.color);
    node.setAttribute("stroke-width", style.strokeWidth);
    node.setAttribute("stroke-linecap", "round");
    node.setAttribute("stroke-linejoin", "round");
    if (gesture.type === "highlight")
      node.setAttribute("opacity", markerOpacity);
  } else {
    node.setAttribute("x", Math.min(point.x, gesture.start.x));
    node.setAttribute("y", Math.min(point.y, gesture.start.y));
    node.setAttribute("width", Math.abs(point.x - gesture.start.x));
    node.setAttribute("height", Math.abs(point.y - gesture.start.y));
    node.setAttribute("fill", "#35675a");
    node.setAttribute("opacity", ".3");
  }
  preview.append(node);
  layer.append(preview);
});
function finishDrawing(event) {
  if (!gesture || !["text", "highlight", "draw"].includes(gesture.type)) return;
  const drawing = gesture;
  gesture = null;
  $("interaction-layer").replaceChildren();
  if (event.type === "pointercancel") return;
  const end = drawing.last,
    x = Math.min(drawing.start.x, end.x),
    y = Math.min(drawing.start.y, end.y),
    width = Math.abs(end.x - drawing.start.x),
    height = Math.abs(end.y - drawing.start.y);
  if (drawing.type === "draw" || drawing.type === "highlight") {
    if (drawing.points.length < 2) return;
    const marker = drawing.type === "highlight",
      style = toolStyles[drawing.type];
    const minX = Math.min(...drawing.points.map((point) => point[0])),
      minY = Math.min(...drawing.points.map((point) => point[1]));
    const w = Math.max(
        1,
        Math.max(...drawing.points.map((point) => point[0])) - minX,
      ),
      h = Math.max(
        1,
        Math.max(...drawing.points.map((point) => point[1])) - minY,
      );
    const created = addElement(
      {
        type: "draw",
        width: w,
        height: h,
        points: drawing.points.map(([px, py]) => [
          (px - minX) / w,
          (py - minY) / h,
        ]),
        strokeWidth: style.strokeWidth,
        color: style.color,
        ...(marker && { marker, opacity: markerOpacity }),
      },
      minX,
      minY,
    );
    if (created) returnToSelect(drawing.type);
  } else {
    const created = addElement(
      {
        type: "text",
        width: width > 10 ? width : 200,
        height:
          height > 10
            ? height
            : Math.max(65, Math.round(toolStyles.text.fontSize * 2)),
      },
      x,
      y,
    );
    if (!created) return;
    returnToSelect("text");
    editText(created.id, true);
  }
}
$("interaction-layer").addEventListener("pointerup", finishDrawing);
$("interaction-layer").addEventListener("pointercancel", finishDrawing);
$("page-list").addEventListener("dragstart", (event) => {
  const item = event.target.closest(".page-item"),
    doc = active();
  if (!item || !doc) return;
  endPageDrag();
  const thumbnail = item.querySelector(".thumbnail"),
    rect = thumbnail.getBoundingClientRect(),
    preview = document.createElement("div"),
    image = document.createElement("canvas"),
    source = thumbnail.querySelector("canvas");
  preview.className = "page-drag-preview";
  preview.hidden = true;
  preview.inert = true;
  preview.setAttribute("aria-hidden", "true");
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  preview.style.borderColor = getComputedStyle(thumbnail).borderColor;
  if (source?.width && source.height) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d").drawImage(source, 0, 0);
    preview.append(canvas);
  } else {
    const placeholder = thumbnail.querySelector(".thumb-placeholder");
    if (placeholder) preview.append(placeholder.cloneNode(true));
  }
  image.className = "page-drag-image";
  image.width = image.height = 1;
  image.inert = true;
  image.setAttribute("aria-hidden", "true");
  document.body.append(preview, image);
  pageDrag = {
    page: item.dataset.page,
    ids: draggedIds(doc, item.dataset.page),
    center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    scroll: $("page-list").scrollTop,
    previous: null,
    sweep: 0,
    mode: "turn",
    preview,
    image,
    offset: { x: event.clientX - rect.left, y: event.clientY - rect.top },
  };
  event.dataTransfer.setData("application/x-pdfhelper-page", pageDrag.page);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setDragImage(image, 0, 0);
});
function clearDropIndicators() {
  document
    .querySelectorAll(".drop-before,.drop-after,.drop-group")
    .forEach((el) =>
      el.classList.remove("drop-before", "drop-after", "drop-group"),
    );
}
function dropZone(event, item) {
  const rect = item.getBoundingClientRect(),
    fraction = (event.clientY - rect.top) / rect.height;
  return fraction < 0.25 ? "before" : fraction > 0.75 ? "after" : "group";
}
function draggedIds(doc, dragged) {
  return doc.selected.includes(dragged) ? [...doc.selected] : [dragged];
}
const pageItem = (id) =>
  $("page-list").querySelector(`.page-item[data-page="${id}"]`);
const turnPreviewThreshold = 30;
function previewPageDrag() {
  const sweep =
      pageDrag.mode === "move" ||
      Math.abs(pageDrag.sweep) < turnPreviewThreshold
        ? 0
        : pageDrag.sweep,
    snapped = snapTurn(sweep) !== 0;
  for (const id of pageDrag.ids) {
    const item = pageItem(id);
    if (!item) continue;
    item.querySelector(".thumbnail").style.transform = sweep
      ? `rotate(${sweep}deg)`
      : "";
    item.classList.toggle("turning", sweep !== 0);
    item.classList.toggle("drop-rotate", snapped);
  }
  const { preview, previous, offset } = pageDrag;
  preview.hidden = pageDrag.mode !== "move";
  if (previous)
    preview.style.transform = `translate(${previous.x - offset.x}px, ${previous.y - offset.y}px)`;
}
function endPageDrag() {
  if (!pageDrag) return;
  pageDrag.sweep = 0;
  previewPageDrag();
  pageDrag.preview.remove();
  pageDrag.image.remove();
  pageDrag = null;
  clearDropIndicators();
}
function finishPageTurn() {
  const turn = pageDrag.mode === "move" ? 0 : snapTurn(pageDrag.sweep),
    ids = pageDrag.ids;
  endPageDrag();
  if (turn) rotatePages(turn, ids);
}
function insideTurnZone(point) {
  const items = [...$("page-list").querySelectorAll(".page-item")],
    index = items.indexOf(pageItem(pageDrag.page));
  if (index < 0) return false;
  const list = $("page-list").getBoundingClientRect(),
    thumbRect = (item) =>
      item?.querySelector(".thumbnail").getBoundingClientRect(),
    top = thumbRect(items[index - 1])?.bottom ?? list.top,
    bottom = thumbRect(items[index + 1])?.top ?? list.bottom;
  return (
    point.x >= list.left &&
    point.x <= list.right &&
    point.y >= top &&
    point.y <= bottom
  );
}
document.addEventListener(
  "dragover",
  (event) => {
    if (!pageDrag) return;
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY },
      center = {
        x: pageDrag.center.x,
        y: pageDrag.center.y + pageDrag.scroll - $("page-list").scrollTop,
      };
    if (pageDrag.mode === "turn" && !insideTurnZone(point)) {
      pageDrag.mode = "move";
      pageDrag.sweep = 0;
    }
    if (pageDrag.mode === "turn" && pageDrag.previous)
      pageDrag.sweep += sweepStep(center, pageDrag.previous, point);
    pageDrag.previous = point;
    previewPageDrag();
  },
  true,
);
document.addEventListener("drop", (event) => {
  if (!pageDrag) return;
  event.preventDefault();
  finishPageTurn();
});
function pageDropTarget(event) {
  const item = event.target.closest(".page-item");
  if (item) return { item, zone: dropZone(event, item) };
  const items = [...$("page-list").querySelectorAll(".page-item")];
  if (!items.length) return null;
  const row = items.find((item) => {
    const rect = item.getBoundingClientRect();
    return event.clientY >= rect.top && event.clientY <= rect.bottom;
  });
  if (row) return { item: row, zone: dropZone(event, row) };
  const next = items.find(
    (item) => item.getBoundingClientRect().top >= event.clientY,
  );
  return next
    ? { item: next, zone: "before" }
    : { item: items.at(-1), zone: "after" };
}
$("page-list").addEventListener("dragover", (event) => {
  if (!pageDrag) return;
  event.preventDefault();
  clearDropIndicators();
  const drop = pageDrag.mode === "move" && pageDropTarget(event);
  if (drop && drop.item.dataset.page !== pageDrag.page)
    drop.item.classList.add(`drop-${drop.zone}`);
});
$("page-list").addEventListener("drop", (event) => {
  if (!pageDrag) return;
  event.preventDefault();
  const drop = pageDrag.mode === "move" && pageDropTarget(event),
    dragged = pageDrag.page;
  if (!drop || drop.item.dataset.page === dragged) return finishPageTurn();
  endPageDrag();
  const target = drop.item.dataset.page,
    zone = drop.zone,
    doc = active();
  if (!doc || draggedIds(doc, dragged).includes(target)) return;
  if (zone === "group")
    modify("Seiten gruppieren", (doc) =>
      groupWith(doc, draggedIds(doc, dragged), target),
    );
  else
    modify("Seiten verschieben", (doc) =>
      moveWithGroups(doc, draggedIds(doc, dragged), target, zone === "after"),
    );
});
$("page-list").addEventListener("dragend", endPageDrag);
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if ([...(event.dataTransfer?.types || [])].includes("Files")) {
    event.preventDefault();
    dragDepth++;
    setHidden($("drop-overlay"), false);
  }
});
document.addEventListener("dragover", (event) => {
  if ([...(event.dataTransfer?.types || [])].includes("Files"))
    event.preventDefault();
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) setHidden($("drop-overlay"), true);
});
document.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  dragDepth = 0;
  setHidden($("drop-overlay"), true);
  if (busy) return;
  const files = [...event.dataTransfer.files],
    pending = [...event.dataTransfer.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFileSystemHandle?.() ?? null);
  void Promise.all(pending)
    .catch(() => [])
    .then((handles) =>
      importFiles(
        files,
        handles.length === files.length
          ? handles.map((handle) => (handle?.kind === "file" ? handle : null))
          : [],
      ),
    )
    .catch(report);
});
function selectedPages() {
  const doc = active();
  return doc ? orderedSelection(doc) : [];
}
function deletePages(ids = selectedIds()) {
  if (!ids.length) return;
  modify("Seiten löschen", (doc) => {
    doc.pages = doc.pages.filter((page) => !ids.includes(page.id));
    doc.selected = doc.selected.filter((id) => !ids.includes(id));
  });
}
function rotatePages(delta, ids) {
  if (!ids.length) return;
  modify("Seiten drehen", (doc) => {
    for (const page of doc.pages)
      if (ids.includes(page.id))
        page.rotation = normalizeAngle(page.rotation + delta);
  });
}
const selectedIds = () => selectedPages().map((page) => page.id);
function canMovePages(doc, ids, direction) {
  const set = new Set(ids);
  return doc.pages.some(
    (page, index) =>
      set.has(page.id) &&
      doc.pages[index + direction] &&
      !set.has(doc.pages[index + direction].id),
  );
}
function movePages(direction, ids = selectedIds()) {
  if (!ids.length) return;
  modify("Seiten verschieben", (doc) => {
    const set = new Set(ids),
      pages = doc.pages;
    if (direction < 0) {
      for (let i = 1; i < pages.length; i++)
        if (set.has(pages[i].id) && !set.has(pages[i - 1].id))
          [pages[i], pages[i - 1]] = [pages[i - 1], pages[i]];
    } else {
      for (let i = pages.length - 2; i >= 0; i--)
        if (set.has(pages[i].id) && !set.has(pages[i + 1].id))
          [pages[i], pages[i + 1]] = [pages[i + 1], pages[i]];
    }
  });
}
function copySelection(target, ids) {
  const source = active(),
    pages = source?.pages.filter((page) => ids.includes(page.id)) ?? [];
  if (!pages.length) return;
  if (!target) {
    target = createDocument(`${source.name} – Auswahl`);
    target.pages = copyPages(source, pages, target);
    target.current = target.pages[0].id;
    target.selected = [target.current];
    target.dirty = true;
    addDocument(target);
  } else {
    if (target.pages.length + pages.length > limits.pages)
      throw new Error("Das Zieldokument würde mehr als 500 Seiten enthalten.");
    edit(target, "Seiten einfügen", () => {
      const copies = copyPages(source, pages, target);
      target.pages.push(...copies);
      target.current = copies[0].id;
      target.selected = copies.map((page) => page.id);
    });
    activate(target);
  }
}
function mergeDocuments() {
  const selected = documents.filter((doc) => doc.kind === "pdf");
  if (selected.length < 2)
    throw new Error("Bitte mindestens zwei Dokumente öffnen.");
  const count = selected.reduce((sum, doc) => sum + doc.pages.length, 0);
  if (count > limits.pages)
    throw new Error("Die Zusammenführung würde mehr als 500 Seiten enthalten.");
  const sourceIds = new Set(
    selected.flatMap((doc) =>
      doc.pages.map((page) => page.sourceId).filter(Boolean),
    ),
  );
  if (
    [...sourceIds].reduce((sum, id) => sum + sources.get(id).file.size, 0) >
    limits.totalBytes
  )
    throw new Error("Die Quelldateien sind zusammen größer als 150 MiB.");
  const doc = createDocument("Zusammengeführt");
  for (const source of selected) {
    const copies = copyPages(source, source.pages, doc),
      mapping = new Map(
        source.pages.map((page, index) => [page.id, copies[index].id]),
      );
    doc.pages.push(...copies);
    doc.groups.push(
      ...source.groups.map((group) => group.map((id) => mapping.get(id))),
    );
  }
  doc.current = doc.pages[0].id;
  doc.selected = [doc.current];
  doc.dirty = true;
  addDocument(doc);
  message(`${count} Seiten zusammengeführt.`);
}
function navigate(delta) {
  const doc = active();
  if (!doc?.pages.length) return;
  const index = Math.max(
    0,
    Math.min(
      doc.pages.length - 1,
      doc.pages.findIndex((page) => page.id === doc.current) + delta,
    ),
  );
  selectPage(doc.pages[index].id);
}
function setZoom(value) {
  zoom = value;
  document.querySelectorAll("[data-zoom]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.zoom === zoom));
  });
  void renderPage();
}
function syncFullscreenButton() {
  const button = $("fullscreen-button"),
    active = !!document.fullscreenElement,
    label = active ? "Vollbildmodus beenden" : "Vollbildmodus starten";
  button.innerHTML = icon(active ? "minimize" : "maximize");
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", label);
  button.title = label;
}
$("fullscreen-button").hidden = !document.fullscreenEnabled;
document.addEventListener("fullscreenchange", syncFullscreenButton);
function zoomBy(factor) {
  if (!current()) return;
  const base = typeof zoom === "number" ? zoom : scale;
  setZoom(Math.max(0.25, Math.min(4, base * factor)));
}
$("editor").addEventListener(
  "wheel",
  (event) => {
    if (!(event.ctrlKey || event.metaKey) || !current()) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
    zoomBy(Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.002));
  },
  { passive: false },
);
$("current-page").addEventListener("change", () => {
  const doc = active(),
    index = Number($("current-page").value) - 1;
  if (doc?.pages[index]) selectPage(doc.pages[index].id);
});
const viewPillRevealDistance = 96;
$("editor").addEventListener(
  "pointermove",
  (event) => {
    const bounds = $("page-scroll").getBoundingClientRect();
    $("view-pill").classList.toggle(
      "revealed",
      event.pointerType === "mouse" &&
        event.clientY >= bounds.bottom - viewPillRevealDistance &&
        event.clientY <= bounds.bottom,
    );
  },
  { passive: true },
);
$("editor").addEventListener("pointerleave", () =>
  $("view-pill").classList.remove("revealed"),
);
let resizeTimer;
new ResizeObserver(() => {
  followViewport();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (
      current() &&
      typeof zoom === "string" &&
      viewportKey() !== renderedViewport
    )
      void renderPage({ preserveNavigation: true });
  }, 150);
}).observe($("editor"));
for (const id of [
  "layout-auto",
  "layout-students",
  "layout-padding",
])
  $(id).addEventListener("input", updateLayoutSummary);
function openExport(split = false) {
  splitting = split;
  $("export-dialog").querySelector("h2").textContent = split
    ? "Dokument aufteilen"
    : "Dokument exportieren";
  const doc = active();
  if (!doc?.pages.length)
    throw new Error("Bitte zuerst ein Dokument öffnen oder anlegen.");
  $("export-name").value = doc.name;
  $("export-scope").value = "all";
  $("export-split").value = split ? "groups" : "combined";
  $("export-error").textContent = "";
  $("export-password").value = "";
  $("export-password-confirm").value = "";
  $("export-dialog").showModal();
  updateExportOptions();
}
function updateExportOptions() {
  const pdf = $("export-format").value === "pdf";
  $("pdf-options").hidden = !pdf;
  $("image-options").hidden = pdf;
  $("export-split").disabled = !pdf;
}
$("export-format").addEventListener("change", updateExportOptions);
$("export-dialog").addEventListener("close", () => {
  if ($("export-dialog").returnValue !== "export") {
    $("export-password").value = "";
    $("export-password-confirm").value = "";
  }
});
function markSaved(doc) {
  doc.dirty = false;
  for (const entry of [...doc.history.past, ...doc.history.future])
    entry.state.dirty = true;
}
function commitPendingInput() {
  finishTextEdit();
  const focused = document.activeElement;
  if (focused?.closest?.("#form-layer")) {
    focused.blur();
    focused.focus({ preventScroll: true });
  }
}
async function detachSources(handle) {
  for (const entry of sources.values())
    if (entry.handle && (await entry.handle.isSameEntry(handle))) {
      entry.file = new File([await readBytes(entry.file)], entry.file.name, {
        type: entry.file.type,
      });
      entry.handle = null;
    }
}
async function writable(handle) {
  const mode = { mode: "readwrite" };
  if (
    (await handle.queryPermission?.(mode)) !== "granted" &&
    (await handle.requestPermission?.(mode)) !== "granted"
  )
    throw new Error("PDFHelper hat keine Schreibberechtigung für diese Datei.");
}
async function saveDocument({ choose = false } = {}) {
  const doc = active();
  if (!doc || doc.kind !== "pdf") return;
  if (!(await confirmRequired(doc, "Trotzdem speichern"))) return;
  let handle = choose ? null : doc.handle;
  if (!handle && !window.showSaveFilePicker) return openExport();
  if (!handle)
    try {
      handle = await window.showSaveFilePicker({
        id: "pdfhelper-save",
        suggestedName: safeName(doc.name),
        types: [
          {
            description: "PDF-Dokument",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
    } catch (error) {
      if (error.name === "AbortError") return;
      throw error;
    }
  await writable(handle);
  const password = sources.get(doc.origin)?.password || "",
    plainGroup = doc.pages.find((page) => page.sourceId === doc.origin)
      ?.formGroup,
    focused = document.activeElement;
  await runJob("Dokument wird gespeichert", async (job) => {
    const result = await buildPdf(
      doc,
      doc.pages,
      sources,
      assets,
      { password, flatten: false, plainGroup },
      job,
    );
    if (job.signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
    await detachSources(handle);
    const stream = await handle.createWritable();
    try {
      await stream.write(new Blob([result.data], { type: "application/pdf" }));
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
  }, { silent: true });
  if (doc.handle !== handle) {
    doc.handle = handle;
    doc.name = handle.name.replace(/\.pdf$/i, "");
    if (recentSupported()) void rememberFile(handle).catch(() => {});
  }
  markSaved(doc);
  renderDocuments();
  if (focused?.isConnected) focused.focus({ preventScroll: true });
  message(`Gespeichert: ${handle.name}`);
}
$("export-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const doc = active();
  if (!doc) return;
  const format = $("export-format").value,
    password = format === "pdf" ? $("export-password").value : "",
    name = $("export-name").value,
    all = $("export-scope").value === "all",
    groups = format === "pdf" && $("export-split").value === "groups";
  if (password !== $("export-password-confirm").value && format === "pdf") {
    $("export-error").textContent = "Die Passwörter stimmen nicht überein.";
    return;
  }
  const pages = splitting
    ? splitGroups(doc, all)
        .flat()
        .map((id) => doc.pages.find((page) => page.id === id))
    : orderedSelection(doc, all);
  if (!pages.length) {
    $("export-error").textContent = "Bitte mindestens eine Seite auswählen.";
    return;
  }
  const options = { password, flatten: $("export-flatten").checked },
    dpi = Number($("export-dpi").value),
    quality = Number($("export-quality").value) / 100;
  $("export-dialog").close("export");
  $("export-password").value = "";
  $("export-password-confirm").value = "";
  try {
    let delivered = false,
      exportNotice = "";
    await runJob("Export wird erstellt", async (job) => {
      if (format === "pdf") {
        const pageGroups = groups
          ? splitGroups(doc, all)
          : [pages.map((page) => page.id)];
        const outputs = [];
        for (const [index, ids] of pageGroups.entries()) {
          if (job.signal.aborted)
            throw new DOMException("Abgebrochen", "AbortError");
          const subset = ids.map((id) =>
            doc.pages.find((page) => page.id === id),
          );
          const result = await buildPdf(doc, subset, sources, assets, options, {
            signal: job.signal,
            progress: (value) =>
              job.progress(((index + value) / pageGroups.length) * 0.85),
          });
          outputs.push({
            name:
              pageGroups.length === 1
                ? safeName(name)
                : safeName(
                    `${name} – ${ids.length === 1 ? `Seite ${String(doc.pages.findIndex((page) => page.id === ids[0]) + 1).padStart(3, "0")}` : `Teil ${String(index + 1).padStart(3, "0")}`}`,
                  ),
            data: result.data,
          });
        }
        delivered =
          outputs.length === 1
            ? await download(
                new Blob([outputs[0].data], { type: "application/pdf" }),
                outputs[0].name,
                { share: true, signal: job.signal },
              )
            : await zipOutputs(outputs, name, job.signal, (value) =>
                job.progress(0.85 + value * 0.15),
              );
      } else {
        const result = await buildPdf(
          doc,
          pages,
          sources,
          assets,
          { flatten: true },
          {
            signal: job.signal,
            progress: (value) => job.progress(value * 0.4),
          },
        );
        const rendered = await renderOutput(result.data, {
          format,
          dpi,
          quality,
          signal: job.signal,
          progress: (value) => job.progress(0.4 + value * 0.5),
          maxPixels:
            navigator.deviceMemory && navigator.deviceMemory <= 4
              ? 4_000_000
              : 16_000_000,
        });
        const outputs = rendered.outputs.map((output, index) => ({
          blob: output.blob,
          name: safeName(
            `${name} – Seite ${String(doc.pages.indexOf(pages[index]) + 1).padStart(3, "0")}`,
            format,
          ),
        }));
        delivered =
          outputs.length === 1
            ? await download(outputs[0].blob, safeName(name, format), {
                signal: job.signal,
              })
            : await zipOutputs(outputs, name, job.signal, (value) =>
                job.progress(0.9 + value * 0.1),
              );
        if (rendered.reduced)
          exportNotice = `Bildauflösung an das Speicherbudget angepasst (mindestens ${Math.floor(Math.min(...rendered.outputs.map((output) => output.dpi)))} dpi).`;
      }
    });
    if (delivered) {
      if (format === "pdf" && all && !groups && !splitting) {
        markSaved(doc);
        renderDocuments();
      }
      message(`Export erstellt.${exportNotice ? "\n" + exportNotice : ""}`);
    } else message("Datei erstellt, Teilen wurde abgebrochen.");
  } catch (error) {
    report(error);
  } finally {
    options.password = "";
  }
});
function openLayout() {
  if (!active()?.pages.length)
    throw new Error("Bitte zuerst ein Dokument öffnen oder anlegen.");
  renderSettings();
  $("layout-dialog").showModal();
}
function submitLayout(action) {
  updateLayoutSummary();
  if ($("layout-submit").disabled) return;
  $("layout-dialog").close("layout");
  (action === "save" ? saveLayout : showLayout)().catch(report);
}
$("layout-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitLayout("save");
});
$("layout-view").addEventListener("click", () => submitLayout("view"));
async function buildLayout() {
  const doc = active();
  if (!doc?.pages.length) throw new Error("Bitte zuerst ein Dokument öffnen.");
  const options = layoutOptions();
  layoutPlan(doc.pages.length, options);
  const result = await runJob("Drucklayout wird erstellt", (job) =>
    buildPdf(
      doc,
      doc.pages,
      sources,
      assets,
      { layout: options, flatten: true },
      job,
    ),
  );
  const name = `${result.copies ? `${result.copies} mal drucken – ` : "Drucken – "}${doc.name}`;
  return { data: result.data, copies: result.copies, name };
}
async function saveLayout() {
  const result = await buildLayout();
  const fileName = safeName(result.name);
  await download(new Blob([result.data], { type: "application/pdf" }), fileName);
  message(
    `Drucklayout gespeichert: ${fileName}${result.copies ? ` · ${result.copies} mal drucken` : ""}`,
  );
}
async function showLayout() {
  const result = await buildLayout();
  const name = result.name;
  const file = new File([result.data], safeName(name), {
    type: "application/pdf",
  });
  const info = await runJob("Drucklayout wird geöffnet", (job) =>
    processPdf("inspect", { data: result.data.slice() }, job),
  );
  const id = uid(),
    group = uid();
  sources.set(id, { id, file, password: "", fingerprint: uid() });
  const next = createDocument(
    name,
    info.pages.map((page, index) => createPage(id, index, page, group)),
  );
  next.dirty = true;
  addDocument(next);
  message(
    `Drucklayout erstellt${result.copies ? ` · ${result.copies} mal drucken` : ""}.`,
  );
}
async function printDocument() {
  const doc = active();
  if (!doc?.pages.length) throw new Error("Bitte zuerst ein Dokument öffnen.");
  if (!(await confirmRequired(doc, "Trotzdem drucken"))) return;
  const all = doc.selected.length <= 1;
  const groups = splitGroups(doc, all);
  await runJob("Drucken wird vorbereitet", async (job) => {
    const outputs = [];
    for (const [index, ids] of groups.entries()) {
      const result = await buildPdf(
        doc,
        ids.map((id) => doc.pages.find((page) => page.id === id)),
        sources,
        assets,
        { flatten: true },
        {
          signal: job.signal,
          progress: (value) =>
            job.progress(((index + value) / groups.length) * 0.55),
        },
      );
      outputs.push(result);
    }
    $("busy-message").textContent =
      "Der Druckdialog öffnet sich, sobald alle Seiten bereit sind.";
    await printOutputs(outputs, {
      signal: job.signal,
      progress: (value) => job.progress(0.55 + value * 0.45),
    });
  });
}
const actions = {
  "toggle-comments": () => showComments(),
  open: openFiles,
  save: () => saveDocument(),
  "save-as": () => saveDocument({ choose: true }),
  "toggle-recent": toggleRecent,
  "close-document": (button) => {
    const doc =
      documents.find((doc) => doc.id === button?.dataset.document) ||
      active();
    if (doc) return closeDocument(doc);
  },
  help: () => $("help-dialog").showModal(),
  undo: () => stepHistory(undo),
  redo: () => stepHistory(redo),
  "toggle-history": toggleHistory,
  "toggle-tool-style": toggleToolStyle,
  "select-all": () => {
    if (active()) {
      active().selected = active().pages.map((page) => page.id);
      updateSelection();
    }
  },
  "select-none": () => {
    if (active()) {
      active().selected = [];
      updateSelection();
    }
  },
  "delete-element": () => {
    if (element())
      modify("Element löschen", () => {
        current().elements = current().elements.filter(
          (el) => el.id !== selectedElement,
        );
        selectedElement = null;
      });
  },
  merge: mergeDocuments,
  split: () => openExport(true),
  export: () => {
    const doc = active();
    commitPendingInput();
    return doc?.kind === "pdf" && missingRequired(doc).length
      ? confirmRequired(doc, "Trotzdem exportieren").then(
          (confirmed) => confirmed && openExport(),
        )
      : openExport();
  },
  "rotate-page": () => {
    const ids = selectedIds();
    rotatePages(90, ids.length ? ids : [active()?.current].filter(Boolean));
  },
  "open-layout": openLayout,
  print: printDocument,
  "navigation-back": navigateBack,
  previous: () => navigate(-1),
  next: () => navigate(1),
  "fit-width": () => setZoom("fit-width"),
  "fit-page": () => setZoom("fit-page"),
  "toggle-page-view": () => {
    twoPages = !twoPages;
    $("page-flow").classList.toggle("two-pages", twoPages);
    $("page-view-button").setAttribute("aria-pressed", String(twoPages));
    void renderPage();
    if (current()) scrollToPage(current().id);
    fadeContent($("page-flow"));
  },
  "toggle-pdf-dark": () => {
    pdfDark = !pdfDark;
    writePdfDark(pdfDark);
    $("pdf-dark-button").setAttribute("aria-pressed", String(pdfDark));
    $("page-flow").classList.toggle("pdf-dark", pdfDark);
    for (const slot of $("page-flow").children) releasePreview(slot);
    mainCanvasPage = null;
    renderAll();
  },
  "zoom-in": () => zoomBy(1.2),
  "zoom-out": () => zoomBy(1 / 1.2),
  "toggle-search": () => (searchOpen() ? closeSearch(true) : openSearch()),
  "toggle-fullscreen": () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen(),
  "search-next": () => stepMatch(1),
  "search-previous": () => stepMatch(-1),
  "search-close": () => closeSearch(true),
  "copy-command": async (button) => {
    const input = button.parentElement.querySelector("input");
    try {
      await navigator.clipboard.writeText(input.value);
      message("Befehl kopiert.");
    } catch {
      input.select();
      message("Bitte den markierten Befehl mit Strg/⌘ C kopieren.");
    }
  },
};
document.addEventListener("click", (event) => {
  const toolButton = event.target.closest("button[data-tool]");
  if (toolButton) {
    setTool(toolButton.dataset.tool);
    return;
  }
  const sheet = event.target.closest("[data-sheet]");
  if (sheet) {
    selectSheet(Number(sheet.dataset.sheet));
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button || !actions[button.dataset.action]) return;
  try {
    Promise.resolve(actions[button.dataset.action](button)).catch(report);
  } catch (error) {
    report(error);
  }
});
document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    key === "s" &&
    current() &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    Promise.resolve(actions[event.shiftKey ? "export" : "save"]()).catch(
      report,
    );
    return;
  }
  if (current() && !document.querySelector("dialog[open]")) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && key === "f") {
      event.preventDefault();
      openSearch();
      return;
    }
    if (event.key === "F3" && searchOpen()) {
      event.preventDefault();
      stepMatch(event.shiftKey ? -1 : 1);
      return;
    }
  }
  if (event.target.closest("input,textarea,select,[contenteditable=true]"))
    return;
  if (document.querySelector("dialog[open]")) return;
  if (active()?.kind === "epub" && !((event.ctrlKey || event.metaKey) && key === "o")) return;
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
    adjustTextSelection(event.key)
  ) {
    event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && ["o", "z", "y"].includes(key)) {
    event.preventDefault();
    const action =
      key === "z" && event.shiftKey
        ? "redo"
        : { o: "open", z: "undo", y: "redo" }[key];
    Promise.resolve(actions[action]()).catch(report);
  } else if (event.key === "Escape") setTool("select");
  else if (event.key === "Delete" || event.key === "Backspace") {
    if (element()) {
      event.preventDefault();
      actions["delete-element"]();
    }
  } else if (event.key === "PageDown") {
    event.preventDefault();
    navigate(1);
  } else if (event.key === "PageUp") {
    event.preventDefault();
    navigate(-1);
  }
});
window.addEventListener("pdfhelper-update", () => (updating = true));
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
window.addEventListener("beforeunload", (event) => {
  if (!updating && documents.some((doc) => doc.dirty)) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  renderer.destroy();
  cleanupExports();
  for (const asset of assets.values()) {
    URL.revokeObjectURL(asset.url);
    asset.bitmap?.close();
  }
  for (const source of sources.values()) source.password = "";
  for (const doc of documents) doc.reader?.destroy();
  sources.clear();
  assets.clear();
  documents.length = 0;
});
setupPwa({
  hasWork: () => documents.length > 0,
  hasChanges: () => documents.some((doc) => doc.dirty),
  confirm: confirmAction,
  message,
  actions,
});
renderAll();
