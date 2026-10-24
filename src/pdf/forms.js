function fieldType(lib, field) {
  return field instanceof lib.PDFTextField
    ? "text"
    : field instanceof lib.PDFCheckBox
      ? "checkbox"
      : field instanceof lib.PDFRadioGroup
        ? "radio"
        : field instanceof lib.PDFDropdown
          ? "select"
          : field instanceof lib.PDFOptionList
            ? "list"
            : "unsupported";
}
function widgetOwner(document) {
  const owners = new Map();
  for (const page of document.getPages())
    for (const ref of page.node.Annots()?.asArray() || []) {
      const dict = document.context.lookup(ref);
      if (!owners.has(dict)) owners.set(dict, page.ref);
    }
  return (widget) => owners.get(widget.dict) ?? widget.P();
}
function checkboxState(lib, field) {
  const off = lib.PDFName.of("Off");
  const value = field.acroField.dict.context.lookup(
    field.acroField.getInheritableAttribute(lib.PDFName.of("V")),
  );
  const state =
    value instanceof lib.PDFName
      ? value
      : field.acroField
          .getWidgets()
          .map((widget) => widget.getAppearanceState())
          .find((entry) => entry && entry !== off);
  return state && state !== off ? state.decodeText() : "";
}
function hidden(widget) {
  return (widget.getFlags() & 34) !== 0;
}
function hexColor(components) {
  if (!components?.length) return null;
  const rgb =
    components.length === 1
      ? [components[0], components[0], components[0]]
      : components.length === 3
        ? components
        : components.length === 4
          ? [0, 1, 2].map((i) => (1 - components[i]) * (1 - components[3]))
          : null;
  return rgb
    ? `#${rgb
        .map((value) =>
          Math.round(Math.min(1, Math.max(0, value)) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`
    : null;
}
function appearanceText(lib, document, field, widget) {
  const name = lib.PDFName.of("DA");
  for (const value of [
    widget.dict.lookup(name),
    field.acroField.dict.context.lookup(
      field.acroField.getInheritableAttribute(name),
    ),
    document.catalog.getAcroForm()?.dict.lookup(name),
  ])
    if (value instanceof lib.PDFString || value instanceof lib.PDFHexString)
      return value.decodeText();
  return "";
}
function textStyle(appearance) {
  const size = Number(appearance.match(/([\d.]+)\s+Tf\b/)?.[1]) || null;
  const color = appearance.match(
    /((?:[\d.]+\s+){4})k\b|((?:[\d.]+\s+){3})rg\b|([\d.]+\s+)g\b/,
  );
  return {
    fontSize: size,
    color: color
      ? hexColor(
          (color[1] || color[2] || color[3]).trim().split(/\s+/).map(Number),
        )
      : null,
  };
}
function alignment(lib, field, widget) {
  const name = lib.PDFName.of("Q");
  const value =
    widget.dict.lookup(name) ??
    field.acroField.dict.context.lookup(
      field.acroField.getInheritableAttribute(name),
    );
  return ["left", "center", "right"][value?.asNumber?.()] || "left";
}
function tabOrder(lib, page) {
  const order = new Map(
    (page.node.Annots()?.asArray() || []).map((ref, i) => [
      page.doc.context.lookup(ref),
      i,
    ]),
  );
  const tabs = page.node.lookup(lib.PDFName.of("Tabs"));
  const top = (widget) => widget.rect[3],
    left = (widget) => widget.rect[0];
  return (a, b) => {
    if (tabs === lib.PDFName.of("R") && Math.abs(top(a) - top(b)) > 2)
      return top(b) - top(a);
    if (tabs === lib.PDFName.of("R") && left(a) !== left(b))
      return left(a) - left(b);
    if (tabs === lib.PDFName.of("C") && Math.abs(left(a) - left(b)) > 2)
      return left(a) - left(b);
    if (tabs === lib.PDFName.of("C") && top(a) !== top(b))
      return top(b) - top(a);
    return (order.get(a.dict) ?? Infinity) - (order.get(b.dict) ?? Infinity);
  };
}
export function adoptOrphanWidgets(lib, document) {
  const name = lib.PDFName.of,
    context = document.context;
  const known = new Set();
  const visit = (ref) => {
    const dict = context.lookup(ref);
    if (!(dict instanceof lib.PDFDict) || known.has(dict)) return;
    known.add(dict);
    for (const kid of dict.lookup(name("Kids"))?.asArray?.() || []) visit(kid);
  };
  for (const ref of document.catalog
    .getAcroForm()
    ?.dict.lookup(name("Fields"))
    ?.asArray?.() || [])
    visit(ref);
  for (const page of document.getPages())
    for (const ref of page.node.Annots()?.asArray() || []) {
      let dict = context.lookup(ref),
        root = ref,
        typed = false;
      if (
        !(dict instanceof lib.PDFDict) ||
        dict.get(name("Subtype")) !== name("Widget") ||
        known.has(dict)
      )
        continue;
      for (const seen = new Set(); dict && !seen.has(dict); ) {
        seen.add(dict);
        typed ||= dict.has(name("FT"));
        const parent = dict.get(name("Parent"));
        if (!parent) break;
        root = parent;
        dict = context.lookup(parent);
      }
      if (
        !typed ||
        !(root instanceof lib.PDFRef) ||
        !(dict instanceof lib.PDFDict) ||
        !dict.has(name("T")) ||
        known.has(dict)
      )
        continue;
      const acroForm = document.catalog.getOrCreateAcroForm();
      acroForm.addField(root);
      visit(root);
    }
}
export function inspectFields(lib, document) {
  const fields = document.getForm().getFields();
  const owner = widgetOwner(document);
  return document.getPages().map((page) => {
    const widgets = fields.flatMap((field) => {
      const type = fieldType(lib, field);
      let value;
      try {
        value =
          type === "text"
            ? field.getText() || ""
            : type === "checkbox"
              ? checkboxState(lib, field)
              : type === "radio"
                ? field.getSelected() || ""
                : type === "select" || type === "list"
                  ? field.getSelected()
                  : "";
      } catch {
        value = "";
      }
      const choices =
        type === "select" || type === "list"
          ? field.acroField.getOptions()
          : [];
      const options = choices.length
        ? choices.map((option) => option.value.decodeText())
        : field.getOptions?.() || [];
      const labels = choices.map((option) =>
        (option.display ?? option.value).decodeText(),
      );
      const allWidgets = field.acroField.getWidgets();
      return allWidgets
        .filter((widget) => owner(widget) === page.ref && !hidden(widget))
        .map((widget) => {
          const { x, y, width, height } = widget.getRectangle();
          const rawOn = widget.getOnValue?.()?.decodeText?.() || "";
          const on =
            type === "radio"
              ? (field.getOptions()[
                  allWidgets.findIndex((entry) => entry.dict === widget.dict)
                ] ?? rawOn)
              : type === "checkbox"
                ? rawOn || value || "Yes"
                : rawOn;
          const characteristics = widget.getAppearanceCharacteristics();
          return {
            dict: widget.dict,
            name: field.getName(),
            type,
            rect: [x, y, x + width, y + height],
            value,
            on,
            options,
            labels,
            readonly: field.isReadOnly(),
            required: field.isRequired(),
            multiline: field.isMultiline?.() || false,
            maxLength: field.getMaxLength?.() || null,
            multiSelect: field.isMultiselect?.() || false,
            comb: (type === "text" && field.isCombed()) || false,
            password: field.isPassword?.() || false,
            spellcheck: field.isSpellChecked?.() ?? true,
            editable: (type === "select" && field.isEditable()) || false,
            toggleOff: (type === "radio" && field.isOffToggleable()) || false,
            align: alignment(lib, field, widget),
            ...textStyle(appearanceText(lib, document, field, widget)),
            background: hexColor(characteristics?.getBackgroundColor()),
            border: hexColor(characteristics?.getBorderColor()),
          };
        });
    });
    return widgets.sort(tabOrder(lib, page)).map(({ dict, ...widget }) => widget);
  });
}
function setCheckbox(lib, field, value) {
  const name = lib.PDFName.of;
  const widgets = field.acroField.getWidgets();
  const state = value ? name(String(value)) : name("Off");
  field.acroField.dict.set(name("V"), state);
  for (const widget of widgets)
    widget.setAppearanceState(
      (widget.getOnValue() ?? state) === state ? state : name("Off"),
    );
}
function setChoice(lib, field, value) {
  const name = lib.PDFName.of;
  const acroField = field.acroField;
  const selected = [value].flat().map(String);
  const values = selected.map((entry) => lib.PDFHexString.fromText(entry));
  acroField.dict.set(
    name("V"),
    values.length === 1 ? values[0] : acroField.dict.context.obj(values),
  );
  const options = acroField
    .getOptions()
    .map((option) => option.value.decodeText());
  const indices = selected
    .map((entry) => options.indexOf(entry))
    .sort((a, b) => a - b);
  if (values.length > 1 && !indices.includes(-1))
    acroField.dict.set(name("I"), acroField.dict.context.obj(indices));
  else acroField.dict.delete(name("I"));
}
export function applyValues(lib, source, values, group) {
  const form = source.getForm();
  for (const field of form.getFields()) {
    const key = `${group}:${field.getName()}`;
    if (!(key in values)) continue;
    const value = values[key];
    if (field instanceof lib.PDFTextField) field.setText(String(value ?? ""));
    else if (field instanceof lib.PDFCheckBox) {
      setCheckbox(lib, field, value);
      form.markFieldAsDirty(field.ref);
    } else if (field instanceof lib.PDFRadioGroup)
      value ? field.select(value) : field.clear();
    else if (
      field instanceof lib.PDFDropdown ||
      field instanceof lib.PDFOptionList
    ) {
      if (value?.length) {
        setChoice(lib, field, value);
        form.markFieldAsDirty(field.ref);
      } else field.clear();
    }
  }
}
function labelChoiceAppearances(lib, fields, font) {
  const name = lib.PDFName.of;
  for (const field of fields) {
    if (
      !(field instanceof lib.PDFDropdown || field instanceof lib.PDFOptionList)
    )
      continue;
    const acroField = field.acroField;
    const options = acroField.getOptions();
    const current = acroField.dict.get(name("V"));
    const values = acroField.getValues();
    const labels = values.map(
      (value) =>
        options.find(
          (option) => option.value.decodeText() === value.decodeText(),
        )?.display ?? value,
    );
    if (labels.every((label, i) => label.decodeText() === values[i].decodeText()))
      continue;
    acroField.dict.set(
      name("V"),
      labels.length === 1 ? labels[0] : acroField.dict.context.obj(labels),
    );
    field.updateAppearances(font);
    acroField.dict.set(name("V"), current);
  }
}
export function transplantForms(
  lib,
  source,
  output,
  mappings,
  namespace,
  copier,
  font,
  changed = new Set(),
) {
  const name = lib.PDFName.of;
  const outForm = output.getForm();
  const targetFields = outForm.acroForm;
  const owner = widgetOwner(source);
  const sourceForm = source.catalog.getAcroForm()?.dict;
  const defaultAppearance = sourceForm?.get(name("DA"));
  mergeResources(lib, sourceForm, targetFields.dict, output, copier);
  const touched = [];
  for (const field of source.getForm().getFields()) {
    if (fieldType(lib, field) === "unsupported") continue;
    const widgets = [];
    for (const widget of field.acroField.getWidgets()) {
      const page = owner(widget);
      for (const mapping of mappings)
        if (page === mapping.source.ref)
          widgets.push({ widget, page: mapping.target });
    }
    if (!widgets.length) continue;
    const dict = field.acroField.dict.clone();
    dict.delete(name("Parent"));
    dict.delete(name("Kids"));
    dict.delete(name("A"));
    dict.delete(name("AA"));
    if (dict.get(name("Subtype")) === name("Widget")) {
      for (const key of [
        "Subtype",
        "Rect",
        "P",
        "AP",
        "AS",
        "MK",
        "BS",
        "Border",
        "F",
      ])
        dict.delete(name(key));
    }
    for (const key of ["FT", "Ff", "DA", "Q", "MaxLen", "Opt", "V", "DV"]) {
      const value = field.acroField.getInheritableAttribute?.(name(key));
      if (value && !dict.has(name(key))) dict.set(name(key), value);
    }
    if (!dict.has(name("DA")) && defaultAppearance)
      dict.set(name("DA"), defaultAppearance);
    dict.set(
      name("T"),
      lib.PDFHexString.fromText(
        namespace ? `${namespace}.${field.getName()}` : field.getName(),
      ),
    );
    const copied = copier.copy(dict);
    const ref = output.context.register(copied);
    const kids = output.context.obj([]);
    copied.set(name("Kids"), kids);
    for (const { widget, page } of widgets) {
      const widgetDict = widget.dict.clone();
      for (const key of ["Parent", "P", "T", "FT", "V", "DV", "Kids", "A", "AA"])
        widgetDict.delete(name(key));
      widgetDict.set(name("Subtype"), name("Widget"));
      const next = copier.copy(widgetDict);
      next.set(name("Parent"), ref);
      next.set(name("P"), page.ref);
      const widgetRef = output.context.register(next);
      kids.push(widgetRef);
      page.node.addAnnot(widgetRef);
    }
    targetFields.addField(ref);
    touched.push({ ref, name: field.getName() });
  }
  const created = new Map(outForm.getFields().map((field) => [field.ref, field]));
  const fields = touched
    .map(({ ref, name: fieldName }) => {
      if (changed.has(fieldName)) outForm.markFieldAsDirty(ref);
      return created.get(ref);
    })
    .filter((field) => field?.needsAppearancesUpdate());
  for (const field of fields) field.defaultUpdateAppearances(font);
  labelChoiceAppearances(lib, fields, font);
}
function mergeResources(lib, source, target, output, copier) {
  const name = lib.PDFName.of;
  const resources = source?.lookup(name("DR"));
  if (!(resources instanceof lib.PDFDict)) return;
  let merged = target.lookup(name("DR"));
  if (!(merged instanceof lib.PDFDict)) {
    merged = output.context.obj({});
    target.set(name("DR"), merged);
  }
  for (const [key, value] of resources.entries()) {
    const group = resources.lookup(key);
    if (!(group instanceof lib.PDFDict)) {
      if (!merged.has(key)) merged.set(key, copier.copy(value));
      continue;
    }
    let into = merged.lookup(key);
    if (!(into instanceof lib.PDFDict)) {
      into = output.context.obj({});
      merged.set(key, into);
    }
    for (const [entry, item] of group.entries())
      if (!into.has(entry)) into.set(entry, copier.copy(item));
  }
}
