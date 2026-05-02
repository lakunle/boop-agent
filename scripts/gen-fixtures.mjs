import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { createCanvas } from "@napi-rs/canvas";
import { ZipWriter, BlobWriter, BlobReader } from "@zip.js/zip.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "tests", "fixtures");
mkdirSync(out, { recursive: true });

// 1. sample.png — 64x64 solid green
{
  const c = createCanvas(64, 64);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0a0";
  ctx.fillRect(0, 0, 64, 64);
  writeFileSync(resolve(out, "sample.png"), c.toBuffer("image/png"));
}

// 2. text-only.pdf — three pages of paragraph text
async function htmlToPdf(html, file) {
  // --no-sandbox required on macOS without a user namespace for Chrome
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const buf = await page.pdf({ format: "A4" });
    writeFileSync(resolve(out, file), buf);
  } finally {
    await browser.close();
  }
}
await htmlToPdf(
  `<html><body style="font:14px sans-serif;padding:40px">
    <h1>Page 1</h1><p>${"Lorem ipsum dolor sit amet ".repeat(40)}</p>
    <h1 style="page-break-before:always">Page 2</h1><p>${"Consectetur adipiscing elit ".repeat(40)}</p>
    <h1 style="page-break-before:always">Page 3</h1><p>${"Sed do eiusmod tempor ".repeat(40)}</p>
  </body></html>`,
  "text-only.pdf",
);

// 3. image-only.pdf — three pages each containing only an image (no text layer)
await htmlToPdf(
  `<html><body style="margin:0">
    ${[1,2,3].map(n =>
      `<div style="page-break-after:always;display:flex;align-items:center;justify-content:center;height:100vh">
        <img src="data:image/svg+xml;utf8,${encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='200' height='200' fill='hsl(${n*120} 60% 50%)'/></svg>`
        )}" />
      </div>`
    ).join("")}
  </body></html>`,
  "image-only.pdf",
);

// 4. mixed.pdf — alternating text and image pages
await htmlToPdf(
  `<html><body style="margin:0;font:14px sans-serif">
    <div style="padding:40px"><h1>Page 1 — text</h1><p>${"Quis nostrud exercitation ".repeat(40)}</p></div>
    <div style="page-break-before:always;display:flex;align-items:center;justify-content:center;height:100vh">
      <img src="data:image/svg+xml;utf8,${encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><rect width='300' height='300' fill='steelblue'/></svg>`
      )}" />
    </div>
    <div style="page-break-before:always;padding:40px"><h1>Page 3 — text</h1><p>${"Duis aute irure dolor ".repeat(40)}</p></div>
  </body></html>`,
  "mixed.pdf",
);

// 5. corrupt.pdf — truncated PDF header, no body
writeFileSync(resolve(out, "corrupt.pdf"), Buffer.from("%PDF-1.4\nthis is not a valid PDF body\n"));

// 6. sample.docx — minimal docx (zip with two XML files)
const blobWriter = new BlobWriter("application/zip");
const zip = new ZipWriter(blobWriter);
await zip.add("[Content_Types].xml", new BlobReader(new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`])));
await zip.add("_rels/.rels", new BlobReader(new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`])));
await zip.add("word/document.xml", new BlobReader(new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Hello from a sample docx fixture. This file exists to verify mammoth extraction.</w:t></w:r></w:p>
</w:body>
</w:document>`])));
const docxResultBlob = await zip.close();
const docxArrayBuffer = await docxResultBlob.arrayBuffer();
writeFileSync(resolve(out, "sample.docx"), Buffer.from(docxArrayBuffer));

console.log("fixtures written to", out);
