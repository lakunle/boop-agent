const OPENAI_TRANSCRIBE = "https://api.openai.com/v1/audio/transcriptions";

// Pricing: gpt-4o-mini-transcribe is $0.003/min. Verify against current
// OpenAI pricing if you adopt a different model.
const COST_PER_SECOND = 0.003 / 60;

export interface TranscribeResult {
  text: string;
  costUsd: number;
}

/**
 * Transcribe audio bytes using OpenAI's audio API. Throws on auth/network errors;
 * returns { text: "" } if the API succeeds but returns nothing meaningful.
 */
export async function transcribeAudio(
  fileBytes: Buffer,
  filename: string,
  mimeType: string,
  durationSeconds: number,
): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const form = new FormData();
  form.append("model", "gpt-4o-mini-transcribe");
  form.append(
    "file",
    new Blob([fileBytes.buffer as ArrayBuffer], { type: mimeType }),
    filename,
  );

  const res = await fetch(OPENAI_TRANSCRIBE, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`transcribe failed ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { text?: string };
  return {
    text: data.text ?? "",
    costUsd: durationSeconds * COST_PER_SECOND,
  };
}
