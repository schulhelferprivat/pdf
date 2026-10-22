const background = [32, 35, 41];
const foreground = [232, 237, 242];

export function darkTextColor(value) {
  if (!/^#[0-9a-f]{6}$/i.test(value || "")) return value;
  const rgb = [1, 3, 5].map((index) =>
    parseInt(value.slice(index, index + 2), 16),
  );
  const chroma = Math.max(...rgb) - Math.min(...rgb);
  if (chroma > 72) return value;
  const light = Math.round(
    (rgb[0] * 77 + rgb[1] * 150 + rgb[2] * 29) / 256,
  );
  if (light >= 150) return value;
  const weight = (150 - light) / 150;
  return `#${foreground
    .map((channel, index) =>
      Math.round(rgb[index] + (channel - rgb[index]) * weight)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function imageMask(canvas, coordinates, rotation) {
  if (!coordinates?.length) return null;
  const images = [];
  let area = 0;
  const turn = (x, y) =>
    rotation === 90
      ? [1 - y, x]
      : rotation === 180
        ? [1 - x, 1 - y]
        : rotation === 270
          ? [y, 1 - x]
          : [x, y];
  for (let index = 0; index < coordinates.length; index += 6) {
    let [ax, ay, bx, by, cx, cy] = coordinates.subarray(index, index + 6);
    [ax, ay] = turn(ax, ay);
    [bx, by] = turn(bx, by);
    [cx, cy] = turn(cx, cy);
    const size = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    if (!Number.isFinite(size) || size <= 0) continue;
    area += size;
    images.push([ax, ay, bx, by, cx, cy]);
  }
  if (!images.length || area >= 0.9) return null;
  const mask = document.createElement("canvas");
  mask.width = canvas.width;
  mask.height = canvas.height;
  const context = mask.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#fff";
  for (const [ax, ay, bx, by, cx, cy] of images) {
    context.beginPath();
    context.moveTo(ax * mask.width, ay * mask.height);
    context.lineTo(bx * mask.width, by * mask.height);
    context.lineTo((bx + cx - ax) * mask.width, (by + cy - ay) * mask.height);
    context.lineTo(cx * mask.width, cy * mask.height);
    context.closePath();
    context.fill();
  }
  const pixels = context.getImageData(0, 0, mask.width, mask.height).data;
  mask.width = 0;
  mask.height = 0;
  return pixels;
}

export function darkenCanvas(context, coordinates = null, rotation = 0) {
  const { canvas } = context;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const mask = imageMask(canvas, coordinates, rotation);
  for (let index = 0; index < pixels.length; index += 4) {
    if (mask && mask[index + 3]) continue;
    const red = pixels[index],
      green = pixels[index + 1],
      blue = pixels[index + 2];
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (chroma >= 32) continue;
    const intensity = (red * 77 + green * 150 + blue * 29) / 65280;
    const blend = chroma <= 12 ? 1 : (32 - chroma) / 20;
    for (let channel = 0; channel < 3; channel++) {
      const dark =
        background[channel] +
        (foreground[channel] - background[channel]) * (1 - intensity);
      pixels[index + channel] = Math.round(
        dark * blend + pixels[index + channel] * (1 - blend),
      );
    }
  }
  context.putImageData(image, 0, 0);
}
