# Telegram Channel + Channel Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Telegram as a second messaging channel for Boop, with a small channel-abstraction layer, a user-controlled active-channel setting, cross-channel recent-history continuity, and Telegram inbound voice transcription via OpenAI Whisper.

**Architecture:** Introduce `server/channels/` with a `Channel` interface; both Sendblue and Telegram implement it. A central `dispatch(conversationId, …)` routes outbound messages by prefix. `runTurn` is the shared turn runner extracted from the existing Sendblue webhook. Active channel is a settings key consulted only by automations and proactive nudges; direct replies always follow the turn's channel.

**Tech Stack:** TypeScript, Express, Convex, Claude Agent SDK, OpenAI Whisper API (`gpt-4o-mini-transcribe`), Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-04-30-telegram-channel-design.md` — read first.

**Verification:** Project has no test framework. Each task verifies via `npm run typecheck` (mandatory after every change), Convex's own type generation (`npx convex dev` reports schema/function errors), and dedicated smoke scripts (`scripts/telegram-smoke.mjs` introduced in Phase 4). Manual end-to-end checklist (`docs/telegram-verification.md`) is the final gate.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `server/channels/types.ts` | `Channel` interface, `ChannelId`, `ConversationId`, `SendOpts`, `ParsedInbound` |
| `server/channels/text.ts` | Shared `stripMarkdown`, `chunk`, `formatDuration` (pure utilities) |
| `server/channels/sendblue.ts` | Adapter — wraps existing `server/sendblue.ts` exports as a `Channel` |
| `server/channels/telegram.ts` | Telegram implementation: send, typing, webhook, voice handling |
| `server/channels/index.ts` | Registry, `dispatch`, `mountChannelRouters`, `runTurn`, `resolveActiveChannel` |
| `server/transcribe.ts` | OpenAI Whisper wrapper — single `transcribeAudio` function |
| `convex/telegramDedup.ts` | `claim` mutation for `update_id` dedup |
| `convex/telegramAllowlist.ts` | `isAllowed`, `recordPending`, `listPending`, `allow`, `dismiss` queries/mutations |
| `scripts/telegram-webhook.mjs` | One-shot script that calls Telegram's `setWebhook` API |
| `scripts/telegram-approve.mjs` | Interactive CLI for approving pending chat_ids |
| `scripts/telegram-smoke.mjs` | End-to-end smoke test (text + voice + allowlist + dedup) |
| `assets/voice-smoke.ogg` | ~20KB OGG/Opus clip saying "hello boop testing" — fixture for smoke test |
| `docs/telegram-verification.md` | Manual verification checklist |

### Files modified

| Path | Lines / Function | Change |
|---|---|---|
| `server/sendblue.ts` | `createSendblueRouter` | Shrink to parse + dedup + delegate to `runTurn`. `sendImessage` and `startTypingLoop` keep their signatures. |
| `server/index.ts` | `main` | Replace `app.use("/sendblue", createSendblueRouter())` with `mountChannelRouters(app)`. Add startup warning when active channel is misconfigured. |
| `server/interaction-agent.ts` | `send_ack` (lines ~209-213); history query (~269-277); system prompt (~128-137); `allowedTools` array | `send_ack` becomes `await dispatch(...)`. History uses `recentAcrossChannels`. Prompt grows two lines. `allowedTools` adds `mcp__boop-self__set_active_channel`. |
| `server/automations.ts` | `runAutomation` (~71-75) | Replace prefix branch with `dispatch(target, …)` where `target = a.notifyConversationId ?? (await resolveActiveChannel()).conversationId`. |
| `server/automation-tools.ts` | `create_automation` | Default `notifyConversationId` to `null` (not the originating conversation). |
| `server/proactive-email.ts` | `dispatchProactiveNotice` (~290-320) | Drop `BOOP_USER_PHONE` derivation. Use `resolveActiveChannel()`. |
| `server/runtime-config.ts` | end of file | Add `getActiveChannel`, `setActiveChannel`, `getChannelPrimary`, `recordChannelPrimary`, `resolveActiveChannel`. |
| `server/self-tools.ts` | inside `createSelfMcp().tools` array | Add `set_active_channel` tool. Extend `get_config` return value with three fields. |
| `convex/schema.ts` | top-level `defineSchema` block | Add `telegramDedup`, `telegramPendingAllowlist`, `telegramAllowedChatIds` tables. |
| `convex/messages.ts` | end of file | Add `recentAcrossChannels` query. |
| `convex/usageRecords.ts` | `sourceV` literal union (~lines 4-12) | Add `v.literal("transcribe")`. |
| `scripts/setup.ts` | end of script (after Sendblue section) | Optional Telegram block: prompt for bot token, generate webhook secret, write to `.env.local`. |
| `scripts/dev.mjs` | webhook auto-register section; banner printer | Add Telegram webhook auto-register call. Banner grows two conditional lines. |
| `package.json` | `scripts` section | Add `telegram:webhook`, `telegram:approve`, `telegram:smoke`. |
| `.env.example` | end of file | Add `TELEGRAM_*` vars. |
| `README.md` | between Sendblue and Composio sections | Add "Telegram" subsection. |

### Files unchanged

`server/execution-agent.ts`, `server/memory/*`, `server/draft-tools.ts`, `server/composio.ts`, `server/consolidation.ts`, `server/embeddings.ts`, `server/heartbeat.ts`, `server/usage.ts`.

---

## Phase 1 — Channel abstraction skeleton (refactor, no new behavior)

### Task 1: Channel types and shared text helpers

**Files:**
- Create: `server/channels/types.ts`
- Create: `server/channels/text.ts`

- [ ] **Step 1: Create the types file**

Write to `server/channels/types.ts`:

```ts
import type { Router } from "express";

/** Identifier for each channel; used as the conversationId prefix and registry key. */
export type ChannelId = "sms" | "tg";

/** Conversation IDs are channel-prefixed: "sms:+15551234567" or "tg:123456789". */
export type ConversationId = `${ChannelId}:${string}`;

export interface SendOpts {
  /** Optional URL of media to attach (PDFs from artifact pipeline). */
  mediaUrl?: string;
}

/** What every channel hands to runTurn after parsing its webhook payload. */
export interface ParsedInbound {
  conversationId: ConversationId;
  /** Human-readable identifier of sender for logs only. */
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

/** Strip the channel prefix from a ConversationId. "tg:123" -> "123" */
export function stripChannelPrefix(conversationId: ConversationId): string {
  const idx = conversationId.indexOf(":");
  return idx === -1 ? conversationId : conversationId.slice(idx + 1);
}

/** Extract the channel id from a ConversationId. "tg:123" -> "tg" */
export function channelIdOf(conversationId: string): ChannelId | null {
  const prefix = conversationId.split(":", 1)[0];
  return prefix === "sms" || prefix === "tg" ? prefix : null;
}
```

- [ ] **Step 2: Create the shared text helpers**

Write to `server/channels/text.ts`:

```ts
/** Strip Markdown formatting that doesn't render well in plain-text chats. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```/g, ""))
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
    .trim();
}

/** Split text into chunks that fit within a channel's per-message size cap. */
export function chunk(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let buf = "";
  for (const line of text.split(/\n/)) {
    if ((buf + "\n" + line).length > size) {
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** Render a duration in seconds as "m:ss" — used for voice-note prefix and length errors. */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS — no errors.

- [ ] **Step 4: Commit**

```bash
git add server/channels/types.ts server/channels/text.ts
git commit -m "$(cat <<'EOF'
channels: add Channel interface and shared text helpers

Foundation for the channel-abstraction layer. Adds:
- types.ts: Channel interface, ChannelId, ConversationId template type, SendOpts, ParsedInbound
- text.ts: stripMarkdown, chunk, formatDuration (pure utilities, shared by all channels)

No runtime wiring yet — these are scaffolding.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Sendblue channel adapter

**Files:**
- Create: `server/channels/sendblue.ts`
- Read (don't modify yet): `server/sendblue.ts`

- [ ] **Step 1: Create the Sendblue adapter**

Write to `server/channels/sendblue.ts`. This is a thin adapter — it imports the existing functions in `server/sendblue.ts` and wraps them to satisfy the `Channel` interface. No behavior change.

```ts
import type { Channel, ChannelId, ConversationId, SendOpts } from "./types.js";
import { stripChannelPrefix } from "./types.js";
import {
  sendImessage,
  startTypingLoop as startSendblueTypingLoop,
  createSendblueRouter,
} from "../sendblue.js";

export const sendblueChannel: Channel = {
  id: "sms" as ChannelId,
  label: "Sendblue (iMessage)",
  webhookPath: "/sendblue",

  isConfigured(): boolean {
    return Boolean(process.env.SENDBLUE_API_KEY && process.env.SENDBLUE_API_SECRET);
  },

  async send(conversationId: ConversationId, text: string, opts: SendOpts = {}): Promise<void> {
    const number = stripChannelPrefix(conversationId);
    await sendImessage(number, text, opts);
  },

  startTypingLoop(conversationId: ConversationId): () => void {
    const number = stripChannelPrefix(conversationId);
    return startSendblueTypingLoop(number);
  },

  webhookRouter() {
    return createSendblueRouter();
  },
};
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/channels/sendblue.ts
git commit -m "$(cat <<'EOF'
channels: add Sendblue adapter implementing Channel interface

Thin wrapper around the existing server/sendblue.ts exports. No behavior
change — the adapter just rehomes the existing functions behind the
Channel interface so the registry can treat all channels uniformly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Channel registry, dispatch, and runTurn

**Files:**
- Create: `server/channels/index.ts`

- [ ] **Step 1: Create the registry, dispatch, and runTurn**

Write to `server/channels/index.ts`. `recordChannelPrimary` is intentionally NOT called in `runTurn` yet — that wiring lands in Phase 3 once the runtime-config helpers exist.

```ts
import type { Express } from "express";
import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { broadcast } from "../broadcast.js";
import { handleUserMessage } from "../interaction-agent.js";
import type { Channel, ChannelId, ConversationId, ParsedInbound, SendOpts } from "./types.js";
import { channelIdOf } from "./types.js";
import { sendblueChannel } from "./sendblue.js";

// NOTE: telegramChannel is registered in a later phase.
const registry: Partial<Record<ChannelId, Channel>> = {
  sms: sendblueChannel,
};

export function getChannel(conversationId: string): Channel | null {
  const id = channelIdOf(conversationId);
  if (!id) return null;
  return registry[id] ?? null;
}

export async function dispatch(
  conversationId: ConversationId,
  text: string,
  opts?: SendOpts,
): Promise<void> {
  const ch = getChannel(conversationId);
  if (!ch) {
    console.warn(`[channels] no channel for ${conversationId}`);
    return;
  }
  if (!ch.isConfigured()) {
    console.warn(`[channels] ${ch.label} not configured — dropping send`);
    return;
  }
  await ch.send(conversationId, text, opts);
}

export function startTyping(conversationId: ConversationId): () => void {
  const ch = getChannel(conversationId);
  if (!ch || !ch.isConfigured()) return () => {};
  return ch.startTypingLoop(conversationId);
}

export function listChannels(): Channel[] {
  return Object.values(registry).filter((ch): ch is Channel => Boolean(ch?.isConfigured()));
}

export function mountChannelRouters(app: Express): void {
  for (const ch of Object.values(registry)) {
    if (ch && ch.isConfigured()) {
      app.use(ch.webhookPath, ch.webhookRouter());
      console.log(`[channels] mounted ${ch.label} at ${ch.webhookPath}`);
    }
  }
}

/** Internal export used by the registry tests in Phase 4 to register the Telegram channel. */
export function _registerChannel(ch: Channel): void {
  registry[ch.id] = ch;
}

/**
 * Shared turn runner extracted from server/sendblue.ts:createSendblueRouter.
 * Each channel's webhook does parse + dedup + allowlist, then calls this.
 */
export async function runTurn(inbound: ParsedInbound): Promise<void> {
  const { conversationId, content, from } = inbound;
  const turnTag = Math.random().toString(36).slice(2, 8);
  const preview = content.length > 100 ? content.slice(0, 100) + "…" : content;
  console.log(`[turn ${turnTag}] ← ${from}: ${JSON.stringify(preview)}`);
  const start = Date.now();

  broadcast("message_in", { conversationId, content, from });

  const stopTyping = startTyping(conversationId);
  try {
    const reply = await handleUserMessage({
      conversationId,
      content,
      turnTag,
      onThinking: (t) => broadcast("thinking", { conversationId, t }),
    });
    if (reply) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const replyPreview = reply.length > 100 ? reply.slice(0, 100) + "…" : reply;
      console.log(
        `[turn ${turnTag}] → reply (${elapsed}s, ${reply.length} chars): ${JSON.stringify(replyPreview)}`,
      );
      const artifact = await convex.query(api.pdfArtifacts.latestForConversation, {
        conversationId,
        since: start,
      });
      await dispatch(conversationId, reply, artifact ? { mediaUrl: artifact.signedUrl } : {});
      await convex.mutation(api.messages.send, {
        conversationId,
        role: "assistant",
        content: reply,
      });
    } else {
      console.log(`[turn ${turnTag}] → (no reply)`);
    }
  } catch (err) {
    console.error(`[turn ${turnTag}] handler error`, err);
  } finally {
    stopTyping();
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/channels/index.ts
git commit -m "$(cat <<'EOF'
channels: add registry, dispatch, and shared runTurn

- registry keyed by ChannelId; only Sendblue registered for now
- dispatch(conversationId, ...) routes by prefix
- mountChannelRouters wires webhooks via the channel interface
- runTurn extracts the shared turn-running logic (broadcast, typing,
  handleUserMessage, PDF pickup, dispatch reply, persist) — currently
  unused; Sendblue's webhook is rewired to call it in the next task

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Refactor Sendblue webhook to use runTurn

**Files:**
- Modify: `server/sendblue.ts:createSendblueRouter` (lines ~157-225)

- [ ] **Step 1: Read current router code**

Read `server/sendblue.ts` lines 157-226 to see the existing router.

- [ ] **Step 2: Replace the router**

Edit `server/sendblue.ts` — replace the `createSendblueRouter` function. The new version delegates to `runTurn` for everything except parsing and dedup.

Old (lines ~157-225):

```ts
export function createSendblueRouter(): express.Router {
  const router = express.Router();

  router.post("/webhook", async (req, res) => {
    const { content, from_number, is_outbound, message_handle } = req.body ?? {};
    if (is_outbound || !content || !from_number) {
      res.json({ ok: true, skipped: true });
      return;
    }

    if (message_handle) {
      const { claimed } = await convex.mutation(api.sendblueDedup.claim, {
        handle: message_handle,
      });
      if (!claimed) {
        res.json({ ok: true, deduped: true });
        return;
      }
    }

    const conversationId = `sms:${from_number}`;
    const turnTag = Math.random().toString(36).slice(2, 8);
    const preview = content.length > 100 ? content.slice(0, 100) + "…" : content;
    console.log(`[turn ${turnTag}] ← ${from_number}: ${JSON.stringify(preview)}`);
    const start = Date.now();

    broadcast("message_in", { conversationId, content, from_number, handle: message_handle });
    res.json({ ok: true });

    const stopTyping = startTypingLoop(from_number);
    try {
      const reply = await handleUserMessage({
        conversationId,
        content,
        turnTag,
        onThinking: (t) => broadcast("thinking", { conversationId, t }),
      });
      if (reply) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const replyPreview = reply.length > 100 ? reply.slice(0, 100) + "…" : reply;
        console.log(
          `[turn ${turnTag}] → reply (${elapsed}s, ${reply.length} chars): ${JSON.stringify(replyPreview)}`,
        );
        const artifact = await convex.query(api.pdfArtifacts.latestForConversation, {
          conversationId,
          since: start,
        });
        await sendImessage(from_number, reply, artifact ? { mediaUrl: artifact.signedUrl } : {});
        await convex.mutation(api.messages.send, {
          conversationId,
          role: "assistant",
          content: reply,
        });
      } else {
        console.log(`[turn ${turnTag}] → (no reply)`);
      }
    } catch (err) {
      console.error(`[turn ${turnTag}] handler error`, err);
    } finally {
      stopTyping();
    }
  });

  return router;
}
```

New:

```ts
export function createSendblueRouter(): express.Router {
  const router = express.Router();

  router.post("/webhook", async (req, res) => {
    const { content, from_number, is_outbound, message_handle } = req.body ?? {};
    if (is_outbound || !content || !from_number) {
      res.json({ ok: true, skipped: true });
      return;
    }

    if (message_handle) {
      const { claimed } = await convex.mutation(api.sendblueDedup.claim, {
        handle: message_handle,
      });
      if (!claimed) {
        res.json({ ok: true, deduped: true });
        return;
      }
    }

    res.json({ ok: true });

    await runTurn({
      conversationId: `sms:${from_number}` as `sms:${string}`,
      content,
      from: from_number,
    });
  });

  return router;
}
```

Add the import at the top of `server/sendblue.ts`:

```ts
import { runTurn } from "./channels/index.js";
```

Remove now-unused imports if any (e.g., `broadcast`, `handleUserMessage`, `pdfArtifacts` references that were only used by the deleted code). Keep `sendImessage`, `startTypingLoop`, `api`, `convex`.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional, only if Sendblue is configured)**

Start `npm run dev`, send a text from a Sendblue-enabled phone, confirm it replies. The behavior should be identical to before this task.

- [ ] **Step 5: Commit**

```bash
git add server/sendblue.ts
git commit -m "$(cat <<'EOF'
sendblue: delegate webhook to channels/runTurn

Pure refactor. The webhook now does only Sendblue-specific work
(parsing, dedup) and hands off to the shared runTurn helper. Behavior
unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migrate three outbound call sites to dispatch

**Files:**
- Modify: `server/interaction-agent.ts:209-213` (send_ack tool body)
- Modify: `server/automations.ts:71-75` (cron-result notify)
- Modify: `server/proactive-email.ts:303-318` (proactive notice send)

- [ ] **Step 1: Update send_ack in interaction-agent.ts**

Read `server/interaction-agent.ts:200-230`. Replace the iMessage-specific branch with `dispatch`.

Old (around lines 209-213):

```ts
          if (opts.conversationId.startsWith("sms:") && opts.kind !== "proactive") {
            const number = opts.conversationId.slice(4);
            await sendImessage(number, text);
          }
```

New:

```ts
          if (opts.kind !== "proactive") {
            await dispatch(opts.conversationId as `sms:${string}` | `tg:${string}`, text);
          }
```

Add an import at the top of `server/interaction-agent.ts`:

```ts
import { dispatch } from "./channels/index.js";
```

Remove the now-unused `sendImessage` import if it's the only consumer.

- [ ] **Step 2: Update automations.ts**

Read `server/automations.ts:60-100`. Replace the prefix-checked iMessage branch with a `dispatch` call. Keep `notifyConversationId` semantics unchanged for now (Phase 3 adds the resolveActiveChannel fallback).

Old (around lines 70-80):

```ts
    if (a.notifyConversationId && res.result) {
      if (a.notifyConversationId.startsWith("sms:")) {
        const number = a.notifyConversationId.slice(4);
        const preamble = `[${a.name}]\n\n`;
        await sendImessage(number, preamble + res.result);
      }
      await convex.mutation(api.messages.send, {
        conversationId: a.notifyConversationId,
        role: "assistant",
        content: `[${a.name}]\n\n${res.result}`,
      });
    }
```

New:

```ts
    if (a.notifyConversationId && res.result) {
      const preamble = `[${a.name}]\n\n`;
      await dispatch(
        a.notifyConversationId as `sms:${string}` | `tg:${string}`,
        preamble + res.result,
      );
      await convex.mutation(api.messages.send, {
        conversationId: a.notifyConversationId,
        role: "assistant",
        content: preamble + res.result,
      });
    }
```

Add the import at the top:

```ts
import { dispatch } from "./channels/index.js";
```

Remove the unused `sendImessage` import.

- [ ] **Step 3: Update proactive-email.ts**

Read `server/proactive-email.ts:290-330`. Replace `sendImessage` with `dispatch`. Keep `BOOP_USER_PHONE` derivation for now (Phase 3 swaps to `resolveActiveChannel`).

Old (around lines 311-317):

```ts
  if (reply && reply !== "(no reply)") {
    await sendImessage(phone, reply);
    await convex.mutation(api.messages.send, {
      conversationId,
      role: "assistant",
      content: reply,
    });
  } else {
```

New:

```ts
  if (reply && reply !== "(no reply)") {
    await dispatch(conversationId as `sms:${string}`, reply);
    await convex.mutation(api.messages.send, {
      conversationId,
      role: "assistant",
      content: reply,
    });
  } else {
```

Search the file for any other `sendImessage` calls and replace each with `dispatch(conversationId, …)`. Keep the env-var-driven phone derivation untouched.

Add the import at the top:

```ts
import { dispatch } from "./channels/index.js";
```

Remove the unused `sendImessage` import.

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/interaction-agent.ts server/automations.ts server/proactive-email.ts
git commit -m "$(cat <<'EOF'
channels: migrate three outbound sites to dispatch

- interaction-agent send_ack: dispatch instead of prefix-check + sendImessage
- automations cron-result: same
- proactive-email final reply: same (BOOP_USER_PHONE derivation unchanged for now)

The dispatch helper drops sends silently when the target channel is not
configured, so behavior is unchanged for Sendblue-only deployments.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Mount channels in server/index.ts

**Files:**
- Modify: `server/index.ts:49` (the `app.use("/sendblue", …)` line)

- [ ] **Step 1: Replace the Sendblue mount with mountChannelRouters**

Old (line 49):

```ts
  app.use("/sendblue", createSendblueRouter());
```

New:

```ts
  mountChannelRouters(app);
```

Update imports at the top of `server/index.ts`. Remove:

```ts
import { createSendblueRouter } from "./sendblue.js";
```

Add:

```ts
import { mountChannelRouters } from "./channels/index.js";
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Start `npm run dev`. Look for `[channels] mounted Sendblue (iMessage) at /sendblue` in the server log. Send a text from Sendblue, confirm round-trip.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "$(cat <<'EOF'
channels: mount channels via registry instead of direct Sendblue mount

server/index.ts no longer imports createSendblueRouter directly. All
channel routers are mounted by mountChannelRouters which iterates the
registry. Today only Sendblue is registered; Telegram joins in a later
phase.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Convex schema + new queries

### Task 7: Add Telegram-related Convex tables

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Read the existing schema**

Read `convex/schema.ts`. Find the closing `})` of `defineSchema({ … })`.

- [ ] **Step 2: Add three tables**

Insert these three table definitions inside the `defineSchema({ … })` block (placement doesn't matter; conventional spot is at the end before the closing brace):

```ts
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

- [ ] **Step 3: Generate types**

Run: `npx convex dev --once`
Expected: success, no schema errors.

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/_generated/
git commit -m "$(cat <<'EOF'
convex: add Telegram dedup, pending-allowlist, allowed-chat-id tables

- telegramDedup: by update_id (mirror of sendblueDedup)
- telegramPendingAllowlist: rejected chat_ids awaiting approval
- telegramAllowedChatIds: dynamic allowlist (hybrid with env var)

Empty tables, no behavior change yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Convex telegramDedup module

**Files:**
- Create: `convex/telegramDedup.ts`

- [ ] **Step 1: Mirror sendblueDedup**

Write to `convex/telegramDedup.ts`:

```ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const claim = mutation({
  args: { updateId: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("telegramDedup")
      .withIndex("by_updateId", (q) => q.eq("updateId", args.updateId))
      .unique();
    if (existing) return { claimed: false };
    await ctx.db.insert("telegramDedup", {
      updateId: args.updateId,
      claimedAt: Date.now(),
    });
    return { claimed: true };
  },
});
```

- [ ] **Step 2: Verify typecheck and Convex types**

Run: `npx convex dev --once && npm run typecheck`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add convex/telegramDedup.ts convex/_generated/
git commit -m "$(cat <<'EOF'
convex: add telegramDedup.claim mutation

Mirrors sendblueDedup. Returns { claimed: false } if update_id was
already seen, { claimed: true } otherwise. Used by the Telegram webhook
to reject duplicates after Telegram retries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Convex telegramAllowlist module

**Files:**
- Create: `convex/telegramAllowlist.ts`

- [ ] **Step 1: Add the allowlist queries and mutations**

Write to `convex/telegramAllowlist.ts`:

```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** True if the chat_id is in the dynamic Convex allowlist (env-var allowlist is checked separately in server code). */
export const isAllowed = query({
  args: { chatId: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("telegramAllowedChatIds")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    return Boolean(row);
  },
});

/** Record a rejected chat_id for later approval. Updates lastSeenAt + attemptCount on repeat attempts. */
export const recordPending = mutation({
  args: {
    chatId: v.number(),
    username: v.optional(v.string()),
    firstName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("telegramPendingAllowlist")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenAt: now,
        attemptCount: existing.attemptCount + 1,
        // Refresh username/firstName in case the user changed them.
        username: args.username ?? existing.username,
        firstName: args.firstName ?? existing.firstName,
      });
      return;
    }
    await ctx.db.insert("telegramPendingAllowlist", {
      chatId: args.chatId,
      username: args.username,
      firstName: args.firstName,
      firstSeenAt: now,
      lastSeenAt: now,
      attemptCount: 1,
    });
  },
});

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("telegramPendingAllowlist")
      .order("desc")
      .collect();
  },
});

/** Approve a pending chat_id: add to allowed table, remove from pending. */
export const allow = mutation({
  args: { chatId: v.number() },
  handler: async (ctx, args) => {
    const existingAllowed = await ctx.db
      .query("telegramAllowedChatIds")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (!existingAllowed) {
      await ctx.db.insert("telegramAllowedChatIds", {
        chatId: args.chatId,
        approvedAt: Date.now(),
      });
    }
    const pending = await ctx.db
      .query("telegramPendingAllowlist")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (pending) await ctx.db.delete(pending._id);
  },
});

/** Drop a pending chat_id without approving. */
export const dismiss = mutation({
  args: { chatId: v.number() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("telegramPendingAllowlist")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (pending) await ctx.db.delete(pending._id);
  },
});
```

- [ ] **Step 2: Verify**

Run: `npx convex dev --once && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add convex/telegramAllowlist.ts convex/_generated/
git commit -m "$(cat <<'EOF'
convex: add telegramAllowlist queries and mutations

- isAllowed: lookup the dynamic Convex allowlist
- recordPending: log rejected chat_ids with metadata, dedup on repeat attempts
- listPending: surface pending entries for the CLI / debug UI
- allow: approve a pending chat_id (adds to allowed, removes from pending)
- dismiss: drop a pending entry without approving

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Add recentAcrossChannels query

**Files:**
- Modify: `convex/messages.ts`

- [ ] **Step 1: Read existing messages.ts**

Read `convex/messages.ts` to see the existing exports. The new query goes at the end.

- [ ] **Step 2: Add the unioned query**

Append to `convex/messages.ts`:

```ts
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

- [ ] **Step 3: Verify**

Run: `npx convex dev --once && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add convex/messages.ts convex/_generated/
git commit -m "$(cat <<'EOF'
convex: add messages.recentAcrossChannels query

Unions recent messages across multiple conversation IDs into one
chronologically-ordered tail. Used by the dispatcher to give the agent
cross-channel continuity (10-turn window covers iMessage + Telegram).

The existing messages.recent query stays for per-conversation views.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Add "transcribe" to usageRecords source

**Files:**
- Modify: `convex/usageRecords.ts:4-12` (the `sourceV` literal union)

- [ ] **Step 1: Add the literal**

Old:

```ts
const sourceV = v.union(
  v.literal("dispatcher"),
  v.literal("execution"),
  v.literal("extract"),
  v.literal("consolidation-proposer"),
  v.literal("consolidation-adversary"),
  v.literal("consolidation-judge"),
  v.literal("proactive"),
);
```

New:

```ts
const sourceV = v.union(
  v.literal("dispatcher"),
  v.literal("execution"),
  v.literal("extract"),
  v.literal("consolidation-proposer"),
  v.literal("consolidation-adversary"),
  v.literal("consolidation-judge"),
  v.literal("proactive"),
  v.literal("transcribe"),
);
```

- [ ] **Step 2: Verify**

Run: `npx convex dev --once && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add convex/usageRecords.ts convex/_generated/
git commit -m "$(cat <<'EOF'
convex: allow source=transcribe in usageRecords

Lets the Telegram voice-transcription path (added in a later phase)
record Whisper costs alongside LLM costs. Append-only addition; no
existing rows affected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Active channel runtime + self-tool + dispatcher updates

### Task 12: Add channel helpers to runtime-config.ts

**Files:**
- Modify: `server/runtime-config.ts`

- [ ] **Step 1: Append channel helpers**

Read the end of `server/runtime-config.ts`. Append:

```ts
import type { ChannelId, ConversationId } from "./channels/types.js";

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
```

If `import { api }` and `import { convex }` aren't already at the top of the file, they should be (they are — used by `getRuntimeModel`). The new `import type { ChannelId, ConversationId }` goes at the top with the other imports.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/runtime-config.ts
git commit -m "$(cat <<'EOF'
runtime-config: add active-channel helpers

- getActiveChannel: read activeChannel setting (defaults to "sms")
- setActiveChannel: write it
- getChannelPrimary: read channelPrimary.<channel>; null if unset/mismatched-prefix
- recordChannelPrimary: write the primary for a given conversationId
- resolveActiveChannel: combined read of channel + its primary

All read through the existing settings key/value table — no schema change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Wire recordChannelPrimary into runTurn

**Files:**
- Modify: `server/channels/index.ts:runTurn`

- [ ] **Step 1: Add the import and the call**

Add to the imports at the top of `server/channels/index.ts`:

```ts
import { recordChannelPrimary } from "../runtime-config.js";
```

Inside `runTurn`, after the `broadcast("message_in", …)` line, add:

```ts
  await recordChannelPrimary(conversationId).catch((err) =>
    console.warn(`[channels] recordChannelPrimary failed`, err),
  );
```

The full updated `runTurn`:

```ts
export async function runTurn(inbound: ParsedInbound): Promise<void> {
  const { conversationId, content, from } = inbound;
  const turnTag = Math.random().toString(36).slice(2, 8);
  const preview = content.length > 100 ? content.slice(0, 100) + "…" : content;
  console.log(`[turn ${turnTag}] ← ${from}: ${JSON.stringify(preview)}`);
  const start = Date.now();

  broadcast("message_in", { conversationId, content, from });
  await recordChannelPrimary(conversationId).catch((err) =>
    console.warn(`[channels] recordChannelPrimary failed`, err),
  );

  const stopTyping = startTyping(conversationId);
  try {
    // ... rest unchanged
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/channels/index.ts
git commit -m "$(cat <<'EOF'
channels: record channel-primary on every inbound turn

runTurn now writes channelPrimary.<channel> = conversationId so
unsolicited-message routing (automations, proactive nudges) can find
the user's most-recent conversation per channel.

Latest-wins: if the user has multiple chats per channel, the most
recently active one becomes the destination.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Add set_active_channel self-tool and extend get_config

**Files:**
- Modify: `server/self-tools.ts`

- [ ] **Step 1: Add imports**

At the top of `server/self-tools.ts`, add:

```ts
import {
  getActiveChannel,
  setActiveChannel,
  getChannelPrimary,
  resolveActiveChannel,
} from "./runtime-config.js";
import { listChannels, getChannel } from "./channels/index.js";
```

- [ ] **Step 2: Add new fields to get_config**

Find the `get_config` tool's handler (it builds a `config` object). Inside the handler, after the existing `tzInfo` line and before the `config` object construction, add:

```ts
          const { channel: activeChannel } = await resolveActiveChannel();
          const activeChannelTarget = await getChannelPrimary(activeChannel);
          const configuredChannels = listChannels().map((c) => c.id);
```

Then in the `config` object literal, add three new fields:

```ts
            activeChannel,
            activeChannelTarget,
            configuredChannels,
```

(Place them after `sendblueEnabled` for grouping.)

- [ ] **Step 3: Add the set_active_channel tool**

Inside the `tools: [ … ]` array of `createSelfMcp()`, append a new tool entry:

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
          channel: z
            .enum(["sms", "tg", "imessage", "telegram"])
            .describe('Channel to make active. "sms"/"imessage" and "tg"/"telegram" are aliases.'),
        },
        async (args) => {
          const target = (args.channel === "imessage"
            ? "sms"
            : args.channel === "telegram"
              ? "tg"
              : args.channel) as "sms" | "tg";

          const channel = getChannel(`${target}:_`);
          if (!channel || !channel.isConfigured()) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `${target === "tg" ? "Telegram" : "iMessage"} is not configured on this server. ` +
                    `Set ${target === "tg" ? "TELEGRAM_BOT_TOKEN" : "SENDBLUE_API_KEY"} in .env.local and restart.`,
                },
              ],
            };
          }

          const primary = await getChannelPrimary(target);
          if (!primary) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    target === "tg"
                      ? `I haven't received a message from you on Telegram yet. Text @${process.env.TELEGRAM_BOT_USERNAME ?? "<bot_username>"} once, then try again.`
                      : `I haven't received a message from you on iMessage yet. Text the Boop number once, then try again.`,
                },
              ],
            };
          }

          await setActiveChannel(target);
          return {
            content: [
              {
                type: "text" as const,
                text: `Active channel set to ${channel.label}. Automations and proactive nudges will go to ${primary} from now on.`,
              },
            ],
          };
        },
      ),
```

- [ ] **Step 4: Also extend get_config to suppress now-stale embedding-only check**

The existing `embeddingsEnabled: Boolean(process.env.VOYAGE_API_KEY)` line stays. Don't change it.

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/self-tools.ts
git commit -m "$(cat <<'EOF'
self-tools: add set_active_channel + channel info in get_config

- get_config now returns activeChannel, activeChannelTarget,
  configuredChannels alongside the existing model + timezone fields
- set_active_channel switches which channel receives automation and
  proactive nudges. Aliases imessage/telegram for natural-language UX.
  Refuses with a helpful error if the target is not configured or the
  user hasn't texted that channel yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Wire set_active_channel into the dispatcher

**Files:**
- Modify: `server/interaction-agent.ts:128-137` (self-inspection prompt block); `allowedTools` array (~308-326)

- [ ] **Step 1: Update the self-inspection block in the system prompt**

Find the `Self-inspection` block in `INTERACTION_SYSTEM` (around lines 126-137). Add two lines to it:

```
- "What channel are you using?" / "Where do notifications go?" → get_config (returns activeChannel + activeChannelTarget)
- "Use telegram now" / "switch back to imessage" / "send pings to X" → set_active_channel
```

Place them between the `list_integrations` line and the `inspect_toolkit` line for natural grouping with other self-config tools.

- [ ] **Step 2: Add the tool to allowedTools**

In the `allowedTools` array (around lines 308-326), add:

```ts
          "mcp__boop-self__set_active_channel",
```

Place it adjacent to the other `mcp__boop-self__*` entries (after `set_timezone`, before `list_integrations`).

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/interaction-agent.ts
git commit -m "$(cat <<'EOF'
interaction-agent: surface set_active_channel to the dispatcher

System prompt grows two lines describing when to call set_active_channel
and get_config (for channel info). allowedTools array adds the new
mcp__boop-self__set_active_channel entry. The agent can now flip the
active channel from natural-language requests like "use telegram now".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Switch dispatcher history to recentAcrossChannels

**Files:**
- Modify: `server/interaction-agent.ts:269-277`

- [ ] **Step 1: Add imports**

At the top of `server/interaction-agent.ts`:

```ts
import { getChannelPrimary } from "./runtime-config.js";
```

- [ ] **Step 2: Replace the history query**

Find lines 269-277 — the existing `convex.query(api.messages.recent, …)` call and the `.slice(0, -1)` block.

Old:

```ts
  const history = await convex.query(api.messages.recent, {
    conversationId: opts.conversationId,
    limit: 10,
  });
  const historyBlock = history
    .slice(0, -1)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");
```

New:

```ts
  const channelPrimaries = await Promise.all([
    getChannelPrimary("sms"),
    getChannelPrimary("tg"),
  ]);
  const conversationIds = Array.from(
    new Set(
      [opts.conversationId, ...channelPrimaries].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
  const history = await convex.query(api.messages.recentAcrossChannels, {
    conversationIds,
    limit: 10,
  });
  const historyBlock = history
    .filter((m) => m.turnId !== turnId)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/interaction-agent.ts
git commit -m "$(cat <<'EOF'
interaction-agent: union recent history across channels

The dispatcher's 10-turn context window now combines the current
conversation + each channel's primary conversation. Lets the agent see
"reminder I'm meeting Sarah at 2pm" sent on iMessage in the morning
when the user follows up on Telegram in the afternoon.

Also tightens the drop-current-message logic: filter by turnId rather
than .slice(0, -1), guarding against _creationTime collisions in the
unioned merge.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: automations.ts uses resolveActiveChannel as default target

**Files:**
- Modify: `server/automations.ts` (the section updated in Task 5)

- [ ] **Step 1: Add the import**

At the top of `server/automations.ts`:

```ts
import { resolveActiveChannel } from "./runtime-config.js";
```

- [ ] **Step 2: Compute the target**

Find the `if (a.notifyConversationId && res.result) { … }` block (updated in Task 5 to use `dispatch`). Replace with:

```ts
    if (res.result) {
      const target =
        a.notifyConversationId ?? (await resolveActiveChannel()).conversationId;
      if (target) {
        const preamble = `[${a.name}]\n\n`;
        await dispatch(
          target as `sms:${string}` | `tg:${string}`,
          preamble + res.result,
        );
        await convex.mutation(api.messages.send, {
          conversationId: target,
          role: "assistant",
          content: preamble + res.result,
        });
      } else {
        console.warn(
          `[automation ${a.name}] no notify target — set notifyConversationId or active channel`,
        );
      }
    }
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/automations.ts
git commit -m "$(cat <<'EOF'
automations: float to active channel when notifyConversationId is null

Existing automations have notifyConversationId set at creation time and
keep pinning to that conversation. New automations (created with
notifyConversationId=null in the next commit) float to whichever
channel is active at fire time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: automation-tools defaults notifyConversationId to null

**Files:**
- Modify: `server/automation-tools.ts:create_automation` handler

- [ ] **Step 1: Read the file to find the create_automation handler**

Read `server/automation-tools.ts` and locate `create_automation`. There's a section that derives `notifyConversationId` from the conversation the user is in.

- [ ] **Step 2: Default the field to null**

Find the place where `notifyConversationId` is set (it likely uses `opts.conversationId` as the default). Change it so the default is `null` and the field is only set when the user explicitly asks for a specific notification target.

Concretely: search for `notifyConversationId` in `automation-tools.ts`. If the current code is:

```ts
    notifyConversationId: opts.conversationId,
```

(or similar), change to:

```ts
    notifyConversationId: undefined,
```

If there's a tool argument that takes a target, route it through here. (The exact change depends on the file's current shape; the goal is "newly-created automations float to active channel by default.")

If `notifyConversationId` is currently always set, also update the tool's description to say something like:

> "By default, automation results go to the user's currently-active channel. Pass an explicit `notifyConversationId` to pin results to a specific conversation."

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/automation-tools.ts
git commit -m "$(cat <<'EOF'
automation-tools: default notifyConversationId to null

New automations float to whichever channel is active at fire time
instead of pinning to the conversation they were created from. Existing
automations are unaffected — they already have notifyConversationId set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: proactive-email uses resolveActiveChannel

**Files:**
- Modify: `server/proactive-email.ts:dispatchProactiveNotice` (around lines 290-330)

- [ ] **Step 1: Replace the env-var derivation**

Old (around lines 290-318):

```ts
async function dispatchProactiveNotice(summary: string): Promise<void> {
  const raw = process.env.BOOP_USER_PHONE;
  if (!raw) {
    console.warn("[proactive] BOOP_USER_PHONE not set; skipping dispatch");
    return;
  }
  const phone = normalizeProactivePhone(raw);
  if (!phone) {
    console.warn(
      `[proactive] BOOP_USER_PHONE=${JSON.stringify(raw)} doesn't look like a valid phone number; skipping dispatch`,
    );
    return;
  }
  const conversationId = `sms:${phone}`;
  const reply = await handleUserMessage({
    conversationId,
    content: `[proactive notice] ${summary}`,
    kind: "proactive",
  });
  if (reply && reply !== "(no reply)") {
    await dispatch(conversationId as `sms:${string}`, reply);
    await convex.mutation(api.messages.send, {
      conversationId,
      role: "assistant",
      content: reply,
    });
  } else {
    // ... existing fallback block
  }
}
```

New:

```ts
async function dispatchProactiveNotice(summary: string): Promise<void> {
  const { conversationId } = await resolveActiveChannel();
  if (!conversationId) {
    console.warn(
      "[proactive] no active-channel target — text Boop on a configured channel first to register",
    );
    return;
  }
  const reply = await handleUserMessage({
    conversationId,
    content: `[proactive notice] ${summary}`,
    kind: "proactive",
  });
  if (reply && reply !== "(no reply)") {
    await dispatch(conversationId, reply);
    await convex.mutation(api.messages.send, {
      conversationId,
      role: "assistant",
      content: reply,
    });
  } else {
    // ... keep the existing fallback block; replace any sendImessage call there with dispatch(conversationId, …)
  }
}
```

Add the import at the top:

```ts
import { resolveActiveChannel } from "./runtime-config.js";
```

Remove the now-unused `normalizeProactivePhone` function (it's only called from `dispatchProactiveNotice` per the codebase). Verify with grep.

Also: search the rest of `proactive-email.ts` for `BOOP_USER_PHONE` and `process.env.BOOP_USER_PHONE`. There's a guard around line 350-352:

```ts
  if (!process.env.BOOP_USER_PHONE) {
    console.warn(
      "[proactive] BOOP_USER_PHONE not set; webhook will register but notices won't dispatch",
    );
  }
```

Replace with a check that warns if no channel is configured at all:

```ts
  if (!sendblueChannel.isConfigured() && /* future: telegram check via list */ true) {
    // (Keep as a soft warning. The new active-channel system handles missing targets at fire time.)
  }
```

Or simpler — just remove the warning. The active-channel resolution handles the missing-target case at dispatch time with a clear log line.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/proactive-email.ts
git commit -m "$(cat <<'EOF'
proactive-email: route through resolveActiveChannel

Drops BOOP_USER_PHONE env-var derivation. Proactive nudges now go to
whichever channel is active. If no primary conversation is registered
yet, the dispatch is dropped with a clear log line.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Boot-time warning for misconfigured active channel

**Files:**
- Modify: `server/index.ts:main`

- [ ] **Step 1: Add the warning after channel mounting**

After the `mountChannelRouters(app)` line in `main`, add:

```ts
  // Warn if the active channel can't actually send (missing creds).
  try {
    const { channel } = await resolveActiveChannel();
    const ch = getChannel(`${channel}:_`);
    if (!ch || !ch.isConfigured()) {
      const required =
        channel === "tg" ? "TELEGRAM_BOT_TOKEN" : "SENDBLUE_API_KEY/SENDBLUE_API_SECRET";
      console.warn(
        `[channels] Active channel is "${channel}" but its credentials are missing (${required}). ` +
        `Unsolicited messages will be dropped. Set the env var or change the active channel via "use imessage" / "use telegram".`,
      );
    }
  } catch (err) {
    console.warn("[channels] active-channel readiness check failed", err);
  }
```

Add to the imports at the top:

```ts
import { resolveActiveChannel } from "./runtime-config.js";
import { getChannel } from "./channels/index.js";
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

`npm run dev` with active channel set to a configured channel → no warning.
Set `activeChannel` to `"tg"` in Convex (via `npx convex run settings:set '{"key": "activeChannel", "value": "tg"}'`) without setting `TELEGRAM_BOT_TOKEN`, restart → warning appears.
Reset: `npx convex run settings:set '{"key": "activeChannel", "value": "sms"}'`.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "$(cat <<'EOF'
server: warn at boot when active channel is misconfigured

If the persisted activeChannel points at a channel whose credentials
aren't set, log a clear warning so the operator knows unsolicited
messages will silently drop. Doesn't block startup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Telegram channel implementation (text-only)

### Task 21: Telegram channel skeleton (send + typing, no webhook)

**Files:**
- Create: `server/channels/telegram.ts`

- [ ] **Step 1: Implement send and typing**

Write to `server/channels/telegram.ts`:

```ts
import express from "express";
import type { Channel, ChannelId, ConversationId, SendOpts } from "./types.js";
import { stripChannelPrefix } from "./types.js";
import { stripMarkdown, chunk } from "./text.js";

const TELEGRAM_API = "https://api.telegram.org";
const MAX_TG_CHUNK = 4000; // 4096 hard cap with margin

function token(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

function redactToken(t: string | null): string {
  if (!t) return "<no-token>";
  return `${t.slice(0, 6)}...${t.slice(-4)}`;
}

async function sendDocument(token: string, chatId: string, mediaUrl: string): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendDocument`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, document: mediaUrl }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      `[telegram bot${redactToken(token)}/sendDocument] failed ${res.status}: ${body}`,
    );
    // Fallback: append URL as text
    await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: `📎 ${mediaUrl}` }),
    });
  }
}

export const telegramChannel: Channel = {
  id: "tg" as ChannelId,
  label: "Telegram",
  webhookPath: "/telegram",

  isConfigured(): boolean {
    return Boolean(token());
  },

  async send(conversationId: ConversationId, text: string, opts: SendOpts = {}): Promise<void> {
    const tk = token();
    if (!tk) {
      console.warn("[telegram] missing TELEGRAM_BOT_TOKEN — not sending");
      return;
    }
    const chatId = stripChannelPrefix(conversationId);
    const plain = stripMarkdown(text);
    const parts = chunk(plain, MAX_TG_CHUNK);

    for (let i = 0; i < parts.length; i++) {
      const isFirst = i === 0;
      const res = await fetch(`${TELEGRAM_API}/bot${tk}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: parts[i],
          link_preview_options: { is_disabled: true },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(
          `[telegram bot${redactToken(tk)}/sendMessage] failed ${res.status}: ${body}`,
        );
      } else {
        console.log(`[telegram] → sent ${parts[i].length} chars to ${chatId}`);
      }
      if (isFirst && opts.mediaUrl) {
        await sendDocument(tk, chatId, opts.mediaUrl).catch((err) =>
          console.error("[telegram] sendDocument unhandled error", err),
        );
      }
    }
  },

  startTypingLoop(conversationId: ConversationId): () => void {
    const tk = token();
    if (!tk) return () => {};
    const chatId = stripChannelPrefix(conversationId);
    const ping = () =>
      fetch(`${TELEGRAM_API}/bot${tk}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action: "typing" }),
      }).catch(() => {/* non-fatal */});
    ping();
    const timer = setInterval(ping, 5000);
    return () => clearInterval(timer);
  },

  webhookRouter() {
    const router = express.Router();
    // Webhook handler is added in the next task.
    router.post("/webhook", (_req, res) => {
      res.json({ ok: true, skipped: "not yet implemented" });
    });
    return router;
  },
};
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/channels/telegram.ts
git commit -m "$(cat <<'EOF'
channels/telegram: skeleton with send + typing loop

Implements Channel.isConfigured, Channel.send (with PDF document
fallback to text URL), Channel.startTypingLoop. Webhook router is a
placeholder — real handler lands next.

Token is redacted in error logs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: Telegram webhook with dedup, allowlist, and pending recording

**Files:**
- Modify: `server/channels/telegram.ts:webhookRouter`

- [ ] **Step 1: Add the imports**

At the top of `server/channels/telegram.ts`, add:

```ts
import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { runTurn } from "./index.js";
```

- [ ] **Step 2: Add the allowlist helper**

Above the `telegramChannel` export, add:

```ts
async function isAllowed(chatId: number): Promise<boolean> {
  const fromEnv = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.includes(String(chatId))) return true;
  try {
    return await convex.query(api.telegramAllowlist.isAllowed, { chatId });
  } catch (err) {
    console.warn("[telegram] isAllowed Convex check failed", err);
    return false;
  }
}
```

- [ ] **Step 3: Replace the webhook router**

Replace the `webhookRouter()` method body with:

```ts
  webhookRouter() {
    const router = express.Router();

    router.post("/webhook", async (req, res) => {
      // 1. Secret token verification
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

      // 2. Group/channel chats rejected (chat_id < 0)
      const chatId = msg.chat?.id;
      if (typeof chatId !== "number" || chatId < 0) {
        res.json({ ok: true, skipped: true });
        return;
      }

      // 3. Allowlist (fail closed)
      if (!(await isAllowed(chatId))) {
        await convex
          .mutation(api.telegramAllowlist.recordPending, {
            chatId,
            username: msg.from?.username,
            firstName: msg.from?.first_name,
          })
          .catch((err) => console.warn("[telegram] recordPending failed", err));
        console.warn(
          `[telegram] denied chat_id=${chatId} (@${msg.from?.username ?? "?"}) — pending approval (run \`npm run telegram:approve\`)`,
        );
        res.json({ ok: true, denied: true });
        return;
      }

      // 4. Dedup
      const { claimed } = await convex.mutation(api.telegramDedup.claim, {
        updateId,
      });
      if (!claimed) {
        res.json({ ok: true, deduped: true });
        return;
      }

      // 5. Resolve content (text-only for now; voice handler in a later task)
      let content: string | null = null;
      if (typeof msg.text === "string" && msg.text.length > 0) {
        content = msg.text;
      }
      if (!content) {
        res.json({ ok: true, skipped: true });
        return;
      }

      res.json({ ok: true });

      await runTurn({
        conversationId: `tg:${chatId}` as ConversationId,
        content,
        from: `tg:${msg.from?.username ? "@" + msg.from.username : chatId}`,
      });
    });

    return router;
  },
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/channels/telegram.ts
git commit -m "$(cat <<'EOF'
channels/telegram: implement webhook (text-only) with dedup + allowlist

- Verifies x-telegram-bot-api-secret-token header
- Rejects group/channel chats (negative chat_id)
- Hybrid allowlist: env var TELEGRAM_ALLOWED_CHAT_IDS + Convex
  telegramAllowedChatIds (no restart needed for runtime approvals)
- Records denied chat_ids in telegramPendingAllowlist with username +
  first_name for later interactive approval
- Dedup on update_id via telegramDedup.claim
- Acks 200 OK before runTurn so Telegram doesn't retry on slow turns
- Voice messages handled in a later task

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Register the Telegram channel

**Files:**
- Modify: `server/channels/index.ts:registry`

- [ ] **Step 1: Import and register**

Add to the imports at the top of `server/channels/index.ts`:

```ts
import { telegramChannel } from "./telegram.js";
```

Update the registry literal:

```ts
const registry: Partial<Record<ChannelId, Channel>> = {
  sms: sendblueChannel,
  tg: telegramChannel,
};
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Start `npm run dev`. Confirm log line:

```
[channels] mounted Sendblue (iMessage) at /sendblue
[channels] mounted Telegram at /telegram
```

(Telegram only appears if `TELEGRAM_BOT_TOKEN` is set; with no token, the line is omitted.)

- [ ] **Step 4: Commit**

```bash
git add server/channels/index.ts
git commit -m "$(cat <<'EOF'
channels: register the Telegram channel

The registry now includes telegramChannel; mountChannelRouters mounts
/telegram when TELEGRAM_BOT_TOKEN is set. Without the token,
telegramChannel.isConfigured() returns false and the channel is
silently skipped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 24: Webhook auto-register script

**Files:**
- Create: `scripts/telegram-webhook.mjs`

- [ ] **Step 1: Write the script**

Write to `scripts/telegram-webhook.mjs`:

```js
#!/usr/bin/env node
// Auto-register the Telegram webhook URL via Telegram's setWebhook API.
// Mirrors scripts/sendblue-webhook.mjs but doesn't need a CLI — Telegram
// has a public REST API.
//
// Usage:
//   node scripts/telegram-webhook.mjs https://abc.ngrok.app
// Reads from .env.local:
//   TELEGRAM_BOT_TOKEN     (required; if missing, exits silently)
//   TELEGRAM_WEBHOOK_SECRET (optional; recommended)
//   TELEGRAM_AUTO_WEBHOOK   (optional; "false" to disable)

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function readEnv() {
  const p = resolve(root, ".env.local");
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*?)(?:\s+#.*)?$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = readEnv();
const token = env.TELEGRAM_BOT_TOKEN;
const secret = env.TELEGRAM_WEBHOOK_SECRET;
const autoOn = env.TELEGRAM_AUTO_WEBHOOK !== "false";

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("[telegram-webhook] usage: telegram-webhook.mjs <public-url>");
  process.exit(2);
}
if (!token) {
  // Silently skip — Telegram is optional.
  process.exit(0);
}
if (!autoOn) {
  console.log("[telegram-webhook] TELEGRAM_AUTO_WEBHOOK=false; skipping registration");
  process.exit(0);
}

const url = `${baseUrl.replace(/\/$/, "")}/telegram/webhook`;

try {
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      ...(secret ? { secret_token: secret } : {}),
      drop_pending_updates: true,
      allowed_updates: ["message"],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    console.error(`[telegram-webhook] setWebhook failed: ${res.status} ${JSON.stringify(body)}`);
    process.exit(1);
  }
  console.log(`[telegram-webhook] registered ${url} (drop_pending=true, allowed=[message])`);
} catch (err) {
  console.error("[telegram-webhook] error", err);
  process.exit(1);
}
```

Make it executable:

```bash
chmod +x scripts/telegram-webhook.mjs
```

- [ ] **Step 2: Add to package.json**

Add to the `scripts` block of `package.json`:

```json
    "telegram:webhook": "node scripts/telegram-webhook.mjs",
```

- [ ] **Step 3: Manual smoke (only if Telegram configured)**

Start ngrok manually if needed. Run:

```bash
npm run telegram:webhook -- https://abc.ngrok-free.app
```

Expected: `[telegram-webhook] registered https://abc.ngrok-free.app/telegram/webhook (...)`

- [ ] **Step 4: Commit**

```bash
git add scripts/telegram-webhook.mjs package.json
git commit -m "$(cat <<'EOF'
scripts: add telegram:webhook for auto-registration

Mirror of sendblue-webhook.mjs. Hits Telegram's setWebhook API
directly — no Telegram CLI required. Set
TELEGRAM_AUTO_WEBHOOK=false to opt out.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: telegram:approve CLI

**Files:**
- Create: `scripts/telegram-approve.mjs`

- [ ] **Step 1: Write the CLI**

Write to `scripts/telegram-approve.mjs`:

```js
#!/usr/bin/env node
// Walk pending Telegram chat_ids and approve / dismiss each interactively.

import readline from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function readEnv() {
  const p = resolve(root, ".env.local");
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*?)(?:\s+#.*)?$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = readEnv();
const convexUrl = env.CONVEX_URL || env.VITE_CONVEX_URL;
if (!convexUrl) {
  console.error("[telegram-approve] CONVEX_URL not set in .env.local");
  process.exit(2);
}

const { api } = await import(resolve(root, "convex/_generated/api.js"));
const convex = new ConvexHttpClient(convexUrl);

const pending = await convex.query(api.telegramAllowlist.listPending);
if (pending.length === 0) {
  console.log("[telegram-approve] no pending chat_ids");
  process.exit(0);
}

console.log(`[telegram-approve] ${pending.length} pending chat_id${pending.length === 1 ? "" : "s"}:\n`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

for (const row of pending) {
  const handle = row.username ? `@${row.username}` : "(no username)";
  const name = row.firstName ? ` "${row.firstName}"` : "";
  const ageMin = Math.round((Date.now() - row.firstSeenAt) / 60000);
  console.log(
    `chat_id=${row.chatId} ${handle}${name} — first seen ${ageMin}m ago, ${row.attemptCount} attempt${row.attemptCount === 1 ? "" : "s"}`,
  );
  const ans = (await ask("Allow? (y/N/q): ")).trim().toLowerCase();
  if (ans === "q") break;
  if (ans === "y" || ans === "yes") {
    await convex.mutation(api.telegramAllowlist.allow, { chatId: row.chatId });
    console.log("  ✓ allowed");
  } else {
    await convex.mutation(api.telegramAllowlist.dismiss, { chatId: row.chatId });
    console.log("  ✗ dismissed");
  }
}

rl.close();
console.log("[telegram-approve] done");
```

Make executable:

```bash
chmod +x scripts/telegram-approve.mjs
```

- [ ] **Step 2: Add to package.json**

```json
    "telegram:approve": "node scripts/telegram-approve.mjs",
```

- [ ] **Step 3: Verify**

`npm run typecheck` (the new script is .mjs so it doesn't go through tsc, but the convex types it imports must exist).

If you can hit it manually: `npm run telegram:approve` with no pending entries should print `no pending chat_ids`.

- [ ] **Step 4: Commit**

```bash
git add scripts/telegram-approve.mjs package.json
git commit -m "$(cat <<'EOF'
scripts: add telegram:approve interactive CLI

Walks the telegramPendingAllowlist table and prompts y/N/q for each
entry. Approved entries land in telegramAllowedChatIds (effective
without restart). Dismissed entries are dropped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 26: Telegram smoke test (text-only first)

**Files:**
- Create: `scripts/telegram-smoke.mjs`

- [ ] **Step 1: Write the smoke**

Write to `scripts/telegram-smoke.mjs`:

```js
#!/usr/bin/env node
// End-to-end smoke for the Telegram webhook. Posts synthetic Telegram
// updates to the local server and asserts behavior via Convex queries.
//
// Required env (in .env.local or environment):
//   TELEGRAM_SMOKE_CHAT_ID  — must be on the allowlist
//   PORT                    — default 3456
//
// Run: npm run telegram:smoke

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function readEnv() {
  const p = resolve(root, ".env.local");
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*?)(?:\s+#.*)?$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = { ...readEnv(), ...process.env };
const port = env.PORT || "3456";
const baseUrl = `http://localhost:${port}`;
const chatId = Number(env.TELEGRAM_SMOKE_CHAT_ID);
if (!chatId) {
  console.error("[smoke] TELEGRAM_SMOKE_CHAT_ID not set in .env.local");
  process.exit(2);
}
const secret = env.TELEGRAM_WEBHOOK_SECRET;
const convexUrl = env.CONVEX_URL || env.VITE_CONVEX_URL;
const { api } = await import(resolve(root, "convex/_generated/api.js"));
const convex = new ConvexHttpClient(convexUrl);

let updateIdCounter = Math.floor(Date.now() / 1000);
function nextUpdateId() {
  return updateIdCounter++;
}

async function postUpdate(update) {
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["x-telegram-bot-api-secret-token"] = secret;
  const res = await fetch(`${baseUrl}/telegram/webhook`, {
    method: "POST",
    headers,
    body: JSON.stringify(update),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function ok(label) {
  console.log(`  ✓ ${label}`);
}
function fail(label, info) {
  console.error(`  ✗ ${label}`);
  if (info !== undefined) console.error(`    ${JSON.stringify(info)}`);
  process.exitCode = 1;
}

console.log("[smoke] 1. text message inbound");
{
  const updateId = nextUpdateId();
  const text = `smoke test ${updateId}`;
  const r = await postUpdate({
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: chatId, username: "smoke", first_name: "Smoke" },
      chat: { id: chatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  });
  if (r.status !== 200) fail("webhook returned 200", r);
  // Wait briefly for runTurn to write the user message to Convex.
  await new Promise((r) => setTimeout(r, 1500));
  const msgs = await convex.query(api.messages.recentAcrossChannels, {
    conversationIds: [`tg:${chatId}`],
    limit: 5,
  });
  const found = msgs.some((m) => m.role === "user" && m.content === text);
  if (found) ok("user message persisted");
  else fail("user message not found", msgs);
}

console.log("[smoke] 2. duplicate update is deduped");
{
  const updateId = nextUpdateId();
  const text = `dedup test ${updateId}`;
  const update = {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: chatId, username: "smoke" },
      chat: { id: chatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
  await postUpdate(update);
  const r2 = await postUpdate(update);
  if (r2.body?.deduped) ok("second post deduped");
  else fail("second post NOT deduped", r2.body);
}

console.log("[smoke] 3. non-allowlisted chat_id pending");
{
  const denyChatId = -Math.abs(chatId) - 7777; // negative -> group reject path
  // Actually we want a denied DM, not a group. Use a positive number not on the allowlist.
  // Skip this assertion if TELEGRAM_ALLOWED_CHAT_IDS contains "*" (no such option, just docs).
  const fakeChatId = chatId + 99999;
  const updateId = nextUpdateId();
  const r = await postUpdate({
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: fakeChatId, username: "fake" },
      chat: { id: fakeChatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text: "I should be denied",
    },
  });
  if (r.body?.denied) ok("non-allowlisted chat_id denied");
  else fail("non-allowlisted chat_id NOT denied", r.body);

  await new Promise((r) => setTimeout(r, 500));
  const pending = await convex.query(api.telegramAllowlist.listPending);
  if (pending.some((p) => p.chatId === fakeChatId)) ok("recorded in pending");
  else fail("not recorded in pending", pending);

  // Cleanup: dismiss the entry so smoke is rerunnable.
  await convex.mutation(api.telegramAllowlist.dismiss, { chatId: fakeChatId });
}

if (process.exitCode === 1) {
  console.error("[smoke] FAILED");
  process.exit(1);
} else {
  console.log("[smoke] PASSED");
}
```

Make executable:

```bash
chmod +x scripts/telegram-smoke.mjs
```

- [ ] **Step 2: Add to package.json**

```json
    "telegram:smoke": "node scripts/telegram-smoke.mjs",
```

- [ ] **Step 3: Manual run**

Start `npm run dev` (server must be running). In another shell:

```bash
TELEGRAM_SMOKE_CHAT_ID=<your-chat-id> npm run telegram:smoke
```

Expected: all three checks pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/telegram-smoke.mjs package.json
git commit -m "$(cat <<'EOF'
scripts: add telegram:smoke for end-to-end verification

Posts synthetic Telegram updates to the local /telegram/webhook and
asserts:
1. Text inbound persists a "messages" row
2. Duplicate update_id is deduped
3. Non-allowlisted chat_id is denied + recorded in pending

Voice path will be added when the voice handler ships.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 27: Hook telegram-webhook into dev.mjs and update banner

**Files:**
- Modify: `scripts/dev.mjs`

- [ ] **Step 1: Read dev.mjs to find the auto-register section and the banner printer**

Read `scripts/dev.mjs`. Look for where `sendblue-webhook.mjs` is invoked (likely after ngrok URL discovery) and where the readiness banner is printed.

- [ ] **Step 2: Add the Telegram webhook call**

Wherever `sendblue-webhook.mjs` is spawned with the public URL, add an analogous call for `telegram-webhook.mjs` immediately after. Both can run in parallel (both are idempotent against their respective APIs).

Example (the exact site depends on dev.mjs's structure):

```js
// after running sendblue webhook registration
spawn("node", [resolve(root, "scripts/telegram-webhook.mjs"), publicUrl], {
  stdio: "inherit",
});
```

- [ ] **Step 3: Update the banner**

Find the banner printer (the block that prints "Boop is ready — ngrok tunnel is live"). Add two conditional lines after the existing Sendblue lines:

```js
// near where the Sendblue webhook URL line is printed
if (envVars.TELEGRAM_BOT_TOKEN) {
  console.log(`  📮 Telegram webhook (inbound):    ${publicUrl}/telegram/webhook`);
  if (envVars.TELEGRAM_BOT_USERNAME) {
    console.log(`  🤖 Telegram bot:                  @${envVars.TELEGRAM_BOT_USERNAME}`);
  }
}
```

(Adapt to dev.mjs's existing string-formatting style.)

- [ ] **Step 4: Verify by running**

`npm run dev` with Telegram configured: banner shows the two new lines.
`npm run dev` without `TELEGRAM_BOT_TOKEN`: banner unchanged from before.

- [ ] **Step 5: Commit**

```bash
git add scripts/dev.mjs
git commit -m "$(cat <<'EOF'
dev: auto-register Telegram webhook and show it in the banner

Mirrors the Sendblue webhook flow. The webhook auto-registers on every
boot when TELEGRAM_BOT_TOKEN is set (idempotent on Telegram's side).
Banner grows two conditional lines for the Telegram URL and @username.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 28: Setup-script Telegram block

**Files:**
- Modify: `scripts/setup.ts`

- [ ] **Step 1: Read setup.ts to find the end of the Sendblue section**

Read `scripts/setup.ts`. Locate where the Sendblue interactive block ends.

- [ ] **Step 2: Add an optional Telegram block**

After the Sendblue block, add:

```ts
  // ---- Telegram (optional) -----------------------------------------------
  const wantTelegram = await prompt("Do you want to enable Telegram? (y/N): ");
  if (wantTelegram.trim().toLowerCase().startsWith("y")) {
    console.log(`
  1. Open Telegram and message @BotFather: /newbot
  2. Follow the prompts. Copy the bot token when given.
  3. Paste it here:
`);
    const tokenIn = await prompt("Bot token: ");
    const token = tokenIn.trim();
    if (!token) {
      console.log("  No token entered — skipping Telegram setup.");
    } else {
      const secret = await import("node:crypto").then((c) =>
        c.randomBytes(32).toString("hex"),
      );
      writeEnvVar(envFile, "TELEGRAM_BOT_TOKEN", token);
      writeEnvVar(envFile, "TELEGRAM_WEBHOOK_SECRET", secret);
      console.log(`
  Generated TELEGRAM_WEBHOOK_SECRET (random 32-byte hex).

Done. Telegram bot token + webhook secret saved to .env.local.

Next: run \`npm run dev\`. Message your bot once. The server logs will
show the rejected chat_id — run \`npm run telegram:approve\` to allow it.
`);
    }
  }
```

(Use whatever `writeEnvVar` / `prompt` helpers exist in `scripts/setup.ts`. If the file uses different names, adapt to its conventions.)

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/setup.ts
git commit -m "$(cat <<'EOF'
setup: add optional Telegram block

Prompts y/N. If yes, walks the user through @BotFather, captures the
bot token, generates a 32-byte webhook secret, and writes both to
.env.local. The chat_id is discovered after first message via
telegram:approve.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 29: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append Telegram vars**

Append to `.env.example`:

```
# --- Telegram (optional) ------------------------------------------------
# Bot token from @BotFather. Without it, Telegram channel is disabled.
TELEGRAM_BOT_TOKEN=
# Comma-separated chat_ids that may DM the bot. Combines with the Convex
# allowlist (npm run telegram:approve to manage at runtime).
TELEGRAM_ALLOWED_CHAT_IDS=
# Random secret (32 bytes hex). Auto-generated by `npm run setup`.
TELEGRAM_WEBHOOK_SECRET=
# Set to "false" to opt out of webhook auto-registration on `npm run dev`.
TELEGRAM_AUTO_WEBHOOK=
# Optional: bot username for friendlier "text @<bot>" error messages.
TELEGRAM_BOT_USERNAME=
# Optional: max voice-note duration in seconds. Above this, transcription
# is skipped and the user is prompted to type. Default 600 (10 min).
TELEGRAM_VOICE_MAX_DURATION=
```

`BOOP_USER_PHONE` keeps its current entry — proactive emails still use it as a fallback if no active channel is registered yet (we removed the *direct* dependency in Phase 3 but didn't delete the env var; it's still useful as a hint during first-run when `channelPrimary.sms` hasn't been recorded yet).

Wait — check the spec: it says "**Removed:** `BOOP_USER_PHONE`". Re-confirm by checking `.env.example` and remove the entry if present:

If `.env.example` contains `BOOP_USER_PHONE=`, remove that line. The active-channel system fully replaces it.

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "$(cat <<'EOF'
env: add Telegram vars; remove BOOP_USER_PHONE

- TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_IDS,
  TELEGRAM_WEBHOOK_SECRET, TELEGRAM_AUTO_WEBHOOK,
  TELEGRAM_BOT_USERNAME, TELEGRAM_VOICE_MAX_DURATION
- BOOP_USER_PHONE is no longer read; proactive nudges resolve via the
  active-channel system

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Voice notes

### Task 30: OpenAI transcribe wrapper

**Files:**
- Create: `server/transcribe.ts`

- [ ] **Step 1: Write the wrapper**

Write to `server/transcribe.ts`:

```ts
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
  form.append("file", new Blob([fileBytes], { type: mimeType }), filename);

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
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/transcribe.ts
git commit -m "$(cat <<'EOF'
add server/transcribe.ts wrapping OpenAI Whisper API

Single transcribeAudio(bytes, filename, mimeType, duration) function.
Uses gpt-4o-mini-transcribe ($0.003/min). Returns text + estimated cost
for usageRecords logging.

Throws on auth/network errors. Empty transcripts bubble back as text=""
so callers can handle them gracefully.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 31: Voice handling in Telegram channel

**Files:**
- Modify: `server/channels/telegram.ts`

- [ ] **Step 1: Add imports**

At the top of `server/channels/telegram.ts`:

```ts
import { transcribeAudio } from "../transcribe.js";
import { dispatch } from "./index.js";
import { formatDuration } from "./text.js";
```

- [ ] **Step 2: Add downloadTelegramFile helper**

Above the `telegramChannel` export:

```ts
async function downloadTelegramFile(fileId: string): Promise<{ bytes: Buffer; mime: string }> {
  const tk = token();
  if (!tk) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const meta = await fetch(`${TELEGRAM_API}/bot${tk}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!meta.ok) {
    throw new Error(`getFile failed ${meta.status}`);
  }
  const metaJson = (await meta.json()) as {
    ok: boolean;
    result?: { file_path?: string };
  };
  if (!metaJson.ok || !metaJson.result?.file_path) {
    throw new Error(`getFile no file_path: ${JSON.stringify(metaJson)}`);
  }
  const fileUrl = `${TELEGRAM_API}/file/bot${tk}/${metaJson.result.file_path}`;
  const dl = await fetch(fileUrl);
  if (!dl.ok) throw new Error(`download failed ${dl.status}`);
  const ab = await dl.arrayBuffer();
  const mime = dl.headers.get("content-type") || "audio/ogg";
  return { bytes: Buffer.from(ab), mime };
}
```

- [ ] **Step 3: Add resolveVoiceContent helper**

Below `downloadTelegramFile`:

```ts
interface TgVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
}

/**
 * Download + transcribe a Telegram voice note. Returns the formatted content
 * string ready for runTurn, or null if any guardrail/error path fired (in which
 * case a polite reply has already been dispatched to the user).
 */
async function resolveVoiceContent(
  voice: TgVoice,
  chatId: number,
): Promise<string | null> {
  const conversationId = `tg:${chatId}` as ConversationId;
  const max = Number(process.env.TELEGRAM_VOICE_MAX_DURATION ?? 600);
  if (voice.duration > max) {
    await dispatch(
      conversationId,
      `That voice note is ${formatDuration(voice.duration)} — longer than I can transcribe (cap ${formatDuration(max)}). Try a shorter clip or type it.`,
    );
    return null;
  }
  if (!process.env.OPENAI_API_KEY) {
    await dispatch(
      conversationId,
      "Voice notes need OPENAI_API_KEY to be configured. Type your message instead.",
    );
    return null;
  }
  try {
    const { bytes, mime } = await downloadTelegramFile(voice.file_id);
    const { text, costUsd } = await transcribeAudio(
      bytes,
      `voice-${voice.file_id}.ogg`,
      voice.mime_type ?? mime,
      voice.duration,
    );
    if (!text.trim()) {
      await dispatch(conversationId, "I couldn't hear that — can you type it instead?");
      return null;
    }
    await convex
      .mutation(api.usageRecords.record, {
        source: "transcribe",
        conversationId,
        model: "gpt-4o-mini-transcribe",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd,
        durationMs: voice.duration * 1000,
      })
      .catch((err) => console.warn("[telegram] usage record failed", err));
    return `🎤 (voice ${formatDuration(voice.duration)}) ${text.trim()}`;
  } catch (err) {
    console.error("[telegram] transcription error", err);
    await dispatch(
      conversationId,
      "I had trouble transcribing that — can you type it instead?",
    );
    return null;
  }
}
```

- [ ] **Step 4: Wire voice into the webhook**

In `webhookRouter`, find the content-resolution block (added in Task 22):

```ts
      // 5. Resolve content (text-only for now; voice handler in a later task)
      let content: string | null = null;
      if (typeof msg.text === "string" && msg.text.length > 0) {
        content = msg.text;
      }
      if (!content) {
        res.json({ ok: true, skipped: true });
        return;
      }

      res.json({ ok: true });
```

Replace with:

```ts
      // 5. Resolve content (text or transcribed voice)
      let content: string | null = null;
      if (msg.voice) {
        // Ack early — transcription can take a few seconds and Telegram retries on slow responses.
        res.json({ ok: true });
        content = await resolveVoiceContent(msg.voice, chatId);
        if (!content) return; // resolveVoiceContent already replied with an error
      } else if (typeof msg.text === "string" && msg.text.length > 0) {
        res.json({ ok: true });
        content = msg.text;
      } else {
        res.json({ ok: true, skipped: true });
        return;
      }
```

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/channels/telegram.ts
git commit -m "$(cat <<'EOF'
channels/telegram: support inbound voice notes

- downloadTelegramFile: getFile + fetch the audio bytes
- resolveVoiceContent: guardrails (duration cap, OPENAI_API_KEY check),
  transcribe via gpt-4o-mini-transcribe, log cost, return formatted
  content. Polite text reply on every failure path so the user always
  hears something
- Webhook now dispatches voice -> transcript before runTurn. Acks 200
  before transcription so Telegram doesn't retry on slow Whisper calls

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 32: Voice smoke fixture and smoke-script extension

**Files:**
- Create: `assets/voice-smoke.ogg`
- Modify: `scripts/telegram-smoke.mjs`

- [ ] **Step 1: Generate a voice fixture**

The fixture is a ~2-3 second OGG/Opus clip saying *"hello boop testing"*. Easy ways to create:

- Record on your own phone, send to yourself on Telegram, save the OGG.
- Use macOS `say "hello boop testing" -o assets/voice-smoke.aiff && ffmpeg -i assets/voice-smoke.aiff -c:a libopus -b:a 24k assets/voice-smoke.ogg && rm assets/voice-smoke.aiff` (requires ffmpeg; libopus is the codec Telegram uses).
- Use any TTS-to-OGG tool.

Verify the file is < 50 KB and plays back as recognizable speech.

- [ ] **Step 2: Add voice section to telegram-smoke.mjs**

Voice tests need a real Telegram bot to upload to (since the smoke posts to our own webhook with a `file_id` that only Telegram knows about). The simplest viable smoke is:

- Skip the voice test by default with a clear log message.
- Run it only when `TELEGRAM_SMOKE_FILE_ID` is set to a real file_id from a prior `sendVoice` upload.

Add to `scripts/telegram-smoke.mjs` after the existing checks:

```js
console.log("[smoke] 4. voice message inbound");
{
  const fileId = env.TELEGRAM_SMOKE_FILE_ID;
  if (!fileId) {
    console.log("  ↪ skipped (set TELEGRAM_SMOKE_FILE_ID to a real Telegram file_id to enable)");
  } else {
    const updateId = nextUpdateId();
    const r = await postUpdate({
      update_id: updateId,
      message: {
        message_id: updateId,
        from: { id: chatId, username: "smoke" },
        chat: { id: chatId, type: "private" },
        date: Math.floor(Date.now() / 1000),
        voice: { file_id: fileId, duration: 3, mime_type: "audio/ogg" },
      },
    });
    if (r.status !== 200) fail("voice webhook 200", r);
    await new Promise((r) => setTimeout(r, 4000)); // give Whisper time
    const msgs = await convex.query(api.messages.recentAcrossChannels, {
      conversationIds: [`tg:${chatId}`],
      limit: 5,
    });
    const found = msgs.some(
      (m) => m.role === "user" && /^🎤 \(voice \d+:\d{2}\)/.test(m.content),
    );
    if (found) ok("voice transcript persisted with marker");
    else fail("voice transcript marker not found", msgs.slice(-3));
  }
}
```

The README/verification doc (Phase 6) will document how to obtain a `file_id`.

- [ ] **Step 3: Add fixture to git (binary file)**

```bash
git add assets/voice-smoke.ogg
```

- [ ] **Step 4: Verify the smoke runs**

```bash
TELEGRAM_SMOKE_CHAT_ID=<your-chat-id> npm run telegram:smoke
```

Steps 1-3 pass. Step 4 logs "skipped" unless you've set `TELEGRAM_SMOKE_FILE_ID`.

- [ ] **Step 5: Commit**

```bash
git add scripts/telegram-smoke.mjs assets/voice-smoke.ogg
git commit -m "$(cat <<'EOF'
smoke: add voice-note path (opt-in via TELEGRAM_SMOKE_FILE_ID)

- assets/voice-smoke.ogg: 2-3s OGG/Opus fixture saying "hello boop testing"
- telegram-smoke.mjs: posts a synthetic voice update; asserts the
  transcript persists with the 🎤 marker prefix

Skipped by default because the synthetic update needs a real Telegram
file_id (Whisper downloads from Telegram's CDN). Set
TELEGRAM_SMOKE_FILE_ID after a manual sendVoice to your bot to enable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Documentation

### Task 33: Manual verification checklist

**Files:**
- Create: `docs/telegram-verification.md`

- [ ] **Step 1: Write the checklist**

Write to `docs/telegram-verification.md`:

```md
# Telegram Channel — Manual Verification

Run through this after the implementation lands. Every checkbox is something a
human needs to eyeball; the smoke script (`npm run telegram:smoke`) covers a
subset automatically.

## Setup prerequisites

- [ ] `.env.local` has `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- [ ] You messaged the bot once and ran `npm run telegram:approve` to add your chat_id
- [ ] `npm run dev` shows the Telegram banner lines

## Telegram inbound — text

- [ ] Send "hello" → bot replies on Telegram
- [ ] Send a question that requires an integration (e.g. "what's on my calendar?") → ack appears, then result
- [ ] Send a long message (>500 chars) → reply is properly chunked

## Telegram inbound — voice

- [ ] Send a short voice note (~10s, English) → reply is the agent answering, with the voice transcript visible in Convex `messages` as `🎤 (voice 0:0X) ...`
- [ ] Send a 15-min voice note → bot replies "longer than I can transcribe" without making a Whisper call (verify in `usageRecords` — no transcribe row)
- [ ] Temporarily unset `OPENAI_API_KEY` and restart, send a voice note → bot replies "Voice notes need OPENAI_API_KEY..."
- [ ] Send mostly silence → bot replies "I couldn't hear that"

## Telegram inbound — non-text/non-voice

- [ ] Send a photo, sticker, or document → no reply, server logs `skipped` (intended)
- [ ] Edit a sent message → no reply (intended)

## Telegram inbound — group chat

- [ ] Add bot to a group, send "hello" → no reply, log shows `chat_id < 0` skip

## Allowlist

- [ ] From an account NOT in the allowlist (a friend's account, with their permission) → bot stays silent, server log shows `denied chat_id=...`, `npm run telegram:approve` lists the entry
- [ ] Approve the entry → friend can now message the bot
- [ ] Add a chat_id to `TELEGRAM_ALLOWED_CHAT_IDS` env var, restart → that chat_id works without needing approval

## Active channel switching

- [ ] On iMessage: text "use telegram now" → reply confirms, automation results 5 min later land on Telegram
- [ ] On Telegram: text "switch back to imessage" → reply confirms, next automation lands on iMessage
- [ ] Try "use telegram" without ever messaging Telegram → bot refuses with "text @bot once first"
- [ ] Unset `TELEGRAM_BOT_TOKEN`, restart, text "use telegram" → bot refuses with config hint

## Cross-channel context (Q3 = C)

- [ ] On iMessage at T=0: "remember I'm meeting Sarah at 2pm tomorrow"
- [ ] On Telegram at T+5min: "what time was that meeting?"
- [ ] Bot recalls 2pm without needing `recall()` (verify by watching server logs — no `tool: recall` line)

## Regressions on iMessage

- [ ] Text round-trip on iMessage works identically
- [ ] PDF generation in iMessage arrives as attachment
- [ ] `send_ack` shows up before slow tool calls
- [ ] Automation creation, run, and notify still works
- [ ] Proactive nudges land on the active channel (test by switching active channel between iMessage and Telegram and observing where the next nudge appears)

## Stress

- [ ] Stop server mid-Telegram-turn → restart → no crash; the in-flight update_id is in `telegramDedup` so the retry is dropped
- [ ] Block the bot in Telegram client → next outbound send logs an error, server doesn't crash
- [ ] Set `activeChannel` to `tg` then unset `TELEGRAM_BOT_TOKEN` and restart → boot warning appears, automations fail silently with log line

## Cost tracking

- [ ] After a few voice notes, `usageRecords` has rows with `source="transcribe"` and reasonable `costUsd` values
- [ ] Debug dashboard's cost tile shows transcribe cost alongside dispatcher / execution costs (if the dashboard surfaces all sources)
```

- [ ] **Step 2: Commit**

```bash
git add docs/telegram-verification.md
git commit -m "$(cat <<'EOF'
docs: add Telegram channel manual verification checklist

Human-driven post-implementation gate. Covers inbound text/voice,
non-text drops, allowlist, active-channel switching, cross-channel
context, regression checks for iMessage, and stress paths.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 34: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the Telegram subsection**

Read `README.md`. Find the natural spot — between the existing Sendblue setup walkthrough (around the `## How the Sendblue integration works` section) and the Composio section. Add:

```md
---

## Telegram (optional second channel)

Boop supports Telegram as a second messaging channel. Run both at once and
toggle which one receives unsolicited messages (automation results,
proactive nudges) with one text.

### Setup

1. Open Telegram and message [@BotFather](https://t.me/BotFather): `/newbot`. Follow the prompts and copy the bot token.
2. Add to `.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   ```
   (`npm run setup` walks through this interactively if you prefer.)
3. Run `npm run dev`. The banner now shows the Telegram webhook URL.
4. Message your bot from your personal Telegram account. The server log will print:
   ```
   [telegram] denied chat_id=12345678 (@yourname) — pending approval (run `npm run telegram:approve`)
   ```
5. Run `npm run telegram:approve` to allow the chat_id.
6. Message the bot again — it now responds.

### Switching active channel

The "active channel" controls where Boop sends *unsolicited* messages
(automation results, proactive nudges). Direct replies always go to whichever
channel you texted from.

Just text Boop on either channel:

> *"Use Telegram now"* — automations + nudges go to Telegram
> *"Switch back to imessage"* — same, but iMessage

`get_config` (or just *"what channel are you using?"*) shows the current state.

### Voice notes

Telegram inbound voice notes are transcribed automatically (uses
`OPENAI_API_KEY` with `gpt-4o-mini-transcribe` — same key already used for
embeddings, if you've set one up). The transcript is processed exactly like a
typed message and stored as `🎤 (voice 0:12) actual transcript` in your
conversation history.

Cap is 10 minutes per note (override with `TELEGRAM_VOICE_MAX_DURATION` in
seconds). Without `OPENAI_API_KEY`, voice notes get a polite "type it instead"
reply.

### Troubleshooting

- **Bot doesn't reply** → check the server log for `denied chat_id`. If you see
  it, run `npm run telegram:approve`.
- **Bot replies but webhook never registered** → check
  `TELEGRAM_AUTO_WEBHOOK` isn't `false`, and that the dev server's public URL
  actually reached Telegram (`curl -s https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo`).
- **Voice notes return "trouble transcribing"** → check `OPENAI_API_KEY` is set
  and the file isn't longer than `TELEGRAM_VOICE_MAX_DURATION`.
- **Group chats don't work** → intentional. The bot only DMs the allowlist.
```

- [ ] **Step 2: Update Environment variables table**

In the existing `## Environment variables` table, add the Telegram rows after the Sendblue rows:

```md
| `TELEGRAM_BOT_TOKEN` | optional | From @BotFather. Without it, Telegram channel is disabled. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | optional | Comma-separated chat_ids that may DM the bot. Hybrid with Convex allowlist. |
| `TELEGRAM_WEBHOOK_SECRET` | optional | Random secret. Auto-generated by `npm run setup`. |
| `TELEGRAM_AUTO_WEBHOOK` | optional | Set to `false` to skip auto-registration on `npm run dev`. Default on. |
| `TELEGRAM_BOT_USERNAME` | optional | Powers the "@bot" placeholder in error messages. |
| `TELEGRAM_VOICE_MAX_DURATION` | optional | Voice-note duration cap in seconds. Default 600 (10 min). |
```

- [ ] **Step 3: Verify the markdown renders**

Skim the rendered markdown (or eyeball in raw form). Make sure indentation under bullet points is consistent.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: add Telegram setup walkthrough to README

- New "Telegram (optional second channel)" section with setup,
  active-channel switching, voice notes, troubleshooting
- Environment variables table grows six TELEGRAM_* rows

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

After the last task, run a final pass:

- [ ] **Spec coverage check.** Skim each section in the spec. For every requirement, point to the task that implemented it. Gaps to look for: did we miss any `if (id.startsWith("sms:"))` site? (Run `grep -rn 'startsWith("sms' server/` — should return empty.)
- [ ] **Typecheck and convex types are clean.** `npm run typecheck && npx convex dev --once` both succeed.
- [ ] **Smoke passes.** `npm run telegram:smoke` (3 of 4 checks; voice optional).
- [ ] **Manual checklist passes.** Walk through `docs/telegram-verification.md` end-to-end on a real device.
- [ ] **No leftover dead code.** `grep -rn 'sendImessage' server/` — only `server/sendblue.ts` should still reference it (the function is still defined and used by the Sendblue adapter; just not called directly elsewhere).
- [ ] **Banner looks right** — `npm run dev`'s output shows both channels when both are configured, just iMessage when Telegram isn't.

---

## Open questions (deferred from the spec — not in this plan)

- Debug-dashboard channel switcher (UI button instead of natural-language)
- Sendblue inbound voice (mirror the Telegram voice path via Sendblue's `media_url`)
- Whisper alternatives (Deepgram, AssemblyAI, local) — would require a strategy interface
- Per-message-bucket rate limiting (only matters for multi-user deployments)

These are intentional follow-ups. Don't expand scope here.
