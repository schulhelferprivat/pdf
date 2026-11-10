import test from "node:test";
import assert from "node:assert/strict";
import { ruleSegments, detectTables, assembleLines } from "../src/core/columns.js";

const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  constructPath: 91,
};
const rect = (x, y, w, h) => [0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4];
const line = (x1, y1, x2, y2) => [0, x1, y1, 1, x2, y2];
const path = (paint, data) => [OPS.constructPath, [paint, [new Float32Array(data)], [0, 0, 0, 0]]];
function list(...ops) {
  return { fnArray: ops.map((op) => op[0]), argsArray: ops.map((op) => op[1]) };
}
const sorted = (segments) =>
  segments.map((segment) => segment.map((value) => Math.round(value * 100) / 100)).sort();

test("stroked rectangles become four axis segments", () => {
  const { fnArray, argsArray } = list(path(OPS.stroke, rect(10, 20, 100, 50)));
  assert.deepEqual(
    sorted(ruleSegments(fnArray, argsArray, OPS)),
    sorted([
      [10, 20, 110, 20],
      [110, 20, 110, 70],
      [110, 70, 10, 70],
      [10, 70, 10, 20],
    ]),
  );
});

test("thin filled rectangles become lines and large fills are ignored", () => {
  const { fnArray, argsArray } = list(
    path(OPS.fill, rect(10, 20, 100, 0.5)),
    path(OPS.fill, rect(50, 20, 0.5, 80)),
    path(OPS.fill, rect(0, 0, 200, 40)),
  );
  assert.deepEqual(
    sorted(ruleSegments(fnArray, argsArray, OPS)),
    sorted([
      [10, 20.25, 110, 20.25],
      [50.25, 20, 50.25, 100],
    ]),
  );
});

test("transforms, save/restore and form xobjects are applied", () => {
  const { fnArray, argsArray } = list(
    [OPS.save, null],
    [OPS.transform, [2, 0, 0, 2, 5, 5]],
    path(OPS.stroke, line(0, 0, 10, 0)),
    [OPS.restore, null],
    [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 100, 0], null]],
    path(OPS.stroke, line(0, 0, 0, 10)),
    [OPS.paintFormXObjectEnd, null],
    path(OPS.stroke, line(0, 50, 10, 50)),
  );
  assert.deepEqual(
    sorted(ruleSegments(fnArray, argsArray, OPS)),
    sorted([
      [5, 5, 25, 5],
      [100, 0, 100, 10],
      [0, 50, 10, 50],
    ]),
  );
});

test("diagonal strokes, curves and paths without paint are ignored", () => {
  const { fnArray, argsArray } = list(
    path(OPS.stroke, line(0, 0, 40, 40)),
    path(OPS.stroke, [0, 0, 0, 2, 10, 10, 20, 10, 30, 0]),
    path(OPS.endPath, rect(0, 0, 100, 100)),
  );
  assert.deepEqual(ruleSegments(fnArray, argsArray, OPS), []);
});

function grid(left, top, columns, rows) {
  const segments = [],
    right = columns.at(-1),
    bottom = rows.at(-1);
  for (const y of rows) segments.push([left, y, right, y]);
  for (const x of [left, ...columns]) segments.push([x, top, x, bottom]);
  return segments;
}

test("a two column grid is detected with its column boundaries", () => {
  const tables = detectTables(grid(100, 100, [300, 500], [100, 130, 200, 260]));
  assert.equal(tables.length, 1);
  assert.deepEqual(
    tables[0],
    { left: 100, top: 100, right: 500, bottom: 260, columns: [{ left: 100, right: 300 }, { left: 300, right: 500 }] },
  );
});

test("separate tables are detected separately and a page frame is ignored", () => {
  const tables = detectTables([
    ...grid(50, 50, [150, 250, 350], [50, 80, 120]),
    ...grid(50, 400, [200, 350], [400, 450]),
    [10, 10, 590, 10],
    [10, 830, 590, 830],
    [10, 10, 10, 830],
    [590, 10, 590, 830],
  ]);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].columns.length, 3);
  assert.equal(tables[1].columns.length, 2);
});

test("short split lines inside a cell do not create columns", () => {
  const tables = detectTables([
    ...grid(0, 0, [200, 400], [0, 30, 300]),
    [100, 250, 100, 300],
  ]);
  assert.deepEqual(tables[0].columns, [{ left: 0, right: 200 }, { left: 200, right: 400 }]);
});

test("segments joined from pieces form one line", () => {
  const tables = detectTables([
    [0, 0, 100, 0],
    [100, 0, 200, 0],
    [0, 100, 200, 100],
    [0, 0, 0, 100],
    [100, 0, 100, 50],
    [100, 50, 100, 100],
    [200, 0, 200, 100],
  ]);
  assert.deepEqual(tables[0].columns, [{ left: 0, right: 100 }, { left: 100, right: 200 }]);
});

test("fragments are grouped into lines in reading order", () => {
  const text = assembleLines([
    { text: "nennen Kriterien", x: 20, y: 31, width: 80, height: 10 },
    { text: "•", x: 0, y: 18, width: 4, height: 10 },
    { text: "beschreiben individuelle", x: 20, y: 18, width: 120, height: 10 },
    { text: "Die Schülerinnen und Schüler …", x: 0, y: 0, width: 150, height: 10 },
  ]);
  assert.equal(text, "Die Schülerinnen und Schüler …\n• beschreiben individuelle\nnennen Kriterien");
});

test("adjacent fragments are joined without extra spaces", () => {
  assert.equal(
    assembleLines([
      { text: "Zukunfts", x: 0, y: 0, width: 40, height: 10 },
      { text: "wünsche", x: 40.5, y: 0.5, width: 40, height: 10 },
      { text: " und", x: 90, y: 0, width: 20, height: 10 },
    ]),
    "Zukunftswünsche und",
  );
});

test("empty and whitespace fragments are dropped", () => {
  assert.equal(
    assembleLines([
      { text: "  ", x: 0, y: 0, width: 10, height: 10 },
      { text: "Ende ", x: 0, y: 20, width: 30, height: 10 },
    ]),
    "Ende",
  );
});
