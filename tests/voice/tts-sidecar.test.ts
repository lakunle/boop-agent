import { test } from "node:test";
import assert from "node:assert/strict";
import { broadcast, subscribe, type BroadcastMessage } from "../../server/broadcast.js";
import { createTtsSidecar } from "../../server/voice/tts-sidecar.js";

function collectEvents(filter: (event: string) => boolean) {
  const events: { event: string; data: any }[] = [];
  const unsub = subscribe((msg: BroadcastMessage) => {
    if (filter(msg.event)) events.push({ event: msg.event, data: msg.data });
  });
  return { events, unsub };
}

test("emits tts_use_local when ELEVENLABS_API_KEY is unset", async () => {
  const { events, unsub } = collectEvents((e) => e.startsWith("tts_"));
  const sidecar = createTtsSidecar({
    conversationId: "ios:dev:thread",
    voiceTurnId: "vt-1",
    config: { apiKey: "", voiceId: "v", modelId: "eleven_flash_v2_5" },
  });
  broadcast("assistant_delta", { conversationId: "ios:dev:thread", delta: "Hello world.", seq: 0 });
  broadcast("assistant_message", { conversationId: "ios:dev:thread", message: "Hello world." });
  await new Promise((r) => setTimeout(r, 50));
  sidecar.dispose();
  unsub();
  const local = events.find((e) => e.event === "tts_use_local");
  assert.ok(local, "expected tts_use_local");
  assert.ok((local!.data as any).text.includes("Hello world"));
});

test("emits tts_done after assistant_message", async () => {
  const { events, unsub } = collectEvents((e) => e === "tts_done");
  const sidecar = createTtsSidecar({
    conversationId: "ios:dev:thread2",
    voiceTurnId: "vt-2",
    config: { apiKey: "", voiceId: "v", modelId: "eleven_flash_v2_5" },
  });
  broadcast("assistant_message", { conversationId: "ios:dev:thread2", message: "Done." });
  await new Promise((r) => setTimeout(r, 50));
  sidecar.dispose();
  unsub();
  assert.equal(events.length, 1);
});

test("ignores events for other conversationId", async () => {
  const { events, unsub } = collectEvents((e) => e.startsWith("tts_"));
  const sidecar = createTtsSidecar({
    conversationId: "ios:dev:thread3",
    voiceTurnId: "vt-3",
    config: { apiKey: "", voiceId: "v", modelId: "eleven_flash_v2_5" },
  });
  broadcast("assistant_delta", { conversationId: "sms:other", delta: "nope.", seq: 0 });
  broadcast("assistant_message", { conversationId: "sms:other", message: "nope." });
  await new Promise((r) => setTimeout(r, 50));
  sidecar.dispose();
  unsub();
  assert.equal(events.length, 0);
});
