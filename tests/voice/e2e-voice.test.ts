// Requires the live dev server on :3456 and a valid bearer token (BOOP_TEST_BEARER).
// Skips otherwise. ElevenLabs path is exercised when the server has
// ELEVENLABS_API_KEY set; otherwise tts_use_local appears instead of tts_chunk.
import { test } from "node:test";
import assert from "node:assert/strict";

const base = process.env.BOOP_TEST_BASE_URL ?? "http://localhost:3456";
const token = process.env.BOOP_TEST_BEARER ?? "";
const threadId = process.env.BOOP_TEST_THREAD ?? "voice-smoke";

test(
  "voice turn yields assistant_delta -> tts_use_local|tts_chunk -> tts_done",
  { skip: !token },
  async () => {
    const voiceTurnId = `vt-${Date.now()}`;
    const seen: string[] = [];

    const ctrl = new AbortController();
    const ssePromise = (async () => {
      const res = await fetch(`${base}/channels/ios/stream?threadId=${threadId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
      if (!res.body) throw new Error("no SSE body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (!ctrl.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let msg: any;
          try {
            msg = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (
            msg.data?.voiceTurnId === voiceTurnId ||
            msg.event === "assistant_delta" ||
            msg.event === "assistant_message"
          ) {
            seen.push(msg.event);
          }
          if (msg.event === "tts_done" && msg.data?.voiceTurnId === voiceTurnId) {
            ctrl.abort();
          }
        }
      }
    })().catch((err) => {
      // AbortError on ctrl.abort() is expected
      if ((err as Error).name !== "AbortError") throw err;
    });

    await new Promise((r) => setTimeout(r, 300)); // give SSE time to attach

    const post = await fetch(`${base}/channels/ios/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text: "say a one-sentence hello",
        threadId,
        source: "voice",
        voiceTurnId,
      }),
    });
    assert.equal(post.status, 200, `inbound failed: ${await post.text()}`);

    await Promise.race([
      ssePromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout waiting for tts_done")), 30_000),
      ),
    ]);

    assert.ok(seen.includes("assistant_delta"), "missing assistant_delta");
    assert.ok(seen.includes("tts_done"), "missing tts_done");
    const hadChunkOrLocal = seen.some((e) => e === "tts_chunk" || e === "tts_use_local");
    assert.ok(hadChunkOrLocal, "missing tts_chunk or tts_use_local");
  },
);
