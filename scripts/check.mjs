import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import assert from "node:assert/strict";
const context = { self: {} };
vm.runInNewContext(await readFile("precache.js", "utf8"), context);
const paths = Array.from(context.self.PDFHELPER_ASSETS, (path) =>
  path.slice(2),
);
assert.equal(new Set(paths).size, paths.length);
for (const path of paths) await readFile(path);
const hash = createHash("sha256");
for (const path of [...paths, "sw.js"])
  hash.update(path).update(await readFile(path));
assert.equal(
  hash.digest("hex").slice(0, 16),
  context.self.PDFHELPER_VERSION,
  "Offlineinventar veraltet: node scripts/prepare.mjs ausführen",
);
const manifest = JSON.parse(await readFile("vendor-manifest.json", "utf8"));
let checked = 0;
for (const pkg of manifest.packages)
  for (const file of pkg.files) {
    assert.equal(
      createHash("sha256")
        .update(await readFile(file.path))
        .digest("hex"),
      file.sha256,
      file.path,
    );
    checked++;
  }
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await walk(path);
    else if (/\.(mjs|js)$/.test(path)) {
      execFileSync(process.execPath, ["--check", path]);
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(
        /(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g,
      )) {
        if (path.startsWith("tests/") && match[0].startsWith("import"))
          continue;
        const url = new URL(match[2], new URL(`../${path}`, import.meta.url));
        await readFile(url);
      }
      if (path.startsWith("src/") && path !== "src/core/recent.js")
        assert.ok(
          !/localStorage|indexedDB|sessionStorage/.test(source),
          `Unerwartete Datenspeicherung: ${path}`,
        );
    }
  }
}
await walk("src");
await walk("tests");
await walk("scripts");
const html = await readFile("index.html", "utf8");
assert.match(html, /<html lang="de" data-theme="dark">/);
assert.ok(!/https?:\/\//.test(html));
assert.ok(
  !paths.some(
    (path) => path.startsWith("tests/") || path.startsWith("scripts/"),
  ),
);
console.log(
  `Prüfung erfolgreich: ${paths.length} Offline-Dateien, ${checked} Bibliotheks-Prüfsummen, Syntax und lokale Modulimporte.`,
);
