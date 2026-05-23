import { WebSocket } from "ws";

export interface ElevenLabsStreamOpts {
  voiceId: string;
  modelId: string;
  apiKey: string;
  onChunk: (audioBase64: string) => void;
  onDone: () => void;
  onError: (reason: string) => void;
  /** Test hook — override the WS URL (skip the real ElevenLabs endpoint). */
  wsUrlOverride?: string;
}

export interface ElevenLabsStream {
  opened: Promise<void>;
  send(text: string): void;
  end(): Promise<void>;
  abort(): void;
}

export function createElevenLabsStream(opts: ElevenLabsStreamOpts): ElevenLabsStream {
  const url = opts.wsUrlOverride ?? (
    `wss://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}/stream-input` +
    `?model_id=${opts.modelId}&output_format=mp3_44100_128`
  );
  const ws = new WebSocket(url, {
    headers: { "xi-api-key": opts.apiKey },
  });

  let opened = false;
  let ended = false;
  let doneFired = false;

  function fireOnDoneOnce() {
    if (!doneFired) {
      doneFired = true;
      opts.onDone();
    }
  }

  const openedPromise = new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      opened = true;
      // Send initialization frame (ElevenLabs streaming protocol). Skip when
      // using a wsUrlOverride — the mock server doesn't speak this protocol.
      if (!opts.wsUrlOverride) {
        ws.send(JSON.stringify({
          text: " ",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          xi_api_key: opts.apiKey,
        }));
      }
      resolve();
    });
    ws.on("error", (err) => {
      opts.onError(`ws error: ${err.message}`);
      if (!opened) reject(err);
    });
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.audio) opts.onChunk(msg.audio);
      if (msg.isFinal) fireOnDoneOnce();
    } catch (e) {
      opts.onError(`parse error: ${(e as Error).message}`);
    }
  });

  ws.on("close", () => {
    if (!ended) fireOnDoneOnce();
  });

  return {
    opened: openedPromise,
    send(text) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ text: text + " ", try_trigger_generation: true }));
    },
    async end() {
      ended = true;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ text: "" }));
      await new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
        setTimeout(resolve, 2000); // hard cap so the test doesn't hang
      });
    },
    abort() {
      ended = true;
      ws.close();
    },
  };
}
