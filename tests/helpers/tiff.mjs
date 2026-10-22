import { deflateSync } from "node:zlib";

export function deflateTiffFixture({
  width = 3,
  height = 2,
  channels = 3,
  bits = Array(channels).fill(8),
  rows = height,
  tile = null,
  compression = 8,
  block = null,
  packed = (bytes) => bytes,
} = {}) {
  const columns = tile ? Math.ceil(width / tile[0]) : 1;
  const count = tile ? columns * Math.ceil(height / tile[1]) : Math.ceil(height / rows);
  const blocks = Array.from({ length: count }, (_, index) => {
    const stride = Math.ceil((tile?.[0] ?? width) * channels * bits[0] / 8);
    const size = stride * (tile?.[1] ?? Math.min(rows, height - index * rows));
    return packed(deflateSync(block ? block(size, index) : new Uint8Array(size).fill(42)), index);
  });
  const tags = [
    [256, 4, [width]], [257, 4, [height]], [258, 3, bits],
    [259, 3, [compression]], [262, 3, [channels >= 3 ? 2 : 1]],
    [277, 3, [channels]], [284, 3, [1]],
    ...(tile ? [[322, 4, [tile[0]]], [323, 4, [tile[1]]]] : [[278, 4, [rows]]]),
    [tile ? 324 : 273, 4, Array(count).fill(0)],
    [tile ? 325 : 279, 4, blocks.map((bytes) => bytes.length)],
  ].sort((a, b) => a[0] - b[0]);
  let offset = 8 + 2 + tags.length * 12 + 4;
  const positions = tags.map(([, type, values]) => {
    const size = values.length * (type === 3 ? 2 : 4);
    if (size <= 4) return null;
    const position = offset;
    offset += size;
    return position;
  });
  const dataStart = offset;
  const offsets = tags.find(([tag]) => tag === (tile ? 324 : 273))[2];
  blocks.forEach((bytes, index) => { offsets[index] = offset; offset += bytes.length; });
  const bytes = new Uint8Array(offset), view = new DataView(bytes.buffer);
  bytes.set([73, 73, 42, 0]);
  view.setUint32(4, 8, true);
  view.setUint16(8, tags.length, true);
  tags.forEach(([tag, type, values], index) => {
    const entry = 10 + index * 12;
    view.setUint16(entry, tag, true);
    view.setUint16(entry + 2, type, true);
    view.setUint32(entry + 4, values.length, true);
    if (positions[index] !== null) view.setUint32(entry + 8, positions[index], true);
    values.forEach((value, item) => {
      const position = (positions[index] ?? entry + 8) + item * (type === 3 ? 2 : 4);
      if (type === 3) view.setUint16(position, value, true);
      else view.setUint32(position, value, true);
    });
  });
  offset = dataStart;
  for (const block of blocks) { bytes.set(block, offset); offset += block.length; }
  return bytes;
}
