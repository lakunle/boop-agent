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

// ---- Inbound photo (opt-in) ----
const smokePhotoFileId = env.TELEGRAM_SMOKE_PHOTO_FILE_ID;
if (smokePhotoFileId) {
  console.log("[smoke] 5. photo inbound");
  {
    const updateId = nextUpdateId();
    const testStart = Date.now();
    const r = await postUpdate({
      update_id: updateId,
      message: {
        message_id: updateId,
        from: { id: chatId, username: "smoke", first_name: "Smoke" },
        chat: { id: chatId, type: "private" },
        date: Math.floor(Date.now() / 1000),
        photo: [
          { file_id: smokePhotoFileId, file_size: 50000, width: 64, height: 64 },
        ],
        caption: "vibe for the deck",
      },
    });
    if (r.status === 200 && r.body?.ok) ok("photo webhook accepted");
    else fail("photo webhook returned non-ok", r);

    // Wait for runTurn → resolveAttachment → upload + describe + persist.
    // Vision call typically takes 2–5 seconds; allow generous slack.
    await new Promise((r) => setTimeout(r, 8000));
    const msgs = await convex.query(api.messages.recent, {
      conversationId: `tg:${chatId}`,
      limit: 5,
    });
    // findLast walks back-to-front; the time guard prevents stale messages from
    // a previous run satisfying the assertion.
    const userMsg = msgs.findLast(
      (m) => m.role === "user"
          && m._creationTime > testStart
          && m.content.includes("(image attached)"),
    );
    if (userMsg) ok("user message row contains image-attachment block");
    else fail("expected image-attachment block in recent user messages");
  }
} else {
  console.log("[smoke] 5. photo inbound — SKIPPED (set TELEGRAM_SMOKE_PHOTO_FILE_ID to enable)");
}

// ---- Inbound document/PDF (opt-in) ----
const smokePdfFileId = env.TELEGRAM_SMOKE_PDF_FILE_ID;
if (smokePdfFileId) {
  console.log("[smoke] 6. document (PDF) inbound");
  {
    const updateId = nextUpdateId();
    const testStart = Date.now();
    const r = await postUpdate({
      update_id: updateId,
      message: {
        message_id: updateId,
        from: { id: chatId, username: "smoke", first_name: "Smoke" },
        chat: { id: chatId, type: "private" },
        date: Math.floor(Date.now() / 1000),
        document: {
          file_id: smokePdfFileId,
          mime_type: "application/pdf",
          file_name: "smoke.pdf",
          file_size: 50000,
        },
        caption: "smoke test pdf",
      },
    });
    if (r.status === 200 && r.body?.ok) ok("pdf webhook accepted");
    else fail("pdf webhook returned non-ok", r);

    // PDFs: pdfjs parse + per-page text extraction is fast for small files.
    await new Promise((r) => setTimeout(r, 10000));
    const msgs = await convex.query(api.messages.recent, {
      conversationId: `tg:${chatId}`,
      limit: 5,
    });
    // findLast walks back-to-front; the time guard prevents stale messages from
    // a previous run satisfying the assertion.
    const userMsg = msgs.findLast(
      (m) => m.role === "user"
          && m._creationTime > testStart
          && m.content.includes("(PDF attached"),
    );
    if (userMsg) ok("user message row contains pdf-attachment block");
    else fail("expected pdf-attachment block in recent user messages");
  }
} else {
  console.log("[smoke] 6. document (PDF) inbound — SKIPPED (set TELEGRAM_SMOKE_PDF_FILE_ID to enable)");
}

// ---- Unsupported media (sticker) → polite reject (always runs) ----
console.log("[smoke] 7. unsupported media (sticker) → polite reject");
{
  const updateId = nextUpdateId();
  const testStart = Date.now();
  const r = await postUpdate({
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: chatId, username: "smoke", first_name: "Smoke" },
      chat: { id: chatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      sticker: {
        file_id: "fake-sticker-id",
        width: 512,
        height: 512,
        is_animated: false,
        is_video: false,
      },
    },
  });
  if (r.status === 200 && r.body?.ok) ok("sticker webhook accepted");
  else fail("sticker webhook returned non-ok", r);

  // The polite reply is sent via dispatch() but is NOT persisted as a user
  // OR assistant message row (dispatch is fire-and-forget for unsolicited
  // pushes; only runTurn persists the assistant message). Verify by checking
  // that NO user-message row appears for this update_id. The sticker file_id
  // is fake, so even an accidental download attempt would fail loudly.
  await new Promise((r) => setTimeout(r, 2000));
  const msgs = await convex.query(api.messages.recent, {
    conversationId: `tg:${chatId}`,
    limit: 3,
  });
  const stickerMsg = msgs.find(
    (m) => m.role === "user"
        && m._creationTime > testStart
        && (m.content.includes("sticker") || m.content.includes("fake-sticker-id")),
  );
  if (!stickerMsg) ok("no user-message row for unsupported sticker (correct)");
  else fail("sticker should not produce a user-message row", { content: stickerMsg.content });
}

if (process.exitCode === 1) {
  console.error("[smoke] FAILED");
  process.exit(1);
} else {
  console.log("[smoke] PASSED");
}
