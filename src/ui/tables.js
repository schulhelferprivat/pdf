import { detectTables } from "../core/tables.js";
import { displayRect, pagePoint } from "../core/geometry.js";

export function setupTableSelection(stage, { page, scale, tool, onSelect }) {
  const layer = document.createElement("div");
  layer.id = "table-layer";
  layer.className = "table-layer";
  stage.append(layer);
  let selection = null;
  let controls = [];
  let nodes = [];
  let visible = null;

  function clear() {
    selection = null;
    show(null);
    layer.querySelectorAll(".table-selection-part").forEach((part) => part.remove());
  }

  function show(button) {
    if (visible === button) return;
    visible?.classList.remove("visible");
    visible = button;
    visible?.classList.add("visible");
  }

  function reset() {
    clear();
    show(null);
    controls = [];
    nodes = [];
    layer.replaceChildren();
  }

  function projected(rect) {
    return displayRect(page(), [rect.x, -rect.y - rect.height, rect.x + rect.width, -rect.y]);
  }

  function cellRanges(cell) {
    const ranges = [];
    for (const word of cell.words) {
      const node = nodes[word.segment];
      const previous = ranges.at(-1);
      if (previous?.endContainer === node &&
        word.start >= previous.endOffset &&
        !node.data.slice(previous.endOffset, word.start).trim()) previous.setEnd(node, word.end);
      else {
        const range = document.createRange();
        range.setStart(node, word.start);
        range.setEnd(node, word.end);
        ranges.push(range);
      }
    }
    return ranges;
  }

  function select(table, axis, index) {
    if (tool() !== "select") return;
    clear();
    getSelection()?.removeAllRanges();
    const cells = axis === "column"
      ? table.rows.map((row) => row.cells[index])
      : table.rows[index].cells;
    const ranges = cells.flatMap(cellRanges);
    if (!ranges.length) return;
    selection = { ranges, text: cells.map((cell) => cell.text).join(axis === "column" ? "\n" : "\t") };
    const stageRect = stage.getBoundingClientRect();
    for (const range of ranges) {
      for (const rect of range.getClientRects()) {
        const part = document.createElement("div");
        part.className = "table-selection-part";
        part.style.left = `${rect.left - stageRect.left}px`;
        part.style.top = `${rect.top - stageRect.top}px`;
        part.style.width = `${rect.width}px`;
        part.style.height = `${rect.height}px`;
        layer.append(part);
      }
    }
    onSelect();
  }

  function render(textLayer, rules = []) {
    reset();
    const currentPage = page();
    if (!currentPage) return;
    const stageRect = stage.getBoundingClientRect();
    const words = [];
    for (const div of textLayer.textDivs) {
      const node = div.firstChild;
      if (node?.nodeType !== Node.TEXT_NODE || !div.isConnected) continue;
      const segment = nodes.push(node) - 1;
      for (const match of node.data.matchAll(/\S+/gu)) {
        if (words.length >= 20000) return;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        const corners = [
          pagePoint(currentPage, (rect.left - stageRect.left) / scale(), (rect.top - stageRect.top) / scale()),
          pagePoint(currentPage, (rect.right - stageRect.left) / scale(), (rect.bottom - stageRect.top) / scale()),
        ];
        words.push({
          text: match[0], segment, start: match.index, end: match.index + match[0].length,
          x: Math.min(corners[0][0], corners[1][0]),
          y: -Math.max(corners[0][1], corners[1][1]),
          width: Math.abs(corners[1][0] - corners[0][0]),
          height: Math.abs(corners[1][1] - corners[0][1]),
        });
      }
    }
    const rotated = ((currentPage.baseRotation || 0) + currentPage.rotation) % 180 !== 0;
    for (const [tableIndex, table] of detectTables(words, rules).entries()) {
      const tableRect = projected(table.rect);
      for (const axis of ["column", "row"]) {
        const entries = axis === "column" ? table.columns : table.rows;
        const top = (axis === "column") !== rotated;
        for (const [index, entry] of entries.entries()) {
          const rect = projected(entry.rect);
          const button = document.createElement("button");
          button.type = "button";
          button.className = "table-select-arrow";
          button.textContent = top ? "↓" : "→";
          button.dataset.table = String(tableIndex);
          button.dataset.tableAxis = axis;
          button.dataset.tableIndex = String(index);
          const label = `Tabelle ${tableIndex + 1}: ${axis === "column" ? "Spalte" : "Zeile"} ${index + 1} auswählen`;
          button.setAttribute("aria-label", label);
          button.title = label;
          button.style.left = `${top ? (rect.x + rect.width / 2) * scale() - 12 : tableRect.x * scale() - 24}px`;
          button.style.top = `${top ? tableRect.y * scale() - 24 : (rect.y + rect.height / 2) * scale() - 12}px`;
          button.addEventListener("pointerdown", (event) => event.preventDefault());
          button.addEventListener("click", () => select(table, axis, index));
          button.addEventListener("focus", () => show(button));
          button.addEventListener("blur", () => show(null));
          controls.push({ button, rect, tableRect, top });
          layer.append(button);
        }
      }
    }
  }

  stage.addEventListener("pointermove", (event) => {
    if (tool() !== "select" || event.buttons) {
      show(null);
      return;
    }
    const arrow = event.target.closest?.(".table-select-arrow");
    if (arrow) {
      show(arrow);
      return;
    }
    const box = stage.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const hit = controls.find(({ rect, tableRect, top }) => top
      ? x >= rect.x * scale() && x < (rect.x + rect.width) * scale() &&
        y >= tableRect.y * scale() - 12 && y <= tableRect.y * scale() + 4
      : y >= rect.y * scale() && y < (rect.y + rect.height) * scale() &&
        x >= tableRect.x * scale() - 12 && x <= tableRect.x * scale() + 4);
    show(hit?.button ?? null);
  });
  stage.addEventListener("pointerleave", () => show(null));
  stage.addEventListener("pointerdown", (event) => {
    if (event.button === 0 && !event.target.closest?.(".table-select-arrow")) clear();
  });
  document.addEventListener("selectionchange", () => {
    if (selection && !getSelection()?.isCollapsed) clear();
  });
  document.addEventListener("copy", (event) => {
    if (!selection || !event.clipboardData ||
      event.target.closest?.("input, textarea, select, [contenteditable=true]") ||
      document.querySelector("dialog[open]")) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selection.text);
  });

  return { render, reset, clear, get selection() { return selection; } };
}
