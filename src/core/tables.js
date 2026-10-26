function bounds(items) {
  const x = Math.min(...items.map((item) => item.x));
  const y = Math.min(...items.map((item) => item.y));
  return {
    x,
    y,
    width: Math.max(...items.map((item) => item.x + item.width)) - x,
    height: Math.max(...items.map((item) => item.y + item.height)) - y,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function textLines(words) {
  const lines = [];
  for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const center = word.y + word.height / 2;
    const line = lines.findLast((item) =>
      Math.abs(item.center - center) <= Math.min(item.height, word.height) * 0.45,
    );
    if (line) {
      line.words.push(word);
      Object.assign(line, bounds(line.words));
      line.center = line.y + line.height / 2;
    } else lines.push({ ...word, center, words: [word] });
  }
  return lines.sort((a, b) => a.y - b.y).map((line) => {
    const runs = [];
    for (const word of line.words.sort((a, b) => a.x - b.x)) {
      const previous = runs.at(-1);
      if (previous && word.x - previous.x - previous.width <= line.height * 1.4) {
        previous.words.push(word);
        Object.assign(previous, bounds(previous.words));
      } else runs.push({ ...word, words: [word] });
    }
    return { ...line, runs };
  });
}

function seedGroups(runs, height) {
  if (runs.length < 4) return [runs];
  const gaps = runs.slice(1).map((run, index) => run.x - runs[index].x - runs[index].width);
  const ordinary = median([...gaps].sort((a, b) => a - b).slice(0, Math.ceil(gaps.length / 2)));
  const groups = [[]];
  for (const [index, run] of runs.entries()) {
    if (index >= 2 && runs.length - index >= 2 && gaps[index - 1] > Math.max(height * 6, ordinary * 3))
      groups.push([]);
    groups.at(-1).push(run);
  }
  return groups;
}

function prose(cells, columnCount) {
  if (columnCount < 2) return true;
  let paragraphs = 0;
  for (let column = 0; column < columnCount; column++) {
    const filled = cells.map((row) => row[column]).filter((cell) => cell.words.length);
    if (filled.length >= 3 && filled.filter((cell) => cell.words.length >= 5).length >= filled.length * 0.6)
      paragraphs++;
  }
  return paragraphs >= 2;
}

function cellText(words) {
  return words.reduce((text, word, index) => {
    const previous = words[index - 1];
    const connected = previous && Math.abs(word.y - previous.y) < word.height * 0.45 &&
      word.x - previous.x - previous.width < word.height * 0.16;
    return text + (index && !connected ? " " : "") + word.text;
  }, "");
}

function candidate(lines, seed, group) {
  const first = group[0], last = group.at(-1);
  const leftNeighbor = seed.runs[seed.runs.indexOf(first) - 1];
  const rightNeighbor = seed.runs[seed.runs.indexOf(last) + 1];
  const leftLimit = leftNeighbor ? (leftNeighbor.x + leftNeighbor.width + first.x) / 2 : first.x - seed.height * 6;
  const rightLimit = rightNeighbor ? (last.x + last.width + rightNeighbor.x) / 2 : last.x + last.width + seed.height * 6;
  const gutters = group.slice(1).map((run, index) => ({
    left: group[index].x + group[index].width,
    right: run.x,
    support: 0,
  }));
  if (!gutters.length) return null;
  const local = lines.map((line) => ({
    ...line,
    source: line,
    runs: line.runs.filter((run) => run.x >= leftLimit && run.x + run.width <= rightLimit),
  })).filter((line) => line.runs.length);
  const seedIndex = local.findIndex((line) => line.source === seed);
  const accepted = new Map();
  const accept = (index) => {
    const line = local[index];
    if (!line.runs.length) return false;
    const updates = [];
    for (const gutter of gutters) {
      const gaps = line.runs.slice(1).map((run, i) => ({
        left: line.runs[i].x + line.runs[i].width,
        right: run.x,
      }));
      const gap = gaps.find((item) => Math.min(item.right, gutter.right) - Math.max(item.left, gutter.left) > seed.height * 0.5);
      if (gap) updates.push({ ...gap, supported: true });
      else {
        const middle = (gutter.left + gutter.right) / 2;
        if (line.runs.some((run) => run.x < middle && run.x + run.width > middle)) return false;
        updates.push({
          left: Math.max(gutter.left, ...line.runs.filter((run) => run.x < middle).map((run) => run.x + run.width)),
          right: Math.min(gutter.right, ...line.runs.filter((run) => run.x >= middle).map((run) => run.x)),
          supported: false,
        });
      }
    }
    updates.forEach((gap, i) => {
      if (!gap) return;
      gutters[i].left = Math.max(gutters[i].left, gap.left);
      gutters[i].right = Math.min(gutters[i].right, gap.right);
      if (gap.supported) gutters[i].support++;
    });
    accepted.set(index, line);
    return true;
  };
  accept(seedIndex);
  for (const direction of [-1, 1]) {
    for (let index = seedIndex + direction; index >= 0 && index < local.length; index += direction) {
      const previous = local[index - direction];
      const distance = Math.abs(local[index].center - previous.center);
      if (distance > Math.max(seed.height, local[index].height) * 3.5 || !accept(index)) break;
    }
  }
  if (gutters.some((gutter) => gutter.support < 2)) return null;
  const dividers = gutters.map((gutter) => (gutter.left + gutter.right) / 2);
  let rows = [...accepted.values()].sort((a, b) => a.y - b.y);
  const occupied = (line) => new Set(line.runs.map((run) => dividers.filter((x) => run.x >= x).length)).size;
  const firstStrong = rows.findIndex((line) => occupied(line) >= 2);
  const lastStrong = rows.findLastIndex((line) => occupied(line) >= 2);
  rows = rows.slice(firstStrong, lastStrong + 1);
  if (rows.length < 2) return null;
  const logicalRows = [];
  for (const row of rows) {
    const previous = logicalRows.at(-1);
    if (previous && occupied(row) === 1 && row.y - previous.y - previous.height <= seed.height * 0.5) {
      previous.runs.push(...row.runs);
      Object.assign(previous, bounds(previous.runs));
    } else logicalRows.push({ ...row, runs: [...row.runs] });
  }
  if (logicalRows.length < 2) return null;
  const cells = logicalRows.map((row) => Array.from({ length: dividers.length + 1 }, (_, column) => {
    const words = row.runs.flatMap((run) => run.words).filter((word) => dividers.filter((x) => word.x >= x).length === column);
    return { words, text: cellText(words), rect: words.length ? bounds(words) : null };
  }));
  if (prose(cells, dividers.length + 1)) return null;
  const rect = bounds(cells.flatMap((row) => row.flatMap((cell) => cell.words)));
  const padding = Math.min(4, seed.height / 3);
  rect.x -= padding;
  rect.y -= padding;
  rect.width += padding * 2;
  rect.height += padding * 2;
  const xs = [rect.x, ...dividers, rect.x + rect.width];
  const ys = [rect.y, ...logicalRows.slice(1).map((row, index) =>
    (logicalRows[index].y + logicalRows[index].height + row.y) / 2), rect.y + rect.height];
  return {
    rect,
    columns: xs.slice(1).map((right, index) => ({
      rect: { x: xs[index], y: rect.y, width: right - xs[index], height: rect.height },
    })),
    rows: cells.map((row, index) => ({
      rect: { x: rect.x, y: ys[index], width: rect.width, height: ys[index + 1] - ys[index] },
      cells: row,
    })),
  };
}

function frameTable(table, rules) {
  const words = table.rows.flatMap((row) => row.cells.flatMap((cell) => cell.words));
  const text = bounds(words);
  const margin = median(words.map((word) => word.height)) * 6;
  const horizontal = rules.filter((rule) => rule.height < 0.5 &&
    rule.x <= text.x && rule.x + rule.width >= text.x + text.width);
  const top = horizontal.filter((rule) => rule.y <= text.y && rule.y >= text.y - margin)
    .sort((a, b) => b.y - a.y)[0];
  const bottom = horizontal.filter((rule) => rule.y >= text.y + text.height && rule.y <= text.y + text.height + margin)
    .sort((a, b) => a.y - b.y)[0];
  if (!top || !bottom) return table;
  const vertical = rules.filter((rule) => rule.width < 0.5 &&
    rule.y <= top.y + 1 && rule.y + rule.height >= bottom.y - 1);
  const left = vertical.filter((rule) => rule.x <= text.x && rule.x >= text.x - margin)
    .sort((a, b) => b.x - a.x)[0];
  const right = vertical.filter((rule) => rule.x >= text.x + text.width && rule.x <= text.x + text.width + margin)
    .sort((a, b) => a.x - b.x)[0];
  if (!left || !right) return table;
  const xs = [left.x, ...table.columns.slice(1).map(({ rect }) => {
    const nearest = vertical.filter((rule) => Math.abs(rule.x - rect.x) < margin && rule.x > left.x && rule.x < right.x)
      .sort((a, b) => Math.abs(a.x - rect.x) - Math.abs(b.x - rect.x))[0];
    return nearest?.x ?? rect.x;
  }), right.x];
  const ys = [top.y, ...table.rows.slice(1).map(({ rect }) => {
    const nearest = horizontal.filter((rule) => Math.abs(rule.y - rect.y) < margin && rule.y > top.y && rule.y < bottom.y)
      .sort((a, b) => Math.abs(a.y - rect.y) - Math.abs(b.y - rect.y))[0];
    return nearest?.y ?? rect.y;
  }), bottom.y];
  if (xs.some((x, index) => index && x <= xs[index - 1]) || ys.some((y, index) => index && y <= ys[index - 1])) return table;
  if (table.rows.some((row, index) => row.cells.some((cell, column) => cell.words.some((word) =>
    word.x < xs[column] || word.x + word.width > xs[column + 1] || word.y < ys[index] || word.y + word.height > ys[index + 1],
  )))) return table;
  table.rect = { x: left.x, y: top.y, width: right.x - left.x, height: bottom.y - top.y };
  table.columns.forEach((column, index) => {
    column.rect = { x: xs[index], y: top.y, width: xs[index + 1] - xs[index], height: table.rect.height };
  });
  table.rows.forEach((row, index) => {
    row.rect = { x: left.x, y: ys[index], width: table.rect.width, height: ys[index + 1] - ys[index] };
  });
  return table;
}

export function detectTables(words, rules = []) {
  const valid = words.filter((word) => word.text?.trim() &&
    [word.x, word.y, word.width, word.height].every(Number.isFinite) && word.width > 0 && word.height > 0);
  if (!valid.length) return [];
  const lines = textLines(valid);
  const candidates = [];
  const seeded = new Set();
  for (const line of [...lines].sort((a, b) => b.runs.length - a.runs.length || b.width - a.width)) {
    for (const group of seedGroups(line.runs, line.height)) {
      if (group.every((run) => run.words.every((word) => seeded.has(word)))) continue;
      const table = candidate(lines, line, group);
      if (table) {
        const entries = table.rows.flatMap((row) => row.cells.flatMap((cell) => cell.words));
        entries.forEach((word) => seeded.add(word));
        candidates.push({ table, entries });
      }
    }
  }
  const tables = [];
  const used = new Set();
  candidates.sort((a, b) => b.entries.length - a.entries.length);
  for (const { table, entries } of candidates) {
    if (entries.some((word) => used.has(word))) continue;
    entries.forEach((word) => used.add(word));
    tables.push(rules.length ? frameTable(table, rules) : table);
  }
  return tables.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}
