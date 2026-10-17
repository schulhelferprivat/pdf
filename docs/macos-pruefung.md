# macOS-Kompatibilitätsprüfung

Stand: 17. Oktober 2026. Die automatisierten Prüfungen liefen unter Linux mit Chrome und Playwright 1.64.1 / WebKit 27.2. Ein echter Mac und Safari waren nicht verfügbar. WebKit prüft das Browserverhalten, bestätigt aber keine macOS-Systemintegration.

## Ergebnis

Die geprüften Funktionen laufen in WebKit einschließlich Offlinebetrieb unter dem Unterpfad `/PDFHelper/`. Dabei wurde ein Darstellungsfehler bei EPUBs behoben: Die Sicherheitsrichtlinie der Hauptseite blockierte lokale Blob-Stylesheets der Bücher. `style-src` erlaubt diese nun ausdrücklich; die eigene EPUB-Richtlinie sperrt weiterhin Skripte und externe Ressourcen. Der vorhandene EPUB-Browsertest prüft zusätzlich, ob die Buchformatierung online und nach einem Offline-Neustart tatsächlich angewendet wird.

| Prüfung in WebKit | Ergebnis |
| --- | --- |
| Appstart, Service Worker und Unterpfad | Erfolgreich |
| PDF öffnen, Seiten rendern, Formular ausfüllen und drehen | Erfolgreich |
| ⌘ Z und ⌘ Umschalt Z | Erfolgreich |
| ⌘ F und Volltextsuche | Erfolgreich |
| ⌘ S mit Exportdialog und echtem PDF-Download | Erfolgreich; Seiten, Drehung und Formularwert im Export geprüft |
| ⌘ O mit normaler Dateiauswahl | Erfolgreich |
| Mehrseitiges TIFF im Worker und SVG-Import | Erfolgreich |
| EPUB-Kapitel, Buchformatierung und Navigation | Erfolgreich |
| EPUB-Skripte gesperrt | Erfolgreich |
| Offline-Neustart und erneutes Öffnen von PDF und formatiertem EPUB | Erfolgreich |
| Unbehandelte JavaScript-Ausnahmen im Funktionstest | Keine |

Die reguläre Testsuite prüft zusätzlich die übrigen Funktionen in Chrome. `npm run check` prüft Syntax, Modulimporte, Bibliotheksprüfsummen und das Offlineinventar. Der gezielte WebKit-Lauf verwendete synthetische Dokumente und einen temporär unter `/tmp` eingerichteten Testbrowser; Playwright wurde nicht als Projektabhängigkeit hinzugefügt.

## Browserunterschiede auf dem Mac

Safari bietet ab macOS Sonoma 14 die Installation über „Ablage → Zum Dock hinzufügen“ an. Der fehlende Installationsbutton innerhalb der App verhindert diesen Weg nicht. [Apple: Web-Apps aus Safari auf dem Mac verwenden](https://support.apple.com/de-de/104996), [WebKit: Safari 17.0](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/).

Safari verwendet den normalen Dateiimport und PDF-Downloads. Direktes Schreiben in eine gewählte Ursprungsdatei und die Dateistart-Integration setzen die entsprechenden Chromium-APIs voraus; dafür Chrome oder Edge verwenden. Die vorhandene macOS-Anleitung zum Festlegen als Standard-PDF-App bezieht sich auf diese Installation. [Chrome: File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [Chrome: File Handling](https://developer.chrome.com/docs/capabilities/web-apis/file-handling).

## Noch auf einem echten Mac prüfen

1. In Safari über „Zum Dock hinzufügen“ installieren, die installierte App online öffnen, schließen und aus dem Dock erneut starten.
2. Dateien aus dem Finder ziehen und über ⌘ O öffnen; ⌘ S und ⌘ Umschalt S einschließlich Dateiname, Speicherziel und erneutem Öffnen des Downloads prüfen.
3. Druckdialog öffnen, drucken und abbrechen; anschließend weiterarbeiten. Vollbild, Trackpad-Zoom und Mehrfachauswahl mit ⌘ prüfen.
4. Die installierte App nach vollständigem Laden ohne Netzwerk neu starten und neue PDF-, Bild- und EPUB-Dateien öffnen.
5. Bei nicht gespeicherten Änderungen das Schließen abbrechen und die Weiterarbeit prüfen. Ein Update mit einem zweiten geöffneten Dokumentfenster ausprobieren.
6. Bei Installation in Chrome oder Edge Finder-Dateizuordnung, Doppelklickstart und Schreiben in eine Ursprungsdatei einschließlich Berechtigungsdialog testen.
