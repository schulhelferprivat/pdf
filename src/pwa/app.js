import { setHidden } from "../ui/motion.js";

export function setupPwa({ hasWork, hasChanges, confirm, message, actions }) {
  let installPrompt = null,
    registration = null,
    allowUpdate = false,
    reloadAuthorized = false;
  const $ = (id) => document.getElementById(id);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    $("install-button").hidden = false;
  });
  actions.install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $("install-button").hidden = true;
  };
  window.addEventListener(
    "appinstalled",
    () => ($("install-button").hidden = true),
  );
  actions["update-later"] = () => setHidden($("update-banner"), true);
  actions["update-now"] = async () => {
    if (!registration?.waiting) {
      await registration?.update();
      return;
    }
    if (
      hasWork() &&
      !(await confirm(
        "PDFHelper aktualisieren?",
        hasChanges()
          ? "Nicht exportierte Änderungen gehen beim Neuladen verloren. Bitte exportiere sie zuerst oder bestätige das Verwerfen."
          : "Die geöffneten Dokumente werden beim Aktualisieren geschlossen.",
      ))
    )
      return;
    allowUpdate = true;
    registration.active?.postMessage({ type: "REQUEST_UPDATE" });
  };
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data;
    if (data?.type === "UPDATE_QUERY")
      event.ports[0]?.postMessage({ ready: allowUpdate || !hasWork() });
    if (data?.type === "UPDATE_APPROVED") {
      reloadAuthorized = true;
      window.dispatchEvent(new Event("pdfhelper-update"));
      document.querySelector(".app-shell").inert = true;
    }
    if (data?.type === "UPDATE_BLOCKED") {
      allowUpdate = false;
      message(
        "Ein anderes PDFHelper-Fenster hat noch Dokumente geöffnet. Bitte diese zuerst schließen.",
      );
    }
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadAuthorized) {
      location.reload();
      return;
    }
  });
  navigator.serviceWorker
    .register(new URL("../../sw.js", import.meta.url), {
      scope: new URL("../../", import.meta.url).pathname,
      updateViaCache: "none",
    })
    .then((value) => {
      registration = value;
      const announce = () => {
        if (registration.waiting && navigator.serviceWorker.controller)
          setHidden($("update-banner"), false);
      };
      announce();
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") {
            announce();
          }
        });
      });
      let checked = Date.now();
      window.addEventListener("focus", () => {
        if (navigator.onLine && Date.now() - checked > 60000) {
          checked = Date.now();
          void registration.update().catch(() => {});
        }
      });
    })
    .catch(() => {
      message(
        "Die App konnte nicht vollständig zwischengespeichert werden. Bitte bei bestehender Verbindung neu laden.",
        true,
      );
    });
}
