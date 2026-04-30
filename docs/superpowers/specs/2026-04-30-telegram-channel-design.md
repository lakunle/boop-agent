# Telegram Channel + Channel Abstraction — Design Spec

**Date:** 2026-04-30
**Status:** Approved, ready for implementation plan

## Goal

Add **Telegram** as a second messaging channel for Boop, alongside the existing iMessage/Sendblue channel, with both running concurrently in the same Boop instance. The user controls a single "active channel" setting that determines where unsolicited messages (automation results, proactive nudges) are delivered. Direct conversation always replies on the channel where the user texted from. Telegram inbound voice notes are transcribed via OpenAI Whisper and processed as text.

## Why

iMessage-only is a hard constraint for users without an Apple device, in regions where iMessage isn't dominant, or for situations where Telegram is more convenient (web client, multi-device, voice notes). Telegram is the most-requested second channel and has a clean bot API. Adding it now also forces the codebase to grow a small **channel abstraction**, which previously didn't exist — `if (id.startsWith("sms:"))` checks live in four places today, and a third channel later (Discord, WhatsApp) would compound the duplication.

## Non-goals (v1)

- Outbound voice (Boop replying as audio).
- Inbound voice on Sendblue/iMessage. Telegram inbound voice only.
- Inbound photos, videos, stickers, documents, or any non-text/non-voice media.
- Telegram groups or channels (allowlist DMs only; group chat IDs rejected).
- Inline keyboards / callback queries / edited-message events.
- Multi-tenant memory isolation (single-user agent posture preserved).
- CI / automated test framework.
- Auto-switching active channel based on inbound (Q2=C was ruled out).
- Per-automation channel override beyond the existing `notifyConversationId` pin.
- A debug-dashboard switcher for the active channel (covered by natural-language self-tool; UI version is a follow-up).

---

## Architecture

```
                                                     ┌──────────────────┐
                                                     │ Convex settings  │
                                                     │  activeChannel   │
                                                     │  channelPrimary.*│
                                                     └────────┬─────────┘
                                                              │
                                                              ▼
                              ┌─────────────────────  resolveActiveChannel()
                              │
   iMessage  →  /sendblue/webhook  ─┐
                                    │
   Telegram  →  /telegram/webhook   │   (each channel parses + dedups + allowlists)
                                    ▼
                          channels/index.ts:runTurn()  ←── shared
                                    │
                                    ▼
                          handleUserMessage()  (unchanged)
                                    │
                                    ▼
                          dispatch(conversationId, reply, opts)
                                    │
                                    ▼
                       channels/index.ts:registry  ──► sendblueChannel.send()
                                                  └──► telegramChannel.send()

   automations.ts ──► dispatch(notifyConversationId ?? activeConversationId, …)
   proactive-email.ts ──► dispatch(activeConversationId, …)
   interaction-agent send_ack ──► dispatch(opts.conversationId, …)
```

Five principles encoded:

1. **Single dispatch point.** Every outbound message goes through `dispatch(conversationId, …)`. No call site knows which channel it's targeting; the prefix decides.
2. **Reply where addressed; push to active.** Direct replies follow the turn's channel. Automations, proactive nudges, and any future agent-initiated message go to the channel resolved from `activeChannel` settings.
3. **Channel-primary tracked per channel.** Every inbound message records its `conversationId` as that channel's "primary" (latest-wins). Active-channel resolution looks up that primary.
4. **Strict-by-default allowlist on Telegram.** Bot is publicly discoverable; fail closed and surface pending requests for explicit approval.
5. **Voice is text from the agent's perspective.** Transcripts get prefixed with `🎤 (voice 0:12)` and flow through the existing pipeline unchanged.

---

## File layout

### New files

```
server/channels/
├── types.ts          Channel interface, ConversationId template type, SendOpts
├── sendblue.ts       Adapter: imports from server/sendblue.ts and wraps as Channel
├── telegram.ts       Telegram implementation
├── index.ts          Registry, dispatch(), resolveActiveChannel(), runTurn()
└── text.ts           Shared stripMarkdown(), chunk() helpers

server/transcribe.ts  OpenAI Whisper wrapper (gpt-4o-mini-transcribe)

scripts/
├── telegram-webhook.mjs    Mirror of sendblue-webhook.mjs; calls Telegram setWebhook
├── telegram-approve.mjs    CLI to approve pending chat_ids
└── telegram-smoke.mjs      End-to-end smoke test

assets/voice-smoke.ogg      Short OGG/Opus clip for smoke test (~20KB)

convex/telegramDedup.ts        Mirror of sendblueDedup.ts
convex/telegramAllowlist.ts    Pending + allowed chat_id queries/mutations

docs/telegram-verification.md  Manual verification checklist
```

### Files modified

| File | Change |
|---|---|
| `server/sendblue.ts` | Stays in place. `createSendblueRouter` shrinks once `runTurn` is extracted (parsing + dedup + delegate). `sendImessage`, `startTypingLoop` keep their signatures. |
| `server/index.ts` | Replace `app.use("/sendblue", createSendblueRouter())` with `mountChannelRouters(app)` from `channels/index.ts`. Add startup warning when `activeChannel` points at a misconfigured channel. |
| `server/interaction-agent.ts` | `send_ack`'s `if (id.startsWith("sms:"))` block → `dispatch(opts.conversationId, text)`. History query → `recentAcrossChannels`, with `.filter(turnId !== currentTurnId)` instead of `.slice(0, -1)`. System-prompt self-inspection block grows two lines. `allowedTools` adds `mcp__boop-self__set_active_channel`. |
| `server/automations.ts` | `if (notifyConversationId.startsWith("sms:"))` → `dispatch(target, …)` where `target = notifyConversationId ?? (await resolveActiveChannel()).conversationId`. |
| `server/proactive-email.ts` | Drop `BOOP_USER_PHONE` env var path. Use `resolveActiveChannel()`; bail with a log if no target. |
| `server/runtime-config.ts` | Add `getActiveChannel`, `setActiveChannel`, `getChannelPrimary`, `recordChannelPrimary`, `resolveActiveChannel`. |
| `server/self-tools.ts` | Add `set_active_channel` tool (with `sms`/`tg`/`imessage`/`telegram` aliases). Extend `get_config` return value with `activeChannel`, `activeChannelTarget`, `configuredChannels`. |
| `convex/schema.ts` | Add `telegramDedup`, `telegramPendingAllowlist`, `telegramAllowedChatIds` tables. |
| `convex/messages.ts` | Add `recentAcrossChannels` query. Existing `recent` stays. |
| `convex/settings.ts` | No new mutations needed — uses existing key/value `set`/`get`. |
| `convex/usageRecords.ts` | Add `"transcribe"` to the `source` literal union so Whisper costs can be tracked alongside LLM costs. |
| `scripts/setup.ts` | Optional Telegram block: prompts for bot token, generates `TELEGRAM_WEBHOOK_SECRET`, writes to `.env.local`. |
| `scripts/dev.mjs` | Mount Telegram webhook auto-register alongside Sendblue's. Banner grows two conditional lines. |
| `package.json` | New scripts: `telegram:webhook`, `telegram:approve`, `telegram:smoke`. |
| `.env.example` | Add `TELEGRAM_*` vars. Remove `BOOP_USER_PHONE`. |
| `README.md` | Add a "Telegram" subsection with setup walkthrough. |

### Files unchanged

- `server/execution-agent.ts` — channel-agnostic, never touches conversation IDs.
- `server/memory/*` — already user-keyed.
- `server/draft-tools.ts`, `server/composio.ts`, `server/consolidation.ts`, `server/embeddings.ts`, `server/heartbeat.ts`, `server/usage.ts` — channel-agnostic.

---

## The `Channel` interface

```ts
// server/channels/types.ts
import type { Router } from "express";

export type ChannelId = "sms" | "tg";

/** Conversation IDs are channel-prefixed: "sms:+15551234567" or "tg:123456789". */
export type ConversationId = `${ChannelId}:${string}`;

export interface SendOpts {
  /** Optional URL of media to attach (PDFs from artifact pipeline). */
  mediaUrl?: string;
}

export interface ParsedInbound {
  conversationId: ConversationId;
  /** Human-readable identifier of sender for logs. */
  from: string;
  content: string;
}

export interface Channel {
  readonly id: ChannelId;
  readonly label: string;
  /** Path the webhook router mounts at, e.g. "/sendblue", "/telegram". */
  readonly webhookPath: string;

  /** True iff env vars are set and the channel can actually send. */
  isConfigured(): boolean;

  /** Send a final reply or unsolicited message. Handles chunking, markdown, attachments. */
  send(conversationId: ConversationId, text: string, opts?: SendOpts): Promise<void>;

  /** Start a typing indicator that auto-renews. Returns a stop fn. No-op if unsupported. */
  startTypingLoop(conversationId: ConversationId): () => void;

  /** Express router for the channel's webhook. */
  webhookRouter(): Router;
}
```

`server/channels/index.ts` provides:

```ts
export function getChannel(conversationId: string): Channel | null;
export async function dispatch(conversationId: ConversationId, text: string, opts?: SendOpts): Promise<void>;
export function startTyping(conversationId: ConversationId): () => void;
export function listChannels(): Channel[];
export function mountChannelRouters(app: Express): void;
export async function resolveActiveChannel(): Promise<{ channel: ChannelId; conversationId: ConversationId | null }>;
export async function runTurn(inbound: ParsedInbound): Promise<void>;
```

`runTurn` is the shared turn runner extracted from the current Sendblue webhook. It handles broadcast, typing loop, `handleUserMessage`, PDF artifact pickup, dispatch reply, persist assistant message, and error handling. It also records `channelPrimary.<channel>` on every turn (latest-wins).

---

## Inbound: Telegram webhook

### Update parsing

The webhook handles only `update.message.text` and `update.message.voice`. All other update types (edited messages, photos, callbacks) return `200 OK` with `skipped: true` and no further processing.

```ts
router.post("/webhook", async (req, res) => {
  // 1. Secret-token verification
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && req.header("x-telegram-bot-api-secret-token") !== expected) {
    res.status(401).end();
    return;
  }

  const update = req.body ?? {};
  const msg = update.message;
  const updateId = update.update_id;
  if (typeof updateId !== "number" || !msg) {
    res.json({ ok: true, skipped: true });
    return;
  }

  // 2. Group-chat reject (chat_id < 0 = group)
  const chatId = msg.chat.id;
  if (chatId < 0) {
    res.json({ ok: true, skipped: true });
    return;
  }

  // 3. Allowlist (hybrid env + Convex)
  if (!(await isAllowed(chatId))) {
    await convex.mutation(api.telegramAllowlist.recordPending, {
      chatId,
      username: msg.from?.username,
      firstName: msg.from?.first_name,
    });
    console.warn(
      `[telegram] denied chat_id=${chatId} (@${msg.from?.username ?? "?"}) — pending approval (run \`npm run telegram:approve\`)`,
    );
    res.json({ ok: true, denied: true });
    return;
  }

  // 4. Dedup
  const { claimed } = await convex.mutation(api.telegramDedup.claim, { updateId });
  if (!claimed) {
    res.json({ ok: true, deduped: true });
    return;
  }

  // 5. Resolve content (text or transcribed voice)
  let content: string;
  if (msg.voice) {
    res.json({ ok: true });  // ack early — transcription can take a few seconds
    content = await resolveVoiceContent(msg.voice, chatId);
    if (!content) return;  // resolveVoiceContent already replied with an error
  } else if (msg.text) {
    res.json({ ok: true });
    content = msg.text;
  } else {
    res.json({ ok: true, skipped: true });
    return;
  }

  await runTurn({
    conversationId: `tg:${chatId}` as ConversationId,
    content,
    from: `tg:${msg.from?.username ? "@" + msg.from.username : chatId}`,
  });
});
```

### Allowlist (hybrid env + Convex)

```ts
async function isAllowed(chatId: number): Promise<boolean> {
  const fromEnv = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.includes(String(chatId))) return true;
  return await convex.query(api.telegramAllowlist.isAllowed, { chatId });
}
```

Static allowlist via env var works for "bake my chat_id into config." Dynamic allowlist via Convex works for runtime approvals (no restart needed).

When `isAllowed` returns false, the webhook records the rejected chat_id in `telegramPendingAllowlist` (with username + first_name from the Telegram update). The user later runs `npm run telegram:approve` to walk pending entries:

```
$ npm run telegram:approve
1 pending chat_id:
  chat_id=12345678 (@alice, "Alice") — first seen 5m ago, 3 attempts
Allow? (y/N): y
Allowed. The bot will respond on next message.
```

The CLI writes to `telegramAllowedChatIds` in Convex and clears the pending entry. No env-var edit, no restart.

### Convex tables

```ts
// convex/schema.ts (additions)
telegramDedup: defineTable({
  updateId: v.number(),
  claimedAt: v.number(),
}).index("by_updateId", ["updateId"]),

telegramPendingAllowlist: defineTable({
  chatId: v.number(),
  username: v.optional(v.string()),
  firstName: v.optional(v.string()),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  attemptCount: v.number(),
}).index("by_chatId", ["chatId"]),

telegramAllowedChatIds: defineTable({
  chatId: v.number(),
  approvedAt: v.number(),
}).index("by_chatId", ["chatId"]),
```

---

## Voice notes (Telegram inbound)

### Flow

```
update.message.voice = { file_id, duration, mime_type, file_size }
  │
  ▼  duration > TELEGRAM_VOICE_MAX_DURATION ? → reply "too long", drop
  │
  ▼  OPENAI_API_KEY unset ? → reply "voice needs OPENAI_API_KEY", drop
  │
  ▼  GET https://api.telegram.org/bot<TOKEN>/getFile?file_id=<id>
  │  → { file_path }
  │
  ▼  GET https://api.telegram.org/file/bot<TOKEN>/<file_path>
  │  → audio bytes
  │
  ▼  POST https://api.openai.com/v1/audio/transcriptions
  │  multipart: model=gpt-4o-mini-transcribe, file=<bytes>
  │  → { text: "hello boop" }
  │
  ▼  empty / null transcript ? → reply "couldn't hear that", drop
  │
  ▼  content = `🎤 (voice 0:12) hello boop`
  │
  ▼  runTurn({ conversationId, content, from })
```

### Transcribe helper

```ts
// server/transcribe.ts
const OPENAI_TRANSCRIBE = "https://api.openai.com/v1/audio/transcriptions";

export interface TranscribeResult {
  text: string;
  costUsd: number;
}

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
  form.append("file", new Blob([fileBytes], { type: mimeType }), filename);

  const res = await fetch(OPENAI_TRANSCRIBE, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`transcribe failed ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as { text: string };

  // gpt-4o-mini-transcribe pricing: $0.003/min (verify against current OpenAI pricing at impl time)
  const costUsd = (durationSeconds / 60) * 0.003;
  return { text: data.text ?? "", costUsd };
}
```

### Channel-side voice handler

```ts
async function resolveVoiceContent(
  voice: { file_id: string; duration: number; mime_type?: string; file_size?: number },
  chatId: number,
): Promise<string | null> {
  const max = Number(process.env.TELEGRAM_VOICE_MAX_DURATION ?? 600);
  if (voice.duration > max) {
    await dispatch(`tg:${chatId}` as ConversationId,
      `That voice note is ${formatDuration(voice.duration)} — longer than I can transcribe (cap ${formatDuration(max)}). Try a shorter clip or type it.`);
    return null;
  }
  if (!process.env.OPENAI_API_KEY) {
    await dispatch(`tg:${chatId}` as ConversationId,
      "Voice notes need OPENAI_API_KEY to be configured. Type your message instead.");
    return null;
  }
  try {
    const fileBytes = await downloadTelegramFile(voice.file_id);
    const { text, costUsd } = await transcribeAudio(
      fileBytes,
      `voice-${voice.file_id}.ogg`,
      voice.mime_type ?? "audio/ogg",
      voice.duration,
    );
    if (!text.trim()) {
      await dispatch(`tg:${chatId}` as ConversationId,
        "I couldn't hear that — can you type it instead?");
      return null;
    }
    await convex.mutation(api.usageRecords.record, {
      source: "transcribe",
      conversationId: `tg:${chatId}`,
      model: "gpt-4o-mini-transcribe",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd,
      durationMs: voice.duration * 1000,
    });
    return `🎤 (voice ${formatDuration(voice.duration)}) ${text.trim()}`;
  } catch (err) {
    console.error("[telegram] transcription error", err);
    await dispatch(`tg:${chatId}` as ConversationId,
      "I had trouble transcribing that — can you type it instead?");
    return null;
  }
}
```

The `🎤 (voice 0:12)` prefix on `content` means the dispatcher's history block, memory extraction, and consolidation all see "this user spoke" naturally — no schema changes needed.

`formatDuration(seconds)` is a small new helper in `server/channels/text.ts` that renders seconds as `m:ss` (e.g. `0:12`, `1:47`). Used by both the prefix and the over-cap error message.

---

## Outbound dispatch & active-channel resolution

### Settings keys

| Key | Type | Default | Set when |
|---|---|---|---|
| `activeChannel` | `"sms" \| "tg"` | `"sms"` | User invokes `set_active_channel` self-tool |
| `channelPrimary.sms` | `"sms:+1..."` | unset | Every inbound iMessage (latest wins) |
| `channelPrimary.tg` | `"tg:<id>"` | unset | Every inbound Telegram (latest wins) |

### Helpers (`server/runtime-config.ts`)

```ts
// Note: api.settings.get returns string | null directly (see convex/settings.ts).
// No `.value` unwrap needed.

export async function getActiveChannel(): Promise<ChannelId> {
  const value = await convex.query(api.settings.get, { key: "activeChannel" });
  return value === "tg" || value === "sms" ? value : "sms";
}

export async function setActiveChannel(channel: ChannelId): Promise<void> {
  await convex.mutation(api.settings.set, { key: "activeChannel", value: channel });
}

export async function getChannelPrimary(channel: ChannelId): Promise<ConversationId | null> {
  const value = await convex.query(api.settings.get, { key: `channelPrimary.${channel}` });
  return (value as ConversationId | null) ?? null;
}

export async function recordChannelPrimary(conversationId: ConversationId): Promise<void> {
  const ch = conversationId.split(":", 1)[0] as ChannelId;
  await convex.mutation(api.settings.set, {
    key: `channelPrimary.${ch}`,
    value: conversationId,
  });
}

export async function resolveActiveChannel(): Promise<{
  channel: ChannelId;
  conversationId: ConversationId | null;
}> {
  const channel = await getActiveChannel();
  return { channel, conversationId: await getChannelPrimary(channel) };
}
```

`recordChannelPrimary` is called inside `runTurn` (one place, can't drift).

### Call-site changes

| Site | Change |
|---|---|
| `server/sendblue.ts:208` (final reply) | Becomes part of `runTurn`. `await dispatch(conversationId, reply, opts)`. |
| `server/interaction-agent.ts:209-213` (`send_ack`) | `if (opts.kind !== "proactive") await dispatch(opts.conversationId, text);` |
| `server/automations.ts:71-75` (cron result) | `const target = a.notifyConversationId ?? (await resolveActiveChannel()).conversationId; if (target) await dispatch(target, preamble + res.result);` |
| `server/proactive-email.ts:303` (proactive nudge) | Drop `BOOP_USER_PHONE` env var path. `const { conversationId } = await resolveActiveChannel(); if (!conversationId) { log; return; } await dispatch(conversationId, notice);` |

### Automations: `notifyConversationId` semantics (Option β)

Existing automations have `notifyConversationId = "sms:..."` baked in at creation time. Those continue to pin to iMessage (good — they were created in iMessage, that's where the user wanted them).

New automations default to `notifyConversationId = null`, which means "float to active channel at fire time." `automation-tools.ts:create_automation` updated so `notify` defaults to null instead of the originating conversation.

Migration: zero. Existing rows keep working as-is.

---

## Active-channel setting & user control

### Self-tool: `set_active_channel`

Lives in `server/self-tools.ts`. Accepts aliases for natural-language ergonomics.

```ts
tool(
  "set_active_channel",
  `Switch which channel receives unsolicited messages (automation results,
   proactive nudges). Use when the user says things like "use telegram now",
   "switch back to imessage", "send notifications to telegram".
   Direct replies always go to whichever channel the user texted from —
   this only affects unsolicited messages. Returns an error if the target
   channel is not configured or the user has not texted it yet.`,
  {
    channel: z.enum(["sms", "tg", "imessage", "telegram"])
      .describe('Channel to make active. "sms"/"imessage" and "tg"/"telegram" are aliases.'),
  },
  async (args) => {
    const target: ChannelId =
      args.channel === "imessage" ? "sms" :
      args.channel === "telegram" ? "tg" :
      args.channel;

    const channel = registry[target];
    if (!channel?.isConfigured()) {
      return {
        content: [{
          type: "text" as const,
          text: `${target === "tg" ? "Telegram" : "iMessage"} is not configured on this server. ` +
                `Set ${target === "tg" ? "TELEGRAM_BOT_TOKEN" : "SENDBLUE_API_KEY"} in .env.local and restart.`,
        }],
      };
    }

    const primary = await getChannelPrimary(target);
    if (!primary) {
      return {
        content: [{
          type: "text" as const,
          text: target === "tg"
            ? `I haven't received a message from you on Telegram yet. Text @<bot_username> once, then try again.`
            : `I haven't received a message from you on iMessage yet. Text the Boop number once, then try again.`,
        }],
      };
    }

    await setActiveChannel(target);
    return {
      content: [{
        type: "text" as const,
        text: `Active channel set to ${channel.label}. Automations and proactive nudges will go to ${primary} from now on.`,
      }],
    };
  },
),
```

### `get_config` extension

Existing `get_config` self-tool grows three fields:

```ts
const { channel, conversationId } = await resolveActiveChannel();
return {
  // ...existing fields (model, userTimezone, currentLocalTime, ...)
  activeChannel: channel,
  activeChannelTarget: conversationId,
  configuredChannels: listChannels().map((c) => c.id),
};
```

### Dispatcher system-prompt addition

`server/interaction-agent.ts:128-137` self-inspection block grows two lines:

```
- "What channel are you using?" / "Where do notifications go?" → get_config (returns activeChannel + activeChannelTarget)
- "Use telegram now" / "switch back to imessage" / "send pings to X" → set_active_channel
```

`allowedTools` adds `mcp__boop-self__set_active_channel`.

---

## Unioned recent-history

### New Convex query

```ts
// convex/messages.ts
export const recentAcrossChannels = query({
  args: {
    conversationIds: v.array(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, { conversationIds, limit }) => {
    if (conversationIds.length === 0) return [];
    const perConvo = await Promise.all(
      conversationIds.map((cid) =>
        ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) => q.eq("conversationId", cid))
          .order("desc")
          .take(limit),
      ),
    );
    const merged = perConvo.flat();
    merged.sort((a, b) => a._creationTime - b._creationTime);
    return merged.slice(-limit);
  },
});
```

Existing `recent` query stays for the debug dashboard's per-conversation views.

### Dispatcher change

`server/interaction-agent.ts:269-272`:

```ts
const channelPrimaries = await Promise.all([
  getChannelPrimary("sms"),
  getChannelPrimary("tg"),
]);
const conversationIds = Array.from(
  new Set(
    [opts.conversationId, ...channelPrimaries].filter((id): id is string => !!id),
  ),
);
const history = await convex.query(api.messages.recentAcrossChannels, {
  conversationIds,
  limit: 10,
});
```

And on line 274, replace `.slice(0, -1)` with `.filter((m) => m.turnId !== turnId)` for defensive ordering against `_creationTime` collisions.

---

## Setup, env vars, dev experience

### Env vars

| Var | Required? | Default | Notes |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes (to enable Telegram) | unset | From @BotFather. Without it, `telegramChannel.isConfigured()` returns false. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | optional | unset = no static allowlist | Comma-separated chat IDs. Combines with the dynamic Convex allowlist (hybrid). |
| `TELEGRAM_WEBHOOK_SECRET` | optional | auto-generated by `npm run setup` | Verified via `X-Telegram-Bot-Api-Secret-Token`. |
| `TELEGRAM_AUTO_WEBHOOK` | optional | `true` | Set to `false` to opt out of auto-registration. |
| `TELEGRAM_BOT_USERNAME` | optional | resolved via `getMe` at boot | Powers the "@your_bot" placeholder in error messages. |
| `TELEGRAM_VOICE_MAX_DURATION` | optional | `600` (10 min) | Voice-note duration cap in seconds. Above this, transcription is skipped. |
| `OPENAI_API_KEY` | optional but **required for voice** | unset | Same key already used optionally for embeddings. Now also unlocks Whisper. |

**Removed:** `BOOP_USER_PHONE` (replaced by active-channel resolution).

### Auto-registration script

`scripts/telegram-webhook.mjs`:

```js
// Mirror of sendblue-webhook.mjs. Hits Telegram API directly, no CLI.
const url = process.argv[2]; // public URL passed by dev.mjs
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token) process.exit(0);  // Telegram not configured, skip silently

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: `${url}/telegram/webhook`,
    secret_token: secret,
    drop_pending_updates: true,
    allowed_updates: ["message"],
  }),
});
// log success/failure mirror of sendblue
```

Wired into `scripts/dev.mjs`: same gating as Sendblue (auto-fires only when public URL is dynamic; skipped when `PUBLIC_URL` static or `TELEGRAM_AUTO_WEBHOOK=false`).

### Banner

```
════════════════════════════════════════════════════════════════════
  Boop is ready — ngrok tunnel is live  (webhooks auto-registered).

  🐶 Debug dashboard (click me):    http://localhost:5173
  🌐 Public URL:                    https://abc123.ngrok-free.app
  📮 Sendblue webhook (inbound):    https://abc123.ngrok-free.app/sendblue/webhook
  📱 Text this Sendblue number:     +13053369541  (from a DIFFERENT phone)
  📮 Telegram webhook (inbound):    https://abc123.ngrok-free.app/telegram/webhook
  🤖 Telegram bot:                  @your_boop_bot
════════════════════════════════════════════════════════════════════
```

The two Telegram lines appear iff `TELEGRAM_BOT_TOKEN` is set. Otherwise banner looks identical to today.

### Setup-script flow

After existing Sendblue prompts, optional Telegram block:

```
Do you want to enable Telegram? (y/N): y

  1. Open Telegram and message @BotFather: /newbot
  2. Follow the prompts. Copy the bot token when given.
  3. Paste it here:

Bot token: 123456:ABC-DEF...

  Generated TELEGRAM_WEBHOOK_SECRET (random 32-byte hex).

Done. Telegram bot token + webhook secret saved to .env.local.

Next: run `npm run dev`. Message your bot once. The server logs will show
the rejected chat_id — run `npm run telegram:approve` to allow it.
```

Skippable with `n`.

---

## Error handling & edge cases

### Markdown / formatting

Strip Markdown to plain text on Telegram, mirroring iMessage. `stripMarkdown` and `chunk` move to `server/channels/text.ts` and both channels import from there. Telegram chunk size is 4000 (4096 hard cap with margin); iMessage stays at 2900. Set `link_preview_options: { is_disabled: true }` on every Telegram `sendMessage` to prevent URL cards.

### PDF / media attachments

Telegram uses `sendDocument` (separate API call from `sendMessage`). Existing PDF artifact pipeline produces public signed Convex URLs — works without changes. Fallback on `sendDocument` failure: append `📎 <url>` as a final text message.

### Webhook retries

Both webhooks ack 200 early before `runTurn`. Telegram retries on 5xx or no response within ~60s; the dedup table catches the rare case where a retry lands before the original `update_id` insert.

### Rate limits

Telegram caps at ~30 msg/sec per bot, ~1 msg/sec per chat. Single-user agent never hits these. **No mitigation in v1.**

### Bot-token leakage

Add a `redactToken` helper. All `console.error` calls touching Telegram URLs use it: `bot${redactToken(token)}/sendMessage` instead of the raw token.

### Active channel pointing at misconfigured channel

On server boot (`server/index.ts:main`), check the resolved active channel and log a warning if its credentials are missing:

```ts
const { channel } = await resolveActiveChannel();
const ch = registry[channel];
if (!ch.isConfigured()) {
  console.warn(
    `[channels] Active channel is "${ch.label}" but its credentials are missing. ` +
    `Unsolicited messages will be dropped. Set ${channel === "tg" ? "TELEGRAM_BOT_TOKEN" : "SENDBLUE_API_KEY"} or change active channel.`,
  );
}
```

### Bot blocked / token revoked

`telegramChannel.send` catches the 401/403 from Telegram and logs. The send is dropped. Boop never panics. No automatic fallback to the dormant channel — that would violate the user's "Telegram is active" intent.

### Voice failure modes

| Failure | Behavior |
|---|---|
| Duration > cap | Polite text reply, no Whisper call, no `runTurn`. |
| `OPENAI_API_KEY` unset | Polite text reply explaining the requirement. |
| `getFile` 4xx/5xx | Log + polite text reply. |
| Audio download network error | Log + polite text reply. |
| Whisper API error | Log + polite text reply. |
| Empty transcript | Polite text reply, no `runTurn` (don't process empty input). |

---

## Testing

### Smoke script

`scripts/telegram-smoke.mjs`. Runs end-to-end against the local server.

1. Posts a synthetic text-message update → asserts a `messages` row appears with `role="user"`.
2. Posts a synthetic voice-message update with `assets/voice-smoke.ogg` (a known short OGG/Opus clip saying *"hello boop testing"*) → asserts the transcript starts with the `🎤` marker and contains `hello`.
3. Posts an update with a non-allowlisted `chat_id` → asserts `telegramPendingAllowlist` row created and *no* `messages` row.
4. Posts a duplicate `update_id` → asserts the second is deduped.

Wired as `npm run telegram:smoke`. Uses `TELEGRAM_SMOKE_CHAT_ID` env var (must be allowlisted) so it can't pollute real conversations.

### Typecheck-driven correctness

The `Channel` interface is the main lever. Both implementations declared `: Channel`. `ConversationId` template literal type forces every `dispatch()` call to use a prefixed string. `getChannel(id) → Channel | null` forces null-handling. `npm run typecheck` (already in `scripts/preflight.mjs`) catches structural drift.

### Manual verification checklist

`docs/telegram-verification.md` ships with the spec. Covered scenarios:

- Telegram inbound: text, voice, voice > 10 min, voice without `OPENAI_API_KEY`, photo/sticker, edited message, group chat ID
- Allowlist: deny → pending → approve via CLI; env-var allowlist
- Active channel: switch via natural language, switch refuses on unconfigured/never-texted channel, automation lands on active channel, switch back
- Cross-channel context: morning iMessage + afternoon Telegram + agent recalls the morning message in its 10-turn window
- Regressions on iMessage: text round-trip, PDF attachment, `send_ack`, automation, proactive nudge
- Stress: server restart mid-turn, bot-token revocation, active-channel-pointing-at-missing-creds boot warning

### What is NOT tested

- Whisper transcription accuracy (trusted).
- Telegram rate limits (single-user won't hit).
- MarkdownV2 escaping (we don't use it).
- Multi-tenant message isolation (single-user agent).

### CI

Out of scope. Add later if the project's testing posture changes.

---

## Migration & rollout

This is a fork-and-own template, not a deployed service. Implementation lands as a single PR with these commits, in order:

1. **Extract shared `runTurn` helper** — pure refactor of existing Sendblue webhook. No new behavior. Includes `channels/types.ts`, `channels/index.ts` (registry, dispatch, runTurn — but **without** the `recordChannelPrimary` call yet), `channels/sendblue.ts` (adapter), and `channels/text.ts` (shared helpers). Migrates three of the four outbound call sites to `dispatch()`: the Sendblue final reply (folded into `runTurn`), `interaction-agent.ts:send_ack`, and `automations.ts:cron-result`. `proactive-email.ts` keeps its existing `BOOP_USER_PHONE`-derived conversation but goes through `dispatch()` instead of `sendImessage` directly. After this commit, iMessage works exactly as before.

2. **Add Convex schema for Telegram + active channel** — `telegramDedup`, `telegramPendingAllowlist`, `telegramAllowedChatIds`, `messages.recentAcrossChannels`. Empty tables, no behavior change yet.

3. **Add active-channel runtime helpers + self-tool + dispatcher updates** — `getActiveChannel`, `setActiveChannel`, `recordChannelPrimary`, `resolveActiveChannel`, `set_active_channel` self-tool, `get_config` extension, system-prompt block, history union query in dispatcher. **Wires `recordChannelPrimary` into `runTurn`** so every inbound message records its channel-primary. Updates `automations.ts` and `proactive-email.ts` to use `resolveActiveChannel`. Defaults to `sms`, so behavior is unchanged on existing Boop installs.

4. **Add Telegram channel implementation (text only)** — `channels/telegram.ts`, `convex/telegramDedup.ts`, `convex/telegramAllowlist.ts`, allowlist CLI (`scripts/telegram-approve.mjs`), webhook auto-register (`scripts/telegram-webhook.mjs`), banner update (`scripts/dev.mjs`), env vars (`.env.example`), README section.

5. **Add voice-note support** — `server/transcribe.ts`, `resolveVoiceContent` in `channels/telegram.ts`, voice-smoke fixture, smoke-test extension.

6. **Add manual verification doc** — `docs/telegram-verification.md`.

Each commit typechecks and leaves the system runnable. Bisect-friendly.

---

## Open questions / followups

- **Debug-dashboard channel switcher.** Out of v1 (Section 5e). Natural-language self-tool covers the core need. Add as follow-up if the natural-language path feels cumbersome.
- **Sendblue inbound voice.** Not in v1 (Section 8.5). Layers on later by parsing Sendblue's `media_url` and routing through the same `transcribeAudio` helper.
- **Whisper alternatives.** v1 hardcodes OpenAI. If a user wants Deepgram / AssemblyAI / local, that's a follow-up — `transcribeAudio` becomes a strategy interface.
- **Per-message-bucket rate limiting.** YAGNI for single-user. If multi-tenant ever happens, add a token bucket in `telegramChannel.send`.
- **Multi-tenant memory keying.** Already a known caveat in `ARCHITECTURE.md:222`. Not regressed, not addressed.
