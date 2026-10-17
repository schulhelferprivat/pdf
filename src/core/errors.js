export function describeError(error) {
  const text = String(error?.message || "");
  if (error?.name === "AbortError") return "Vorgang abgebrochen.";
  if (/password|encrypted/i.test(text))
    return "Die PDF ist passwortgeschützt oder das Passwort ist nicht korrekt.";
  if (/font|glyph|WinAnsi|code point|character/i.test(text))
    return "Ein verwendetes Zeichen oder eine Schrift konnte nicht verarbeitet werden. Bitte den eingefügten Text prüfen.";
  if (
    /[äöüß]/i.test(text) ||
    /^(Bitte|Die |Das |Der |Eine |Erlaubt|Maximal|Ungültig)/.test(text)
  )
    return text;
  return "Die Datei konnte nicht verarbeitet werden. Sie ist möglicherweise beschädigt oder enthält nicht unterstützte Inhalte.";
}
const renameReasons = {
  NotAllowedError:
    "Der Browser erlaubt das Umbenennen nicht. Bitte die Schreibberechtigung und den Zugriff auf den zugehörigen Ordner prüfen.",
  NoModificationAllowedError:
    "Sie ist gesperrt, vermutlich weil sie in einem anderen Programm geöffnet ist. Bitte dort schließen und erneut versuchen.",
  InvalidModificationError:
    "Im selben Ordner existiert vermutlich bereits eine Datei mit diesem Namen.",
  NotFoundError:
    "Sie wurde außerhalb von PDFHelper verschoben oder gelöscht.",
  InvalidStateError:
    "Sie wurde außerhalb von PDFHelper verändert. Bitte die Datei neu öffnen.",
  SecurityError: "Der Browser erlaubt in diesem Ordner keine Änderungen.",
  TypeError: "Der Browser lehnt den neuen Namen ab.",
};
export function describeRenameError(error, { writeGranted = false } = {}) {
  const name = error?.name || "Error";
  const reason = name === "NotAllowedError" && writeGranted
    ? "Die Schreibberechtigung ist erteilt, aber der Browser erlaubt das Umbenennen in diesem Ordner nicht. Bitte den zugehörigen Ordner freigeben oder die Datei im Dateimanager umbenennen."
    : Object.hasOwn(renameReasons, name)
    ? renameReasons[name]
    : `Der Browser meldet: ${error?.message || "unbekannter Fehler"}`;
  return `Die Datei konnte nicht umbenannt werden. ${reason} (${name})`;
}
