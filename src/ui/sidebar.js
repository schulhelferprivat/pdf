import { readSidebarPinned, writeSidebarPinned } from "./settings.js";

export function setupSidebar(shouldReserve) {
  const workspace = document.getElementById("workspace"),
    panel = document.getElementById("pages-panel"),
    pin = document.getElementById("sidebar-pin"),
    grip = document.getElementById("sidebar-grip"),
    menu = document.getElementById("context-menu"),
    noHover = matchMedia("(hover: none)");
  let pinned = readSidebarPinned(),
    keyboard = true,
    point = null,
    touchOpen = false,
    context = false,
    resizing = null,
    dragging = false;

  function sync() {
    const bounds = workspace.getBoundingClientRect(),
      rect = panel.getBoundingClientRect(),
      inside = point && point.y >= rect.top && point.y <= rect.bottom &&
        point.x >= bounds.left && point.x <= bounds.right &&
        (point.x <= bounds.left + 96 ||
          (workspace.classList.contains("sidebar-visible") && point.x <= rect.right)),
      reserved = pinned && shouldReserve(),
      visible = reserved || touchOpen || (!noHover.matches && inside) ||
        (keyboard && panel.contains(document.activeElement)) ||
        (context && menu.matches(":popover-open")) || resizing !== null || dragging;
    workspace.classList.toggle("sidebar-reserved", reserved);
    workspace.classList.toggle("sidebar-visible", !!visible);
    pin.setAttribute("aria-pressed", String(pinned));
    pin.title = pinned ? "Sidebar lösen" : "Sidebar festpinnen";
    pin.setAttribute("aria-label", pin.title);
    grip.hidden = !noHover.matches || !!visible;
    grip.setAttribute("aria-expanded", String(!!visible));
  }

  function move(event, frame = null) {
    if (event.pointerType && event.pointerType !== "mouse") return;
    const offset = frame?.getBoundingClientRect();
    point = { x: event.clientX + (offset?.left || 0), y: event.clientY + (offset?.top || 0) };
    sync();
  }

  function pointerDown(event) {
    keyboard = false;
    if (!panel.contains(event.target)) touchOpen = false;
    if (event.target.closest?.("#pages-resizer")) resizing = event.pointerId;
    sync();
  }

  function release(event) {
    if (event.pointerId !== resizing) return;
    resizing = null;
    sync();
  }

  pin.addEventListener("click", () => {
    pinned = !pinned;
    writeSidebarPinned(pinned);
    sync();
  });
  grip.addEventListener("click", () => {
    touchOpen = true;
    if (keyboard) pin.focus({ preventScroll: true });
    sync();
  });
  document.addEventListener("pointermove", (event) => move(event), { passive: true });
  document.addEventListener("pointerdown", pointerDown, { capture: true, passive: true });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    document.addEventListener(type, release, true);
  document.addEventListener("keydown", () => {
    keyboard = true;
    sync();
  }, true);
  document.addEventListener("focusin", sync);
  document.addEventListener("focusout", () => queueMicrotask(sync));
  document.addEventListener("contextmenu", (event) => {
    context = panel.contains(event.target);
  }, true);
  menu.addEventListener("toggle", sync);
  panel.addEventListener("dragstart", () => {
    dragging = true;
    sync();
  });
  document.addEventListener("dragover", (event) => move(event), { passive: true });
  for (const type of ["drop", "dragend"])
    document.addEventListener(type, () => {
      dragging = false;
      queueMicrotask(sync);
    }, true);
  document.addEventListener("load", (event) => {
    const frame = event.target;
    if (!frame.matches?.(".epub-book iframe")) return;
    frame.contentDocument?.addEventListener("pointermove", (event) => move(event, frame), { passive: true });
    frame.contentDocument?.addEventListener("pointerdown", pointerDown, { capture: true, passive: true });
  }, true);
  document.documentElement.addEventListener("pointerleave", () => {
    point = null;
    sync();
  });
  window.addEventListener("blur", () => {
    point = null;
    resizing = null;
    dragging = false;
    touchOpen = false;
    sync();
  });
  noHover.addEventListener("change", () => {
    touchOpen = false;
    sync();
  });
  window.addEventListener("resize", sync);
  sync();
  return sync;
}
