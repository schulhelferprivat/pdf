function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function extractTableRules({ fnArray, argsArray }, ops) {
  const rules = [];
  const stack = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  const point = (x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], -(matrix[1] * x + matrix[3] * y + matrix[5])];
  const add = (a, b) => {
    const width = Math.abs(a[0] - b[0]), height = Math.abs(a[1] - b[1]);
    if ((width >= 20 && height < 0.5) || (height >= 20 && width < 0.5))
      rules.push({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width, height });
  };
  const draw = { move: 0, line: 1, curve: 2, quadratic: 3, close: 4 };
  const strokes = new Set([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  for (let index = 0; index < fnArray.length; index++) {
    const op = fnArray[index], args = argsArray[index];
    if (op === ops.save) stack.push(matrix);
    else if (op === ops.restore) matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === ops.transform) matrix = multiply(matrix, args);
    else if (op === ops.paintFormXObjectBegin) {
      stack.push(matrix);
      if (args[0]) matrix = multiply(matrix, args[0]);
    } else if (op === ops.paintFormXObjectEnd) matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === ops.constructPath && strokes.has(args[0])) {
      const path = args[1]?.[0];
      if (!ArrayBuffer.isView(path) && !Array.isArray(path)) continue;
      let previous = null, start = null;
      for (let offset = 0; offset < path.length;) {
        const command = path[offset++];
        if (command === draw.move || command === draw.line) {
          const next = point(path[offset++], path[offset++]);
          if (command === draw.line && previous) add(previous, next);
          else start = next;
          previous = next;
        } else if (command === draw.close) {
          if (previous && start) add(previous, start);
          previous = start;
        } else if (command === draw.curve || command === draw.quadratic) {
          offset += command === draw.curve ? 6 : 4;
          previous = point(path[offset - 2], path[offset - 1]);
        } else break;
      }
    }
  }
  return rules;
}
