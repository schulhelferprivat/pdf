let documentNumber = 0;
export async function openBlankDocument(browser, pages = 1) {
  const name = `Dokument-${++documentNumber}.pdf`;
  await browser.evaluate(async ({ name, pages }) => {
    const { pdfLib } = await import("./src/pdf/vendors.js");
    const lib = await pdfLib();
    const documentPdf = await lib.PDFDocument.create();
    for (let i = 0; i < pages; i++) documentPdf.addPage([595.3, 841.9]);
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([await documentPdf.save()], name, { type: "application/pdf" }),
    );
    const input = document.querySelector("#file-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  }, { name, pages });
  await browser.wait(
    (name) =>
      document.querySelector("#file-list [aria-current=true]")?.textContent ===
        name.replace(/\.pdf$/i, "") &&
      !document.querySelector("#busy-dialog").open &&
      document.querySelector("#page-canvas").width > 0 &&
      document.querySelector("#page-loading").hidden,
    30000,
    name,
  );
}
export async function selectDocument(browser, index) {
  await browser.evaluate((index) => {
    document.querySelectorAll("#file-list .file-open")[index].click();
  }, index);
}
