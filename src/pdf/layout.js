export function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
export const lcm = (a, b) => (a && b ? (a * b) / gcd(a, b) : 0);
export function layoutPlan(
  count,
  { perSheet = 2, special = false, padding = "blank", students = null } = {},
) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("Das Dokument enthält keine Seiten.");
  if (students !== null && (!Number.isInteger(students) || students < 1))
    throw new Error("Die Anzahl Lernende muss eine ganze Zahl größer 0 sein.");
  if (![2, 4, 6, 8].includes(perSheet))
    throw new Error("Ungültige Anzahl Seiten pro Blatt.");
  if (special && count !== 3)
    throw new Error("Der Sondermodus benötigt genau drei Seiten.");
  const effective =
    special || (perSheet > 2 && count % perSheet !== 0) ? padding : null;
  if (effective === "lcm" && !students)
    throw new Error(
      "Bitte für die mengenbezogene Auffüllung eine Anzahl Lernende angeben.",
    );
  let sheets = [];
  let copies = students;
  if (special) {
    sheets =
      padding === "lcm"
        ? [
            ...Array.from({ length: Math.ceil(students / 2) }, () => [0, 0]),
            ...Array.from({ length: students }, () => [1, 2]),
          ]
        : [
            [0, 0],
            [1, 2],
            [1, 2],
          ];
    copies = students
      ? padding === "lcm"
        ? 1
        : Math.ceil(students / 2)
      : null;
  } else if (perSheet === 2) {
    if (students === 1 || count % 2 === 0)
      sheets = Array.from({ length: Math.ceil(count / 2) }, (_, i) => [
        i * 2,
        i * 2 + 1 < count ? i * 2 + 1 : null,
      ]);
    else sheets = Array.from({ length: count }, (_, i) => [i, i]);
    copies = students ? (count % 2 ? Math.ceil(students / 2) : students) : null;
  } else {
    let indices;
    if (effective === "lcm") {
      const total = lcm(count, perSheet);
      if (count <= perSheet) {
        let extra = 0;
        indices = Array.from({ length: total / perSheet }, () => [
          ...Array.from({ length: count }, (_, i) => i),
          ...Array.from({ length: perSheet - count }, () => extra++ % count),
        ]).flat();
      } else indices = Array.from({ length: total }, (_, i) => i % count);
      copies = Math.ceil(students / (total / count));
    } else {
      indices = Array.from(
        { length: Math.ceil(count / perSheet) * perSheet },
        (_, i) =>
          i < count ? i : effective === "blank" ? null : (i - count) % count,
      );
    }
    for (let i = 0; i < indices.length; i += perSheet)
      sheets.push(indices.slice(i, i + perSheet));
  }
  if (sheets.length > 500)
    throw new Error(
      "Das Drucklayout würde mehr als 500 Seiten erzeugen. Bitte die Anzahl reduzieren.",
    );
  return { sheets, copies };
}
export async function impose(lib, source, options, progress = () => {}) {
  const { sheets, copies } = layoutPlan(source.getPageCount(), options);
  const output = await lib.PDFDocument.create();
  const pages = source.getPages();
  const sizes = pages.map((page) => page.getSize());
  const a4 = sizes.every(
    ({ width: w, height: h }) =>
      (Math.abs(w - 595.3) <= 3 && Math.abs(h - 841.9) <= 3) ||
      (Math.abs(h - 595.3) <= 3 && Math.abs(w - 841.9) <= 3),
  );
  const embedded = await Promise.all(
    pages.map((page) => (page.node.Contents() ? output.embedPage(page) : null)),
  );
  for (const [sheetIndex, indices] of sheets.entries()) {
    const existing = indices.filter((i) => i !== null);
    let width, height;
    if (indices.length === 2) {
      const half = a4
        ? 595.3
        : Math.max(...existing.map((i) => sizes[i].width));
      height = a4 ? 841.9 : Math.max(...existing.map((i) => sizes[i].height));
      width = a4 ? 1190.6 : Math.max(half * 2, height);
    } else {
      width = a4
        ? 841.9
        : Math.max(...existing.map((i) => sizes[i].width)) * Math.SQRT2;
      height = a4
        ? 1190.6
        : Math.max(...existing.map((i) => sizes[i].height)) * Math.SQRT2;
    }
    const target = output.addPage([width, height]);
    const cellW = width / 2,
      cellH = height / (indices.length / 2);
    const rotations = [];
    for (let slot = 0; slot < indices.length; slot++) {
      const index = indices[slot];
      if (index === null) continue;
      const page = embedded[index];
      if (!page) continue;
      const normal = Math.min(cellW / page.width, cellH / page.height);
      const rotated = Math.min(cellW / page.height, cellH / page.width);
      const turn = options.autoOrientation !== false && rotated > normal + 1e-9;
      const scale = turn ? rotated : normal;
      const drawW = (turn ? page.height : page.width) * scale,
        drawH = (turn ? page.width : page.height) * scale;
      const x = (slot % 2) * cellW + (cellW - drawW) / 2;
      const y =
        height - (Math.floor(slot / 2) + 1) * cellH + (cellH - drawH) / 2;
      target.drawPage(page, {
        x: x + (turn ? page.height * scale : 0),
        y,
        width: page.width * scale,
        height: page.height * scale,
        rotate: lib.degrees(turn ? 90 : 0),
      });
      rotations.push(turn ? 90 : 0);
    }
    if (rotations.every((value) => value === rotations[0]))
      target.setRotation(lib.degrees(rotations[0] || 0));
    progress((sheetIndex + 1) / sheets.length);
  }
  return { document: output, copies };
}
