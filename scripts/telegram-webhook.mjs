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
