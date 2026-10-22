# Drittanbieter und Lizenzen

Die Anwendung bindet alle Ressourcen lokal ein. Die lokale Sicherheitsanpassung an UTIF.js ist unten beschrieben; Lizenztexte stehen in den jeweiligen Verzeichnissen. Prüfsummen sämtlicher ausgelieferter Bibliotheksdateien stehen in `vendor-manifest.json`.

| Paket | Version | Lizenz | Quelle |
| --- | --- | --- | --- |
| @cantoo/pdf-lib | 2.11.1 | MIT | https://github.com/cantoo-scribe/pdf-lib |
| pdfjs-dist | 6.4.299 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| @cantoo/fontkit | 2.0.12 | MIT | https://github.com/cantoo-scribe/fontkit |
| Lucide (move-horizontal und scan) | 0.468.0 | ISC | https://github.com/lucide-icons/lucide |
| JSZip | 3.10.2 | MIT oder GPL-3.0-or-later; hier unter MIT verwendet | https://github.com/Stuk/jszip |
| UTIF.js | 3.1.0 | MIT | https://github.com/photopea/UTIF.js |
| pako | 3.0.2 | MIT und Zlib | https://github.com/nodeca/pako |
| epub.js | 0.3.93 | BSD-2-Clause | https://github.com/futurepress/epub.js |
| Noto Sans Regular/Bold | Repository-Artefakte, durch SHA-256 festgelegt | SIL Open Font License 1.1 | https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans |
| QuickJS in PDF.js | Commit `3d5e064e9dd67c70f7962836505a7fa067bf0a4e` | MIT | https://github.com/bellard/quickjs/tree/3d5e064e9dd67c70f7962836505a7fa067bf0a4e |
| QuickJS-Wrapper für PDF.js | Mit PDF.js 6.4.299 ausgelieferter Build | MIT | https://github.com/mozilla/pdf.js.quickjs |
| Liberation Sans in PDF.js | 1.07.4 | GPL-2.0 mit Liberation-Schriftausnahme | https://github.com/liberationfonts/liberation-1.7-fonts/tree/1b25642191bb57c05d128f6a20d9567e3079c2b8 |

PDF.js enthält zusätzliche Schrift-, CMap-, Farbprofil- und Decoderressourcen mit ihren mitgelieferten Lizenzhinweisen. Fontkit wird aus dem offiziellen Paket `@cantoo/fontkit@2.0.12`, Datei `dist/fontkit.umd.min.js`, erzeugt; die einzige Ergänzung ist der ES-Modul-Export `export default fontkit;`. Die Ursprungspakete von PDF.js und Fontkit wurden beim Einbinden gegen die SHA-512-Integrität der npm-Metadaten geprüft. Die vorhandenen PDF.js-Hauptdateien stimmen bytegenau mit dem offiziellen Paket überein.

Noto Sans wird aus dem oben verlinkten Repository eingebunden; Lizenztext und Schriften stehen unter `assets`. Die Symbole move-horizontal und scan stammen aus Lucide; der Lizenztext liegt unter `assets/lucide-LICENSE.txt`. Die weiteren Symbole und das App-Icon wurden für PDFHelper erstellt.

UTIF.js, pako und epub.js stammen aus den offiziellen npm-Paketen. Die ursprünglichen Archive wurden gegen die SHA-512-Integrität der npm-Metadaten geprüft. pako und epub.js werden unverändert eingebunden. UTIF.js 3.1.0 enthält eine lokale Sicherheitsanpassung: Deflate-Daten werden blockweise direkt in den Zielpuffer geschrieben und auf die erwartete Strip- beziehungsweise Tile-Größe begrenzt. Überlange, unvollständige oder beschädigte Streams werden abgelehnt; der Kurzschluss für unkomprimierte Daten gilt nicht für Deflate. Tile-Puffer berücksichtigen die Byte-Ausrichtung jeder Bildzeile. EPUB.js verwendet das bereits eingebundene JSZip. EPUB.js enthält weitere Abhängigkeiten, deren mitgelieferte Lizenzhinweise zusätzlich unter `vendor/epubjs` stehen.

## QuickJS

Die Dateien `vendor/pdfjs-dist/6.4.299/wasm/quickjs-eval.js` und `quickjs-eval.wasm` enthalten QuickJS und den PDF.js-Wrapper. Die unveränderten MIT-Lizenztexte stehen daneben in [LICENSE_QUICKJS](vendor/pdfjs-dist/6.4.299/wasm/LICENSE_QUICKJS) und [LICENSE_PDFJS_QUICKJS](vendor/pdfjs-dist/6.4.299/wasm/LICENSE_PDFJS_QUICKJS). Herkunft und Version sind in [README_LICENSING.md](vendor/pdfjs-dist/6.4.299/README_LICENSING.md) dokumentiert.

## Liberation-Schriftquellen

Die vier `LiberationSans-*.ttf` unter `vendor/pdfjs-dist/6.4.299/standard_fonts` sind Version 1.07.4. Für diese Version gilt GPLv2 mit Liberation-Schriftausnahme, nicht die OFL späterer Versionen. Der vollständige Lizenztext einschließlich Ausnahme liegt in [LICENSE_LIBERATION](vendor/pdfjs-dist/6.4.299/standard_fonts/LICENSE_LIBERATION).

Das vollständige, unveränderte [Quellarchiv für Version 1.07.4](vendor/pdfjs-dist/6.4.299/standard_fonts/sources/liberation-fonts-1.07.4.tar.gz) wird gemeinsam mit den Schriftdateien ausgeliefert. Es enthält die bearbeitbaren SFD-Dateien, Buildskripte, das Makefile sowie `COPYING` und `License.txt`. [Herkunft, Prüfsumme und Bauanleitung](vendor/pdfjs-dist/6.4.299/standard_fonts/sources/README.md) liegen daneben. Das Archiv und die Lizenzhinweise gehören zum Offlineinventar und müssen bei einer Weitergabe der Schriftdateien mit bereitgestellt werden.

Diese Drittanbieter-Lizenzen gelten jeweils für die zugehörigen Komponenten. Eine eigene Lizenz für den Anwendungscode wird hierdurch nicht erteilt. Vorhandene Urheber-, Lizenz- und Haftungshinweise sind bei der Weitergabe zu erhalten.
