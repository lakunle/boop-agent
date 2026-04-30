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
