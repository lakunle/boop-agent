#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { ConvexHttpClient } from "convex/browser";
import puppeteer from "puppeteer";
import { api } from "../convex/_generated/api.js";

const CONVEX_URL = process.env.CONVEX_URL;
const SB_KEY = process.env.SENDBLUE_API_KEY;
const SB_SECRET = process.env.SENDBLUE_API_SECRET;
const SB_FROM = process.env.SENDBLUE_FROM_NUMBER;

if (!CONVEX_URL || !SB_KEY || !SB_SECRET || !SB_FROM) {
  console.error("Missing env: need CONVEX_URL, SENDBLUE_API_KEY, SENDBLUE_API_SECRET, SENDBLUE_FROM_NUMBER");
  process.exit(1);
}

const toArg = process.argv.findIndex((a) => a === "--to");
const TO = toArg >= 0 ? process.argv[toArg + 1] : null;
if (!TO) {
  console.error("Usage: npm run pdf:smoke:sendblue -- --to +14155551234");
  process.exit(1);
}

const SAMPLE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: system-ui, sans-serif; padding: 40px; color: oklch(15% 0 0); line-height: 1.5; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  .badge { display: inline-block; padding: 2px 10px; background: oklch(58% 0.18 250); color: white; border-radius: 999px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
</style></head><body>
  <span class="badge">Sendblue smoke test</span>
  <h1>If you can read this, media_url works</h1>
  <p>Generated ${new Date().toISOString()}</p>
</body></html>`;

const convex = new ConvexHttpClient(CONVEX_URL);

async function main() {
  console.log(`[smoke-sb] rendering...`);
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setContent(SAMPLE, { waitUntil: "networkidle0" });
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  await page.setViewport({ width: 200, height: 283 });
  const thumb = await page.screenshot({ type: "png" });
  await browser.close();

  console.log(`[smoke-sb] uploading to Convex...`);
  const result = await convex.action(api.pdfArtifacts.generate, {
    pdfBase64: Buffer.from(pdf).toString("base64"),
    thumbnailBase64: Buffer.from(thumb).toString("base64"),
    conversationId: "smoke-sendblue",
    kind: "invoice",
    filename: `smoke-sendblue-${Date.now()}.pdf`,
    pageCount: 1,
  });
  console.log(`[smoke-sb] artifact ${result.artifactId} — ${result.signedUrl}`);

  console.log(`[smoke-sb] sending to ${TO} via Sendblue media_url...`);
  const res = await fetch("https://api.sendblue.com/api/send-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "sb-api-key-id": SB_KEY,
      "sb-api-secret-key": SB_SECRET,
    },
    body: JSON.stringify({
      number: TO,
      from_number: SB_FROM,
      content: "PDF smoke test — open the attachment.",
      media_url: result.signedUrl,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[smoke-sb] Sendblue rejected ${res.status}: ${body}`);
    console.error(`[smoke-sb] The fallback path will text the URL instead in the real flow.`);
    process.exit(1);
  }
  console.log(`[smoke-sb] sent ✓ — check ${TO} for the iMessage with attachment`);
}

main().catch((err) => {
  console.error(`[smoke-sb] fatal:`, err);
  process.exit(1);
});
