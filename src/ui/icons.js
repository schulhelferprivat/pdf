const paths = {
  pin: "M16 3h-8 M9 3v7l-3 4v2h12v-2l-3-4V3 M12 16v6",
  "select-all": "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z m1 8 3 3 5-6",
  "select-none": "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z",
  "fit-width":
    "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M8.5 12h7 M10.5 10l-2 2 2 2 M13.5 10l2 2-2 2",
  "fit-page":
    "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M12 6v12 M10 8l2-2 2 2 M10 16l2 2 2-2",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  "two-pages":
    "M4 3h6a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M14 3h6a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
  install: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
  folder: "M3 7h7l2 2h9v11H3z M3 7V4h7l2 3",
  "folder-open":
    "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  cursor: "m5 3 14 9-7 1-3 7z",
  text: "M4 5h16 M12 5v15 M8 20h8",
  highlighter:
    "m9 11-6 6v3h9l3-3 M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
  pen: "m15 3 6 6-12 12H3v-6z M12 6l6 6",
  eraser:
    "m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21z M22 21H7 M5 11l9 9",
  undo: "M9 5 3 10l6 5 M3 10h11a6 6 0 0 1 0 12",
  redo: "M15 5l6 5-6 5 M21 10H10a6 6 0 0 0 0 12",
  save: "M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M8 3v5h7V3 M8 21v-7h8v7",
  print: "M7 8V3h10v5 M7 17H3V9h18v8h-4 M7 14h10v8H7z M17 11h1",
  download: "M12 3v12 m-5-5 5 5 5-5 M3 16v5h18v-5",
  sidebar:
    "M7 4h10a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z M9 4v16",
  "list-tree": "M21 12h-8 M21 6H8 M21 18h-8 M3 6v4c0 1.1.9 2 2 2h3 M3 10v6c0 1.1.9 2 2 2h3",
  layers: "m12 3 10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z m-4 10 3 3 5-6",
  trash: "M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
  copy: "M8 8h13v13H8z M16 8V3H3v13h5",
  up: "m5 14 7-7 7 7",
  down: "m5 10 7 7 7-7",
  back: "m9 10-6-6 6-3 M3 4h10a8 8 0 0 1 0 16h-3",
  left: "m15 5-7 7 7 7",
  right: "m9 5 7 7-7 7",
  close: "m6 6 12 12 M6 18 18 6",
  help: "M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  layout: "M3 3h18v18H3z M12 3v18 M3 12h18",
  split: "M12 3v6 M5 21v-6l7-6 7 6v6 M2 18l3 3 3-3 M16 18l3 3 3-3",
  "rotate-left": "M3 10a9 9 0 1 1 2 9 M3 4v6h6",
  "rotate-right": "M21 10a9 9 0 1 0-2 9 M21 4v6h-6",
  file: "M6 2h8l5 5v15H6z M14 2v6h5",
  check: "m5 12 4 4L19 6",
  maximize: "M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7",
  minimize: "M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4",
  message: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  image:
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M9 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z m12 8-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
};
export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"></path></svg>`;
}
export function installIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((element) => {
    if (!element.querySelector(".icon"))
      element.insertAdjacentHTML("afterbegin", icon(element.dataset.icon));
  });
}
export function cursorIcon(
  name,
  { color = "#1f2937", hotspot = [12, 12], fallback = "crosshair" } = {},
) {
  const path = paths[name] || paths.file;
  const layer = (stroke, width) =>
    `<path d="${path}" stroke="${stroke}" stroke-width="${width}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">${layer("#ffffff", 4.5)}${layer("#1f2937", 2.4)}${layer(color, 1.3)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot[0]} ${hotspot[1]}, ${fallback}`;
}
