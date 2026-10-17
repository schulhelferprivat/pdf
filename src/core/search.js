export function normalizeQuery(query) {
  return String(query ?? "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
export function findMatches(segments, query) {
  const needle = normalizeQuery(query);
  if (!needle) return [];
  let text = "";
  const positions = [];
  segments.forEach((segment, index) => {
    let offset = 0;
    for (const char of String(segment ?? "")) {
      const end = offset + char.length;
      if (/\s/.test(char)) {
        if (text && !text.endsWith(" ")) {
          text += " ";
          positions.push({ segment: index, offset, end });
        }
      } else {
        const lower = char.toLocaleLowerCase();
        text += lower;
        for (let i = 0; i < lower.length; i++)
          positions.push({ segment: index, offset, end });
      }
      offset = end;
    }
  });
  const matches = [];
  let from = text.indexOf(needle);
  while (from >= 0) {
    const first = positions[from],
      last = positions[from + needle.length - 1];
    matches.push({
      start: { segment: first.segment, offset: first.offset },
      end: { segment: last.segment, offset: last.end },
    });
    from = text.indexOf(needle, from + needle.length);
  }
  return matches;
}
