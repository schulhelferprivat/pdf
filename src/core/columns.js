const DRAW_MOVE = 0,
  DRAW_LINE = 1,
  DRAW_CURVE = 2,
  DRAW_QUADRATIC = 3,
  DRAW_CLOSE = 4;
const AXIS_TOLERANCE = 0.75,
  MIN_LENGTH = 4,
  MAX_THICKNESS = 3,
  JOIN_TOLERANCE = 2;
function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function axisSegment([x1, y1], [x2, y2]) {
  const dx = Math.abs(x2 - x1),
    dy = Math.abs(y2 - y1);
  if (dy <= AXIS_TOLERANCE && dx >= MIN_LENGTH) return [x1, (y1 + y2) / 2, x2, (y1 + y2) / 2];
  if (dx <= AXIS_TOLERANCE && dy >= MIN_LENGTH) return [(x1 + x2) / 2, y1, (x1 + x2) / 2, y2];
  return null;
}
function thinBox(points) {
  if (points.length < 2) return null;
  const xs = points.map((point) => point[0]),
    ys = points.map((point) => point[1]),
    left = Math.min(...xs),
    right = Math.max(...xs),
    bottom = Math.min(...ys),
    top = Math.max(...ys),
    width = right - left,
    height = top - bottom;
  if (height <= MAX_THICKNESS && width >= MIN_LENGTH && width > height)
    return [left, (bottom + top) / 2, right, (bottom + top) / 2];
  if (width <= MAX_THICKNESS && height >= MIN_LENGTH && height > width)
    return [(left + right) / 2, bottom, (left + right) / 2, top];
  return null;
}
function subpaths(data, matrix) {
  const paths = [];
  let current = null;
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === DRAW_MOVE) {
      current = { points: [apply(matrix, data[i], data[i + 1])], closed: false, curved: false };
      paths.push(current);
      i += 2;
    } else if (op === DRAW_LINE) {
      if (!current) {
        current = { points: [], closed: false, curved: false };
        paths.push(current);
      }
      current.points.push(apply(matrix, data[i], data[i + 1]));
      i += 2;
    } else if (op === DRAW_CURVE) {
      if (current) current.curved = true;
      i += 6;
    } else if (op === DRAW_QUADRATIC) {
      if (current) current.curved = true;
      i += 4;
    } else if (op === DRAW_CLOSE) {
      if (current) current.closed = true;
    } else break;
  }
  return paths.filter((path) => !path.curved);
}
export function ruleSegments(fnArray, argsArray, OPS) {
  const stroking = new Set(
      ["stroke", "closeStroke", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke"].map((name) => OPS[name]),
    ),
    filling = new Set(
      ["fill", "eoFill", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke"].map((name) => OPS[name]),
    ),
    stack = [],
    segments = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  for (let index = 0; index < fnArray.length; index++) {
    const fn = fnArray[index],
      args = argsArray[index];
    if (fn === OPS.save) stack.push(matrix);
    else if (fn === OPS.restore) matrix = stack.pop() ?? matrix;
    else if (fn === OPS.transform) matrix = multiply(matrix, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(matrix);
      if (args?.[0]) matrix = multiply(matrix, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) matrix = stack.pop() ?? matrix;
    else if (fn === OPS.constructPath) {
      const [paint, [data] = [], bounds] = args || [];
      if (!data || !bounds) continue;
      for (const path of subpaths(data, matrix)) {
        if (stroking.has(paint)) {
          const points = path.closed ? [...path.points, path.points[0]] : path.points;
          for (let i = 1; i < points.length; i++) {
            const segment = axisSegment(points[i - 1], points[i]);
            if (segment) segments.push(segment);
          }
        }
        if (filling.has(paint)) {
          const segment = thinBox(path.points);
          if (segment) segments.push(segment);
        }
      }
    }
  }
  return segments;
}
function classify(segments) {
  const horizontal = [],
    vertical = [];
  for (const [x1, y1, x2, y2] of segments) {
    const dx = Math.abs(x2 - x1),
      dy = Math.abs(y2 - y1);
    if (dy <= AXIS_TOLERANCE && dx >= MIN_LENGTH)
      horizontal.push({ pos: (y1 + y2) / 2, from: Math.min(x1, x2), to: Math.max(x1, x2) });
    else if (dx <= AXIS_TOLERANCE && dy >= MIN_LENGTH)
      vertical.push({ pos: (x1 + x2) / 2, from: Math.min(y1, y2), to: Math.max(y1, y2) });
  }
  return { horizontal: merge(horizontal), vertical: merge(vertical) };
}
function merge(lines) {
  const sorted = [...lines].sort((a, b) => a.pos - b.pos || a.from - b.from),
    groups = [];
  for (const line of sorted) {
    const group = groups.at(-1);
    if (group && line.pos - group.pos <= 1) group.lines.push(line);
    else groups.push({ pos: line.pos, lines: [line] });
  }
  const merged = [];
  for (const group of groups) {
    const pos = group.lines.reduce((sum, line) => sum + line.pos, 0) / group.lines.length;
    let current = null;
    for (const line of group.lines.sort((a, b) => a.from - b.from)) {
      if (current && line.from <= current.to + JOIN_TOLERANCE) current.to = Math.max(current.to, line.to);
      else {
        current = { pos, from: line.from, to: line.to };
        merged.push(current);
      }
    }
  }
  return merged;
}
function crosses(h, v) {
  return (
    v.pos >= h.from - JOIN_TOLERANCE &&
    v.pos <= h.to + JOIN_TOLERANCE &&
    h.pos >= v.from - JOIN_TOLERANCE &&
    h.pos <= v.to + JOIN_TOLERANCE
  );
}
function cluster(values) {
  const sorted = [...values].sort((a, b) => a - b),
    groups = [];
  for (const value of sorted) {
    const group = groups.at(-1);
    if (group && value - group.at(-1) <= JOIN_TOLERANCE) group.push(value);
    else groups.push([value]);
  }
  return groups.map((group) => group.reduce((sum, value) => sum + value, 0) / group.length);
}
export function detectTables(segments) {
  const { horizontal, vertical } = classify(segments),
    parent = new Map(),
    find = (node) => {
      while (parent.get(node) !== node) {
        parent.set(node, parent.get(parent.get(node)));
        node = parent.get(node);
      }
      return node;
    };
  for (const line of [...horizontal, ...vertical]) parent.set(line, line);
  for (const h of horizontal)
    for (const v of vertical) if (crosses(h, v)) parent.set(find(h), find(v));
  const components = new Map();
  for (const line of [...horizontal, ...vertical]) {
    const root = find(line);
    if (!components.has(root)) components.set(root, { horizontal: [], vertical: [] });
    components.get(root)[horizontal.includes(line) ? "horizontal" : "vertical"].push(line);
  }
  const tables = [];
  for (const component of components.values()) {
    if (component.horizontal.length < 2 || component.vertical.length < 2) continue;
    const left = Math.min(...component.horizontal.map((h) => h.from), ...component.vertical.map((v) => v.pos)),
      right = Math.max(...component.horizontal.map((h) => h.to), ...component.vertical.map((v) => v.pos)),
      top = Math.min(...component.vertical.map((v) => v.from), ...component.horizontal.map((h) => h.pos)),
      bottom = Math.max(...component.vertical.map((v) => v.to), ...component.horizontal.map((h) => h.pos)),
      height = bottom - top,
      spans = new Map();
    for (const v of component.vertical) spans.set(v.pos, (spans.get(v.pos) || 0) + (v.to - v.from));
    const boundaries = cluster([
      left,
      right,
      ...component.vertical
        .filter((v) => v.from <= top + JOIN_TOLERANCE || spans.get(v.pos) >= height / 2)
        .map((v) => v.pos),
    ]);
    const columns = [];
    for (let i = 1; i < boundaries.length; i++)
      if (boundaries[i] - boundaries[i - 1] > MIN_LENGTH)
        columns.push({ left: boundaries[i - 1], right: boundaries[i] });
    if (columns.length >= 2) tables.push({ left, top, right, bottom, columns });
  }
  return tables.sort((a, b) => a.top - b.top || a.left - b.left);
}
export function assembleLines(fragments) {
  const lines = [];
  for (const fragment of [...fragments].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x)) {
    let best = null,
      bestOverlap = 0;
    for (const line of lines) {
      const overlap =
        Math.min(line.bottom, fragment.y + fragment.height) - Math.max(line.top, fragment.y);
      if (overlap > Math.min(line.bottom - line.top, fragment.height) / 2 && overlap > bestOverlap) {
        best = line;
        bestOverlap = overlap;
      }
    }
    if (best) {
      best.parts.push(fragment);
      best.top = Math.min(best.top, fragment.y);
      best.bottom = Math.max(best.bottom, fragment.y + fragment.height);
    } else lines.push({ top: fragment.y, bottom: fragment.y + fragment.height, parts: [fragment] });
  }
  return lines
    .sort((a, b) => a.top - b.top)
    .map((line) => {
      const parts = line.parts.sort((a, b) => a.x - b.x);
      let text = "",
        previous = null;
      for (const part of parts) {
        if (
          previous &&
          part.x - (previous.x + previous.width) > 0.25 * Math.max(part.height, previous.height) &&
          !/\s$/.test(text) &&
          !/^\s/.test(part.text)
        )
          text += " ";
        text += part.text;
        previous = part;
      }
      return text.trim();
    })
    .filter(Boolean)
    .join("\n");
}
