import express from "express";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { runTurn } from "./channels/index.js";

const API_BASE = "https://api.sendblue.com/api";
const MAX_CHUNK = 2900;

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```/g, ""))
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
    .trim();
}

function chunk(text: string, size = MAX_CHUNK): string[] {
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

function headers(): Record<string, string> | null {
  const apiKey = process.env.SENDBLUE_API_KEY;
  const apiSecret = process.env.SENDBLUE_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return {
    "Content-Type": "application/json",
    "sb-api-key-id": apiKey,
    "sb-api-secret-key": apiSecret,
  };
}

function normalizeE164(n: string | undefined): string | undefined {
  if (!n) return undefined;
  const trimmed = n.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("+")) return trimmed;
  // Bare US-length numbers get a +1. Longer/shorter just get a leading +.
  if (/^\d{10}$/.test(trimmed)) return `+1${trimmed}`;
  if (/^\d{11,15}$/.test(trimmed)) return `+${trimmed}`;
  return trimmed;
}

export async function sendImessage(
  toNumber: string,
  text: string,
  opts: { mediaUrl?: string } = {},
): Promise<void> {
  const h = headers();
  if (!h) {
    console.warn("[sendblue] missing credentials — not sending");
    return;
  }
  const from = normalizeE164(process.env.SENDBLUE_FROM_NUMBER);
  if (!from) {
    console.error(
      `[sendblue] SENDBLUE_FROM_NUMBER is not set. Run \`npm run sendblue:sync\` (pulls it from \`sendblue lines\`) or paste your provisioned number into .env.local, then restart \`npm run dev\`.`,
    );
    return;
  }
  const plain = stripMarkdown(text);
  const parts = chunk(plain);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isFirst = i === 0;
    // Attach media on the first chunk only — multi-chunk + media would
    // deliver the file once per chunk.
    const body: Record<string, unknown> = {
      number: toNumber,
      content: part,
      from_number: from,
    };
    if (isFirst && opts.mediaUrl) body.media_url = opts.mediaUrl;

    const res = await fetch(`${API_BASE}/send-message`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[sendblue] send failed ${res.status}: ${errBody}`);
      // Fallback: media rejected (size, plan, carrier). Re-send as text+URL.
      if (opts.mediaUrl && isFirst) {
        console.warn(`[sendblue] media_url rejected — falling back to text URL`);
        const fallbackRes = await fetch(`${API_BASE}/send-message`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({
            number: toNumber,
            from_number: from,
            content: `${part}\n\n${opts.mediaUrl}`,
          }),
        });
        if (!fallbackRes.ok) {
          const fbBody = await fallbackRes.text().catch(() => "");
          console.error(`[sendblue] fallback send also failed ${fallbackRes.status}: ${fbBody}`);
        }
      } else if (errBody.includes("missing required parameter") && errBody.includes("from_number")) {
        console.error(
          `[sendblue] → Set SENDBLUE_FROM_NUMBER in .env.local to your Sendblue-provisioned number and restart the server.`,
        );
      } else if (errBody.includes("Cannot send messages to self")) {
        console.error(
          `[sendblue] → SENDBLUE_FROM_NUMBER is your personal cell. It must be the Sendblue-provisioned number (the one people text TO).`,
        );
      } else if (errBody.includes("This phone number is not defined")) {
        console.error(
          `[sendblue] → Sendblue doesn't recognize from_number=${from}. Run \`npm run sendblue:sync\` to pull the correct one from \`sendblue lines\`, then restart the server.`,
        );
      }
    } else {
      const attachNote = isFirst && opts.mediaUrl ? " + 1 attachment" : "";
      console.log(`[sendblue] → sent ${part.length} chars${attachNote} to ${toNumber}`);
    }
  }
}

export async function sendTypingIndicator(toNumber: string): Promise<void> {
  const h = headers();
  if (!h) return;
  const from = process.env.SENDBLUE_FROM_NUMBER;
  try {
    await fetch(`${API_BASE}/send-typing-indicator`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ number: toNumber, from_number: from }),
    });
  } catch {
    /* non-fatal */
  }
}

export function startTypingLoop(toNumber: string): () => void {
  sendTypingIndicator(toNumber);
  const timer = setInterval(() => sendTypingIndicator(toNumber), 5000);
  return () => clearInterval(timer);
}

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
