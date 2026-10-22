import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const registry = "https://registry.npmjs.org/";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;

export async function readManifest({ staged = false, cwd = process.cwd() } = {}) {
  const source = staged
    ? execFileSync("git", ["show", ":vendor-manifest.json"], { cwd, encoding: "utf8", maxBuffer: 8 * 1024 ** 2, stdio: ["ignore", "pipe", "pipe"] })
    : await readFile(new URL("vendor-manifest.json", pathToFileURL(`${cwd}/`)), "utf8");
  const manifest = JSON.parse(source);
  if (!Array.isArray(manifest.packages) || !manifest.packages.length)
    throw new Error("Das Bibliotheksinventar enthält keine Pakete.");
  const names = new Set();
  for (const pkg of manifest.packages) {
    if (!pkg || typeof pkg.name !== "string" || typeof pkg.version !== "string" || typeof pkg.source !== "string" || names.has(pkg.name))
      throw new Error("Das Bibliotheksinventar enthält ungültige oder doppelte Einträge.");
    names.add(pkg.name);
  }
  return manifest;
}

export async function checkDependencies(manifest, { fetchLatest = globalThis.fetch, timeoutMs = 10000 } = {}) {
  return Promise.all(manifest.packages.map(async (pkg) => {
    const result = { name: pkg.name, current: pkg.version };
    if (!pkg.source.startsWith(registry))
      return { ...result, status: "manual", message: "Kein npm-Paket; Versionsstand manuell prüfen." };
    if (!packageName.test(pkg.name) || !stableVersion.test(pkg.version))
      return { ...result, status: "error", message: "Ungültiger npm-Paketname oder keine feste stabile Version." };
    try {
      const response = await fetchLatest(`${registry}${encodeURIComponent(pkg.name)}/latest`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) throw new Error(`npm antwortet mit HTTP ${response.status}.`);
      const latest = await response.json();
      if (latest.name !== pkg.name || !stableVersion.test(latest.version))
        throw new Error("npm liefert keinen gültigen stabilen latest-Versionsstand.");
      return { ...result, latest: latest.version, status: latest.version === pkg.version ? "current" : "outdated" };
    } catch (error) {
      const detail = error.cause?.code ?? error.message;
      return { ...result, status: "error", message: `Versionsabfrage fehlgeschlagen: ${detail}` };
    }
  }));
}

export function reportDependencies(results, log = console.log) {
  for (const result of results) {
    if (result.status === "current") log(`AKTUELL     ${result.name}: ${result.current}`);
    else if (result.status === "outdated") log(`ABWEICHEND  ${result.name}: eingebunden ${result.current}, npm latest ${result.latest}`);
    else if (result.status === "manual") log(`MANUELL     ${result.name}: ${result.current}. ${result.message}`);
    else log(`FEHLER      ${result.name}: ${result.message}`);
  }
  const checked = results.filter((result) => result.status !== "manual");
  if (!checked.length || results.some((result) => result.status === "error")) {
    log("Versionscheck unvollständig. Commit blockiert; Registry-Zugriff und Inventar prüfen und erneut versuchen.");
    return 2;
  }
  if (results.some((result) => result.status === "outdated")) {
    log("Versionscheck fehlgeschlagen. Commit blockiert, bis alle geprüften npm-Bibliotheken dem latest-Stand entsprechen.");
    log("Bibliotheken gezielt aktualisieren, lokale Anpassungen erhalten und Tests ausführen; anschließend Inventar neu erzeugen und Änderungen stagen.");
    return 1;
  }
  log(`Versionscheck erfolgreich: ${checked.length} npm-Bibliotheken entsprechen npm latest.`);
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--staged")) throw new Error("Aufruf: node scripts/check-dependencies.mjs [--staged]");
  const staged = args.includes("--staged");
  console.log(`Bibliotheks-Versionscheck (${staged ? "Git-Index" : "Arbeitsverzeichnis"}, npm latest)`);
  const manifest = await readManifest({ staged });
  process.exitCode = reportDependencies(await checkDependencies(manifest));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(`Versionscheck nicht möglich. Commit blockiert: ${error.message}`);
    process.exitCode = 2;
  });
