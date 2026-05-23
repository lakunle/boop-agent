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

  // Fix 1+2: track every sentence sent to ElevenLabs this turn so that a
  // mid-turn error can reroute them all to fallbackBuffer (not just sentence #1).
  // Once midTurnFailed is set, all subsequent sentences skip ElevenLabs entirely.
  const sentencesInFlight: string[] = [];
  let midTurnFailed = false;

  // Fix 3: guard every emit helper so that after dispose() no events escape.
  function emitChunk(audioBase64: string) {
    if (disposed) return;
    broadcast("tts_chunk", { conversationId, voiceTurnId, seq: seq++, audio: audioBase64, mime: "audio/mpeg" });
  }

  function emitDone() {
    if (disposed || emittedDone) return;
    emittedDone = true;
    broadcast("tts_done", { conversationId, voiceTurnId });
  }

  function emitLocalFallback(text: string) {
    if (disposed) return;
    broadcast("tts_use_local", { conversationId, voiceTurnId, text: stripMarkdown(text) });
    emitDone();
  }

  function emitError(reason: string) {
    if (disposed) return;
    broadcast("tts_error", { conversationId, voiceTurnId, reason });
  }

  const sentenceBuffer: SentenceBuffer = createSentenceBuffer({
    maxBufferMs: 1500,
    onSentence: (sentence) => {
      if (disposed) return;
      // Fix 2: once midTurnFailed, route all remaining sentences to fallback —
      // do NOT re-open an ElevenLabs stream.
      if (useFallback || midTurnFailed) {
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
            // Fix 1: set sticky flag and dump ALL in-flight sentences (not just
            // the closure-captured first one) into fallbackBuffer.
            emitError(reason);
            midTurnFailed = true;
            elevenlabs = null;
            for (const s of sentencesInFlight) {
              fallbackBuffer += (fallbackBuffer ? " " : "") + s;
            }
            sentencesInFlight.length = 0;
          },
        });
      }
      sentencesInFlight.push(sentence);
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
        // Fix 3: the .then() continuation checks disposed before emitting.
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
