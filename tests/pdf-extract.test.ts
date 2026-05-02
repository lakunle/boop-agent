import { test, after } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  extractPdf,
  __setVisionForTesting,
  __resetVisionForTesting,
  MAX_PDF_PAGES,
} from "../server/pdf-extract.js";

test("text-heavy PDF: every page extracts via text path, zero vision calls", async () => {
  const bytes = readFileSync("tests/fixtures/text-only.pdf");
  let visionCalls = 0;
  __setVisionForTesting(async () => {
    visionCalls++;
    return { description: "MOCK-VISION", costUsd: 0.01, model: "gpt-4o" };
  });

  const result = await extractPdf(bytes, 1.5);
  assert.equal(visionCalls, 0, "text-only PDF should never call vision");
  assert.equal(result.pagesProcessed, 3);
  assert.equal(result.pagesTotal, 3);
  assert.match(result.description, /## Page 1/);
  assert.match(result.description, /## Page 2/);
  assert.match(result.description, /## Page 3/);
  assert.match(result.description, /Lorem ipsum/i);
  assert.equal(result.truncatedReason, undefined);
  // Cost regression: text-heavy PDF must stay under $0.005
  assert.ok(result.costUsd < 0.005, `costUsd too high: ${result.costUsd}`);
});

test("image-only PDF: every page calls vision", async () => {
  const bytes = readFileSync("tests/fixtures/image-only.pdf");
  let visionCalls = 0;
  __setVisionForTesting(async (_buf, _mime, opts) => {
    visionCalls++;
    return {
      description: `vision page ${opts?.pageContext?.page}`,
      costUsd: 0.01,
      model: "gpt-4o",
    };
  });

  const result = await extractPdf(bytes, 1.5);
  assert.equal(result.pagesTotal, 3);
  assert.equal(visionCalls, 3);
  assert.match(result.description, /## Page 1 \(image\)/);
  assert.match(result.description, /vision page 1/);
});

test("mixed PDF: text pages use text path, image pages use vision", async () => {
  const bytes = readFileSync("tests/fixtures/mixed.pdf");
  let visionCalls = 0;
  __setVisionForTesting(async () => {
    visionCalls++;
    return { description: "VISION", costUsd: 0.01, model: "gpt-4o" };
  });

  const result = await extractPdf(bytes, 1.5);
  assert.equal(result.pagesTotal, 3);
  assert.ok(visionCalls >= 1 && visionCalls <= 2,
    `expected 1-2 vision calls, got ${visionCalls}`);
});

test("cost cap: stops processing when accumulated vision cost exceeds cap", async () => {
  const bytes = readFileSync("tests/fixtures/image-only.pdf");
  __setVisionForTesting(async () => ({
    description: "VISION",
    costUsd: 1.0, // each call = $1, cap = $1.5 → cap fires after page 2
    model: "gpt-4o",
  }));

  const result = await extractPdf(bytes, 1.5);
  assert.equal(result.truncatedReason, "cost-cap");
  assert.equal(result.pagesProcessed, 2);
  assert.equal(result.pagesTotal, 3);
});

test("MAX_PDF_PAGES is exported and equals 20", () => {
  assert.equal(MAX_PDF_PAGES, 20);
});

test("corrupt PDF: throws a recognizable error", async () => {
  const bytes = readFileSync("tests/fixtures/corrupt.pdf");
  await assert.rejects(extractPdf(bytes, 1.5), /pdf|invalid|parse/i);
});

after(() => {
  __resetVisionForTesting();
});
