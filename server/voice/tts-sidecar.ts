import { broadcast, subscribe } from "../broadcast.js";
import { createSentenceBuffer, type SentenceBuffer } from "./sentence-buffer.js";
import { createElevenLabsStream, type ElevenLabsStream } from "./tts-elevenlabs.js";
import { stripMarkdown } from "./markdown-strip.js";

export interface TtsConfig {
  apiKey: string;     // "" means fallback path
  voiceId: string;
  modelId: string;
}

export interface TtsSidecarOpts {
  conversationId: string;
  voiceTurnId: string;
  config: TtsConfig;
}

export interface TtsSidecar { dispose(): void }

export function createTtsSidecar(opts: TtsSidecarOpts): TtsSidecar {
  const { conversationId, voiceTurnId, config } = opts;
  const useFallback = !config.apiKey;
  let seq = 0;
  let disposed = false;
  let elevenlabs: ElevenLabsStream | null = null;
  let fallbackBuffer = "";
  let emittedDone = false;

  function emitChunk(audioBase64: string) {
    broadcast("tts_chunk", { conversationId, voiceTurnId, seq: seq++, audio: audioBase64, mime: "audio/mpeg" });
  }

  function emitDone() {
    if (emittedDone) return;
    emittedDone = true;
    broadcast("tts_done", { conversationId, voiceTurnId });
  }

  function emitLocalFallback(text: string) {
    broadcast("tts_use_local", { conversationId, voiceTurnId, text: stripMarkdown(text) });
    emitDone();
  }

  function emitError(reason: string) {
    broadcast("tts_error", { conversationId, voiceTurnId, reason });
  }

  const sentenceBuffer: SentenceBuffer = createSentenceBuffer({
    maxBufferMs: 1500,
    onSentence: (sentence) => {
      if (disposed) return;
      if (useFallback) {
        fallbackBuffer += (fallbackBuffer ? " " : "") + sentence;
        return;
      }
      if (!elevenlabs) {
        elevenlabs = createElevenLabsStream({
          voiceId: config.voiceId,
          modelId: config.modelId,
          apiKey: config.apiKey,
          onChunk: (audio) => emitChunk(audio),
          onDone: () => emitDone(),
          onError: (reason) => {
            // WS failed mid-turn — fall back with remaining text
            emitError(reason);
            elevenlabs = null;
            fallbackBuffer += (fallbackBuffer ? " " : "") + sentence;
          },
        });
      }
      elevenlabs.send(sentence);
    },
  });

  const unsub = subscribe((msg) => {
    if (disposed) return;
    const data = msg.data as any;
    if (data?.conversationId !== conversationId) return;
    if (msg.event === "assistant_delta") {
      if (typeof data.delta === "string") sentenceBuffer.push(data.delta);
    } else if (msg.event === "assistant_message") {
      sentenceBuffer.flush();
      if (useFallback && fallbackBuffer) {
        emitLocalFallback(fallbackBuffer);
      } else if (elevenlabs) {
        elevenlabs.end().then(() => emitDone());
      } else if (fallbackBuffer) {
        // Fallback buffer accrued because the ElevenLabs path errored mid-turn
        emitLocalFallback(fallbackBuffer);
      } else {
        emitDone();
      }
    }
  });

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      unsub();
      sentenceBuffer.dispose();
      if (elevenlabs) elevenlabs.abort();
    },
  };
}
