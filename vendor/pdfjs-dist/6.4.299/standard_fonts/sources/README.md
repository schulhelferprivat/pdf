# Liberation Sans 1.07.4: vollständige Quellen

Die vier daneben unter `../` ausgelieferten `LiberationSans-*.ttf` melden Version 1.07.4. Das unveränderte Archiv [liberation-fonts-1.07.4.tar.gz](liberation-fonts-1.07.4.tar.gz) enthält die vollständigen Projektquellen dieser Version einschließlich SFD-Dateien, Buildskripten, Makefile, `COPYING` und `License.txt`.

- Projekt: https://github.com/liberationfonts/liberation-1.7-fonts
- Quellenstand: `1b25642191bb57c05d128f6a20d9567e3079c2b8` mit Schriftversion 1.07.4.
- Unveränderte Downloadadresse: https://codeload.github.com/liberationfonts/liberation-1.7-fonts/tar.gz/1b25642191bb57c05d128f6a20d9567e3079c2b8
- SHA-256: `f948f0979a8dcb8b19e23dc0b57c4cc80b23dd516190009d1639ed389098e2d8`
- Lizenz: GPL Version 2 mit Liberation-Schriftausnahme; siehe auch [LICENSE_LIBERATION](../LICENSE_LIBERATION).

## Aus den Quellen bauen

Voraussetzungen sind GNU Make und FontForge mit Unterstützung für dessen Skriptsprache. Im Verzeichnis dieses Archivs ausführen:

```sh
tar -xzf liberation-fonts-1.07.4.tar.gz
cd liberation-1.7-fonts-1b25642191bb57c05d128f6a20d9567e3079c2b8
make
```

Das mitgelieferte Makefile erzeugt die TTF-Dateien im Unterverzeichnis `liberation-fonts-ttf-1.07.4`. Für die Anwendung werden ausschließlich die vier Sans-Schnitte verwendet. Ein Neubau mit anderen FontForge-Versionen muss nicht bytegleich mit den ausgelieferten TTF-Dateien sein.

Archiv, Lizenztexte und Schriftdateien werden im selben Projekt und im Offlineinventar bereitgestellt. Bei einer Veröffentlichung oder Weitergabe der Schriftdateien sind diese Quellen und Lizenzhinweise mit bereitzustellen. Die Schriften wurden für PDFHelper nicht verändert.
