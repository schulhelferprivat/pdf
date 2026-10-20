export function setupPanelResizing() {
  const workspace = document.getElementById("workspace");
  for (const [name, direction, minimum, mobileMaximum] of [
    ["pages", 1, 160, 0.85],
    ["comments", -1, 220, 1],
  ]) {
    const panel = document.getElementById(`${name}-panel`),
      handle = document.getElementById(`${name}-resizer`),
      widthTarget = name === "pages" ? panel.parentElement : panel,
      property = `--${name}-manual-width`;
    let gesture = null;
    function bounds() {
      const available = workspace.clientWidth,
        maximum = window.innerWidth <= 600
          ? available * (name === "pages" && workspace.classList.contains("sidebar-reserved") ? 0.5 : mobileMaximum)
          : Math.min(480, available * 0.4);
      return { minimum: Math.min(minimum, maximum), maximum };
    }
    function width() {
      return parseFloat(getComputedStyle(panel).width) || 0;
    }
    function syncAria() {
      const current = width(), limits = bounds();
      handle.setAttribute("aria-valuemin", String(Math.round(Math.min(limits.minimum, current))));
      handle.setAttribute("aria-valuemax", String(Math.round(Math.max(limits.maximum, current))));
      handle.setAttribute("aria-valuenow", String(Math.round(current)));
      handle.setAttribute("aria-valuetext", `${Math.round(current)} Pixel`);
    }
    function change(operation) {
      panel.classList.add("resizing");
      operation();
      syncAria();
      void panel.offsetWidth;
      if (!gesture) panel.classList.remove("resizing");
    }
    function setWidth(value) {
      const limits = bounds(),
        next = Math.max(limits.minimum, Math.min(limits.maximum, value));
      change(() => widthTarget.style.setProperty(property, `${next}px`));
    }
    function finish(event) {
      if (!gesture || (event?.pointerId != null && event.pointerId !== gesture.pointerId)) return;
      const { pointerId } = gesture;
      gesture = null;
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      panel.classList.remove("resizing");
      document.body.classList.remove("resizing-panels");
    }
    function reset() {
      finish();
      change(() => widthTarget.style.removeProperty(property));
    }
    handle.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0 || gesture) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      gesture = { pointerId: event.pointerId, x: event.clientX, width: width() };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add("resizing");
      document.body.classList.add("resizing-panels");
    });
    handle.addEventListener("pointermove", (event) => {
      if (event.pointerId !== gesture?.pointerId) return;
      setWidth(gesture.width + (event.clientX - gesture.x) * direction);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      handle.addEventListener(type, finish);
    window.addEventListener("blur", () => finish());
    handle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      reset();
    });
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") reset();
      else {
        const step = (event.shiftKey ? 50 : 10) * (event.key === "ArrowRight" ? 1 : -1);
        setWidth(width() + step * direction);
      }
    });
    const observer = new ResizeObserver(() => {
      const manual = widthTarget.style.getPropertyValue(property);
      if (manual) {
        const value = parseFloat(manual), limits = bounds();
        if (value < limits.minimum || value > limits.maximum) setWidth(value);
      }
      if (gesture && (!panel.checkVisibility() || panel.inert)) finish();
      syncAria();
    });
    observer.observe(workspace);
    observer.observe(panel);
    syncAria();
  }
}
