import test from "node:test";
import assert from "node:assert/strict";
import { browser } from "./helpers/browser.mjs";
import { openBlankDocument, selectDocument } from "./helpers/documents.mjs";

test("Browser: Menüs und Dialoge blenden ein und aus und bleiben direkt bedienbar", { timeout: 120000 }, async (t) => {
  const b = await browser(t, { reducedMotion: false });
  await b.evaluate(async () => {
    await document.fonts.ready;
    const { rememberFile } = await import("./src/core/recent.js");
    const root = await navigator.storage.getDirectory();
    await rememberFile(await root.getFileHandle("Animation.pdf", { create: true }));
    window.menuTransitions = [];
    document.querySelector("#recent-menu").addEventListener("transitionrun", (event) => {
      if (event.target.id === "recent-menu")
        window.menuTransitions.push({ property: event.propertyName, hidden: event.target.hidden });
    });
    document.querySelector("#recent-button").click();
  });
  await b.wait(() => window.menuTransitions.some((event) => event.property === "opacity" && !event.hidden));
  await b.evaluate(async () => {
    await Promise.all(document.querySelector("#recent-menu").getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  await b.screenshot("/tmp/pdfhelper-motion-recent.png");
  assert.deepEqual(await b.evaluate(() => {
    const menu = document.querySelector("#recent-menu");
    const toggle = document.querySelector("#recent-button");
    const before = getComputedStyle(menu).opacity;
    toggle.click();
    return {
      before,
      hidden: menu.hidden,
      inert: menu.inert,
      expanded: toggle.getAttribute("aria-expanded"),
      focused: document.activeElement.id,
      display: getComputedStyle(menu).display,
      pointerEvents: getComputedStyle(menu).pointerEvents,
      animating: menu.getAnimations().some((animation) => animation.transitionProperty === "opacity"),
    };
  }), {
    before: "1", hidden: true, inert: true, expanded: "false", focused: "recent-button",
    display: "block", pointerEvents: "none", animating: true,
  });
  await b.evaluate(() => document.querySelector("#recent-button").click());
  await b.wait(() => !document.querySelector("#recent-menu").hidden);
  await b.evaluate(async () => {
    const menu = document.querySelector("#recent-menu");
    await Promise.all(menu.getAnimations().map((animation) => animation.finished.catch(() => {})));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.deepEqual(await b.evaluate(() => [
    document.querySelector("#recent-menu").hidden,
    document.activeElement.id,
    document.querySelector("#recent-button").getAttribute("aria-expanded"),
  ]), [true, "recent-button", "false"]);
  await b.evaluate(() => document.querySelector("#recent-button").click());
  await b.wait(() => !document.querySelector("#recent-menu").hidden);
  await b.evaluate(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await b.wait(() => getComputedStyle(document.querySelector("#recent-menu")).display === "none");
  await b.evaluate(async () => {
    const toggle = document.querySelector("#recent-button");
    toggle.click();
    toggle.click();
    const { recentFiles } = await import("./src/core/recent.js");
    await recentFiles();
  });
  assert.deepEqual(await b.evaluate(() => [
    document.querySelector("#recent-menu").hidden,
    document.querySelector("#recent-button").getAttribute("aria-expanded"),
  ]), [true, "false"]);
  assert.deepEqual(await b.evaluate(async () => {
    const dialog = document.querySelector("#help-dialog");
    dialog.showModal();
    const animations = dialog.getAnimations();
    const entering = animations.some((animation) => animation.transitionProperty === "opacity");
    await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
    dialog.querySelector("[data-close]").click();
    return {
      entering,
      open: dialog.open,
      closing: dialog.getAnimations().some((animation) => animation.transitionProperty === "opacity"),
      pointerEvents: getComputedStyle(dialog).pointerEvents,
      focusedInDialog: dialog.contains(document.activeElement),
    };
  }), { entering: true, open: false, closing: true, pointerEvents: "none", focusedInDialog: false });
  await openBlankDocument(b, 3);
  await b.evaluate(async () => {
    const panel = document.querySelector("#pages-panel");
    await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  await b.evaluate(() => document.querySelector('[data-action="rotate-page"]').click());
  await b.wait(() => document.querySelector("#page-loading").hidden);
  for (const [menuId, toggleSelector] of [
    ["history-menu", "#history-button"],
    ["tool-style-menu", '[data-style-tool="text"]'],
  ]) {
    assert.deepEqual(await b.evaluate(async ({ menuId, toggleSelector }) => {
      const menu = document.getElementById(menuId);
      const toggle = document.querySelector(toggleSelector);
      toggle.click();
      const entering = menu.getAnimations().some((animation) => animation.transitionProperty === "opacity");
      await Promise.all(menu.getAnimations().map((animation) => animation.finished.catch(() => {})));
      toggle.click();
      const closing = menu.getAnimations().some((animation) => animation.transitionProperty === "opacity");
      const inert = menu.inert;
      await Promise.all(menu.getAnimations().map((animation) => animation.finished.catch(() => {})));
      return { entering, closing, inert, display: getComputedStyle(menu).display };
    }, { menuId, toggleSelector }), { entering: true, closing: true, inert: true, display: "none" });
  }
  assert.deepEqual(await b.evaluate(async () => {
    document.querySelector("#search-button").click();
    const search = document.querySelector("#search-bar");
    const entering = search.getAnimations().some((animation) => animation.transitionProperty === "opacity");
    await Promise.all(search.getAnimations().map((animation) => animation.finished.catch(() => {})));
    document.querySelector('[data-action="search-close"]').click();
    return {
      entering,
      hidden: search.hidden,
      inert: search.inert,
      focused: document.activeElement.id,
      closing: search.getAnimations().some((animation) => animation.transitionProperty === "opacity"),
    };
  }), { entering: true, hidden: true, inert: true, focused: "search-button", closing: true });
  await openBlankDocument(b, 2);
  await b.evaluate(async () => {
    const panel = document.querySelector("#pages-panel");
    await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  await b.evaluate(async () => {
    const section = document.querySelector('[data-side-section="files"]');
    section.open = true;
    const content = section.querySelector(".file-list");
    await new Promise((resolve) => {
      if (!content.inert) resolve();
      else section.addEventListener("toggle", resolve, { once: true });
    });
  });
  await b.wait(() => {
    const section = document.querySelector('[data-side-section="files"]');
    const content = [...section.children].slice(1);
    const height = content.reduce((sum, child) => {
      const style = getComputedStyle(child);
      return sum + child.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    }, 0);
    return Math.abs(parseFloat(getComputedStyle(section, "::details-content").height) - height) < 1;
  });
  assert.deepEqual(await b.evaluate(() => {
    const section = document.querySelector('[data-side-section="files"]');
    const pseudo = "::details-content";
    const supported = CSS.supports("interpolate-size", "allow-keywords") && CSS.supports("selector(details::details-content)");
    const expanded = parseFloat(getComputedStyle(section, pseudo).height) > 0;
    section.querySelector("summary").click();
    const closing = parseFloat(getComputedStyle(section, pseudo).height) > 0;
    const pointerEvents = getComputedStyle(section, pseudo).pointerEvents;
    const file = section.querySelector(".file-open");
    file.focus();
    const focusedInContent = document.activeElement === file;
    return { supported, expanded, closing, pointerEvents, focusedInContent };
  }), { supported: true, expanded: true, closing: true, pointerEvents: "none", focusedInContent: false });
  await b.wait(() => getComputedStyle(document.querySelector('[data-side-section="files"]'), "::details-content").height === "0px");
  for (const width of [1440, 390]) {
    await b.command("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false });
    await b.wait((width) => innerWidth === width, 30000, width);
    await b.evaluate(async () => {
      const toggle = document.querySelector('[data-action="toggle-pages"]');
      if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
      const panel = document.querySelector("#pages-panel");
      await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => {})));
    });
    await b.screenshot(`/tmp/pdfhelper-motion-sidebar-${width}.png`);
    assert.deepEqual(await b.evaluate(async () => {
      const panel = document.querySelector("#pages-panel");
      panel.querySelector("button").focus();
      document.querySelector('[data-action="toggle-pages"]').click();
      const inert = panel.inert;
      const focusedInPanel = panel.contains(document.activeElement);
      const animations = panel.getAnimations();
      const closing = animations.some((animation) => animation.transitionProperty === "opacity");
      await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
      return { inert, focusedInPanel, closing, display: getComputedStyle(panel).display };
    }), { inert: true, focusedInPanel: false, closing: true, display: "none" });
  }
  assert.deepEqual(b.errors, []);
});

test("Browser: Nur gezielte Dokument-, Seiten- und Kapitelwechsel blenden fertige Inhalte ein", { timeout: 120000 }, async (t) => {
  const b = await browser(t, { reducedMotion: false });
  await b.evaluate(() => {
    window.contentFades = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.id === "page-stage" || this.classList.contains("epub-book")) {
        window.contentFades.push({
          target: this.id || this.className,
          page: this.parentElement.dataset.page,
          loading: !document.querySelector("#page-loading").hidden,
          frames,
          duration: options.duration,
        });
      }
      return animate.call(this, frames, options);
    };
  });
  await openBlankDocument(b, 5);
  await b.wait(() => window.contentFades.length === 1);
  assert.deepEqual(await b.evaluate(() => {
    const fade = window.contentFades[0];
    return { target: fade.target, loading: fade.loading, frames: fade.frames, duration: fade.duration };
  }), { target: "page-stage", loading: false, frames: [{ opacity: 0.45 }, { opacity: 1 }], duration: 180 });
  await b.evaluate(() => {
    window.contentFades.length = 0;
    document.querySelectorAll(".thumbnail")[1].click();
    document.querySelectorAll(".thumbnail")[2].click();
    document.querySelectorAll(".thumbnail")[3].click();
  });
  await b.wait(() => document.querySelector("#page-loading").hidden && window.contentFades.length > 0);
  assert.deepEqual(await b.evaluate(() => ({
    count: window.contentFades.length,
    page: window.contentFades[0].page,
    current: document.querySelector(".page-item.current").dataset.page,
    number: document.querySelector("#current-page").value,
  })), await b.evaluate(() => ({
    count: 1,
    page: document.querySelector(".page-item.current").dataset.page,
    current: document.querySelector(".page-item.current").dataset.page,
    number: "4",
  })));
  await b.evaluate(async () => {
    const stage = document.querySelector("#page-stage");
    const finished = stage.getAnimations().map((animation) => animation.finished.catch(() => {}));
    window.contentFades.length = 0;
    document.querySelector('[data-action="zoom-in"]').click();
    await Promise.all(finished);
  });
  await b.wait(() => document.querySelector("#page-loading").hidden);
  assert.equal(await b.evaluate(() => window.contentFades.length), 0);
  await b.evaluate(() => {
    const scroller = document.querySelector("#page-scroll");
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
  });
  await b.wait(() => document.querySelector("#current-page").value === "1" && document.querySelector("#page-loading").hidden);
  assert.equal(await b.evaluate(() => window.contentFades.length), 0);
  await b.evaluate(() => {
    document.querySelector('[data-action="rotate-page"]').click();
  });
  await b.wait(() => document.querySelector("#page-loading").hidden);
  assert.equal(await b.evaluate(() => window.contentFades.length), 0);
  await openBlankDocument(b, 2);
  await b.wait(() => document.querySelector("#page-loading").hidden);
  await b.evaluate(() => { window.contentFades.length = 0; });
  await selectDocument(b, 0);
  await b.wait(() => window.contentFades.length === 1 && document.querySelector("#page-loading").hidden);
  await b.evaluate(async () => {
    window.contentFades.length = 0;
    const { Renderer } = await import("./src/pdf/renderer.js");
    window.originalRender = Renderer.prototype.render;
    Renderer.prototype.render = function (page, canvas, scale, options) {
      if (options?.main && page.index === 4) return Promise.reject(new Error("Synthetischer Renderfehler"));
      return window.originalRender.call(this, page, canvas, scale, options);
    };
    document.querySelectorAll(".thumbnail")[4].click();
  });
  await b.wait(() => document.querySelector("#page-loading").hidden && document.querySelector("#toast").classList.contains("error"));
  assert.equal(await b.evaluate(() => window.contentFades.length), 0);
  await b.evaluate(async () => {
    const { Renderer } = await import("./src/pdf/renderer.js");
    Renderer.prototype.render = window.originalRender;
    delete window.originalRender;
  });
  await b.evaluate(async () => {
    const { epubFixture } = await import("./tests/helpers/formats.mjs");
    const transfer = new DataTransfer();
    transfer.items.add(new File([await epubFixture()], "Animation.epub"));
    const input = document.querySelector("#file-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await b.wait(() => window.contentFades.some((fade) => fade.target === "epub-book"));
  await b.evaluate(() => {
    window.contentFades.length = 0;
    document.querySelector("#epub-next").click();
  });
  await b.wait(() => window.contentFades.length === 1);
  assert.equal(await b.evaluate(() => document.querySelector(".epub-book iframe").contentDocument.querySelector("h1").textContent), "Zweites Kapitel");
  await b.evaluate(() => {
    window.contentFades.length = 0;
    document.querySelector(".epub-outline-link").click();
  });
  await b.wait(() => window.contentFades.length === 1);
  await b.evaluate(() => {
    window.contentFades.length = 0;
    document.querySelector(".epub-book iframe").contentDocument.querySelector("#internal").click();
  });
  await b.wait(() => window.contentFades.length === 1);
  assert.equal(await b.evaluate(() => window.contentFades[0].target), "epub-book");
  await b.evaluate(() => {
    window.contentFades.length = 0;
    document.querySelector("#epub-previous").click();
    document.querySelector("#file-list .file-open").click();
  });
  await b.wait(() => document.querySelector("#page-loading").hidden && document.querySelector(".epub-book iframe")?.contentDocument?.querySelector("h1")?.textContent === "Erstes Kapitel");
  assert.equal(await b.evaluate(() => window.contentFades.some((fade) => fade.target === "epub-book")), false);
  await selectDocument(b, 2);
  await b.wait(() => !document.querySelector("#epub-reader").hidden && document.querySelector(".epub-book").getAnimations().length > 0);
  await b.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await b.wait(() => document.querySelector(".epub-book").getAnimations().length === 0);
  await b.evaluate(() => { window.contentFades.length = 0; });
  await selectDocument(b, 0);
  await b.wait(() => !document.querySelector("#page-scroll").hidden && document.querySelector("#page-loading").hidden);
  await b.evaluate(() => document.querySelector('[data-action="next"]').click());
  await b.wait(() => document.querySelector("#page-loading").hidden);
  assert.equal(await b.evaluate(() => window.contentFades.length), 0);
  assert.deepEqual(await b.evaluate(() => {
    const toggle = document.querySelector('[data-action="toggle-pages"]');
    toggle.click();
    const panel = document.querySelector("#pages-panel");
    return [getComputedStyle(panel).transitionDuration, panel.getAnimations().length];
  }), ["0s", 0]);
  assert.deepEqual(b.errors, []);
});
