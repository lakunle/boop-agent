import express from "express";
import type { Channel, ChannelId, ConversationId, SendOpts } from "./types.js";
import { stripChannelPrefix } from "./types.js";
import { stripMarkdown, chunk, formatDuration } from "./text.js";
import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { runTurn, dispatch } from "./index.js";
import { transcribeAudio } from "../transcribe.js";
import {
  resolveAttachment,
  isAttachmentError,
  ATTACHMENT_LIMITS,
  type ResolvedAttachment,
} from "../attachments.js";

const TELEGRAM_API = "https://api.telegram.org";
const MAX_TG_CHUNK = 4000; // 4096 hard cap with margin

function token(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

function redactToken(t: string | null): string {
  if (!t) return "<no-token>";
  return `${t.slice(0, 6)}...${t.slice(-4)}`;
}

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

function formatAttachmentBlock(
  resolved: ResolvedAttachment,
  index: number | null,
  total: number,
  caption: string | undefined,
): string {
  const emoji = resolved.kind === "image" ? "🖼️" : resolved.kind === "pdf" ? "📄" : "📎";
  const label =
    resolved.kind === "image"
      ? "image"
      : resolved.kind === "pdf"
        ? "PDF"
        : "file";
  const counter = index !== null && total > 1 ? ` ${index + 1}/${total}` : "";
  return [
    `${emoji} (${label} attached${counter})`,
    caption ? `Caption: ${caption}` : null,
    resolved.filename ? `Filename: ${resolved.filename}` : null,
    `Description: ${resolved.description}`,
    `Link: ${resolved.signedUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function pickPhoto(
  photos: Array<{ file_id: string; file_size?: number; width?: number; height?: number }>,
  maxBytes: number,
): { file_id: string; file_size?: number } | null {
  const sorted = [...photos].sort(
    (a, b) => (b.file_size ?? 0) - (a.file_size ?? 0),
  );
  for (const p of sorted) {
    if (!p.file_size || p.file_size <= maxBytes) return p;
  }
  return null;
}

async function recordAttachmentUsage(
  resolved: ResolvedAttachment,
  conversationId: ConversationId,
): Promise<void> {
  const source =
    resolved.kind === "image"
      ? "vision"
      : resolved.kind === "pdf"
        ? "pdf-extract"
        : "docx-extract";
  await convex
    .mutation(api.usageRecords.record, {
      source,
      conversationId,
      // Prefer the model surfaced by the resolver (e.g. "gpt-4o" or
      // "BOOP_VISION_MODEL" override for vision; "pdfjs", "pdfjs+vision",
      // "mammoth" for extractors). Fall back to the source name for raw
      // text reads where no specific tool was used.
      model: resolved.model ?? source,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: resolved.costUsd,
      durationMs: 0,
    })
    .catch((err) => console.warn("[telegram] attachment usage record failed", err));
}

async function resolveTelegramPhoto(
  photos: Array<{ file_id: string; file_size?: number; width?: number; height?: number }>,
  caption: string | undefined,
  chatId: number,
): Promise<string | null> {
  const conversationId = `tg:${chatId}` as ConversationId;
  const pick = pickPhoto(photos, ATTACHMENT_LIMITS.maxImageBytes);
  if (!pick) {
    await dispatch(
      conversationId,
      `That photo is bigger than ${(ATTACHMENT_LIMITS.maxImageBytes / 1024 / 1024).toFixed(0)} MB — try sending a smaller one?`,
    );
    return null;
  }

  let downloaded;
  try {
    downloaded = await downloadTelegramFile(pick.file_id);
  } catch (e) {
    console.error("[telegram] photo download failed", e);
    await dispatch(conversationId, "Couldn't fetch that photo — try sending it again?");
    return null;
  }

  const resolved = await resolveAttachment(
    downloaded.bytes,
    downloaded.mime,
    `photo-${pick.file_id}.jpg`,
    "telegram",
  );
  if (isAttachmentError(resolved)) {
    console.error("[telegram] photo resolveAttachment error", resolved.serverError);
    await dispatch(conversationId, resolved.userMessage);
    return null;
  }

  await recordAttachmentUsage(resolved, conversationId);

  return formatAttachmentBlock(resolved, null, 1, caption);
}

async function resolveTelegramDocument(
  doc: { file_id: string; mime_type?: string; file_name?: string; file_size?: number },
  caption: string | undefined,
  chatId: number,
): Promise<string | null> {
  const conversationId = `tg:${chatId}` as ConversationId;
  const declaredMime = doc.mime_type ?? "application/octet-stream";
  const cap =
    declaredMime === "application/pdf"
      ? ATTACHMENT_LIMITS.maxPdfBytes
      : ATTACHMENT_LIMITS.maxTextBytes;
  if (doc.file_size && doc.file_size > cap) {
    await dispatch(
      conversationId,
      `That file is ${(doc.file_size / 1024 / 1024).toFixed(1)} MB — bigger than I can handle (${(cap / 1024 / 1024).toFixed(0)} MB).`,
    );
    return null;
  }

  let downloaded;
  try {
    downloaded = await downloadTelegramFile(doc.file_id);
  } catch (e) {
    console.error("[telegram] document download failed", e);
    await dispatch(conversationId, "Couldn't fetch that file — try sending it again?");
    return null;
  }

  const resolved = await resolveAttachment(
    downloaded.bytes,
    declaredMime,
    doc.file_name,
    "telegram",
  );
  if (isAttachmentError(resolved)) {
    console.error("[telegram] document resolveAttachment error", resolved.serverError);
    await dispatch(conversationId, resolved.userMessage);
    return null;
  }

  await recordAttachmentUsage(resolved, conversationId);

  return formatAttachmentBlock(resolved, null, 1, caption);
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

      // 5. Resolve content (text, voice, photo, document, or unsupported media)
      let content: string | null = null;
      if (msg.voice) {
        // Ack early — transcription can take a few seconds and Telegram retries on slow responses.
        res.json({ ok: true });
        content = await resolveVoiceContent(msg.voice, chatId);
        if (!content) return; // resolveVoiceContent already replied with an error
      } else if (typeof msg.text === "string" && msg.text.length > 0) {
        res.json({ ok: true });
        content = msg.text;
      } else if (Array.isArray(msg.photo) && msg.photo.length > 0) {
        res.json({ ok: true });
        content = await resolveTelegramPhoto(msg.photo, msg.caption, chatId);
        if (!content) return;
      } else if (msg.document) {
        res.json({ ok: true });
        content = await resolveTelegramDocument(msg.document, msg.caption, chatId);
        if (!content) return;
      } else if (msg.sticker || msg.video || msg.animation || msg.video_note) {
        res.json({ ok: true });
        const what =
          msg.sticker ? "stickers" :
          msg.video || msg.video_note ? "videos" :
          "GIFs";
        await dispatch(
          `tg:${chatId}` as ConversationId,
          `I can't read ${what} yet — only photos, PDFs, .txt/.md/.docx, voice notes, and text. Try sending it differently?`,
        );
        return;
      } else {
        res.json({ ok: true, skipped: true });
        return;
      }
      if (!content) return;

      await runTurn({
        conversationId: `tg:${chatId}` as ConversationId,
        content,
        from: `tg:${msg.from?.username ? "@" + msg.from.username : chatId}`,
      });
    });

    return router;
  },
};
