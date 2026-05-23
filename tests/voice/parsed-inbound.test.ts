import { test } from "node:test";
import assert from "node:assert/strict";
import type { ParsedInbound } from "../../server/channels/types.js";

test("ParsedInbound accepts source: 'voice' + voiceTurnId", () => {
  const inbound: ParsedInbound = {
    conversationId: "ios:dev-123:thread-abc",
    from: "ios:dev-123",
    content: "hello",
    source: "voice",
    voiceTurnId: "turn-xyz",
  };
  assert.equal(inbound.source, "voice");
  assert.equal(inbound.voiceTurnId, "turn-xyz");
});

test("ParsedInbound accepts undefined source (text path)", () => {
  const inbound: ParsedInbound = {
    conversationId: "sms:+15551234567",
    from: "+15551234567",
    content: "hi",
  };
  assert.equal(inbound.source, undefined);
});
