/**
 * Accumulates streamed tokens and emits coherent sentence chunks
 * suitable for ElevenLabs WS input. Handles common abbreviation
 * false-positives (Mr., U.S., 3.14). On flush(), emits whatever's
 * buffered. Optional maxBufferMs safety timer force-flushes when
 * the agent emits a long un-punctuated reply.
 */

export interface SentenceBufferOpts {
  onSentence: (sentence: string) => void;
  maxBufferMs?: number;
}

export interface SentenceBuffer {
  push(chunk: string): void;
  flush(): void;
  dispose(): void;
}

/**
 * Matches a sentence boundary: a terminating punctuation character ([.!?:])
 * followed by one or more whitespace characters, BUT NOT when the character
 * immediately before the punctuation is:
 *   - A known abbreviation prefix (Mr, Mrs, Ms, Dr, St, Sr, Jr, Prof, vs, etc,
 *     i.e, e.g, or the U.S / U.K style: a single uppercase letter after a dot)
 *   - A digit (handles decimals like 3.14)
 *
 * Node 18+ supports variable-length lookbehinds (ECMA-2018).
 */
const BOUNDARY =
  /(?<!\bMr|\bMrs|\bMs|\bDr|\bSt|\bSr|\bJr|\bProf|\bvs|\betc|\bi\.e|\be\.g|\b[A-Z]\.[A-Z]|\d)([.!?:])\s+/g;

/**
 * Extract completed sentences from the accumulated buffer.
 * Returns { sentences, remainder }.
 */
function extractSentences(buffer: string): {
  sentences: string[];
  remainder: string;
} {
  const sentences: string[] = [];
  let lastIndex = 0;

  // Reset the regex state since it's stateful (global flag)
  BOUNDARY.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = BOUNDARY.exec(buffer)) !== null) {
    // match.index is where the boundary punctuation starts
    // match[0] includes the punctuation + trailing whitespace
    // match[1] is the punctuation character itself
    const sentenceEnd = match.index + match[1].length; // index after the punctuation
    const sentence = buffer.slice(lastIndex, sentenceEnd).trim();
    if (sentence.length > 0) {
      sentences.push(sentence);
    }
    lastIndex = match.index + match[0].length; // skip past the whitespace
  }

  const remainder = buffer.slice(lastIndex);
  return { sentences, remainder };
}

export function createSentenceBuffer(opts: SentenceBufferOpts): SentenceBuffer {
  const { onSentence, maxBufferMs } = opts;
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  function armTimer() {
    if (maxBufferMs == null) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, maxBufferMs);
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flush() {
    clearTimer();
    if (buffer.trim().length === 0) {
      buffer = "";
      return;
    }
    // Emit the entire remaining buffer as one sentence (trimmed)
    onSentence(buffer.trim());
    buffer = "";
  }

  function push(chunk: string) {
    buffer += chunk;
    armTimer();

    const { sentences, remainder } = extractSentences(buffer);
    for (const s of sentences) {
      onSentence(s);
    }
    buffer = remainder;
  }

  function dispose() {
    clearTimer();
    buffer = "";
  }

  return { push, flush, dispose };
}
