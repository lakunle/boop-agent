import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { extractDocx, MAX_DOCX_TEXT_BYTES } from "../server/docx-extract.js";

test("extractDocx returns text from a real docx", async () => {
  const bytes = readFileSync("tests/fixtures/sample.docx");
  const result = await extractDocx(bytes);
  assert.match(result.text, /Hello from a sample docx fixture/);
  assert.equal(result.costUsd, 0);
  assert.equal(result.truncated, false);
  assert.ok(result.totalBytes > 0);
});

test("MAX_DOCX_TEXT_BYTES is exported and equals 200 KB", () => {
  assert.equal(MAX_DOCX_TEXT_BYTES, 200 * 1024);
});

test("extractDocx throws a clear error on garbage input", async () => {
  await assert.rejects(
    extractDocx(Buffer.from("not a docx — totally invalid bytes here")),
    /docx|extract|zip|file/i,
  );
});
