import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkDependencies, readManifest, reportDependencies } from "../scripts/check-dependencies.mjs";

const pkg = (name, version) => ({ name, version, source: `https://registry.npmjs.org/${name}/${version}` });
const response = (name, version) => ({ ok: true, json: async () => ({ name, version }) });

test("Versionscheck vergleicht jedes npm-Paket einschließlich Scopes mit latest", async () => {
  const calls = [];
  const manifest = { packages: [pkg("example", "1.2.3"), pkg("@example/library", "2.0.0"), { name: "Font", version: "snapshot", source: "https://example.org/font" }] };
  const results = await checkDependencies(manifest, { fetchLatest: async (url, options) => {
    calls.push({ url, options });
    return url.includes("%40") ? response("@example/library", "3.0.0") : response("example", "1.2.3");
  } });
  assert.deepEqual(results.map((result) => result.status), ["current", "outdated", "manual"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://registry.npmjs.org/%40example%2Flibrary/latest");
  assert.equal(calls[0].options.cache, "no-store");
  const output = [];
  assert.equal(reportDependencies(results, (line) => output.push(line)), 1);
  assert.ok(output.some((line) => line.includes("2.0.0") && line.includes("3.0.0")));
  assert.ok(output.some((line) => line.includes("Commit blockiert")));
  assert.equal(reportDependencies([results[0], results[2]], () => {}), 0);
});

test("Versionscheck meldet HTTP-, Netzwerk- und Metadatenfehler als unvollständig", async () => {
  for (const fetchLatest of [
    async () => ({ ok: false, status: 404 }),
    async () => { throw new Error("DNS fehlgeschlagen"); },
    async () => response("different-package", "1.2.3"),
    async () => response("example", "2.0.0-beta.1"),
    async () => ({ ok: true, json: async () => { throw new Error("Ungültiges JSON"); } }),
  ]) {
    const results = await checkDependencies({ packages: [pkg("example", "1.2.3")] }, { fetchLatest });
    assert.equal(results[0].status, "error");
    assert.equal(reportDependencies(results, () => {}), 2);
  }
  assert.equal(reportDependencies([], () => {}), 2);
  assert.equal(reportDependencies([{ status: "manual", name: "Font" }], () => {}), 2);
});

test("Versionscheck bricht eine nicht antwortende Registry nach dem Zeitlimit ab", async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const results = await checkDependencies({ packages: [pkg("example", "1.2.3")] }, {
      timeoutMs: 20,
      fetchLatest: async (_, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });
    assert.equal(results[0].status, "error");
    assert.equal(reportDependencies(results, () => {}), 2);
  } finally {
    clearInterval(keepAlive);
  }
});

test("Versionscheck akzeptiert keine ungültigen oder variablen Paketversionen", async () => {
  for (const entry of [pkg("example", "^1.2.3"), pkg("bad/package", "1.2.3")]) {
    const results = await checkDependencies({ packages: [entry] }, { fetchLatest: async () => { assert.fail("Keine Registry-Abfrage für ungültige Einträge"); } });
    assert.equal(results[0].status, "error");
  }
});

test("Commit-Hooks prüfen den Git-Index und blockieren Abweichungen und Netzwerkfehler", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pdfhelper-dependencies-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "--quiet");
  await mkdir(join(directory, "scripts"));
  await copyFile(new URL("../scripts/check-dependencies.mjs", import.meta.url), join(directory, "scripts/check-dependencies.mjs"));
  const hooks = fileURLToPath(new URL("../.githooks", import.meta.url));
  const mock = join(directory, "registry.mjs");
  await writeFile(mock, 'globalThis.fetch = async (url) => ({ ok: true, json: async () => ({ name: decodeURIComponent(new URL(url).pathname.split("/")[1]), version: "1.2.3" }) });\n');
  const env = { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(mock).href}` };
  const run = (hook = "pre-commit") => spawnSync("git", ["-c", `core.hooksPath=${hooks}`, "hook", "run", hook], { cwd: directory, env, encoding: "utf8" });
  const inventory = join(directory, "vendor-manifest.json");
  await writeFile(inventory, JSON.stringify({ packages: [pkg("example", "1.0.0")] }));
  git("add", "vendor-manifest.json");
  await writeFile(inventory, JSON.stringify({ packages: [pkg("example", "1.2.3")] }));
  assert.equal((await readManifest({ cwd: directory })).packages[0].version, "1.2.3");
  assert.equal((await readManifest({ cwd: directory, staged: true })).packages[0].version, "1.0.0");
  const blocked = run();
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.match(blocked.stdout + blocked.stderr, /eingebunden 1\.0\.0, npm latest 1\.2\.3/);
  git("add", "vendor-manifest.json");
  for (const hook of ["pre-commit", "pre-merge-commit"]) {
    const passed = run(hook);
    assert.equal(passed.status, 0, passed.stderr);
    assert.match(passed.stdout + passed.stderr, /Versionscheck erfolgreich/);
  }
  await writeFile(mock, 'globalThis.fetch = async () => { throw new Error("offline"); };\n');
  const offline = run();
  assert.notEqual(offline.status, 0);
  assert.match(offline.stdout + offline.stderr, /Versionscheck unvollständig/);
  await writeFile(inventory, "{}");
  git("add", "vendor-manifest.json");
  const invalid = run();
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Commit blockiert/);
  assert.equal(await readFile(inventory, "utf8"), "{}");
});
