const OPENAI_CHAT = "https://api.openai.com/v1/chat/completions";

// Models we've already warned about — keeps log noise to one warning per
// unknown model per process. Lives at module scope, not per-call.
const warnedModels = new Set<string>();

// Pricing as of 2026-05. gpt-4o is the default; gpt-4o-mini is supported via
// BOOP_VISION_MODEL override. Add new entries here when adding model support.
const PRICING: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 2.5 / 1_000_000, out: 10 / 1_000_000 },
  "gpt-4o-mini": { in: 0.15 / 1_000_000, out: 0.6 / 1_000_000 },
};

export interface VisionResult {
  description: string;
  costUsd: number;
  model: string;
}

export interface VisionOptions {
  /** A short hint from the sender (e.g. user's caption) appended to the user message. */
  promptHint?: string;
  /** When extracting from a multi-page PDF, the page number context. */
  pageContext?: { page: number; total: number };
  /** Test seam — inject a custom fetch implementation. */
  deps?: { fetch?: typeof fetch };
}

const SYSTEM_PROMPT =
  "Describe this image in 2–4 sentences. Capture: subject, layout/composition, " +
  "dominant colors, typography style if any, text content if legible. Be concrete " +
  "and visual; this description routes the image to a downstream agent.";

/**
 * Describe an image via OpenAI's chat-completions vision endpoint. Returns the
 * description text plus an estimated cost in USD (computed from token usage).
 *
 * Throws on auth/network/HTTP errors. Caller is expected to surface a
 * user-friendly error to the channel.
 *
 * If BOOP_VISION_MODEL is set to a model not in PRICING, gpt-4o pricing is
 * used as a fallback and a one-time warning is logged. Add the model to
 * PRICING to fix cost accuracy.
 */
export async function describeImage(
  bytes: Buffer,
  mimeType: string,
  options: VisionOptions = {},
): Promise<VisionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const model = process.env.BOOP_VISION_MODEL ?? "gpt-4o";
  const fetchImpl = options.deps?.fetch ?? fetch;

  const userText = [
    options.pageContext
      ? `(Page ${options.pageContext.page} of ${options.pageContext.total})`
      : null,
    options.promptHint ? `Hint from sender: ${options.promptHint}` : null,
    "Describe this image now.",
  ]
    .filter(Boolean)
    .join("\n");

  const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;

  const res = await fetchImpl(OPENAI_CHAT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 300,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI vision failed ${res.status}: ${body}`);
  }
  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const description = json.choices?.[0]?.message?.content?.trim() ?? "";
  const pricing = PRICING[model];
  if (!pricing && !warnedModels.has(model)) {
    console.warn(
      `[vision] BOOP_VISION_MODEL="${model}" not in PRICING table — using gpt-4o pricing for cost estimates. Add it to server/vision.ts:PRICING for accuracy.`,
    );
    warnedModels.add(model);
  }
  const effective = pricing ?? PRICING["gpt-4o"];
  const costUsd =
    (json.usage?.prompt_tokens ?? 0) * effective.in +
    (json.usage?.completion_tokens ?? 0) * effective.out;

  return { description, costUsd, model };
}
