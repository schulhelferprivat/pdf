const toolbarPinKey = "pdfhelper:toolbar-pinned";
const sidebarPinKey = "pdfhelper:sidebar-pinned";

function readPinned(key) {
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

function writePinned(key, pinned) {
  try {
    localStorage.setItem(key, String(pinned));
  } catch {}
}

export function readToolbarPinned() {
  return readPinned(toolbarPinKey);
}

export function writeToolbarPinned(pinned) {
  writePinned(toolbarPinKey, pinned);
}

export function readSidebarPinned() {
  return readPinned(sidebarPinKey);
}

export function writeSidebarPinned(pinned) {
  writePinned(sidebarPinKey, pinned);
}
