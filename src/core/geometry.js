import { normalizeAngle } from "./model.js";
export function pagePoint(page, x, y) {
  const box = page.crop || {
    x: 0,
    y: 0,
    width: page.width,
    height: page.height,
  };
  const angle = normalizeAngle((page.baseRotation || 0) + page.rotation);
  if (angle === 90) return [box.x + y, box.y + x];
  if (angle === 180) return [box.x + box.width - x, box.y + y];
  if (angle === 270) return [box.x + box.width - y, box.y + box.height - x];
  return [box.x + x, box.y + box.height - y];
}
export function displayPoint(page, x, y) {
  const box = page.crop || {
    x: 0,
    y: 0,
    width: page.width,
    height: page.height,
  };
  x -= box.x;
  y -= box.y;
  const angle = normalizeAngle((page.baseRotation || 0) + page.rotation);
  if (angle === 90) return [y, x];
  if (angle === 180) return [box.width - x, y];
  if (angle === 270) return [box.height - y, box.width - x];
  return [x, box.height - y];
}
export function displayRect(page, rect) {
  const corners = [
    [rect[0], rect[1]],
    [rect[2], rect[3]],
  ].map(([x, y]) => displayPoint(page, x, y));
  return {
    x: Math.min(...corners.map((p) => p[0])),
    y: Math.min(...corners.map((p) => p[1])),
    width: Math.abs(corners[0][0] - corners[1][0]),
    height: Math.abs(corners[0][1] - corners[1][1]),
  };
}
export function fitSize(width, height, pixels = 4_000_000, edge = 8192) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    throw new Error("Ungültige Seitenabmessungen.");
  const factor = Math.min(
    1,
    edge / width,
    edge / height,
    Math.sqrt(pixels / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * factor)),
    height: Math.max(1, Math.floor(height * factor)),
    factor,
  };
}
function sameLine(a, b) {
  const overlap =
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    gap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
  return (
    overlap > Math.min(a.height, b.height) / 2 &&
    gap <= Math.max(a.height, b.height)
  );
}
function unite(a, b) {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
export function lineRects(rects) {
  let lines = [];
  for (const rect of rects
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .sort((a, b) => a.y - b.y || a.x - b.x)) {
    const index = lines.findIndex((line) => sameLine(line, rect));
    if (index < 0) lines.push({ ...rect });
    else lines[index] = unite(lines[index], rect);
  }
  for (let merged = true; merged; ) {
    merged = false;
    const next = [];
    for (const line of lines) {
      const index = next.findIndex((other) => sameLine(other, line));
      if (index < 0) next.push(line);
      else {
        next[index] = unite(next[index], line);
        merged = true;
      }
    }
    lines = next;
  }
  lines.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const [index, upper] of lines.entries())
    for (const lower of lines.slice(index + 1)) {
      const bottom = upper.y + upper.height;
      if (
        lower.y >= bottom ||
        lower.x >= upper.x + upper.width ||
        upper.x >= lower.x + lower.width
      )
        continue;
      const split = (bottom + lower.y) / 2,
        end = lower.y + lower.height;
      upper.height = split - upper.y;
      lower.y = split;
      lower.height = end - split;
    }
  return lines;
}
export function sweepStep(center, from, to, minRadius = 12) {
  if (
    Math.hypot(from.x - center.x, from.y - center.y) < minRadius ||
    Math.hypot(to.x - center.x, to.y - center.y) < minRadius
  )
    return 0;
  let step =
    ((Math.atan2(to.y - center.y, to.x - center.x) -
      Math.atan2(from.y - center.y, from.x - center.x)) *
      180) /
    Math.PI;
  if (step > 180) step -= 360;
  else if (step <= -180) step += 360;
  return Math.abs(step) > 90 ? 0 : step;
}
const snapThreshold = 60;
export function snapTurn(sweep) {
  const turns = Math.floor((Math.abs(sweep) + 90 - snapThreshold) / 90);
  return normalizeAngle(Math.sign(sweep) * turns * 90);
}
