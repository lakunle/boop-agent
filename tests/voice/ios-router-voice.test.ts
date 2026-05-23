// Requires the live test harness (CONVEX_URL + :3456 dev server) like
// tests/ios-thread-routes.test.ts. Skip in unit-only CI.
import { test } from "node:test";
import assert from "node:assert/strict";

const base = process.env.BOOP_TEST_BASE_URL ?? "http://localhost:3456";
const token = process.env.BOOP_TEST_BEARER ?? "";

test("POST /channels/ios/inbound accepts source + voiceTurnId", { skip: !token }, async () => {
  const res = await fetch(`${base}/channels/ios/inbound`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      text: "hello",
      threadId: "test-thread",
      source: "voice",
      voiceTurnId: "voice-turn-123",
    }),
  });
  assert.equal(res.status, 200);
});
