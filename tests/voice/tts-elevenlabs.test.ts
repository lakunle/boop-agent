import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { createElevenLabsStream } from "../../server/voice/tts-elevenlabs.js";

function withMockServer(handler: (port: number) => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("listening", async () => {
      const port = (wss.address() as any).port;
      wss.on("connection", (ws) => {
        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.text === "") {
            ws.send(JSON.stringify({ audio: null, isFinal: true }));
            ws.close();
          } else {
            const fakeAudio = Buffer.from("fake-mp3-bytes-" + msg.text).toString("base64");
            ws.send(JSON.stringify({ audio: fakeAudio, isFinal: false }));
          }
        });
      });
      try { await handler(port); resolve(); }
      catch (e) { reject(e); }
      finally { wss.close(); }
    });
  });
}

test("emits onChunk for each text send", () => withMockServer(async (port) => {
  const chunks: string[] = [];
  let doneCalled = false;
  const stream = createElevenLabsStream({
    wsUrlOverride: `ws://localhost:${port}`,
    voiceId: "test",
    modelId: "eleven_flash_v2_5",
    apiKey: "test",
    onChunk: (audio) => chunks.push(audio),
    onDone: () => { doneCalled = true; },
    onError: () => assert.fail("unexpected error"),
  });
  await stream.opened;
  stream.send("hello");
  stream.send("world");
  await stream.end();
  assert.equal(chunks.length, 2);
  // chunks should be base64 strings (not the raw "fake-mp3-bytes-..." literal)
  assert.equal(chunks[0].includes("fake-mp3-bytes"), false);
  assert.equal(doneCalled, true);
}));

test("send() after end() is silently ignored", () => withMockServer(async (port) => {
  let chunks = 0;
  const stream = createElevenLabsStream({
    wsUrlOverride: `ws://localhost:${port}`,
    voiceId: "test",
    modelId: "eleven_flash_v2_5",
    apiKey: "test",
    onChunk: () => { chunks++; },
    onDone: () => {},
    onError: () => assert.fail("unexpected error"),
  });
  await stream.opened;
  stream.send("hello");
  const endPromise = stream.end();
  // Try to slip a frame in between end() and the close — should be silently dropped
  stream.send("ghost frame");
  await endPromise;
  assert.equal(chunks, 1, "only the pre-end send should produce a chunk");
}));
