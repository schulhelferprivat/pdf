# Lizenzhinweise zu den PDF.js-Ressourcen

PDF.js selbst steht unter Apache License 2.0; der Text liegt in `LICENSE`. Mitgelieferte Komponenten behalten ihre eigenen Lizenzen. Die Bibliotheksdateien werden unverändert verwendet; ergänzt wurden diese Dokumentation, die QuickJS-Lizenztexte und das Liberation-Quellarchiv.

## QuickJS

`wasm/quickjs-eval.js` und `wasm/quickjs-eval.wasm` stammen aus PDF.js 6.4.299. Der PDF.js-Commit [7a7e4fd382481a76f55c6d735873f635c9178db1](https://github.com/mozilla/pdf.js/commit/7a7e4fd382481a76f55c6d735873f635c9178db1) dokumentiert den Wechsel auf QuickJS-Commit `3d5e064e9dd67c70f7962836505a7fa067bf0a4e`.

Die [versionsbezogene PDF.js-Dokumentation](https://github.com/mozilla/pdf.js/blob/v6.4.299/external/quickjs/README.md) nennt MIT als Lizenz für QuickJS und den Wrapper.

- `wasm/LICENSE_QUICKJS`: unverändert aus [QuickJS an diesem Commit](https://github.com/bellard/quickjs/blob/3d5e064e9dd67c70f7962836505a7fa067bf0a4e/LICENSE).
- `wasm/LICENSE_PDFJS_QUICKJS`: unverändert aus dem [Commit zur Ergänzung der MIT-Lizenz des Wrappers](https://github.com/mozilla/pdf.js.quickjs/blob/e2c5bfc8194b16f5973eea5e4e025b67be3c1015/LICENSE).

## Weitere Ressourcen

- `standard_fonts/LiberationSans-*.ttf`: GPLv2 mit Liberation-Schriftausnahme; siehe `standard_fonts/LICENSE_LIBERATION` und [beigefügte Quellen](standard_fonts/sources/README.md).
- `standard_fonts/Foxit*.pfb`: BSD-Lizenz gemäß `standard_fonts/LICENSE_FOXIT`.
- `cmaps`: Lizenztext in `cmaps/LICENSE`.
- `iccs`: CC0 gemäß `iccs/LICENSE`.
- OpenJPEG, JBIG2 und QCMS: jeweilige Lizenztexte `wasm/LICENSE_OPENJPEG`, `wasm/LICENSE_JBIG2`, `wasm/LICENSE_QCMS` sowie die zugehörigen `LICENSE_PDFJS_*`.

Die übergeordnete [Lizenzübersicht](../../../THIRD_PARTY_NOTICES.md) und `vendor-manifest.json` im Projektverzeichnis dokumentieren die Einbindung. Die Prüfsummen umfassen auch die ergänzten Lizenzdateien und das Quellarchiv.
