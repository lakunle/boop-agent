import { test } from "node:test";
import assert from "node:assert/strict";
import { createSentenceBuffer } from "../../server/voice/sentence-buffer.js";

test("splits on period + space", () => {
  const out: string[] = [];
  const buf = createSentenceBuffer({ onSentence: (s) => out.push(s) });
  buf.push("Hello world. ");
  buf.push("How are you?");
  buf.flush();
  assert.deepEqual(out, ["Hello world.", "How are you?"]);
});

test("does NOT split on Mr. / U.S. / 3.14", () => {
  const out: string[] = [];
  const buf = createSentenceBuffer({ onSentence: (s) => out.push(s) });
  buf.push("Mr. Smith owes $3.14 from the U.S. office. ");
  buf.push("Done.");
  buf.flush();
  assert.deepEqual(out, ["Mr. Smith owes $3.14 from the U.S. office.", "Done."]);
});

test("splits on ? and !", () => {
  const out: string[] = [];
  const buf = createSentenceBuffer({ onSentence: (s) => out.push(s) });
  buf.push("Really? Yes! Of course.");
  buf.flush();
  assert.deepEqual(out, ["Really?", "Yes!", "Of course."]);
});

test("splits on colon for list intros", () => {
  const out: string[] = [];
  const buf = createSentenceBuffer({ onSentence: (s) => out.push(s) });
  buf.push("Here are three: first, second, and third. Done.");
  buf.flush();
  assert.deepEqual(out, ["Here are three:", "first, second, and third.", "Done."]);
});

test("flush emits remainder without trailing punctuation", () => {
  const out: string[] = [];
  const buf = createSentenceBuffer({ onSentence: (s) => out.push(s) });
  buf.push("tail with no period");
  buf.flush();
  assert.deepEqual(out, ["tail with no period"]);
});

test("force-flushes after maxBufferMs of inactivity", async () => {
  const out: string[] = [];
  const buf = createSentenceBuffer({
    onSentence: (s) => out.push(s),
    maxBufferMs: 50,
  });
  buf.push("no terminator here");
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(out, ["no terminator here"]);
  buf.dispose();
});

test("push after dispose is a no-op", () => {
  const out: string[] = [];
  const buf = createSentenceBuffer({ onSentence: (s) => out.push(s) });
  buf.dispose();
  buf.push("Hello world. ");
  buf.flush();
  assert.deepEqual(out, []);
});

test("dispose is idempotent", () => {
  const buf = createSentenceBuffer({ onSentence: () => {} });
  buf.dispose();
  buf.dispose(); // should not throw or double-emit
});
