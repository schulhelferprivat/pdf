import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else if (!path.endsWith(".map")) output.push(path);
  }
  return output;
}
const paths = [
  "index.html",
  "manifest.webmanifest",
  "THIRD_PARTY_NOTICES.md",
  ...(await walk("src")),
  ...(await walk("assets")),
  ...(await walk("vendor")),
].sort();
const hash = createHash("sha256");
for (const path of [...paths, "sw.js"])
  hash.update(path).update(await readFile(path));
const version = hash.digest("hex").slice(0, 16);
await writeFile(
  "precache.js",
  `self.PDFHELPER_VERSION=${JSON.stringify(version)};\nself.PDFHELPER_ASSETS=${JSON.stringify(paths.map((path) => `./${path}`))};\n`,
);
const packages = [
  [
    "@cantoo/pdf-lib",
    "2.11.1",
    "MIT",
    "https://registry.npmjs.org/@cantoo/pdf-lib/2.11.1",
    "vendor/cantoo-pdf-lib",
  ],
  [
    "pdfjs-dist",
    "6.4.299",
    "Apache-2.0",
    "https://registry.npmjs.org/pdfjs-dist/6.4.299",
    "vendor/pdfjs-dist",
  ],
  [
    "jszip",
    "3.10.2",
    "MIT OR GPL-3.0-or-later",
    "https://registry.npmjs.org/jszip/3.10.2",
    "vendor/jszip",
  ],
  [
    "@cantoo/fontkit",
    "2.0.12",
    "MIT",
    "https://registry.npmjs.org/@cantoo/fontkit/2.0.12",
    "vendor/fontkit",
  ],
];
for (const [name, version, license] of [
  ["utif", "3.1.0", "MIT"],
  ["pako", "3.0.2", "MIT AND Zlib"],
  ["epubjs", "0.3.93", "BSD-2-Clause"],
]) packages.push([name, version, license, `https://registry.npmjs.org/${name}/${version}`, `vendor/${name}`]);
const manifest = [];
for (const [name, version, license, source, directory] of packages) {
  const files = [];
  for (const path of await walk(directory))
    files.push({
      path,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    });
  const entry = { name, version, license, source, files };
  if (name === "pdfjs-dist")
    entry.bundledComponents = [
      {
        name: "QuickJS",
        version: "3d5e064e9dd67c70f7962836505a7fa067bf0a4e",
        license: "MIT",
        licenseFile: "vendor/pdfjs-dist/6.4.299/wasm/LICENSE_QUICKJS",
      },
      {
        name: "PDF.js QuickJS wrapper",
        license: "MIT",
        licenseFile: "vendor/pdfjs-dist/6.4.299/wasm/LICENSE_PDFJS_QUICKJS",
      },
      {
        name: "Liberation Sans",
        version: "1.07.4",
        license: "GPL-2.0-only with Liberation font exception",
        licenseFile: "vendor/pdfjs-dist/6.4.299/standard_fonts/LICENSE_LIBERATION",
        sourceArchive: "vendor/pdfjs-dist/6.4.299/standard_fonts/sources/liberation-fonts-1.07.4.tar.gz",
        source: "https://github.com/liberationfonts/liberation-1.7-fonts/tree/1b25642191bb57c05d128f6a20d9567e3079c2b8",
      },
    ];
  manifest.push(entry);
}
const fontFiles = [];
for (const path of [
  "assets/NotoSans-Regular.ttf",
  "assets/NotoSans-Bold.ttf",
  "assets/NotoSans-LICENSE.txt",
])
  fontFiles.push({
    path,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  });
manifest.push({
  name: "Noto Sans",
  version: "repository snapshot",
  license: "OFL-1.1",
  source:
    "https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans",
  files: fontFiles,
});
await writeFile(
  "vendor-manifest.json",
  JSON.stringify({ packages: manifest }, null, 2) + "\n",
);
console.log(`Offlineinventar ${version}: ${paths.length} Dateien`);
