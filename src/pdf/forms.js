export function inspectFields(lib, document) {
  const form = document.getForm();
  const fields = form.getFields();
  return document.getPages().map((page) => {
    const annotations = page.node.Annots()?.asArray() || [];
    return fields.flatMap((field) => {
      const type =
        field instanceof lib.PDFTextField
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
      let value;
      try {
        value =
          type === "text"
            ? field.getText() || ""
            : type === "checkbox"
              ? field.isChecked()
              : type === "radio"
                ? field.getSelected() || ""
                : type === "select" || type === "list"
                  ? field.getSelected()
                  : "";
      } catch {
        value = "";
      }
      const allWidgets = field.acroField.getWidgets();
      return allWidgets
        .filter(
          (widget) =>
            widget.P() === page.ref ||
            annotations.some(
              (ref) => document.context.lookup(ref) === widget.dict,
            ),
        )
        .map((widget) => {
          const { x, y, width, height } = widget.getRectangle();
          const rawOn = widget.getOnValue?.()?.decodeText?.() || "";
          const on =
            type === "radio"
              ? (field.getOptions()[
                  allWidgets.findIndex((entry) => entry.dict === widget.dict)
                ] ?? rawOn)
              : rawOn;
          return {
            name: field.getName(),
            type,
            rect: [x, y, x + width, y + height],
            value,
            on,
            options: field.getOptions?.() || [],
            readonly: field.isReadOnly(),
            required: field.isRequired(),
            multiline: field.isMultiline?.() || false,
            maxLength: field.getMaxLength?.() || null,
            multiSelect: field.isMultiselect?.() || false,
          };
        });
    });
  });
}
export function applyValues(lib, source, values, group) {
  const form = source.getForm();
  for (const field of form.getFields()) {
    const key = `${group}:${field.getName()}`;
    if (!(key in values)) continue;
    const value = values[key];
    if (field instanceof lib.PDFTextField) field.setText(String(value ?? ""));
    else if (field instanceof lib.PDFCheckBox)
      value ? field.check() : field.uncheck();
    else if (field instanceof lib.PDFRadioGroup)
      value ? field.select(value) : field.clear();
    else if (
      field instanceof lib.PDFDropdown ||
      field instanceof lib.PDFOptionList
    )
      value?.length ? field.select(value) : field.clear();
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
) {
  const name = lib.PDFName.of;
  const outForm = output.getForm();
  const targetFields = outForm.acroForm;
  for (const field of source.getForm().getFields()) {
    if (
      !(
        field instanceof lib.PDFTextField ||
        field instanceof lib.PDFCheckBox ||
        field instanceof lib.PDFRadioGroup ||
        field instanceof lib.PDFDropdown ||
        field instanceof lib.PDFOptionList
      )
    )
      continue;
    const widgets = [];
    for (const widget of field.acroField.getWidgets()) {
      for (const mapping of mappings) {
        const annots = mapping.source.node.Annots()?.asArray() || [];
        if (
          widget.P() === mapping.source.ref ||
          annots.some((ref) => source.context.lookup(ref) === widget.dict)
        )
          widgets.push({ widget, page: mapping.target });
      }
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
  }
  for (const field of outForm.getFields()) {
    outForm.markFieldAsDirty(field.ref);
  }
  outForm.updateFieldAppearances(font);
}
