import { readToolbarPinned, writeToolbarPinned } from "./settings.js";

export function setupToolbar() {
  const shell = document.querySelector(".app-shell"),
    toolbar = document.getElementById("editor-topbar"),
    noHover = matchMedia("(hover: none)"),
    menus = ["recent-menu", "history-menu", "tool-style-menu", "context-menu"]
      .map((id) => document.getElementById(id));
  let pinned = readToolbarPinned(),
    nearTop = false,
    keyboard = true,
    toolbarContext = false;

  function menuOpen(menu) {
    if (menu.id === "context-menu")
      return menu.matches(":popover-open") && toolbarContext;
    return menu.hasAttribute("popover") ? menu.matches(":popover-open") : !menu.hidden;
  }

  function sync() {
    const focused = keyboard && toolbar.contains(document.activeElement),
      visible = pinned || noHover.matches || nearTop || focused || menus.some(menuOpen);
    shell.classList.toggle("toolbar-visible", visible);
    shell.classList.toggle("toolbar-reserved", pinned || noHover.matches);
    toolbar.dataset.pinned = String(pinned);
  }

  function togglePinned() {
    pinned = !pinned;
    writeToolbarPinned(pinned);
    sync();
  }
  function pointerMove(event, frame = null) {
    if (event.pointerType && event.pointerType !== "mouse") return;
    const bounds = shell.getBoundingClientRect();
    const offset = frame?.getBoundingClientRect(),
      x = event.clientX + (offset?.left || 0),
      y = event.clientY + (offset?.top || 0);
    const next = x >= bounds.left && x <= bounds.right && y >= bounds.top &&
      (y <= bounds.top + 96 || toolbar.contains(event.target));
    if (next === nearTop) return;
    nearTop = next;
    sync();
  }
  for (const type of ["pointermove", "pointerover"])
    document.addEventListener(type, (event) => pointerMove(event), { capture: true, passive: true });
  document.addEventListener("load", (event) => {
    const frame = event.target;
    if (!frame.matches?.(".epub-book iframe")) return;
    for (const type of ["pointermove", "pointerover"])
      frame.contentDocument?.addEventListener(type, (event) => pointerMove(event, frame), { capture: true, passive: true });
  }, true);
  document.documentElement.addEventListener("pointerleave", () => {
    nearTop = false;
    sync();
  });
  document.addEventListener("pointerdown", () => {
    keyboard = false;
    sync();
  }, { capture: true, passive: true });
  document.addEventListener("keydown", () => {
    keyboard = true;
    sync();
  }, true);
  document.addEventListener("focusin", sync);
  document.addEventListener("focusout", () => queueMicrotask(sync));
  document.addEventListener("contextmenu", (event) => {
    toolbarContext = toolbar.contains(event.target);
  }, true);
  window.addEventListener("blur", () => {
    nearTop = false;
    sync();
  });
  noHover.addEventListener("change", sync);
  const observer = new MutationObserver(sync);
  for (const menu of menus) {
    observer.observe(menu, { attributes: true, attributeFilter: ["hidden"] });
    menu.addEventListener("toggle", sync);
  }
  sync();
  return { isPinned: () => pinned, togglePinned };
}
