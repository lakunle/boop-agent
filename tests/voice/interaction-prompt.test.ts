// CONVEX_URL must be set before importing interaction-agent.ts because it
// transitively pulls in convex-client.ts which throws at module load time
// if the var is absent. We never call any Convex function in this test.
process.env.CONVEX_URL = process.env.CONVEX_URL || "http://test.invalid";

import { test } from "node:test";
import assert from "node:assert/strict";

// Dynamic import (with top-level await) runs AFTER the env mutation above.
const { buildSystemPrompt } = await import("../../server/interaction-agent.js");

test("voice source appends voice-mode addendum", () => {
  const prompt = buildSystemPrompt({ source: "voice" });
  assert.match(prompt, /text-to-speech/);
  assert.match(prompt, /No bullet lists/);
});

test("absent or undefined source omits voice addendum", () => {
  assert.doesNotMatch(buildSystemPrompt({}), /text-to-speech/);
  assert.doesNotMatch(buildSystemPrompt({ source: undefined }), /text-to-speech/);
});
