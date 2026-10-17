export function tiffFixture({ little = true, orientations = [1, 6], thumbnail = true, compression = 1 } = {}) {
  const frames = orientations.map((orientation, index) => ({ orientation, thumbnail: false, color: index ? [0, 170, 0] : [220, 0, 0] }));
  if (thumbnail) frames.splice(1, 0, { orientation: 1, thumbnail: true, color: [0, 0, 200] });
  const bytes = new Uint8Array(8 + frames.length * 180);
  const view = new DataView(bytes.buffer);
  bytes.set(little ? [73,73,42,0] : [77,77,0,42]);
  view.setUint32(4, 8, little);
  frames.forEach((frame, index) => {
    const offset = 8 + index * 180;
    const pixelOffset = offset + 156;
    const tags = [[254,4,1,frame.thumbnail ? 1 : 0],[256,4,1,3],[257,4,1,2],[258,3,3,offset + 150],[259,3,1,compression],[262,3,1,2],[273,4,1,pixelOffset],[274,3,1,frame.orientation],[277,3,1,3],[278,4,1,2],[279,4,1,18],[284,3,1,1]];
    view.setUint16(offset, tags.length, little);
    tags.forEach(([tag,type,count,value], tagIndex) => {
      const start = offset + 2 + tagIndex * 12;
      view.setUint16(start, tag, little);
      view.setUint16(start + 2, type, little);
      view.setUint32(start + 4, count, little);
      if (type === 3 && count === 1) view.setUint16(start + 8, value, little);
      else view.setUint32(start + 8, value, little);
    });
    view.setUint32(offset + 2 + tags.length * 12, index + 1 < frames.length ? offset + 180 : 0, little);
    for (let channel = 0; channel < 3; channel++) view.setUint16(offset + 150 + channel * 2, 8, little);
    for (let pixel = 0; pixel < 6; pixel++) bytes.set(pixel === 0 ? [255,255,255] : frame.color, pixelOffset + pixel * 3);
  });
  return bytes;
}

export async function epubFixture({ drm = false, fixed = false, epub2 = false, alternateNames = false } = {}) {
  await import("../../vendor/jszip/3.10.2/jszip.min.js");
  const zip = new globalThis.JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("book/content.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:example:synthetic</dc:identifier><dc:title>Testbuch</dc:title><dc:language>de</dc:language>${fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : ''}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="img" href="image.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`);
  zip.file("book/nav.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Inhalt</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Erstes Kapitel</a></li><li><a href="two.xhtml">Zweites Kapitel</a></li></ol></nav></body></html>');
  zip.file("book/style.css", 'body { line-height: 1.6; } p { color: rgb(15, 60, 90); } .external { background: url(https://example.invalid/blocked-css); }');
  zip.file("book/image.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="green"/></svg>');
  for (const [name, title, target] of [["one", "Erstes Kapitel", "two"], ["two", "Zweites Kapitel", "one"]])
    zip.file(`book/${name}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><meta name="viewport" content="width=600,height=800"/><link rel="stylesheet" href="style.css"/><script>parent.epubScriptExecuted = true;</script></head><body onload="parent.epubEventExecuted = true"><h1>${title}</h1><a id="internal" href="${target}.xhtml">Weiterlesen</a><img id="local-image" src="image.svg"/><img src="https://example.invalid/blocked-image"/><iframe src="https://example.invalid/blocked-frame"/><form action="https://example.invalid/blocked-form"><input/></form><a id="external" href="https://example.invalid/blocked-link">Extern</a>${Array.from({length:40}, (_, i) => `<p>Absatz ${i + 1}: Synthetischer Buchinhalt zum Prüfen der Leseposition.</p>`).join("")}</body></html>`);
  if (drm) zip.file("META-INF/encryption.xml", "<encryption/>");
  if (epub2) {
    const opf = (await zip.file("book/content.opf").async("string"))
      .replace('version="3.0"', 'version="2.0"')
      .replace('<manifest>', '<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>')
      .replace('<spine>', '<spine toc="ncx">');
    zip.file("book/content.opf", opf);
    zip.file("book/toc.ncx", '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Testbuch</text></docTitle><navMap><navPoint id="one" playOrder="1"><navLabel><text>Erstes Kapitel</text></navLabel><content src="one.xhtml"/></navPoint><navPoint id="two" playOrder="2"><navLabel><text>Zweites Kapitel</text></navLabel><content src="two.xhtml"/></navPoint></navMap></ncx>');
    const text = await zip.file("book/one.xhtml").async("string");
    zip.file("book/one.xhtml", '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">' + text.replace("Absatz 1:", "Absatz&nbsp;1:"));
  }
  if (alternateNames) {
    for (const name of ["book/content.opf", "book/nav.xhtml", "book/one.xhtml", "book/two.xhtml", "book/toc.ncx"]) {
      if (!zip.file(name)) continue;
      const text = (await zip.file(name).async("string")).replace(/(one|two)\.xhtml/g, "$1.dat");
      zip.file(name.replace(/(one|two)\.xhtml/, "$1.dat"), text);
      if (/\/(?:one|two)\.xhtml$/.test(name)) zip.remove(name);
    }
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
