import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import puppeteer, { type Browser } from "puppeteer";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";

let browserPromise: Promise<Browser> | null = null;
let renderCount = 0;
let restarting = false;
const RESTART_AFTER = 100;
const RENDER_TIMEOUT_MS = 30_000;

async function getBrowser(): Promise<Browser> {
  // Restart only one caller at a time. Without this guard, two concurrent
  // calls at the 100-render boundary can each launch a fresh Chromium and
  // overwrite each other's reference, leaking the orphaned process.
  if (renderCount >= RESTART_AFTER && browserPromise && !restarting) {
    restarting = true;
    try {
      const prev = await browserPromise;
      await prev.close().catch(() => {});
      browserPromise = null;
      renderCount = 0;
    } finally {
      restarting = false;
    }
  }
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

// Shut down Chromium cleanly on process exit so `npm run dev` restarts don't
// orphan the browser.
function installShutdownHooks() {
  const shutdown = async () => {
    if (browserPromise) {
      const b = await browserPromise.catch(() => null);
      if (b) await b.close().catch(() => {});
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
installShutdownHooks();

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface RenderResult {
  pdfBase64: string;
  thumbnailBase64: string;
  pageCount: number;
}

async function renderHtml(html: string): Promise<RenderResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // setContent — networkidle0 ensures all inlined assets settle. We hard-cap
    // total render time so a hanging external request can't lock the page.
    await withTimeout(
      page.setContent(html, { waitUntil: "networkidle0", timeout: RENDER_TIMEOUT_MS }),
      RENDER_TIMEOUT_MS,
      "page.setContent",
    );

    const pdfBuffer = await withTimeout(
      page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
      }),
      RENDER_TIMEOUT_MS,
      "page.pdf",
    );

    // Thumbnail — re-use the same page, shrink the viewport to A4 aspect ratio
    // at thumbnail size, then screenshot. ~150ms.
    await page.setViewport({ width: 200, height: 283, deviceScaleFactor: 1 });
    const thumbBuffer = await withTimeout(
      page.screenshot({ type: "png", fullPage: false }),
      5_000,
      "page.screenshot",
    );

    // Page count — Chromium does not expose this directly. The PDF buffer
    // contains "/Type /Page" once per page in the dictionary stream; counting
    // matches the standard pdf-lib approach without the dependency.
    const pageCount = countPages(pdfBuffer);

    renderCount += 1;
    return {
      pdfBase64: Buffer.from(pdfBuffer).toString("base64"),
      thumbnailBase64: Buffer.from(thumbBuffer as Buffer).toString("base64"),
      pageCount,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function countPages(pdfBuffer: Buffer | Uint8Array): number {
  const text = Buffer.from(pdfBuffer).toString("latin1");
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 1;
}

const KIND = z.enum(["brief", "invoice", "itinerary", "resume", "newsletter", "reference"]);

/**
 * Boop PDF MCP. Loaded on every execution agent spawn that has a
 * conversationId. Skills under .claude/skills/pdf-* call the single
 * `generate_pdf` tool; the tool renders, uploads, and returns success info.
 *
 * The agent's text response should NOT include the URL — the interaction
 * agent picks up the artifact from Convex and attaches it to the iMessage.
 */
export function createPdfMcp(conversationId: string, agentId?: string) {
  return createSdkMcpServer({
    name: "boop-pdf",
    version: "0.1.0",
    tools: [
      tool(
        "generate_pdf",
        `Render an HTML document to a PDF, store it, and return success info.

Input expectations:
- html: a complete HTML document with all CSS inlined in a <style> block. Do NOT reference external stylesheets, fonts, or images — Puppeteer renders offline. Use system fonts and inline SVGs.
- filename: the user-facing filename, e.g. "invoice-acme-2026-04-29.pdf".
- kind: one of brief | invoice | itinerary | resume | newsletter | reference.

The interaction agent will attach the resulting PDF to the user's iMessage automatically. Do NOT paste the URL in your response — just say what you produced ("Generated INV-2026-0042 — $4,200 to Acme.").`,
        {
          html: z.string(),
          filename: z.string(),
          kind: KIND,
        },
        async (args) => {
          try {
            const { pdfBase64, thumbnailBase64, pageCount } = await renderHtml(args.html);
            const result = await convex.action(api.pdfArtifacts.generate, {
              pdfBase64,
              thumbnailBase64,
              conversationId,
              kind: args.kind,
              filename: args.filename,
              pageCount,
              agentId,
            });
            const sizeKb = (result.fileSizeBytes / 1024).toFixed(1);
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `PDF generated.\n` +
                    `artifactId: ${result.artifactId}\n` +
                    `filename: ${args.filename}\n` +
                    `pages: ${pageCount}\n` +
                    `size: ${sizeKb} KB\n\n` +
                    `Reminder: do NOT paste the URL. The interaction agent attaches it.`,
                },
              ],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `PDF render failed: ${message}\n\nRetry once with a simpler layout. If it still fails, return one sentence telling the user what went wrong and offer a plain-text fallback.`,
                },
              ],
            };
          }
        },
      ),
    ],
  });
}
