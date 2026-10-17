const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const contentFades = new Map();

export function setHidden(element, hidden) {
  element.inert = hidden;
  element.hidden = hidden;
}

export function setupDisclosures() {
  for (const details of document.querySelectorAll("details")) {
    const summary = details.querySelector(":scope > summary");
    if (!summary) continue;
    const setContentInert = (inert) => {
      const content = [...details.children].filter((child) => child !== summary);
      if (inert && content.some((child) => child.contains(document.activeElement))) summary.focus();
      for (const child of content) child.inert = inert;
    };
    summary.addEventListener("click", () => setContentInert(details.open));
    details.addEventListener("toggle", () => setContentInert(!details.open));
    setContentInert(!details.open);
  }
}

export function cancelContentFade(element) {
  contentFades.get(element)?.cancel();
  contentFades.delete(element);
}

export function fadeContent(element) {
  cancelContentFade(element);
  if (reducedMotion.matches || !element.isConnected || element.closest("[hidden]")) return;
  const style = getComputedStyle(element);
  const animation = element.animate(
    [{ opacity: 0.45 }, { opacity: 1 }],
    {
      duration: parseFloat(style.getPropertyValue("--motion-reveal")),
      easing: style.getPropertyValue("--motion-ease").trim(),
    },
  );
  contentFades.set(element, animation);
  const cleanup = () => {
    if (contentFades.get(element) === animation) contentFades.delete(element);
  };
  animation.addEventListener("finish", cleanup, { once: true });
  animation.addEventListener("cancel", cleanup, { once: true });
}

reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches)
    for (const element of contentFades.keys()) cancelContentFade(element);
});
