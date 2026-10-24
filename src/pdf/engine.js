import { pdfLib, fontkit } from "./vendors.js";
import {
  inspectFields,
  applyValues,
  transplantForms,
  adoptOrphanWidgets,
} from "./forms.js";
import { impose } from "./layout.js";
import { limits, normalizeAngle, displayedSize } from "../core/model.js";
import { pagePoint } from "../core/geometry.js";
let fontsPromise;
async function fonts(document, bytes) {
  document.registerFontkit(await fontkit());
  if (!bytes && !fontsPromise)
    fontsPromise = Promise.all(
      ["Regular", "Bold"].map(
        async (weight) =>
          new Uint8Array(
            await (
              await fetch(
                new URL(`../../assets/NotoSans-${weight}.ttf`, import.meta.url),
              )
            ).arrayBuffer(),
          ),
      ),
    );
  const [regular, bold] = bytes || (await fontsPromise);
  return {
    regular: await document.embedFont(regular, { subset: true }),
    bold: await document.embedFont(bold, { subset: true }),
  };
}
export async function inspect(data, password = "") {
  const lib = await pdfLib();
  const source = await lib.PDFDocument.load(data, {
    password,
    preserveXFA: true,
    updateMetadata: false,
  });
  const count = source.getPageCount();
  if (count < 1 || count > limits.pages)
    throw new Error(`Erlaubt sind 1 bis ${limits.pages} Seiten pro Dokument.`);
  adoptOrphanWidgets(lib, source);
  const widgets = inspectFields(lib, source);
  const encryption = !!password || !!source.context.trailerInfo.Encrypt;
  const elements =
    encryption && !password
      ? source.getPages().map(() => [])
      : restoreElements(lib, source);
  const info = {
    pages: source.getPages().map((page, index) => ({
      ...page.getSize(),
      crop: page.getCropBox(),
      baseRotation: normalizeAngle(page.getRotation().angle),
      widgets: widgets[index],
      elements: elements[index],
    })),
    xfa: source.getForm().hasXFA(),
    signed: source.getForm().getSignatureFields().length > 0,
    encrypted: source.isEncrypted,
  };
  if (elements.some((list) => list.length)) {
    if (encryption)
      source.encrypt({
        userPassword: password,
        ownerPassword: Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (value) => value.toString(16).padStart(2, "0"),
        ).join(""),
        algorithm: "AES-256",
      });
    info.data = await source.save({
      useObjectStreams: true,
      updateFieldAppearances: false,
    });
  }
  return info;
}
function color(lib, value = "#334155") {
  return lib.rgb(
    ...[1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255),
  );
}
function placement(element) {
  const angle = (element.angle * Math.PI) / 180;
  const right = [Math.cos(angle), Math.sin(angle)],
    down = [Math.sin(angle), -Math.cos(angle)];
  return (x, y) => ({
    x: element.x + right[0] * x + down[0] * y,
    y: element.y + right[1] * x + down[1] * y,
  });
}
async function drawElements(lib, output, target, page, font, images) {
  for (const element of page.elements) {
    if (element.type === "comment") continue;
    const position = placement(element);
    const bottom = position(0, element.height);
    const options = {
      ...bottom,
      width: element.width,
      height: element.height,
      rotate: lib.degrees(element.angle),
      opacity: element.opacity ?? 1,
    };
    if (element.type === "image") {
      if (!images.has(element.assetId))
        throw new Error("Eine Bilddatei ist nicht mehr verfügbar.");
      const image = images.get(element.assetId);
      if (!image.embedded)
        image.embedded =
          image.mime === "image/png"
            ? await output.embedPng(image.bytes)
            : await output.embedJpg(image.bytes);
      target.drawImage(image.embedded, options);
    } else if (element.type === "text") {
      const activeFont = element.bold ? font.bold : font.regular;
      const size = element.fontSize || 16;
      const lines = [];
      for (const paragraph of String(element.text || "").split("\n")) {
        let line = "";
        for (const word of paragraph.split(" ")) {
          const next = line ? `${line} ${word}` : word;
          if (
            activeFont.widthOfTextAtSize(next, size) > element.width &&
            line
          ) {
            lines.push(line);
            line = word;
          } else line = next;
        }
        lines.push(line);
      }
      const corners = [
        [0, 0],
        [element.width, 0],
        [element.width, element.height],
        [0, element.height],
      ].map(([x, y]) => position(x, y));
      target.pushOperators(
        lib.pushGraphicsState(),
        lib.moveTo(corners[0].x, corners[0].y),
        ...corners.slice(1).map((point) => lib.lineTo(point.x, point.y)),
        lib.closePath(),
        lib.clip(),
        lib.endPath(),
      );
      lines.forEach((line, index) => {
        if ((index + 1) * size * 1.25 > element.height + size * 0.25) return;
        target.drawText(line, {
          ...position(0, size + index * size * 1.25),
          size,
          font: activeFont,
          color: color(lib, element.color),
          rotate: lib.degrees(element.angle),
          opacity: element.opacity ?? 1,
        });
      });
      target.pushOperators(lib.popGraphicsState());
    } else if (element.type === "highlight")
      for (const [rx, ry, rw, rh] of element.rects || [[0, 0, 1, 1]])
        target.drawRectangle({
          ...position(rx * element.width, (ry + rh) * element.height),
          width: rw * element.width,
          height: rh * element.height,
          rotate: options.rotate,
          color: color(lib, element.color),
          opacity: element.opacity ?? 0.35,
        });
    else if (element.type === "draw") {
      target.pushOperators(
        lib.pushGraphicsState(),
        lib.setLineJoin(lib.LineJoinStyle.Round),
      );
      for (const points of element.paths || [element.points || []]) {
        if (points.length < 2) continue;
        const path = points
          .map(([px, py], i) => {
            const point = position(px * element.width, py * element.height);
            return `${i ? "L" : "M"}${point.x} ${-point.y}`;
          })
          .join(" ");
        target.drawSvgPath(path, {
          x: 0,
          y: 0,
          borderColor: color(lib, element.color),
          borderWidth: element.strokeWidth || 2,
          borderOpacity: element.opacity ?? 1,
          borderLineCap: lib.LineCapStyle.Round,
        });
      }
      target.pushOperators(lib.popGraphicsState());
    }
  }
}
const annotationSubtypes = {
  text: "FreeText",
  highlight: "Highlight",
  draw: "Ink",
  comment: "Text",
};
const commentColor = "#f5c542";
function rgb(color) {
  return [1, 3, 5].map(
    (i) => parseInt((color || "#334155").slice(i, i + 2), 16) / 255,
  );
}
function pdfDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  const pad = (number) => String(number).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}
function parsePdfDate(text) {
  const match =
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?/.exec(
      text || "",
    );
  if (!match) return "";
  const [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00", sign, offsetHour = "00", offsetMinute = "00"] = match;
  let time = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  if (sign === "+" || sign === "-")
    time -= (sign === "+" ? 1 : -1) * (+offsetHour * 60 + +offsetMinute) * 60000;
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
}
const elementKey = "PDFHelper";
function strokes(element) {
  return (element.paths || [element.points || []]).filter(
    (points) => points.length,
  );
}
function annotationGeometry(element) {
  const position = placement(element),
    corners = (x, y, width, height) =>
      [
        [x, y],
        [x + width, y],
        [x, y + height],
        [x + width, y + height],
      ].map(([cx, cy]) => position(cx, cy));
  const points =
    element.type === "draw"
      ? strokes(element).map((points) =>
          points.map(([px, py]) =>
            position(px * element.width, py * element.height),
          ),
        )
      : [corners(0, 0, element.width, element.height)];
  const all = points.flat(),
    pad = element.type === "draw" ? (element.strokeWidth || 2) / 2 + 1 : 1;
  const rect = [
    Math.min(...all.map((point) => point.x)) - pad,
    Math.min(...all.map((point) => point.y)) - pad,
    Math.max(...all.map((point) => point.x)) + pad,
    Math.max(...all.map((point) => point.y)) + pad,
  ];
  if (element.type === "draw")
    return {
      rect,
      InkList: points.map((stroke) => stroke.flatMap(({ x, y }) => [x, y])),
      BS: { W: element.strokeWidth || 2 },
    };
  if (element.type === "highlight")
    return {
      rect,
      QuadPoints: (element.rects || [[0, 0, 1, 1]]).flatMap(
        ([rx, ry, rw, rh]) =>
          corners(
            rx * element.width,
            ry * element.height,
            rw * element.width,
            rh * element.height,
          ).flatMap(({ x, y }) => [x, y]),
      ),
    };
  return { rect };
}
async function appearance(lib, output, element, font, rect) {
  const scratch = output.addPage([1, 1]);
  await drawElements(lib, output, scratch, { elements: [element] }, font);
  const form = output.context.formXObject(
    scratch.contentStream?.operators || [],
    { BBox: rect, Resources: scratch.node.Resources() },
  );
  output.removePage(output.getPageCount() - 1);
  if (scratch.contentStreamRef) output.context.delete(scratch.contentStreamRef);
  output.context.delete(scratch.ref);
  return output.context.register(form);
}
async function annotateElements(lib, output, target, page, font, images) {
  await drawElements(
    lib,
    output,
    target,
    { elements: page.elements.filter((el) => !annotationSubtypes[el.type]) },
    font,
    images,
  );
  for (const element of page.elements) {
    const subtype = annotationSubtypes[element.type];
    if (!subtype) continue;
    if (element.type === "comment") {
      addComment(lib, output, target, element);
      continue;
    }
    const { id, ...data } = element;
    const { rect, ...geometry } = annotationGeometry(element);
    const colors = rgb(element.color);
    const annotation = output.context.obj({
      Type: "Annot",
      Subtype: subtype,
      Rect: rect,
      F: 4,
      C: colors,
      CA: element.opacity ?? (element.type === "highlight" ? 0.35 : 1),
      ...(id ? { NM: lib.PDFHexString.fromText(id) } : {}),
      AP: { N: await appearance(lib, output, element, font, rect) },
      [elementKey]: lib.PDFHexString.fromText(JSON.stringify(data)),
      ...geometry,
      ...(element.type === "text"
        ? {
            Contents: lib.PDFHexString.fromText(element.text || ""),
            DA: lib.PDFString.of(
              `/Helv ${element.fontSize || 16} Tf ${colors.join(" ")} rg`,
            ),
          }
        : {}),
    });
    target.node.addAnnot(output.context.register(annotation));
  }
}
function addComment(lib, output, target, element) {
  const { id, ...data } = element,
    { rect } = annotationGeometry(element),
    date = pdfDate(element.date),
    stamp = date ? { M: lib.PDFString.of(date) } : {};
  const ref = output.context.register(
    output.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Name: "Comment",
      Rect: rect,
      F: 24,
      C: rgb(element.color || commentColor),
      Open: false,
      Contents: lib.PDFHexString.fromText(element.text || ""),
      ...stamp,
      ...(element.author ? { T: lib.PDFHexString.fromText(element.author) } : {}),
      ...(id ? { NM: lib.PDFHexString.fromText(id) } : {}),
      [elementKey]: lib.PDFHexString.fromText(JSON.stringify(data)),
    }),
  );
  target.node.addAnnot(ref);
  if (element.done)
    target.node.addAnnot(
      output.context.register(
        output.context.obj({
          Type: "Annot",
          Subtype: "Text",
          Name: "Comment",
          Rect: rect,
          F: 30,
          IRT: ref,
          StateModel: "Review",
          State: "Completed",
          Contents: lib.PDFHexString.fromText("Completed"),
          ...stamp,
        }),
      ),
    );
}
const coordinateKeys = ["x", "y", "width", "height", "angle"];
const isPoint = (point) =>
  Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
function parseElement(text) {
  let element;
  try {
    element = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !element ||
    !annotationSubtypes[element.type] ||
    !coordinateKeys.every((key) => Number.isFinite(element[key])) ||
    !/^#[0-9a-f]{6}$/i.test(element.color)
  )
    return null;
  if (
    (element.type === "text" || element.type === "comment") &&
    typeof element.text !== "string"
  )
    return null;
  if (
    element.type === "draw" &&
    !(element.paths || [element.points]).every(
      (points) => Array.isArray(points) && points.every(isPoint),
    )
  )
    return null;
  if (
    element.type === "highlight" &&
    element.rects &&
    !element.rects.every(
      (rect) =>
        Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite),
    )
  )
    return null;
  return element;
}
function decoded(value) {
  return value?.decodeText ? value.decodeText() : "";
}
function foreignComment(lib, dict, angle) {
  const name = (key) => lib.PDFName.of(key),
    rect = dict.get(name("Rect"))?.asRectangle?.();
  if (!rect) return null;
  const channels = dict
    .get(name("C"))
    ?.asArray?.()
    .map((value) => value.asNumber?.());
  const color =
    channels?.length === 3 && channels.every(Number.isFinite)
      ? `#${channels
          .map((value) =>
            Math.round(Math.min(1, Math.max(0, value)) * 255)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`
      : commentColor;
  const author = decoded(dict.get(name("T"))).trim();
  return {
    type: "comment",
    x: rect.x,
    y: rect.y + rect.height,
    width: 20,
    height: 20,
    angle,
    color,
    opacity: 1,
    text: decoded(dict.get(name("Contents"))),
    done: false,
    date: parsePdfDate(decoded(dict.get(name("M")))),
    ...(author ? { author } : {}),
  };
}
function restoreElements(lib, source) {
  const key = lib.PDFName.of(elementKey),
    name = (value) => lib.PDFName.of(value);
  return source.getPages().map((page) => {
    const annots = page.node.Annots();
    if (!annots?.size()) return [];
    const entries = annots
        .asArray()
        .map((ref) => ({ ref, dict: source.context.lookup(ref) })),
      elements = [],
      owners = new Map(),
      removed = new Set();
    const subtype = (dict) => dict?.get?.(name("Subtype"));
    for (const entry of entries) {
      const value = entry.dict?.get?.(key);
      const element = value?.decodeText && parseElement(value.decodeText());
      if (!element) continue;
      elements.push(element);
      owners.set(entry.ref, element);
      removed.add(entry.ref);
    }
    const angle = normalizeAngle(page.getRotation().angle);
    for (const entry of entries) {
      if (
        removed.has(entry.ref) ||
        subtype(entry.dict) !== name("Text") ||
        entry.dict.get(name("IRT"))
      )
        continue;
      const element = foreignComment(lib, entry.dict, angle);
      if (!element) continue;
      elements.push(element);
      owners.set(entry.ref, element);
      removed.add(entry.ref);
    }
    for (const entry of entries) {
      if (removed.has(entry.ref) || subtype(entry.dict) !== name("Text"))
        continue;
      const parent = owners.get(entry.dict.get(name("IRT")));
      if (parent?.type !== "comment") continue;
      const model = entry.dict.get(name("StateModel"));
      if (model) {
        if (model === name("Review"))
          parent.done = entry.dict.get(name("State")) === name("Completed");
      } else {
        const text = decoded(entry.dict.get(name("Contents"))).trim(),
          author = decoded(entry.dict.get(name("T"))).trim();
        if (text)
          parent.text = [parent.text, author ? `${author}: ${text}` : text]
            .filter(Boolean)
            .join("\n\n");
        owners.set(entry.ref, parent);
      }
      removed.add(entry.ref);
    }
    for (const entry of entries) {
      const popup = entry.dict?.get?.(name("Popup"));
      if (removed.has(entry.ref) && popup) removed.add(popup);
      if (
        subtype(entry.dict) === name("Popup") &&
        removed.has(entry.dict.get(name("Parent")))
      )
        removed.add(entry.ref);
    }
    for (let i = annots.size() - 1; i >= 0; i--)
      if (removed.has(annots.get(i))) annots.remove(i);
    return elements;
  });
}
export async function assemble(payload, progress = () => {}) {
  const lib = await pdfLib();
  const output = await lib.PDFDocument.create();
  const font = await fonts(output, payload.fontBytes);
  const selected = payload.document.pages;
  if (!selected.length || selected.length > limits.pages)
    throw new Error("Bitte 1 bis 500 Seiten auswählen.");
  const assets = new Map(
    (payload.images || []).map((asset) => [asset.id, { ...asset }]),
  );
  const sourceInputs = new Map(
    payload.sources.map((source) => [source.id, source]),
  );
  const groups = new Map();
  for (const page of selected) {
    if (!page.sourceId) continue;
    const key = `${page.sourceId}:${page.formGroup}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(page);
  }
  const outputPages = new Map(),
    annotate = !payload.options?.flatten && !payload.options?.layout;
  let done = 0;
  for (const entries of groups.values()) {
    const input = sourceInputs.get(entries[0].sourceId);
    if (!input) throw new Error("Eine Quelldatei ist nicht mehr verfügbar.");
    const source = await lib.PDFDocument.load(input.data, {
      password: input.password ?? "",
      preserveXFA: true,
      updateMetadata: false,
    });
    adoptOrphanWidgets(lib, source);
    applyValues(lib, source, payload.document.formValues, entries[0].formGroup);
    const copier = lib.PDFObjectCopier.for(source.context, output.context);
    const mappings = [];
    for (const page of entries) {
      const original = source.getPage(page.index);
      const node = original.node.clone();
      node.delete(lib.PDFName.of("Annots"));
      node.delete(lib.PDFName.of("A"));
      node.delete(lib.PDFName.of("AA"));
      const copied = copier.copy(node);
      const ref = output.context.register(copied);
      const target = lib.PDFPage.of(copied, ref, output);
      copier.traversedObjects.set(original.ref, ref);
      outputPages.set(page.id, target);
      mappings.push({ source: original, target });
    }
    const supportedWidgets = new Set(
      source
        .getForm()
        .getFields()
        .filter(
          (field) =>
            field instanceof lib.PDFTextField ||
            field instanceof lib.PDFCheckBox ||
            field instanceof lib.PDFRadioGroup ||
            field instanceof lib.PDFDropdown ||
            field instanceof lib.PDFOptionList,
        )
        .flatMap((field) =>
          field.acroField.getWidgets().map((widget) => widget.dict),
        ),
    );
    for (const { source: original, target } of mappings) {
      for (const ref of original.node.Annots()?.asArray() || []) {
        const dict = source.context.lookup(ref);
        if (supportedWidgets.has(dict)) continue;
        const next = dict.clone();
        if (next.get(lib.PDFName.of("Subtype")) === lib.PDFName.of("Widget")) {
          next.set(lib.PDFName.of("Subtype"), lib.PDFName.of("Stamp"));
          for (const key of ["Parent", "FT", "Kids", "T", "V", "DV"])
            next.delete(lib.PDFName.of(key));
        }
        next.delete(lib.PDFName.of("P"));
        next.delete(lib.PDFName.of("A"));
        next.delete(lib.PDFName.of("AA"));
        target.node.addAnnot(output.context.register(copier.copy(next)));
      }
    }
    transplantForms(
      lib,
      source,
      output,
      mappings,
      entries[0].formGroup === payload.options?.plainGroup
        ? null
        : entries[0].formGroup,
      copier,
      font.regular,
      new Set(
        Object.keys(payload.document.formValues)
          .filter((key) => key.startsWith(`${entries[0].formGroup}:`))
          .map((key) => key.slice(`${entries[0].formGroup}:`.length)),
      ),
    );
  }
  for (const page of selected) {
    let target = outputPages.get(page.id);
    if (!target) target = output.addPage([page.width, page.height]);
    else output.addPage(target);
    target.setRotation(
      lib.degrees(normalizeAngle((page.baseRotation || 0) + page.rotation)),
    );
    await (annotate ? annotateElements : drawElements)(
      lib,
      output,
      target,
      page,
      font,
      assets,
    );
    progress((++done / selected.length) * 0.65);
  }
  if (payload.options?.flatten || payload.options?.layout)
    output.getForm().flatten();
  output.setCreator("PDFHelper");
  output.setProducer("PDFHelper");
  let result = output;
  let copies = null;
  if (payload.options?.layout) {
    await output.flush();
    const normalized = await lib.PDFDocument.create();
    for (const page of output.getPages()) {
      const size = page.getSize(),
        crop = page.getCropBox();
      const rotate = normalizeAngle(page.getRotation().angle);
      const width = rotate % 180 ? crop.height : crop.width,
        height = rotate % 180 ? crop.width : crop.height;
      if (!page.node.Contents()) {
        normalized.addPage([width, height]);
        continue;
      }
      const embedded = await normalized.embedPage(page, {
        left: crop.x,
        bottom: crop.y,
        right: crop.x + crop.width,
        top: crop.y + crop.height,
      });
      const target = normalized.addPage([width, height]);
      const coordinates =
        rotate === 90
          ? [0, height]
          : rotate === 180
            ? [width, height]
            : rotate === 270
              ? [width, 0]
              : [0, 0];
      target.drawPage(embedded, {
        x: coordinates[0],
        y: coordinates[1],
        width: crop.width,
        height: crop.height,
        rotate: lib.degrees(-rotate),
      });
    }
    await normalized.flush();
    const imposed = await impose(
      lib,
      normalized,
      payload.options.layout,
      (value) => progress(0.65 + value * 0.25),
    );
    result = imposed.document;
    copies = imposed.copies;
  }
  const password = payload.options?.password;
  if (password) {
    const ownerPassword = Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      (value) => value.toString(16).padStart(2, "0"),
    ).join("");
    result.encrypt({
      userPassword: password,
      ownerPassword,
      algorithm: "AES-256",
    });
  }
  const data = await result.save({
    useObjectStreams: true,
    updateFieldAppearances: false,
  });
  progress(1);
  return { data, copies };
}
export async function imagePdf(data, mime) {
  const lib = await pdfLib();
  const doc = await lib.PDFDocument.create();
  const image =
    mime === "image/png" ? await doc.embedPng(data) : await doc.embedJpg(data);
  drawImagePage(doc, image);
  return { data: await doc.save() };
}
export function drawImagePage(doc, image) {
  const page = doc.addPage([595.3, 841.9]);
  const factor = Math.min(555.3 / image.width, 801.9 / image.height);
  const width = image.width * factor,
    height = image.height * factor;
  page.drawImage(image, {
    x: (595.3 - width) / 2,
    y: (841.9 - height) / 2,
    width,
    height,
  });
}
