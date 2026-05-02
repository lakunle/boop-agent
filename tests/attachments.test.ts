import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  resolveAttachment,
  isAttachmentError,
  ATTACHMENT_LIMITS,
  __setStorageForTesting,
  __setVisionForTesting,
  __setExtractorsForTesting,
} from "../server/attachments.js";

function setupHappyMocks() {
  __setStorageForTesting({
    upload: async () => ({
      storageId: "stor_test_123" as any,
      signedUrl: "https://storage.example/abc",
    }),
  });
  __setVisionForTesting(async () => ({
    description: "A green square.",
    costUsd: 0.003,
    model: "gpt-4o",
  }));
  __setExtractorsForTesting({
    pdf: async () => ({
      description: "PDF content",
      costUsd: 0.001,
      pagesProcessed: 3,
      pagesTotal: 3,
    }),
    docx: async () => ({
      text: "DOCX content",
      costUsd: 0,
      truncated: false,
      totalBytes: 100,
    }),
  });
}

test("image: returns ResolvedAttachment with vision description", async () => {
  setupHappyMocks();
  const png = readFileSync("tests/fixtures/sample.png");
  const r = await resolveAttachment(png, "image/png", "icon.png", "telegram");
  assert.equal(isAttachmentError(r), false);
  if (isAttachmentError(r)) return;
  assert.equal(r.kind, "image");
  assert.equal(r.signedUrl, "https://storage.example/abc");
  assert.equal(r.description, "A green square.");
  assert.equal(r.costUsd, 0.003);
  assert.equal(r.filename, "icon.png");
});

test("pdf: returns ResolvedAttachment via pdf-extract", async () => {
  setupHappyMocks();
  const pdf = readFileSync("tests/fixtures/text-only.pdf");
  const r = await resolveAttachment(pdf, "application/pdf", "doc.pdf", "sendblue");
  assert.equal(isAttachmentError(r), false);
  if (isAttachmentError(r)) return;
  assert.equal(r.kind, "pdf");
  assert.equal(r.description, "PDF content");
});

test("docx: returns ResolvedAttachment via docx-extract", async () => {
  setupHappyMocks();
  const docx = readFileSync("tests/fixtures/sample.docx");
  const r = await resolveAttachment(
    docx,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "memo.docx",
    "telegram",
  );
  assert.equal(isAttachmentError(r), false);
  if (isAttachmentError(r)) return;
  assert.equal(r.kind, "doc");
  assert.equal(r.description, "DOCX content");
});

test("text/plain: reads bytes as utf-8", async () => {
  setupHappyMocks();
  const r = await resolveAttachment(Buffer.from("hello world", "utf-8"), "text/plain", "n.txt", "telegram");
  assert.equal(isAttachmentError(r), false);
  if (isAttachmentError(r)) return;
  assert.equal(r.kind, "doc");
  assert.equal(r.description, "hello world");
});

test("oversized image: returns AttachmentError with size message", async () => {
  setupHappyMocks();
  const tooBig = Buffer.alloc(ATTACHMENT_LIMITS.maxImageBytes + 1);
  const r = await resolveAttachment(tooBig, "image/png", "big.png", "telegram");
  assert.equal(isAttachmentError(r), true);
  if (!isAttachmentError(r)) return;
  assert.match(r.userMessage, /MB/i);
  assert.match(r.userMessage, /image/i);
});

test("unsupported mime: returns AttachmentError listing supported types", async () => {
  setupHappyMocks();
  const r = await resolveAttachment(Buffer.from([0]), "video/mp4", "v.mp4", "telegram");
  assert.equal(isAttachmentError(r), true);
  if (!isAttachmentError(r)) return;
  assert.match(r.userMessage, /don't read/i);
  assert.match(r.userMessage, /photos|PDF/i);
});

test("storage upload failure: returns AttachmentError, no extractor call", async () => {
  let extractorCalled = false;
  __setStorageForTesting({
    upload: async () => {
      throw new Error("convex storage 503");
    },
  });
  __setVisionForTesting(async () => {
    extractorCalled = true;
    return { description: "x", costUsd: 0, model: "gpt-4o" };
  });
  __setExtractorsForTesting({
    pdf: async () => { extractorCalled = true; throw new Error(); },
    docx: async () => { extractorCalled = true; throw new Error(); },
  });

  const r = await resolveAttachment(Buffer.from([0]), "image/png", "x.png", "telegram");
  assert.equal(isAttachmentError(r), true);
  if (!isAttachmentError(r)) return;
  assert.match(r.userMessage, /save|store/i);
  assert.equal(extractorCalled, false, "must short-circuit before extractor call");
});

test("vision API failure: returns AttachmentError but bytes are still stored", async () => {
  setupHappyMocks();
  let uploaded = false;
  __setStorageForTesting({
    upload: async () => {
      uploaded = true;
      return { storageId: "stor_x" as any, signedUrl: "https://x" };
    },
  });
  __setVisionForTesting(async () => { throw new Error("OpenAI 500"); });

  const r = await resolveAttachment(Buffer.from([0]), "image/png", "x.png", "telegram");
  assert.equal(isAttachmentError(r), true);
  assert.equal(uploaded, true, "bytes should be uploaded before vision call");
});
