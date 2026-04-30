import express from "express";
import type { Channel, ChannelId, ConversationId, SendOpts } from "./types.js";
import { stripChannelPrefix } from "./types.js";
import { stripMarkdown, chunk } from "./text.js";
import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { runTurn } from "./index.js";

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
};
