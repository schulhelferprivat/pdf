export async function togglePin(browser, name) {
  return browser.evaluate((name) => {
    const panel = document.getElementById(name === "toolbar" ? "editor-topbar" : "pages-panel");
    panel.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    const item = document.querySelector(`#context-menu [data-action="pin-${name}"]`),
      label = item.textContent;
    item.click();
    return label;
  }, name);
}
