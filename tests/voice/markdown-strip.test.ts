import { test } from "node:test";
import assert from "node:assert/strict";
import { stripMarkdown } from "../../server/voice/markdown-strip.js";

test("strips bold and italic", () => {
  assert.equal(stripMarkdown("This is **bold** and *italic*"), "This is bold and italic");
});

test("strips inline code", () => {
  assert.equal(stripMarkdown("call `foo()` now"), "call foo() now");
});

test("removes fenced code blocks", () => {
  const input = "prose\n```ts\nconst x = 1\n```\nmore prose";
  assert.equal(stripMarkdown(input), "prose\n\nmore prose");
});

test("removes heading markers, keeps text", () => {
  assert.equal(stripMarkdown("# Title\n## Sub"), "Title\nSub");
});

test("removes bullet markers, keeps content", () => {
  const input = "- one\n- two\n- three";
  assert.equal(stripMarkdown(input), "one\ntwo\nthree");
});

test("removes numbered list markers", () => {
  assert.equal(stripMarkdown("1. first\n2. second"), "first\nsecond");
});

test("preserves URLs as plain text", () => {
  assert.equal(stripMarkdown("see [docs](https://example.com)"), "see docs (https://example.com)");
});
