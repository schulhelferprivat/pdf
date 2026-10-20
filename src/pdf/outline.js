function titleText(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function validTitle(title) {
  return title.length >= 3 && title.length <= 160 &&
    title.split(" ").length <= 20 && /\p{L}/u.test(title) &&
    !/\.{3}|…|[.!?;]$/u.test(title);
}

function readPage(content, viewport, index) {
  const fragments = [], marked = new Map(), stack = [];
  for (const item of content.items) {
    if (item.type === "beginMarkedContent" || item.type === "beginMarkedContentProps") {
      stack.push(item);
      continue;
    }
    if (item.type === "endMarkedContent") {
      stack.pop();
      continue;
    }
    if (!item.str?.trim() || stack.some((entry) => entry.tag === "Artifact")) continue;
    const size = Math.hypot(item.transform[2], item.transform[3]);
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const [endX, endY] = viewport.convertToViewportPoint(
      item.transform[4] + item.transform[0],
      item.transform[5] + item.transform[1],
    );
    if (!size || Math.abs(endY - y) > Math.abs(endX - x) * 0.1 || endX < x) continue;
    const fragment = {
      text: item.str, x, y, size, right: x + item.width,
      font: item.fontName, index, height: viewport.height,
    };
    fragments.push(fragment);
    for (const entry of stack) {
      if (!entry.id) continue;
      if (!marked.has(entry.id)) marked.set(entry.id, []);
      marked.get(entry.id).push(fragment);
    }
  }
  return { lines: makeLines(fragments), marked, index };
}

function makeLines(fragments) {
  const lines = [];
  for (const fragment of [...fragments].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.y - fragment.y) <= Math.min(previous.size, fragment.size) * 0.25) {
      previous.fragments.push(fragment);
    } else lines.push({ ...fragment, fragments: [fragment] });
  }
  return lines.map((line) => {
    const parts = line.fragments.sort((a, b) => a.x - b.x);
    let text = "", right = parts[0].x, table = false;
    for (const part of parts) {
      const gap = part.x - right;
      if (text && gap > line.size * 2) table = true;
      text += (text && gap > line.size * 0.15 ? " " : "") + part.text;
      right = Math.max(right, part.right);
    }
    return {
      ...line, text: titleText(text), right, table,
      uniform: parts.every((part) => part.font === line.font && Math.abs(part.size - line.size) <= 0.5),
      style: `${line.font}:${Math.round(line.size * 2) / 2}`,
    };
  });
}

function edgeKey(line) {
  return line.text.toLocaleLowerCase().replace(/\d+/gu, "#");
}

function repeatedEdges(pages) {
  const occurrences = new Map();
  for (const { lines, index } of pages) {
    for (const line of lines) {
      if (line.y > line.height * 0.12 && line.y < line.height * 0.88) continue;
      const key = edgeKey(line);
      if (!occurrences.has(key)) occurrences.set(key, new Set());
      occurrences.get(key).add(index);
    }
  }
  return new Set([...occurrences].filter(([, indices]) => indices.size >= 2).map(([key]) => key));
}

function isRepeated(line, repeated) {
  return (line.y <= line.height * 0.12 || line.y >= line.height * 0.88) && repeated.has(edgeKey(line));
}

function taggedHeadings(page, repeated) {
  const headings = [];
  const visit = (node) => {
    if (/^H[1-6]?$/u.test(node.role || "")) {
      const fragments = new Set();
      const collect = (child) => {
        if (child.type === "content") {
          for (const fragment of page.marked.get(child.id) || []) fragments.add(fragment);
        }
        for (const next of child.children || []) collect(next);
      };
      collect(node);
      const lines = makeLines([...fragments]);
      const title = titleText(lines.map((line) => line.text).join(" "));
      if (lines.length && validTitle(title) && !lines.some((line) => line.table || isRepeated(line, repeated))) {
        headings.push({ title, index: page.index, level: Number(node.role.slice(1)) || 1 });
      }
      return;
    }
    for (const child of node.children || []) visit(child);
  };
  if (page.tree) visit(page.tree);
  return headings;
}

function visualHeadings(pages, repeated) {
  const sizes = new Map();
  const lines = pages.flatMap((page) => page.lines).filter((line) => !isRepeated(line, repeated));
  for (const line of lines) {
    if (line.table || !line.uniform) continue;
    const size = Math.round(line.size * 2) / 2;
    sizes.set(size, (sizes.get(size) || 0) + line.text.length);
  }
  const body = [...sizes].sort((a, b) => b[1] - a[1])[0];
  if (!body || body[1] < 160) return [];
  const bodySize = body[0];
  if (lines.filter((line) => Math.abs(line.size - bodySize) <= 0.5).length < 4) return [];
  const candidates = [];
  for (const page of pages) {
    const eligible = (line) => {
      if (!line || !line.uniform || line.table || !validTitle(line.text) || isRepeated(line, repeated)) return false;
      const numbered = /^\d+(?:\.\d+)*[.)]?\s+\p{L}/u.test(line.text);
      return line.size >= bodySize * (numbered ? 1.15 : 1.2);
    };
    for (let i = 0; i < page.lines.length; i++) {
      const first = page.lines[i];
      if (!eligible(first)) continue;
      let last = first, title = first.text;
      const previous = page.lines[i - 1];
      while (i + 1 < page.lines.length) {
        const next = page.lines[i + 1];
        if (!eligible(next) || next.style !== first.style ||
          next.y - last.y > first.size * 1.45 || Math.abs(next.x - first.x) > first.size ||
          !validTitle(`${title} ${next.text}`)) break;
        title += ` ${next.text}`;
        last = next;
        i++;
      }
      const next = page.lines[i + 1];
      if (previous && first.y - first.size - previous.y < first.size * 0.7) continue;
      if (!next || next.table || Math.abs(next.size - bodySize) > 0.5 ||
        next.y - next.size - last.y < bodySize * 0.4 || next.y - last.y > first.size * 5) continue;
      candidates.push({ ...first, title });
    }
  }
  const styles = new Map();
  for (const candidate of candidates) {
    if (!styles.has(candidate.style)) styles.set(candidate.style, new Set());
    styles.get(candidate.style).add(candidate.title.toLocaleLowerCase());
  }
  const reliable = candidates.filter((candidate) => styles.get(candidate.style).size >= 2);
  const levels = [...new Set(reliable.map((candidate) => Math.round(candidate.size * 2) / 2))].sort((a, b) => b - a);
  return reliable.map((candidate) => ({
    title: candidate.title, index: candidate.index,
    level: levels.indexOf(Math.round(candidate.size * 2) / 2) + 1,
  }));
}

function buildTree(headings) {
  if (new Set(headings.map((entry) => entry.title.toLocaleLowerCase())).size < 2) return [];
  const entries = [], stack = [];
  for (const heading of headings) {
    const entry = { title: heading.title, index: heading.index, items: [], open: true };
    while (stack.length && stack.at(-1).level >= heading.level) stack.pop();
    (stack.at(-1)?.entry.items || entries).push(entry);
    stack.push({ level: heading.level, entry });
  }
  return entries;
}

export async function generateOutline(pdf) {
  const pages = [];
  for (let index = 0; index < pdf.numPages; index++) {
    const page = await pdf.getPage(index + 1);
    const content = await page.getTextContent({ includeMarkedContent: true });
    const data = readPage(content, page.getViewport({ scale: 1 }), index);
    data.tree = await page.getStructTree();
    pages.push(data);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const repeated = repeatedEdges(pages);
  const tagged = buildTree(pages.flatMap((page) => taggedHeadings(page, repeated)));
  return tagged.length ? tagged : buildTree(visualHeadings(pages, repeated));
}
