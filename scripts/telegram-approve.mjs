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
