import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import type { ChannelId, ConversationId } from "./channels/types.js";

const MODEL_KEY = "model";
const MODEL_TTL_MS = 30 * 1000;
let cached: { at: number; value: string } | null = null;

// User-friendly aliases the agent can pass through from iMessage. Resolved to
// canonical Anthropic model IDs before being handed to the SDK.
export const MODEL_ALIASES: Record<string, string> = {
  opus: "claude-opus-4-7",
  "opus 4.7": "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  "sonnet 4.6": "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
  "haiku 4.5": "claude-haiku-4-5-20251001",
};

export const KNOWN_MODELS = new Set<string>([
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
]);

export function resolveModelInput(input: string): string | null {
  const lower = input.trim().toLowerCase();
  if (KNOWN_MODELS.has(lower)) return lower;
  return MODEL_ALIASES[lower] ?? null;
}

function envFallback(): string {
  return process.env.BOOP_MODEL ?? "claude-sonnet-4-6";
}

export async function getRuntimeModel(): Promise<string> {
  if (cached && Date.now() - cached.at < MODEL_TTL_MS) return cached.value;
  let stored: string | null = null;
  try {
    stored = await convex.query(api.settings.get, { key: MODEL_KEY });
  } catch (err) {
    console.warn("[runtime-config] settings:get failed", err);
  }
  // Re-validate even though set_model writes through resolveModelInput — the
  // settings table is also writable via the Convex dashboard and other
  // mutations, and a bad value here would surface as an opaque SDK 4xx on the
  // next turn instead of falling back gracefully.
  const final = stored && KNOWN_MODELS.has(stored) ? stored : envFallback();
  cached = { at: Date.now(), value: final };
  return final;
}

export async function setRuntimeModel(model: string): Promise<void> {
  await convex.mutation(api.settings.set, { key: MODEL_KEY, value: model });
  cached = { at: Date.now(), value: model };
}

export async function clearRuntimeModel(): Promise<void> {
  await convex.mutation(api.settings.clear, { key: MODEL_KEY });
  cached = null;
}

const ACTIVE_CHANNEL_KEY = "activeChannel";
const channelPrimaryKey = (ch: ChannelId) => `channelPrimary.${ch}`;

export async function getActiveChannel(): Promise<ChannelId> {
  let value: string | null = null;
  try {
    value = await convex.query(api.settings.get, { key: ACTIVE_CHANNEL_KEY });
  } catch (err) {
    console.warn("[runtime-config] settings:get(activeChannel) failed", err);
  }
  return value === "tg" || value === "sms" ? value : "sms";
}

export async function setActiveChannel(channel: ChannelId): Promise<void> {
  await convex.mutation(api.settings.set, {
    key: ACTIVE_CHANNEL_KEY,
    value: channel,
  });
}

export async function getChannelPrimary(channel: ChannelId): Promise<ConversationId | null> {
  let value: string | null = null;
  try {
    value = await convex.query(api.settings.get, { key: channelPrimaryKey(channel) });
  } catch (err) {
    console.warn("[runtime-config] settings:get(channelPrimary) failed", err);
  }
  if (!value) return null;
  // Defensive: only return values that match the expected prefix.
  if (value.startsWith(`${channel}:`)) return value as ConversationId;
  return null;
}

export async function recordChannelPrimary(conversationId: ConversationId): Promise<void> {
  const ch = conversationId.split(":", 1)[0] as ChannelId;
  if (ch !== "sms" && ch !== "tg") return;
  await convex.mutation(api.settings.set, {
    key: channelPrimaryKey(ch),
    value: conversationId,
  });
}

export async function resolveActiveChannel(): Promise<{
  channel: ChannelId;
  conversationId: ConversationId | null;
}> {
  const channel = await getActiveChannel();
  const conversationId = await getChannelPrimary(channel);
  return { channel, conversationId };
}
