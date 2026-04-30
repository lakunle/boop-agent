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
