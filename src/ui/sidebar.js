import { readSidebarPinned, writeSidebarPinned } from "./settings.js";

export function setupSidebar(shouldReserve) {
  const shell = document.querySelector(".app-shell"),
    workspace = document.getElementById("workspace"),
    panel = document.getElementById("pages-panel"),
    grip = document.getElementById("sidebar-grip"),
    menu = document.getElementById("context-menu"),
    scroller = document.getElementById("page-scroll"),
    flow = document.getElementById("page-flow"),
    noHover = matchMedia("(hover: none)");
  let pinned = readSidebarPinned(),
    keyboard = true,
    point = null,
    touchOpen = false,
    context = false,
    resizing = null,
    dragging = false,
    geometryFrame = 0;

  function nearEdge(bounds) {
    if (scroller.hidden) return point.x <= bounds.left + 96;
    const viewport = scroller.getBoundingClientRect();
    let edge = Infinity;
    for (const slot of flow.children) {
      const rect = slot.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 &&
          rect.bottom > viewport.top && rect.top < viewport.bottom &&
          rect.right > viewport.left && rect.left < viewport.right)
        edge = Math.min(edge, rect.left);
    }
    return Number.isFinite(edge) && point.x < edge;
  }

  function scheduleSync() {
    if (geometryFrame) return;
    geometryFrame = requestAnimationFrame(() => {
      geometryFrame = 0;
      sync();
    });
  }

  function sync() {
    const bounds = shell.getBoundingClientRect(),
      rect = panel.getBoundingClientRect(),
      inside = point && point.y >= bounds.top && point.y <= bounds.bottom &&
        point.x >= bounds.left && point.x <= bounds.right &&
        (nearEdge(bounds) ||
          (workspace.classList.contains("sidebar-visible") && point.y >= rect.top &&
            point.y <= rect.bottom && point.x <= bounds.left + panel.offsetWidth)),
      reserved = pinned && shouldReserve(),
      visible = reserved || touchOpen || (!noHover.matches && inside) ||
        (keyboard && panel.contains(document.activeElement)) ||
        (context && menu.matches(":popover-open")) || resizing !== null || dragging;
    workspace.classList.toggle("sidebar-reserved", reserved);
    workspace.classList.toggle("sidebar-visible", !!visible);
    panel.dataset.pinned = String(pinned);
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

  function togglePinned() {
    pinned = !pinned;
    writeSidebarPinned(pinned);
    sync();
  }
  grip.addEventListener("click", () => {
    touchOpen = true;
    if (keyboard) panel.focus({ preventScroll: true });
    sync();
  });
  for (const type of ["pointermove", "pointerover"])
    document.addEventListener(type, (event) => move(event), { capture: true, passive: true });
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
    for (const type of ["pointermove", "pointerover"])
      frame.contentDocument?.addEventListener(type, (event) => move(event, frame), { capture: true, passive: true });
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
  scroller.addEventListener("scroll", scheduleSync, { passive: true });
  const geometryObserver = new ResizeObserver(scheduleSync);
  geometryObserver.observe(scroller);
  geometryObserver.observe(flow);
  new MutationObserver(scheduleSync).observe(flow, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  new MutationObserver(scheduleSync).observe(scroller, {
    attributes: true,
    attributeFilter: ["hidden"],
  });
  sync();
  return { sync, isPinned: () => pinned, togglePinned };
}
