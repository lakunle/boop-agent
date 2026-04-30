#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { ConvexHttpClient } from "convex/browser";
import puppeteer from "puppeteer";
import { api } from "../convex/_generated/api.js";

const CONVEX_URL = process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("CONVEX_URL not set in .env.local");
  process.exit(1);
}
const convex = new ConvexHttpClient(CONVEX_URL);

const SAMPLE_HTML = (kind) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { --fg: oklch(15% 0 0); --muted: oklch(50% 0 0); --accent: oklch(58% 0.18 250); --bg: oklch(99% 0 0); }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; padding: 32px; line-height: 1.55; }
  h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; }
  h2 { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 24px 0 8px; }
  p { font-size: 16px; max-width: 65ch; margin: 0 0 12px; }
  hr { border: 0; border-top: 1px solid var(--fg); margin: 16px 0; }
  .kind-tag { display: inline-block; font-size: 11px; padding: 2px 8px; background: var(--accent); color: white; border-radius: 999px; letter-spacing: 0.05em; text-transform: uppercase; }
</style></head><body>
  <span class="kind-tag">${kind}</span>
  <h1>Smoke test — ${kind}</h1>
  <hr/>
  <h2>What this verifies</h2>
  <p>The Puppeteer renderer boots, OKLCH colors round-trip through PDF, system fonts load, and the Convex storage upload + row creation succeeds.</p>
  <h2>Generated</h2>
  <p>${new Date().toISOString()}</p>
</body></html>`;

const KINDS = ["brief", "invoice", "itinerary", "resume", "newsletter", "reference"];

async function renderOne(browser, kind) {
  const page = await browser.newPage();
  try {
    await page.setContent(SAMPLE_HTML(kind), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
    });
    await page.setViewport({ width: 200, height: 283, deviceScaleFactor: 1 });
    const thumb = await page.screenshot({ type: "png" });
    return {
      pdfBase64: Buffer.from(pdf).toString("base64"),
      thumbnailBase64: Buffer.from(thumb).toString("base64"),
    };
  } finally {
    await page.close();
  }
}

async function main() {
  console.log(`[smoke] launching Chromium...`);
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  console.log(`[smoke] Chromium booted`);
  let failures = 0;
  for (const kind of KINDS) {
    process.stdout.write(`[smoke] ${kind.padEnd(11)} `);
    const start = Date.now();
    try {
      const { pdfBase64, thumbnailBase64 } = await renderOne(browser, kind);
      const result = await convex.action(api.pdfArtifacts.generate, {
        pdfBase64,
        thumbnailBase64,
        conversationId: "smoke-test",
        kind,
        filename: `smoke-${kind}-${Date.now()}.pdf`,
        pageCount: 1,
      });
      const ms = Date.now() - start;
      const sizeKb = (result.fileSizeBytes / 1024).toFixed(1);
      console.log(`✓ ${ms}ms  ${sizeKb}KB  ${result.signedUrl}`);
      // Sanity asserts
      if (result.fileSizeBytes < 5_000) throw new Error(`PDF too small (${result.fileSizeBytes} bytes)`);
      if (result.fileSizeBytes > 5_000_000) throw new Error(`PDF too large (${result.fileSizeBytes} bytes)`);
      const headRes = await fetch(result.signedUrl, { method: "HEAD" });
      if (!headRes.ok) throw new Error(`signedUrl returned ${headRes.status}`);
    } catch (err) {
      failures += 1;
      console.log(`✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await browser.close();
  console.log(`[smoke] done — ${KINDS.length - failures}/${KINDS.length} succeeded`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`[smoke] fatal:`, err);
  process.exit(1);
});
