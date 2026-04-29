# Boop PDF Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Boop the ability to design and generate beautifully-designed PDFs (six doc types) and deliver them as iMessage attachments, with `boop-design` as the universal design quality gate.

**Architecture:** Six specialized `pdf-*` skills under `.claude/skills/` each call a single `boop-pdf` MCP tool that renders HTML→PDF via headless Chromium (Puppeteer) and uploads to Convex file storage. The interaction agent picks up the artifact post-turn and attaches it to the outbound iMessage via Sendblue's `media_url`, falling back to a text+URL on rejection.

**Tech Stack:** Puppeteer (bundled Chromium), Convex (file storage + new `pdfArtifacts` table), Sendblue API (media URL), existing Claude Agent SDK MCP server pattern, existing Convex/React/Vite debug dashboard.

**Spec:** `docs/superpowers/specs/2026-04-29-boop-pdf-skills-design.md`

---

## File Structure

**New files:**
- `convex/pdfArtifacts.ts` — Convex action + queries + internal mutation for the new table
- `server/pdf-tools.ts` — Puppeteer-backed `boop-pdf` MCP server with `generate_pdf` tool
- `.claude/skills/pdf-brief/SKILL.md`
- `.claude/skills/pdf-invoice/SKILL.md`
- `.claude/skills/pdf-itinerary/SKILL.md`
- `.claude/skills/pdf-resume/SKILL.md`
- `.claude/skills/pdf-newsletter/SKILL.md`
- `.claude/skills/pdf-reference/SKILL.md`
- `scripts/pdf-smoke.mjs` — verification script (offline)
- `scripts/pdf-smoke-sendblue.mjs` — opt-in iMessage round-trip
- `debug/src/components/FilesPanel.tsx` — new dashboard tab
- `docs/superpowers/specs/pdf-skills-trigger-checklist.md`

**Moved files:**
- `skills/boop-design/SKILL.md` → `.claude/skills/boop-design/SKILL.md` (description sharpened)

**Deleted directories:**
- `skills/` (after move; only contained `boop-design`)

**Modified files:**
- `convex/schema.ts` — add `pdfArtifacts` table
- `server/execution-agent.ts` — register `boop-pdf` MCP, two system-prompt additions
- `server/interaction-agent.ts` — pickup latest artifact + pass to `sendImessage`
- `server/sendblue.ts` — accept optional `mediaUrl` + fallback path
- `package.json` — add `puppeteer` dep + two npm scripts
- `debug/src/App.tsx` — wire Files tab into navigation

---

## Verification Approach (no test framework introduced)

This project has no Vitest/Jest setup; the existing verification surface is `npm run typecheck` + the debug dashboard + manual texting. Each task ends with a concrete verification step (typecheck, smoke-script run, or dashboard/iMessage check). Tasks that touch Convex must also `npx convex dev` to confirm schema is accepted.

---

## Tasks

### Task 1: Move and sharpen the `boop-design` skill

The skill currently lives at `skills/boop-design/SKILL.md`, which the execution agent's `settingSources: ["project"]` does not load. Moving it to `.claude/skills/` makes it discoverable, and the sharpened description ensures the SDK auto-engages it for any visual artifact task.

**Files:**
- Move: `skills/boop-design/SKILL.md` → `.claude/skills/boop-design/SKILL.md`
- Modify: `.claude/skills/boop-design/SKILL.md` (frontmatter description)
- Delete: `skills/` (empty directory after move)

- [ ] **Step 1: Move the skill file**

The file `skills/boop-design/SKILL.md` may be untracked on this branch. Detect and handle:

```bash
mkdir -p .claude/skills/boop-design
if git ls-files --error-unmatch skills/boop-design/SKILL.md > /dev/null 2>&1; then
  git mv skills/boop-design/SKILL.md .claude/skills/boop-design/SKILL.md
else
  mv skills/boop-design/SKILL.md .claude/skills/boop-design/SKILL.md
  git add .claude/skills/boop-design/SKILL.md
fi
rmdir skills/boop-design
rmdir skills
```

Expected: `git status` shows either a rename (if previously tracked) or a new file at the destination, and the empty `skills/` directory removed.

- [ ] **Step 2: Sharpen the frontmatter description**

Open `.claude/skills/boop-design/SKILL.md` and replace the frontmatter block (top of file) with:

```yaml
---
name: boop-design
description: Boop's design law book. Use when generating any visual artifact (PDFs, HTML, slide layouts) to enforce typography, color (OKLCH), spacing, and motion rules. Required reading before producing visual output.
user-invocable: false
---
```

Leave the rest of the file unchanged.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: pass (no code touched, but confirm the move didn't break TS path resolution anywhere).

- [ ] **Step 4: Verify the SDK loads it**

Boot the dev server and watch the agent boot logs:

```bash
npm run dev
```

In the Chat tab of the dashboard (`http://localhost:5173`), text any design-adjacent prompt: "review the spacing on this card mockup". The agent should invoke `boop-design`. If it doesn't, the description still needs work — but for this step, confirming `npm run dev` boots clean is enough.

Stop the dev server with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/boop-design/SKILL.md
git add -u skills/  # picks up the deletes
git commit -m "feat(skills): move boop-design to .claude/skills/ and sharpen trigger description"
```

---

### Task 2: Add Puppeteer dependency

`puppeteer` (not `puppeteer-core`) bundles Chromium for zero-config installs. Adds ~200MB once; reused across all renders.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Puppeteer**

```bash
npm install puppeteer
```

Expected: dependency appears in `package.json` under `"dependencies"`. Chromium downloads to `~/.cache/puppeteer/chrome/...` (Mac) or equivalent on Linux/Windows. Output ends with "puppeteer install completed".

- [ ] **Step 2: Verify Chromium is reachable**

```bash
node -e "import('puppeteer').then(p => p.default.executablePath()).then(console.log)"
```

Expected: prints an absolute path to `chrome` or `chromium`. If it fails with "Could not find Chrome", run `npx puppeteer browsers install chrome` and retry.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(deps): add puppeteer for PDF rendering"
```

---

### Task 3: Add `pdfArtifacts` table to Convex schema

Strict `kind` union (six literals) doubles as documentation. `signedUrl` and `thumbnailUrl` are cached on the row so the dashboard list view doesn't re-query storage.

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the table definition**

Open `convex/schema.ts`. Inside the `defineSchema({...})` object, AFTER the `automationRuns` table definition (at the very end, before the closing `})`), add:

```ts
  pdfArtifacts: defineTable({
    artifactId: v.string(),
    conversationId: v.optional(v.string()),
    kind: v.union(
      v.literal("brief"),
      v.literal("invoice"),
      v.literal("itinerary"),
      v.literal("resume"),
      v.literal("newsletter"),
      v.literal("reference"),
    ),
    filename: v.string(),
    storageId: v.id("_storage"),
    thumbnailStorageId: v.optional(v.id("_storage")),
    fileSizeBytes: v.number(),
    pageCount: v.number(),
    signedUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    agentId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_artifact_id", ["artifactId"])
    .index("by_conversation_and_createdAt", ["conversationId", "createdAt"])
    .index("by_kind_and_createdAt", ["kind", "createdAt"]),
```

Index names follow the project convention from `convex/_generated/ai/guidelines.md`: include all index fields in the name with `_and_` separators.

- [ ] **Step 2: Push the schema to Convex**

```bash
npx convex dev --once
```

Expected: "Schema validated. ... Convex functions ready". If you see a validator error, re-read the table definition — usually a missing `v.string()` or trailing comma issue.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: pass. The `_generated/api.ts` and `_generated/dataModel.ts` were rebuilt by `convex dev --once`.

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(convex): add pdfArtifacts table"
```

(`convex/_generated/` is gitignored, so we don't commit those.)

---

### Task 4: Create `convex/pdfArtifacts.ts` module

Single `generate` action handles upload + thumbnail upload + URL retrieval + row insert in one round-trip from the MCP tool. Per `convex/_generated/ai/guidelines.md`: actions can call `ctx.storage.store` directly and `ctx.runMutation(internal.pdfArtifacts.createInternal, ...)` for the row insert.

**Files:**
- Create: `convex/pdfArtifacts.ts`

- [ ] **Step 1: Create the file**

Write `convex/pdfArtifacts.ts`:

```ts
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const kindV = v.union(
  v.literal("brief"),
  v.literal("invoice"),
  v.literal("itinerary"),
  v.literal("resume"),
  v.literal("newsletter"),
  v.literal("reference"),
);

function randomArtifactId(): string {
  return `pdf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Atomic upload + create. Called by the boop-pdf MCP server. Accepts both the
 * PDF and its thumbnail as base64 (MCP tool inputs serialize through JSON).
 * Stores both blobs, generates signed URLs, and writes the metadata row in
 * one action so the caller only does one round-trip.
 */
export const generate = action({
  args: {
    pdfBase64: v.string(),
    thumbnailBase64: v.string(),
    conversationId: v.optional(v.string()),
    kind: kindV,
    filename: v.string(),
    pageCount: v.number(),
    agentId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    artifactId: string;
    storageId: string;
    thumbnailStorageId: string;
    signedUrl: string;
    thumbnailUrl: string;
    fileSizeBytes: number;
  }> => {
    const pdfBuffer = Buffer.from(args.pdfBase64, "base64");
    const thumbBuffer = Buffer.from(args.thumbnailBase64, "base64");
    const pdfBlob = new Blob([pdfBuffer], { type: "application/pdf" });
    const thumbBlob = new Blob([thumbBuffer], { type: "image/png" });

    const storageId = await ctx.storage.store(pdfBlob);
    const thumbnailStorageId = await ctx.storage.store(thumbBlob);

    const signedUrl = (await ctx.storage.getUrl(storageId)) ?? "";
    const thumbnailUrl = (await ctx.storage.getUrl(thumbnailStorageId)) ?? "";

    const artifactId: string = await ctx.runMutation(
      internal.pdfArtifacts.createInternal,
      {
        artifactId: randomArtifactId(),
        conversationId: args.conversationId,
        kind: args.kind,
        filename: args.filename,
        storageId,
        thumbnailStorageId,
        fileSizeBytes: pdfBuffer.byteLength,
        pageCount: args.pageCount,
        signedUrl,
        thumbnailUrl,
        agentId: args.agentId,
      },
    );

    return {
      artifactId,
      storageId,
      thumbnailStorageId,
      signedUrl,
      thumbnailUrl,
      fileSizeBytes: pdfBuffer.byteLength,
    };
  },
});

/**
 * Internal because only the `generate` action should write to this table —
 * never expose row creation as a public mutation.
 */
export const createInternal = internalMutation({
  args: {
    artifactId: v.string(),
    conversationId: v.optional(v.string()),
    kind: kindV,
    filename: v.string(),
    storageId: v.id("_storage"),
    thumbnailStorageId: v.optional(v.id("_storage")),
    fileSizeBytes: v.number(),
    pageCount: v.number(),
    signedUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    agentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pdfArtifacts", {
      ...args,
      createdAt: Date.now(),
    });
    return args.artifactId;
  },
});

/**
 * Refresh helper — Convex storage URLs are stable for the file lifetime, but
 * exposing a refresh path keeps the dashboard simple if we ever rotate keys.
 */
export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId);
  },
});

/**
 * Used by the interaction agent post-turn to know whether a PDF was produced
 * during this turn. `since` is the turn-start timestamp.
 */
export const latestForConversation = query({
  args: { conversationId: v.string(), since: v.number() },
  handler: async (ctx, { conversationId, since }) => {
    const rows = await ctx.db
      .query("pdfArtifacts")
      .withIndex("by_conversation_and_createdAt", (q) =>
        q.eq("conversationId", conversationId).gte("createdAt", since),
      )
      .order("desc")
      .take(1);
    return rows[0] ?? null;
  },
});

/**
 * Powers the dashboard Files tab — list of artifacts for a thread.
 */
export const listForConversation = query({
  args: { conversationId: v.string() },
  handler: async (ctx, { conversationId }) => {
    return await ctx.db
      .query("pdfArtifacts")
      .withIndex("by_conversation_and_createdAt", (q) =>
        q.eq("conversationId", conversationId),
      )
      .order("desc")
      .take(50);
  },
});

/**
 * Powers the dashboard Files tab — unfiltered list view.
 */
export const listAll = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pdfArtifacts")
      .order("desc")
      .take(args.limit ?? 100);
  },
});
```

- [ ] **Step 2: Push and verify the module compiles**

```bash
npx convex dev --once
```

Expected: "Convex functions ready" with no validator errors. If you see "Cannot find name 'internal.pdfArtifacts.createInternal'", you forgot to save the file before running.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add convex/pdfArtifacts.ts
git commit -m "feat(convex): add pdfArtifacts module (generate action + queries)"
```

---

### Task 5: Build `server/pdf-tools.ts` with the `boop-pdf` MCP

Single Chromium instance reused across renders, with a 100-render restart for memory bounding. Per-render `page` lifecycle in `try/finally`. 30-second hard timeout via `Promise.race`.

**Files:**
- Create: `server/pdf-tools.ts`

- [ ] **Step 1: Write the file**

```ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import puppeteer, { type Browser } from "puppeteer";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";

let browserPromise: Promise<Browser> | null = null;
let renderCount = 0;
const RESTART_AFTER = 100;
const RENDER_TIMEOUT_MS = 30_000;

async function getBrowser(): Promise<Browser> {
  if (renderCount >= RESTART_AFTER && browserPromise) {
    const prev = await browserPromise;
    await prev.close().catch(() => {});
    browserPromise = null;
    renderCount = 0;
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
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: pass. If you see "Cannot find name 'Buffer'", verify `@types/node` is installed (it already is per `package.json`).

- [ ] **Step 3: Smoke-test the renderer in isolation**

Run this one-liner to confirm Puppeteer + the renderer module work without touching Convex:

```bash
node --experimental-vm-modules -e "
import('./server/pdf-tools.js').catch(async () => {
  // tsx-style direct execution
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent('<h1>Hello PDF</h1>', { waitUntil: 'networkidle0' });
  const buf = await page.pdf({ format: 'A4' });
  console.log('PDF generated, bytes:', buf.length);
  await browser.close();
});
"
```

Expected: prints "PDF generated, bytes: <some number 1500–4000>". This validates Chromium boots and renders before we wire anything else.

- [ ] **Step 4: Commit**

```bash
git add server/pdf-tools.ts
git commit -m "feat(server): add boop-pdf MCP with Puppeteer-backed generate_pdf tool"
```

---

### Task 6: Wire `boop-pdf` MCP into the execution agent

Add the new MCP server to `mcpServers` (alongside `boop-drafts`), and add two lines to the execution-agent system prompt covering PDF-attach discipline and render-failure recovery.

**Files:**
- Modify: `server/execution-agent.ts`

- [ ] **Step 1: Add the import**

Open `server/execution-agent.ts`. Near the existing imports at the top, ADD:

```ts
import { createPdfMcp } from "./pdf-tools.js";
```

Place it next to `import { createDraftStagingMcp } from "./draft-tools.js";`.

- [ ] **Step 2: Register the MCP server alongside `boop-drafts`**

Find the block (around line 122 today):

```ts
  const draftServer = opts.conversationId
    ? createDraftStagingMcp(opts.conversationId)
    : undefined;
  const mcpServers = {
    ...integrationServers,
    ...(draftServer ? { "boop-drafts": draftServer } : {}),
  };
```

REPLACE with:

```ts
  const draftServer = opts.conversationId
    ? createDraftStagingMcp(opts.conversationId)
    : undefined;
  const pdfServer = opts.conversationId
    ? createPdfMcp(opts.conversationId, agentId)
    : undefined;
  const mcpServers = {
    ...integrationServers,
    ...(draftServer ? { "boop-drafts": draftServer } : {}),
    ...(pdfServer ? { "boop-pdf": pdfServer } : {}),
  };
```

The existing `allowedTools` list already covers `mcp__boop-pdf__*` via the spread `Object.keys(mcpServers).flatMap((n) => [\`mcp__${n}__*\`])`. No change needed there.

- [ ] **Step 3: Update the system prompt with the two new bullets**

Find the `EXECUTION_SYSTEM` template literal (around line 45). Inside the `Style:` section, AFTER the bullet `- If you can't complete something, say why in one sentence.`, ADD:

```
- If you generated a PDF via the boop-pdf tool, do NOT paste the URL or filename path in your response. The interaction agent attaches the file automatically. Just say what you produced — e.g. "Generated INV-2026-0042 — $4,200 to Acme."
```

Inside the `Safety:` section, AFTER the existing two bullets, ADD:

```
- If a PDF render fails, retry once with a simpler layout. If the second attempt fails, return a single sentence telling the user what failed and offer a plain-text fallback. Never paste raw error text.
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Boot and verify the MCP loads**

```bash
npm run dev
```

Watch the server logs. There should be no error about `boop-pdf` registration. Stop the server with Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add server/execution-agent.ts
git commit -m "feat(server): register boop-pdf MCP and update execution agent system prompt"
```

---

### Task 7: Create `scripts/pdf-smoke.mjs` for offline verification

Renders six fixed-content sample PDFs (one per kind) through the full pipeline (Puppeteer → Convex action → row insert), then prints the signed URLs. No Sendblue, no skill, no agent — just the renderer + storage path.

**Files:**
- Create: `scripts/pdf-smoke.mjs`
- Modify: `package.json` (add `pdf:smoke` script)

- [ ] **Step 1: Write the script**

Write `scripts/pdf-smoke.mjs`:

```js
#!/usr/bin/env node
import "dotenv/config";
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
```

- [ ] **Step 2: Add the npm script**

Open `package.json`. In `"scripts"`, AFTER the existing `"sendblue:webhook"` line, ADD:

```json
    "pdf:smoke": "node scripts/pdf-smoke.mjs",
```

- [ ] **Step 3: Run it**

Make sure `npx convex dev` is running in another terminal first (so the action is deployed). Then:

```bash
npm run pdf:smoke
```

Expected output (one line per kind):
```
[smoke] launching Chromium...
[smoke] Chromium booted
[smoke] brief       ✓ 1840ms  6.2KB  https://...convex.cloud/api/storage/...
[smoke] invoice     ✓  920ms  6.1KB  https://...
... (4 more)
[smoke] done — 6/6 succeeded
```

Open one of the URLs in a browser to eyeball — should show a clean PDF with the OKLCH-colored "kind tag" rendering correctly.

- [ ] **Step 4: Verify rows in Convex dashboard**

Open the Convex dashboard for your deployment. Browse the `pdfArtifacts` table — should have 6 new rows (one per kind), each with a populated `signedUrl`, `thumbnailUrl`, `fileSizeBytes`, and `pageCount: 1`.

- [ ] **Step 5: Commit**

```bash
git add scripts/pdf-smoke.mjs package.json
git commit -m "feat(scripts): add pdf:smoke for offline render-and-upload verification"
```

---

### Task 8: Create the canonical `pdf-invoice` skill

This is the first specialized skill. Validates the full agent flow before we build the other five.

**Files:**
- Create: `.claude/skills/pdf-invoice/SKILL.md`

- [ ] **Step 1: Create the skill file**

```bash
mkdir -p .claude/skills/pdf-invoice
```

Write `.claude/skills/pdf-invoice/SKILL.md`:

````markdown
---
name: pdf-invoice
description: Generate a beautifully designed invoice, receipt, or expense report as a PDF. Use when the user asks for an invoice, a bill, a receipt, an expense report, or "send me a PDF for $X to <client>". Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-invoice

You produce a polished, business-ready invoice PDF.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.** Read it in full before writing any HTML. Its design laws (OKLCH only, semantic color names, ≥1.25-stop heading/body weight contrast, 65–75ch line length, the spacing scale, the absolute bans) are non-negotiable.
2. Extract the invoice data from the user's request. Required: payee, payer, line items, currency, total. Optional: due date, terms, notes, logo. If a required field is missing, return one sentence asking for it instead of guessing.
3. Apply the layout rules in §Layout below.
4. Generate semantic HTML using §Template. Inline ALL CSS in a single `<style>` block. Do NOT pull external assets — Puppeteer prints offline.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "invoice" }`. The interaction agent attaches the file automatically.
6. Return ONE short summary line. Example: "Generated INV-2026-0042 — $4,200 to Acme, due Apr 12." Do NOT paste the URL.

## Layout (invoice-specific, on top of boop-design)

- Single column, 32mm horizontal margins (override the 20mm default via inline CSS `@page { margin: 32mm; }`).
- A4 default; US Letter if currency is USD.
- Top band: payee identity (left) and metadata block (right — number, issue date, due date, total).
- Line-items table: 4 columns (description, qty, rate, total). Right-align numerics. `font-variant-numeric: tabular-nums`.
- Totals stack right-aligned below the table: subtotal, tax (if any), total. Total is the only emphasis — heavier weight, no color.
- One accent color max (the action-primary OKLCH from boop-design), used only on the total row's underline.

## Template (reference HTML)

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 32mm; size: A4; }
  :root {
    --color-fg: oklch(15% 0 0);
    --color-muted: oklch(50% 0 0);
    --color-line: oklch(88% 0 0);
    --color-action-primary: oklch(58% 0.18 250);
    --color-bg: oklch(99% 0 0);
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--color-fg); background: var(--color-bg); margin: 0; line-height: 1.55; font-size: 16px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .payee h1 { font-size: 28px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.02em; }
  .payee p { margin: 0; font-size: 14px; color: var(--color-muted); }
  .meta { text-align: right; }
  .meta .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); display: block; }
  .meta .value { font-size: 14px; margin-bottom: 8px; display: block; }
  .meta .total-headline { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .billto { display: flex; gap: 64px; margin: 24px 0; font-size: 14px; }
  .billto .col .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; font-variant-numeric: tabular-nums; }
  th, td { padding: 10px 0; text-align: left; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); border-bottom: 1px solid var(--color-fg); }
  td { border-bottom: 1px solid var(--color-line); }
  .num { text-align: right; }
  .totals { margin-top: 16px; margin-left: auto; width: 280px; font-size: 14px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; font-variant-numeric: tabular-nums; }
  .totals .total { border-bottom: 2px solid var(--color-action-primary); padding-bottom: 6px; margin-top: 6px; font-size: 18px; font-weight: 700; }
  .footer { margin-top: 48px; font-size: 12px; color: var(--color-muted); }
</style></head><body>
  <div class="header">
    <div class="payee">
      <h1>Studio Hera</h1>
      <p>14 Atlantic Way · hello@example.com</p>
    </div>
    <div class="meta">
      <span class="label">Invoice</span><span class="value">INV-2026-0042</span>
      <span class="label">Issued</span><span class="value">29 Apr 2026</span>
      <span class="label">Due</span><span class="value">12 May 2026</span>
      <span class="total-headline">$4,200.00</span>
    </div>
  </div>
  <div class="billto">
    <div class="col"><div class="label">Billed to</div><div>Acme Corp<br/>Billing Dept</div></div>
    <div class="col"><div class="label">Project</div><div>Design system v2</div></div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <tr><td>Design system v2 — components, tokens, docs</td><td class="num">40</td><td class="num">$85.00</td><td class="num">$3,400.00</td></tr>
      <tr><td>Component refactor</td><td class="num">10</td><td class="num">$80.00</td><td class="num">$800.00</td></tr>
    </tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>$4,200.00</span></div>
    <div class="row total"><span>Total due</span><span>$4,200.00</span></div>
  </div>
  <p class="footer">Net 14. ACH preferred. Thank you.</p>
</body></html>
```

Adapt the values to the user's actual data. Keep the structure and the OKLCH variables.

## Examples

**Input:** "Invoice $4200 to Acme for design system v2 (40h @ $85) and component refactor (10h @ $80)."
**Filename:** `invoice-acme-2026-04-29.pdf`
**Returns:** "Generated INV-2026-0042 — $4,200 to Acme."

**Input:** "Receipt for the $42 Sushi Saito lunch yesterday, paid card."
**Filename:** `receipt-sushi-saito-2026-04-28.pdf`
**Returns:** "Generated receipt — $42 to Sushi Saito (28 Apr)."
````

- [ ] **Step 2: Verify the file is loaded by the SDK**

Boot the dev server: `npm run dev`. In the dashboard's Chat tab, text:

```
make me an invoice for $4,200 to Acme for the design system v2 (40 hours @ $85) plus a component refactor (10 hours @ $80)
```

Watch the server logs for:
```
[agent xxx] tool: Skill (boop-design)
[agent xxx] tool: generate_pdf
[agent xxx] done (completed, ...)
```

- [ ] **Step 3: Confirm the artifact in Convex**

Open the Convex dashboard → `pdfArtifacts` table. Newest row should be `kind: "invoice"`. Open the `signedUrl` — should be a real-looking invoice with OKLCH-rendered totals underline.

If the PDF looks generic or off-spec (Inter font, hex colors, gradient text), revisit `.claude/skills/boop-design/SKILL.md` to verify it loaded — text "review my design system" to confirm it engages.

- [ ] **Step 4: Stop the dev server and commit**

```bash
git add .claude/skills/pdf-invoice/
git commit -m "feat(skills): add pdf-invoice for invoice / receipt / expense PDFs"
```

---

### Task 9: Extend `sendImessage` with `mediaUrl` support

`sendImessage(toNumber, text, { mediaUrl })`. Sends `media_url` on the first chunk only; falls back to text + URL on Sendblue rejection.

**Files:**
- Modify: `server/sendblue.ts`

- [ ] **Step 1: Update the function signature and body**

Open `server/sendblue.ts`. Replace the current `sendImessage` function (lines ~59–99) with:

```ts
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
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: pass. Existing call sites continue to work because `opts` defaults to `{}`.

- [ ] **Step 3: Commit**

```bash
git add server/sendblue.ts
git commit -m "feat(sendblue): accept optional mediaUrl with text-URL fallback"
```

---

### Task 10: Add interaction-agent artifact pickup

After the dispatcher resolves a turn, query for any PDF artifact created during this turn and pass its `signedUrl` to `sendImessage`.

**Files:**
- Modify: `server/interaction-agent.ts`

- [ ] **Step 1: Read the current shape of `handleUserMessage`**

```bash
grep -n "handleUserMessage\|sendImessage\|turnStart" server/interaction-agent.ts | head -20
```

This shows where to insert the pickup logic. The function should already capture a turn start timestamp (or you'll add one).

- [ ] **Step 2: Add the artifact pickup**

Open `server/interaction-agent.ts`. Find `handleUserMessage` and locate the spot just before the call to `sendImessage(fromNumber, reply)` (or wherever the dispatcher's final reply is returned to `sendblue.ts`).

Note: `sendblue.ts` is what calls `handleUserMessage` and then calls `sendImessage` itself today — so the pickup may belong in `sendblue.ts`'s router rather than `interaction-agent.ts`. Check the call graph:

```bash
grep -n "handleUserMessage" server/sendblue.ts
```

If `sendblue.ts:152` calls `handleUserMessage` and then `sendImessage`, the pickup goes in `sendblue.ts`. If `interaction-agent.ts` calls `sendImessage` directly, it goes there.

**For the case in `sendblue.ts` (likely):** Open `server/sendblue.ts`. Find the `router.post("/webhook", ...)` handler. The existing code already captures `const start = Date.now();` at the top of the handler — we'll reuse that as our turn-start filter. Modify the section that currently does:

```ts
    const stopTyping = startTypingLoop(from_number);
    try {
      const reply = await handleUserMessage({ ... });
      if (reply) {
        ...
        await sendImessage(from_number, reply);
        ...
      }
```

REPLACE with:

```ts
    const stopTyping = startTypingLoop(from_number);
    try {
      const reply = await handleUserMessage({ ... });
      if (reply) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const replyPreview = reply.length > 100 ? reply.slice(0, 100) + "…" : reply;
        console.log(
          `[turn ${turnTag}] → reply (${elapsed}s, ${reply.length} chars): ${JSON.stringify(replyPreview)}`,
        );
        // Pick up any PDF the agent generated during this turn so we can
        // attach it to the iMessage. `since: start` ensures only PDFs
        // produced this turn attach (a follow-up "thanks!" wouldn't re-send
        // last hour's invoice).
        const artifact = await convex.query(api.pdfArtifacts.latestForConversation, {
          conversationId,
          since: start,
        });
        await sendImessage(from_number, reply, artifact ? { mediaUrl: artifact.signedUrl } : {});
        await convex.mutation(api.messages.send, {
          conversationId,
          role: "assistant",
          content: reply,
        });
      } else {
        console.log(`[turn ${turnTag}] → (no reply)`);
      }
    } catch (err) {
      console.error(`[turn ${turnTag}] handler error`, err);
    } finally {
      stopTyping();
    }
```

The two existing imports at the top of `sendblue.ts` already provide `convex` and `api` — no import additions needed.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: pass. If you see "Property 'pdfArtifacts' does not exist on type", run `npx convex dev --once` to regenerate `_generated/api.ts`.

- [ ] **Step 4: End-to-end test from the dashboard**

Boot dev server: `npm run dev`. Text from the dashboard Chat tab (which goes through the same path):

```
make me an invoice for $1,000 to Test Co for consulting (10h @ $100)
```

Watch logs:
```
[turn xxx] → reply (4.5s, 65 chars): "Generated invoice ..."
[sendblue] → sent ... + 1 attachment to ...
```

(In the dashboard chat there's no Sendblue call — but the artifact pickup runs and the `+ 1 attachment` line proves the logic is wired. If using a real Sendblue-routed iMessage, check your phone for the actual attachment.)

- [ ] **Step 5: Commit**

```bash
git add server/sendblue.ts
git commit -m "feat(sendblue): pick up latest pdfArtifact post-turn and attach via media_url"
```

---

### Task 11: Create `scripts/pdf-smoke-sendblue.mjs`

Opt-in iMessage round-trip — generates one sample invoice and calls `sendImessage` with `media_url` to confirm Sendblue accepts it on your plan + carrier.

**Files:**
- Create: `scripts/pdf-smoke-sendblue.mjs`
- Modify: `package.json` (add `pdf:smoke:sendblue` script)

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
import "dotenv/config";
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
```

- [ ] **Step 2: Add the npm script**

In `package.json`, AFTER the `"pdf:smoke"` line, ADD:

```json
    "pdf:smoke:sendblue": "node scripts/pdf-smoke-sendblue.mjs",
```

- [ ] **Step 3: Run it (opt-in)**

Replace `+1...` with your actual mobile number (must be a different phone than your Sendblue-provisioned number):

```bash
npm run pdf:smoke:sendblue -- --to +14155551234
```

Expected: a PDF attachment lands in iMessage on the target number within ~15 seconds. If Sendblue rejects (e.g., "media too large" or carrier issue), the script logs the rejection — that proves the fallback path is what users will hit on the production flow.

- [ ] **Step 4: Commit**

```bash
git add scripts/pdf-smoke-sendblue.mjs package.json
git commit -m "feat(scripts): add pdf:smoke:sendblue for end-to-end iMessage verification"
```

---

### Task 12: Create `pdf-brief` skill

Briefing doc — daily/weekly recap, meeting prep, research summary. Hierarchical headings, prose blocks. The most general of the six.

**Files:**
- Create: `.claude/skills/pdf-brief/SKILL.md`

- [ ] **Step 1: Create the skill file**

```bash
mkdir -p .claude/skills/pdf-brief
```

Write `.claude/skills/pdf-brief/SKILL.md`:

````markdown
---
name: pdf-brief
description: Generate a beautifully designed brief, recap, or summary as a PDF. Use when the user asks for a daily brief, morning brief, weekly summary, meeting prep, research summary, or "make me a brief on X". Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-brief

You produce a tight, scannable briefing PDF — calendar + tasks + key signals for the day, prep notes for a meeting, or a focused research summary.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.** Read it in full before any HTML.
2. Gather the source material. For a daily brief: pull recent calendar, inbox priorities, and active project context (call other tools or skills as needed). For a meeting brief: history with the attendee(s), recent threads, open items. For a research brief: synthesize from your tools (WebSearch, WebFetch).
3. Apply the layout in §Layout. Brief should be 1–3 pages MAX.
4. Generate semantic HTML using §Template. Inline ALL CSS in a single `<style>` block.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "brief" }`.
6. Return ONE short summary line. Example: "Brief for 29 Apr — 3 meetings, 5 inbox priorities, 2 deadlines."

## Layout (brief-specific)

- Single column, body width 65–75ch (apply via `max-width` on the main).
- Top: date + brief title + 1-line tldr.
- Section headings: H2, uppercase, 11px, letter-spacing 0.08em, muted color.
- Body: 16px, line-height 1.55, prose-friendly.
- Lists: bulleted (•) or numbered, never "card grids".
- One accent color for the tldr underline only — no other color emphasis.

## Template (reference HTML)

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 24mm; size: A4; }
  :root { --fg: oklch(15% 0 0); --muted: oklch(50% 0 0); --line: oklch(88% 0 0); --accent: oklch(58% 0.18 250); --bg: oklch(99% 0 0); }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; line-height: 1.55; font-size: 16px; max-width: 70ch; }
  .meta { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 12px; }
  .tldr { font-size: 18px; line-height: 1.4; padding-bottom: 16px; border-bottom: 2px solid var(--accent); margin-bottom: 24px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 24px 0 8px; font-weight: 600; }
  ul { margin: 0; padding-left: 20px; }
  li { margin: 6px 0; }
  p { margin: 0 0 12px; }
  .when { color: var(--muted); font-variant-numeric: tabular-nums; }
</style></head><body>
  <div class="meta">Daily brief · Mon 29 Apr 2026</div>
  <h1>Today at a glance</h1>
  <p class="tldr">3 meetings, 5 inbox priorities, 2 deadlines. Mid-afternoon is your only deep-work window.</p>
  <h2>Schedule</h2>
  <ul>
    <li><span class="when">09:00</span> · 1:1 with Sarah — ship-readiness review</li>
    <li><span class="when">11:30</span> · Acme demo — design system v2 walkthrough</li>
    <li><span class="when">16:00</span> · Q2 retro</li>
  </ul>
  <h2>Inbox priorities</h2>
  <ul>
    <li>Acme — invoice 0042 needs sign-off before noon</li>
    <li>Sarah — feedback on the spec, due EOD</li>
    <li>Granola — recording quota renewal, optional</li>
  </ul>
  <h2>Deadlines</h2>
  <ul>
    <li>Tax filing reminder — Friday 3 May</li>
    <li>Conference talk submission — Friday 3 May</li>
  </ul>
</body></html>
```

## Examples

**Input:** "Summarize today as a brief PDF"
**Filename:** `brief-2026-04-29.pdf`
**Returns:** "Brief for 29 Apr — 3 meetings, 5 inbox priorities, 2 deadlines."

**Input:** "Meeting prep for the 11:30 with Acme"
**Filename:** `meeting-prep-acme-2026-04-29.pdf`
**Returns:** "Prep brief for Acme demo — design system v2 walkthrough."
````

- [ ] **Step 2: Manual verify via dashboard chat**

Boot `npm run dev`. Text: `summarize today as a PDF brief`. Confirm `kind: "brief"` row appears in `pdfArtifacts`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pdf-brief/
git commit -m "feat(skills): add pdf-brief for daily/meeting/research summaries"
```

---

### Task 13: Create `pdf-itinerary` skill

Trip plan, agenda, schedule. Timeline-based with day separators.

**Files:**
- Create: `.claude/skills/pdf-itinerary/SKILL.md`

- [ ] **Step 1: Create the skill file**

```bash
mkdir -p .claude/skills/pdf-itinerary
```

Write `.claude/skills/pdf-itinerary/SKILL.md`:

````markdown
---
name: pdf-itinerary
description: Generate a beautifully designed travel itinerary, event agenda, or timed schedule as a PDF. Use when the user asks for a trip plan, itinerary, travel agenda, event schedule, conference agenda, or "plan my X trip". Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-itinerary

You produce a clean, day-by-day, time-anchored itinerary or agenda PDF.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.**
2. Extract trip/agenda data. Required: title, date range, day-by-day entries (time + activity). Optional: confirmation numbers, addresses, weather, travel-time hints. Pull from calendar/email/etc. as needed.
3. Apply the layout in §Layout.
4. Generate HTML using §Template. Inline all CSS.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "itinerary" }`.
6. Return ONE short summary line. Example: "Itinerary — Tokyo May 4–11, 23 entries across 7 days."

## Layout (itinerary-specific)

- Single column, body 70ch.
- Cover band: trip title + date range + 1-line summary.
- Each day: H2 heading "Day N — Day-of-week Date".
- Within a day: time-anchored rows. Two-column grid: time (tabular-nums, accent color) on the left, content on the right.
- No card grids. No "tips" sidebars. Itineraries are timelines.

## Template (reference HTML)

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 24mm; size: A4; }
  :root { --fg: oklch(15% 0 0); --muted: oklch(50% 0 0); --line: oklch(88% 0 0); --accent: oklch(58% 0.18 250); --bg: oklch(99% 0 0); }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; line-height: 1.55; font-size: 16px; max-width: 70ch; }
  .meta { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 8px; }
  .summary { font-size: 16px; color: var(--muted); margin: 0 0 24px; padding-bottom: 16px; border-bottom: 2px solid var(--accent); }
  h2 { font-size: 18px; font-weight: 600; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  .row { display: grid; grid-template-columns: 64px 1fr; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .time { color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; font-size: 14px; }
  .what { font-size: 14px; }
  .what .note { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
</style></head><body>
  <div class="meta">Trip · Tokyo · 4–11 May 2026</div>
  <h1>Tokyo — 7 days</h1>
  <p class="summary">Solo trip. JL061 from JFK. Park Hyatt 4–8, Aman 8–11. Yuki dinner Day 1.</p>

  <h2>Day 1 — Mon 4 May</h2>
  <div class="row"><div class="time">06:30</div><div class="what">NRT arrival, Terminal 1<br/><span class="note">Flight JL061 from JFK · Passport: ready</span></div></div>
  <div class="row"><div class="time">09:00</div><div class="what">Park Hyatt check-in<br/><span class="note">Confirmation #PHT-44291 · Suite 5102</span></div></div>
  <div class="row"><div class="time">13:00</div><div class="what">Sushi Saito lunch<br/><span class="note">For 2 · 90 min · 6F Hibiya</span></div></div>
  <div class="row"><div class="time">19:00</div><div class="what">Dinner with Yuki — Den<br/><span class="note">2-1-3 Jingumae · 30-min walk from hotel</span></div></div>

  <h2>Day 2 — Tue 5 May</h2>
  <div class="row"><div class="time">07:00</div><div class="what">Tsukiji breakfast walk</div></div>
  <div class="row"><div class="time">10:00</div><div class="what">teamLab Borderless<br/><span class="note">Tickets: emailed · ~2.5 hr</span></div></div>
  <div class="row"><div class="time">15:00</div><div class="what">Aoyama design district stroll</div></div>
</body></html>
```

## Examples

**Input:** "Plan my Tokyo trip May 4–11" (with calendar context)
**Filename:** `itinerary-tokyo-2026-05-04.pdf`
**Returns:** "Itinerary — Tokyo May 4–11, ~22 entries across 7 days."

**Input:** "Make me an agenda for the team offsite next week"
**Filename:** `agenda-team-offsite-2026-05-06.pdf`
**Returns:** "Offsite agenda — 2 days, 14 sessions."
````

- [ ] **Step 2: Manual verify**

`npm run dev` → text: `plan a 3-day NYC trip starting Friday`. Confirm `kind: "itinerary"` row in `pdfArtifacts`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pdf-itinerary/
git commit -m "feat(skills): add pdf-itinerary for trip plans, agendas, schedules"
```

---

### Task 14: Create `pdf-resume` skill

One-page max. Sidebar + main column layout. Dense, highly designed.

**Files:**
- Create: `.claude/skills/pdf-resume/SKILL.md`

- [ ] **Step 1: Create the skill file**

```bash
mkdir -p .claude/skills/pdf-resume
```

Write `.claude/skills/pdf-resume/SKILL.md`:

````markdown
---
name: pdf-resume
description: Generate a beautifully designed resume, CV, or one-page profile as a PDF. Use when the user asks for a resume, CV, one-pager, profile sheet, or "build me a resume from <data source>". Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-resume

You produce a single-page (strict — no overflow) resume or one-page profile.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.**
2. Gather data. Required: name, role/title, contact, experience (3–5 entries with dates), skills. Optional: education, projects, links. Pull from memory or ask if missing.
3. Apply the strict layout in §Layout. ONE PAGE. If content overflows, the agent must trim — it's not a brochure.
4. Generate HTML using §Template.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "resume" }`.
6. Return ONE short summary line. Example: "Resume — 4 roles, 8 skills, single page."

## Layout (resume-specific)

- Two-column: dark sidebar on left (32% width), main on right (68%). Use a flex/grid layout that's tested at A4.
- Sidebar: name (white, large), title, contact, skills.
- Main: experience (most weight), education, optional projects.
- ONE accent color, used only on a thin underline below the name.
- Strict 1-page constraint: agent must trim content to fit.

## Template (reference HTML)

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 0; size: A4; }
  :root { --fg: oklch(15% 0 0); --muted: oklch(50% 0 0); --line: oklch(88% 0 0); --accent: oklch(58% 0.18 250); --bg: oklch(99% 0 0); --dark: oklch(20% 0 0); --dark-fg: oklch(95% 0 0); }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; line-height: 1.5; font-size: 11px; }
  .page { display: grid; grid-template-columns: 32% 1fr; min-height: 297mm; }
  .sidebar { background: var(--dark); color: var(--dark-fg); padding: 28px 22px; }
  .sidebar .name { font-size: 22px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em; padding-bottom: 6px; border-bottom: 2px solid var(--accent); margin-bottom: 4px; }
  .sidebar .title { font-size: 11px; opacity: 0.7; margin-bottom: 24px; }
  .sidebar h3 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; opacity: 0.5; margin: 18px 0 6px; font-weight: 600; }
  .sidebar p { margin: 0 0 4px; font-size: 11px; }
  .sidebar ul { margin: 0; padding: 0; list-style: none; font-size: 11px; line-height: 1.7; }
  .main { padding: 28px 28px; }
  .main h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin: 0 0 8px; font-weight: 600; }
  .main h2:not(:first-child) { margin-top: 18px; }
  .role { margin-bottom: 12px; }
  .role .head { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; }
  .role .when { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .role .where { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
  .role ul { margin: 0; padding-left: 16px; font-size: 11px; line-height: 1.5; }
  .role li { margin: 2px 0; }
</style></head><body>
  <div class="page">
    <div class="sidebar">
      <div class="name">Lakunle<br/>Akinde</div>
      <div class="title">Designer · Engineer</div>
      <h3>Contact</h3>
      <p>hello@example.com</p>
      <p>Lagos, Nigeria</p>
      <h3>Skills</h3>
      <ul>
        <li>TypeScript / React</li>
        <li>Design Systems</li>
        <li>Convex / Postgres</li>
        <li>Product Strategy</li>
      </ul>
      <h3>Tools</h3>
      <ul><li>Figma</li><li>Linear</li><li>Notion</li></ul>
    </div>
    <div class="main">
      <h2>Experience</h2>
      <div class="role">
        <div class="head"><span>Hera Studio</span><span class="when">2023 – present</span></div>
        <div class="where">Founder · Remote</div>
        <ul>
          <li>Build personal-agent infrastructure on top of Claude Agent SDK and Convex.</li>
          <li>Lead 4-person team across design, product, and engineering.</li>
        </ul>
      </div>
      <div class="role">
        <div class="head"><span>Acme Inc.</span><span class="when">2020 – 2023</span></div>
        <div class="where">Staff Engineer · NYC</div>
        <ul>
          <li>Architected the design-system shared infra used by 60+ engineers across 14 teams.</li>
          <li>Migrated 1.2M LOC from Webpack to Vite over two quarters.</li>
        </ul>
      </div>
      <h2>Education</h2>
      <div class="role">
        <div class="head"><span>BSc Computer Science</span><span class="when">2018</span></div>
        <div class="where">University of Lagos</div>
      </div>
    </div>
  </div>
</body></html>
```

## Examples

**Input:** "Build me a resume from my LinkedIn data" (with the data passed in)
**Filename:** `resume-lakunle-akinde-2026-04-29.pdf`
**Returns:** "Resume — 4 roles, 8 skills, single page."

**Input:** "Make a one-pager about me for the conference badge"
**Filename:** `one-pager-2026-04-29.pdf`
**Returns:** "One-pager — single page, 6 sections."
````

- [ ] **Step 2: Manual verify**

`npm run dev` → text: `make me a quick resume one-pager`. Confirm `kind: "resume"` row.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pdf-resume/
git commit -m "feat(skills): add pdf-resume for resumes, CVs, one-pagers"
```

---

### Task 15: Create `pdf-newsletter` skill

Multi-column digest. Masthead. Scannable.

**Files:**
- Create: `.claude/skills/pdf-newsletter/SKILL.md`

- [ ] **Step 1: Create the skill file**

```bash
mkdir -p .claude/skills/pdf-newsletter
```

Write `.claude/skills/pdf-newsletter/SKILL.md`:

````markdown
---
name: pdf-newsletter
description: Generate a beautifully designed newsletter, digest, or weekly roundup as a PDF. Use when the user asks for a newsletter, digest, link roundup, weekly recap, "best of the week", or "issue N of my newsletter". Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-newsletter

You produce a multi-section, multi-column digest PDF — issue-style, scannable, dense without feeling cramped.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.**
2. Gather content. Required: title, issue number, date, sections (each with 2–5 items). Optional: cover quote, masthead tagline. Pull from inbox / RSS / WebSearch as needed.
3. Apply the layout in §Layout.
4. Generate HTML using §Template.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "newsletter" }`.
6. Return ONE short summary line. Example: "Issue 042 — 4 sections, 12 items."

## Layout (newsletter-specific)

- Masthead: large title (italic serif welcome — but only via system fonts like Georgia or system-ui-serif), issue number + date below, full-width rule.
- Body: 2 columns, balanced. Use CSS `column-count: 2; column-gap: 24px; column-rule: 1px solid var(--line);`
- Section headings: H3 with subtle italic.
- Items: short paragraph + optional inline link (rendered as `[text]` since URLs are clickable in iMessage anyway).
- One accent color on the masthead rule only.

## Template (reference HTML)

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 22mm; size: A4; }
  :root { --fg: oklch(15% 0 0); --muted: oklch(50% 0 0); --line: oklch(85% 0 0); --accent: oklch(58% 0.18 250); --bg: oklch(99% 0 0); }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; line-height: 1.55; font-size: 14px; }
  .masthead { text-align: center; padding-bottom: 12px; border-bottom: 3px solid var(--accent); margin-bottom: 24px; }
  .masthead .meta { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
  .masthead h1 { font-family: Georgia, "Times New Roman", serif; font-style: italic; font-size: 36px; font-weight: 600; margin: 4px 0 0; letter-spacing: -0.02em; }
  .masthead .tagline { font-size: 13px; color: var(--muted); margin-top: 2px; }
  .columns { column-count: 2; column-gap: 24px; column-rule: 1px solid var(--line); }
  h3 { font-family: Georgia, serif; font-style: italic; font-size: 18px; font-weight: 600; margin: 0 0 6px; break-after: avoid; }
  h3:not(:first-child) { margin-top: 18px; }
  p { margin: 0 0 10px; font-size: 13px; line-height: 1.55; orphans: 3; widows: 3; }
  .ref { color: var(--muted); font-size: 11px; }
</style></head><body>
  <div class="masthead">
    <div class="meta">Issue 042 · Week of 27 Apr 2026</div>
    <h1>The Roundup</h1>
    <div class="tagline">A weekly digest of design, AI, and the in-between.</div>
  </div>
  <div class="columns">
    <h3>In tech</h3>
    <p>Anthropic shipped Claude Agent SDK 1.0 — the prebuilt loops for tool-use orchestration land in the same week as the Convex 1.18 schema-evolution rewrite. <span class="ref">[Anthropic blog]</span></p>
    <p>OKLCH crossed 90% browser support after Safari 18 — meaning the workaround period is officially over.</p>
    <h3>Reading list</h3>
    <p>"Patterns of Distributed Systems" — Unmesh Joshi. Long but the chapter on consensus alone is worth the read.</p>
    <p>"The visual display of quantitative information" — Tufte, second edition. Re-read; the section on data-ink ratio still scorches.</p>
    <h3>From the inbox</h3>
    <p>Acme is shipping their new design system on May 12. Demo invite landed Tuesday — sneak peek looks deeply impressive.</p>
    <h3>Coming up</h3>
    <p>Tokyo trip 4–11 May. Dispatches likely.</p>
  </div>
</body></html>
```

## Examples

**Input:** "Compile this week's reading list as a newsletter"
**Filename:** `roundup-issue-042-2026-04-29.pdf`
**Returns:** "Issue 042 — 4 sections, 9 items."

**Input:** "Make a digest of my saved-for-later articles from last month"
**Filename:** `digest-2026-04-29.pdf`
**Returns:** "Digest — 5 sections, 14 items."
````

- [ ] **Step 2: Manual verify**

`npm run dev` → text: `make a newsletter digest of this week`. Confirm `kind: "newsletter"` row.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pdf-newsletter/
git commit -m "feat(skills): add pdf-newsletter for digests, roundups, weekly recaps"
```

---

### Task 16: Create `pdf-reference` skill

Cheat sheet, glossary, quick reference. Tables, monospace-friendly, dense.

**Files:**
- Create: `.claude/skills/pdf-reference/SKILL.md`

- [ ] **Step 1: Create the skill file**

```bash
mkdir -p .claude/skills/pdf-reference
```

Write `.claude/skills/pdf-reference/SKILL.md`:

````markdown
---
name: pdf-reference
description: Generate a beautifully designed cheat sheet, quick reference, or glossary as a PDF. Use when the user asks for a cheatsheet, quick reference, packing list, glossary, API reference, command reference, or "make me a one-page cheat sheet for X". Always renders through boop-design for typography, color, and layout discipline.
---

# pdf-reference

You produce a dense, scannable, look-it-up-fast reference document.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.**
2. Gather the reference content. Required: title, sections, key/value pairs (or term/definition pairs). Pull from docs / WebSearch / memory as needed.
3. Apply the layout in §Layout.
4. Generate HTML using §Template.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "reference" }`.
6. Return ONE short summary line. Example: "Convex cheat sheet — 18 entries across 4 sections."

## Layout (reference-specific)

- Single column, 70ch.
- Section headings: H2.
- Body: a 2-column inner grid for term/definition. Term in monospace + accent color. Definition in body type.
- ONE accent color on the term column.
- No prose blocks. Lists, definitions, or rows only.

## Template (reference HTML)

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 22mm; size: A4; }
  :root { --fg: oklch(15% 0 0); --muted: oklch(50% 0 0); --line: oklch(88% 0 0); --accent: oklch(58% 0.18 250); --bg: oklch(99% 0 0); }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; line-height: 1.5; font-size: 13px; max-width: 75ch; }
  .meta { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
  h1 { font-size: 28px; font-weight: 700; margin: 4px 0 4px; letter-spacing: -0.02em; }
  .summary { color: var(--muted); margin: 0 0 18px; padding-bottom: 12px; border-bottom: 1px solid var(--line); font-size: 13px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin: 18px 0 8px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: 220px 1fr; gap: 4px 16px; }
  .grid .term { font-family: ui-monospace, SF Mono, Menlo, monospace; color: var(--accent); font-size: 12px; padding: 4px 0; border-bottom: 1px solid var(--line); }
  .grid .def { padding: 4px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
</style></head><body>
  <div class="meta">Cheat sheet · Convex</div>
  <h1>Convex quick reference</h1>
  <p class="summary">Most-used functions and patterns. Index names follow the by_field1_and_field2 convention.</p>

  <h2>Function definitions</h2>
  <div class="grid">
    <div class="term">query()</div><div class="def">Define a read function. Read-only access to the DB; transactional.</div>
    <div class="term">mutation()</div><div class="def">Define a write function. Read + write; transactional.</div>
    <div class="term">action()</div><div class="def">HTTP-callable function with side effects. Can call ctx.runQuery / ctx.runMutation.</div>
    <div class="term">internalQuery / internalMutation</div><div class="def">Like query / mutation but private — only callable from other Convex code.</div>
  </div>

  <h2>Schema and validators</h2>
  <div class="grid">
    <div class="term">defineSchema</div><div class="def">Top-level schema declaration in convex/schema.ts.</div>
    <div class="term">defineTable({...})</div><div class="def">Table definition with field validators.</div>
    <div class="term">v.id("table")</div><div class="def">Reference to a row in another table.</div>
    <div class="term">v.union(...)</div><div class="def">Discriminated union via v.literal(...) members.</div>
    <div class="term">.index("by_x_and_y", ["x", "y"])</div><div class="def">Index on multiple fields. Order matters.</div>
  </div>

  <h2>Storage</h2>
  <div class="grid">
    <div class="term">ctx.storage.store(blob)</div><div class="def">Upload a blob. Returns Id&lt;"_storage"&gt;.</div>
    <div class="term">ctx.storage.getUrl(id)</div><div class="def">Long-lived signed URL for a stored file.</div>
  </div>

  <h2>Calling between functions</h2>
  <div class="grid">
    <div class="term">ctx.runQuery(api.x.f, args)</div><div class="def">Call a query from a mutation or action.</div>
    <div class="term">ctx.runMutation(internal.x.g, args)</div><div class="def">Call an internal mutation from an action.</div>
  </div>
</body></html>
```

## Examples

**Input:** "Make me a one-page cheat sheet for git rebase"
**Filename:** `cheatsheet-git-rebase-2026-04-29.pdf`
**Returns:** "Git rebase cheat sheet — 12 entries across 3 sections."

**Input:** "Pack list for Tokyo, weather will be 18–22°C"
**Filename:** `packlist-tokyo-2026-05-04.pdf`
**Returns:** "Pack list — 26 items across 5 sections."
````

- [ ] **Step 2: Manual verify**

`npm run dev` → text: `make me a quick cheat sheet for the convex API`. Confirm `kind: "reference"` row.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pdf-reference/
git commit -m "feat(skills): add pdf-reference for cheatsheets, glossaries, quick references"
```

---

### Task 17: Add Convex queries already in pdfArtifacts.ts (verify) and wire Files tab — Phase 1: Backend hookup

The `listAll` and `listForConversation` queries were added in Task 4. Confirm they're still there and add a small lookup helper for the Files panel.

**Files:**
- Verify: `convex/pdfArtifacts.ts` (already has `listAll`, `listForConversation`, `getUrl`)

- [ ] **Step 1: Quick sanity check on the queries**

```bash
grep -n "listAll\|listForConversation" convex/pdfArtifacts.ts
```

Expected: both functions present (added in Task 4). If missing, return to Task 4 — they were part of that task's file.

- [ ] **Step 2: Test the queries from the Convex dashboard**

In the Convex dashboard's Function Runner, invoke `pdfArtifacts:listAll` with `{ "limit": 10 }`. Should return all rows created so far (smoke + your manual test runs from Tasks 7–16).

- [ ] **Step 3: No commit needed — this task is a verification step.**

---

### Task 18: Build the Files panel component for the debug dashboard

New panel listing PDF artifacts with thumbnail, filename, kind, page count, size, created-at, and a click-to-open inline preview.

**Files:**
- Create: `debug/src/components/FilesPanel.tsx`

- [ ] **Step 1: Write the panel**

Write `debug/src/components/FilesPanel.tsx`:

```tsx
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api.js";

interface PdfArtifactRow {
  _id: string;
  artifactId: string;
  conversationId?: string;
  kind: string;
  filename: string;
  signedUrl?: string;
  thumbnailUrl?: string;
  fileSizeBytes: number;
  pageCount: number;
  createdAt: number;
}

const KIND_LABEL: Record<string, string> = {
  brief: "Brief",
  invoice: "Invoice",
  itinerary: "Itinerary",
  resume: "Resume",
  newsletter: "Newsletter",
  reference: "Reference",
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FilesPanel({ isDark }: { isDark: boolean }) {
  const rows = (useQuery(api.pdfArtifacts.listAll, { limit: 100 }) ??
    []) as unknown as PdfArtifactRow[];
  const [selected, setSelected] = useState<PdfArtifactRow | null>(null);

  const cardCls = isDark
    ? "bg-slate-900/60 border-slate-800 hover:border-slate-700"
    : "bg-white border-slate-200 hover:border-slate-300";
  const subCls = isDark ? "text-slate-500" : "text-slate-400";
  const headCls = isDark ? "text-slate-300" : "text-slate-700";

  return (
    <div className="flex h-full gap-4">
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className={`text-lg font-semibold ${headCls}`}>Files</h2>
          <span className={`text-xs ${subCls}`}>{rows.length} artifacts</span>
        </div>
        {rows.length === 0 ? (
          <div className={`text-sm ${subCls} py-8 text-center`}>
            No PDFs yet. Text Boop something like "make me an invoice for $X to Y".
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((row) => (
              <button
                key={row._id}
                onClick={() => setSelected(row)}
                className={`text-left border rounded-lg overflow-hidden transition-colors ${cardCls} ${
                  selected?._id === row._id ? "ring-2 ring-sky-500" : ""
                }`}
              >
                <div
                  className={`aspect-[200/283] ${isDark ? "bg-slate-950" : "bg-slate-100"} flex items-center justify-center overflow-hidden`}
                >
                  {row.thumbnailUrl ? (
                    <img
                      src={row.thumbnailUrl}
                      alt={row.filename}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className={`text-xs ${subCls}`}>no thumbnail</span>
                  )}
                </div>
                <div className="p-2.5">
                  <div className={`text-[10px] uppercase tracking-wider ${subCls} mb-0.5`}>
                    {KIND_LABEL[row.kind] ?? row.kind}
                  </div>
                  <div
                    className={`text-xs font-medium truncate ${headCls}`}
                    title={row.filename}
                  >
                    {row.filename}
                  </div>
                  <div className={`text-[11px] ${subCls} mt-1 flex justify-between`}>
                    <span>
                      {row.pageCount}p · {formatBytes(row.fileSizeBytes)}
                    </span>
                    <span>{formatTime(row.createdAt)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div
          className={`w-[480px] shrink-0 border rounded-lg flex flex-col ${cardCls.replace("hover:border-slate-700", "").replace("hover:border-slate-300", "")}`}
        >
          <div
            className={`px-3 py-2 border-b ${isDark ? "border-slate-800" : "border-slate-200"} flex items-center justify-between`}
          >
            <div className={`text-xs font-medium truncate ${headCls}`}>
              {selected.filename}
            </div>
            <button
              onClick={() => setSelected(null)}
              className={`text-xs ${subCls} hover:underline`}
            >
              close
            </button>
          </div>
          {selected.signedUrl ? (
            <iframe
              src={selected.signedUrl}
              className="flex-1 w-full"
              title={selected.filename}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
              No URL
            </div>
          )}
          <div
            className={`px-3 py-2 border-t ${isDark ? "border-slate-800" : "border-slate-200"} text-[11px] ${subCls} flex justify-between`}
          >
            <span>{selected.artifactId}</span>
            {selected.conversationId && <span>{selected.conversationId}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add debug/src/components/FilesPanel.tsx
git commit -m "feat(debug): add FilesPanel for browsing pdfArtifacts with thumbnails"
```

---

### Task 19: Wire Files tab into the dashboard navigation

Add the Files tab to the View union, NAV array, NAV_ICONS map, and main switch in `App.tsx`.

**Files:**
- Modify: `debug/src/App.tsx`

- [ ] **Step 1: Add the import**

Open `debug/src/App.tsx`. With the other component imports (around line 21), ADD:

```ts
import { FilesPanel } from "./components/FilesPanel.js";
```

- [ ] **Step 2: Add the icon import**

In the `@hugeicons/core-free-icons` import block (lines 4–12), ADD `File02Icon`:

```ts
import {
  MachineRobotIcon,
  AiBrain02Icon,
  WorkflowCircle03Icon,
  Activity01Icon,
  Link04Icon,
  DashboardSquare01Icon,
  ArrowShrink02Icon,
  File02Icon,
} from "@hugeicons/core-free-icons";
```

- [ ] **Step 3: Add `"files"` to the View type and the navigation arrays**

Update the `View` type:

```ts
type View =
  | "dashboard"
  | "agents"
  | "automations"
  | "memory"
  | "events"
  | "consolidation"
  | "connections"
  | "files";
```

Add to `NAV_ICONS`:

```ts
const NAV_ICONS: Record<View, any> = {
  dashboard: DashboardSquare01Icon,
  agents: MachineRobotIcon,
  automations: WorkflowCircle03Icon,
  memory: AiBrain02Icon,
  events: Activity01Icon,
  consolidation: ArrowShrink02Icon,
  connections: Link04Icon,
  files: File02Icon,
};
```

Add to `NAV` (place it after `connections` — last):

```ts
const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "agents", label: "Agents" },
  { id: "automations", label: "Automations" },
  { id: "memory", label: "Memory" },
  { id: "events", label: "Events" },
  { id: "consolidation", label: "Consolidation" },
  { id: "connections", label: "Connections" },
  { id: "files", label: "Files" },
];
```

- [ ] **Step 4: Render the panel in the main switch**

In the main switch (around line 220), AFTER the `{view === "connections" && <ConnectionsPanel ... />}` line, ADD:

```tsx
            {view === "files" && <FilesPanel isDark={isDark} />}
```

- [ ] **Step 5: Typecheck and visual verify**

```bash
npm run typecheck
```

Expected: pass.

```bash
npm run dev
```

Open `http://localhost:5173`. Click the new "Files" tab in the sidebar. Should show the artifact grid (populated by your earlier smoke runs and skill tests). Click any thumbnail — preview pane appears on the right.

- [ ] **Step 6: Commit**

```bash
git add debug/src/App.tsx
git commit -m "feat(debug): wire Files tab into dashboard navigation"
```

---

### Task 20: Write the trigger checklist doc

Manual checklist for verifying each skill auto-engages on the right phrases.

**Files:**
- Create: `docs/superpowers/specs/pdf-skills-trigger-checklist.md`

- [ ] **Step 1: Write the checklist**

```markdown
# PDF Skills Trigger Checklist

Manual verification that each `pdf-*` skill auto-engages on its intended phrases. Run from the dashboard Chat tab or via real iMessage.

For each row: text the prompt, watch the server logs for the expected `[agent ...] tool: Skill (<skill-name>)` line and the subsequent `tool: generate_pdf`. If the wrong skill fires (or none fires), tighten that skill's frontmatter `description` until it triggers reliably.

## pdf-invoice

- [ ] "Invoice $4200 to Acme for the design system" → fires
- [ ] "Bill Acme $4200 for design work" → fires
- [ ] "Send me a receipt PDF for the $42 lunch" → fires
- [ ] "Make me an expense report PDF for last week" → fires

## pdf-brief

- [ ] "Summarize today as a PDF brief" → fires
- [ ] "Morning brief PDF" → fires
- [ ] "Meeting prep PDF for the 11:30 with Acme" → fires
- [ ] "Weekly review PDF" → fires
- [ ] "Schedule for Monday" → does NOT fire (this is a calendar lookup, no PDF)

## pdf-itinerary

- [ ] "Plan my Tokyo trip May 4–11 as a PDF" → fires
- [ ] "Make me an itinerary PDF for Friday" → fires
- [ ] "Agenda PDF for the team offsite" → fires
- [ ] "What's on my calendar Friday" → does NOT fire (calendar lookup)

## pdf-resume

- [ ] "Build me a resume from my LinkedIn data" → fires
- [ ] "One-pager PDF about me for the conference" → fires
- [ ] "CV PDF" → fires

## pdf-newsletter

- [ ] "Compile this week as a newsletter PDF" → fires
- [ ] "Make a digest PDF of my saved articles" → fires
- [ ] "Weekly roundup PDF" → fires

## pdf-reference

- [ ] "Make me a cheat sheet for git rebase" → fires
- [ ] "Quick reference PDF for the Convex API" → fires
- [ ] "Pack list PDF for Tokyo" → fires
- [ ] "Glossary PDF for the company terms" → fires

## boop-design auto-engagement

- [ ] When any `pdf-*` skill runs, the agent should ALSO invoke `boop-design` (visible in the agent log as a separate `Skill` tool call, ideally before `generate_pdf`)
- [ ] Open one rendered PDF per kind. Visually verify against the boop-design laws:
  - [ ] OKLCH only (no hex / hsl)
  - [ ] Heading/body weight contrast ≥1.25 stops
  - [ ] One accent color per page, ≤10% surface coverage
  - [ ] No banned patterns: gradient text, side-stripe accents, decorative glassmorphism
  - [ ] Body line-length 65–75ch
  - [ ] Body line-height 1.5–1.6
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/pdf-skills-trigger-checklist.md
git commit -m "docs: add manual trigger checklist for pdf-* skills"
```

---

### Task 21: Final end-to-end verification

Walk the full path one more time with both smoke scripts and a real iMessage round-trip.

- [ ] **Step 1: Run the offline smoke**

```bash
npm run pdf:smoke
```

Expected: `done — 6/6 succeeded`.

- [ ] **Step 2: Run the Sendblue smoke (your number)**

```bash
npm run pdf:smoke:sendblue -- --to +<your-mobile>
```

Expected: PDF attachment lands in iMessage.

- [ ] **Step 3: Real-world sanity check via iMessage**

Text Boop's number from your phone:

```
make me an invoice for $1500 to Boop Verification Co for testing services (5h @ $300)
```

Expected:
1. Typing indicator
2. Within ~10s, an iMessage with the invoice PDF attached
3. Reply text: "Generated INV-... — $1,500 to Boop Verification Co." (or similar)
4. Open the dashboard Files tab — newest row matches

- [ ] **Step 4: Verify the trigger checklist**

Open `docs/superpowers/specs/pdf-skills-trigger-checklist.md` and walk each prompt. Tighten any skill description that misfires.

- [ ] **Step 5: Final typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 6: No final commit needed unless verification surfaced fixes.**

---

## Summary of commits

If everything goes smoothly, this plan produces these commits in order:

1. `feat(skills): move boop-design to .claude/skills/ and sharpen trigger description`
2. `feat(deps): add puppeteer for PDF rendering`
3. `feat(convex): add pdfArtifacts table`
4. `feat(convex): add pdfArtifacts module (generate action + queries)`
5. `feat(server): add boop-pdf MCP with Puppeteer-backed generate_pdf tool`
6. `feat(server): register boop-pdf MCP and update execution agent system prompt`
7. `feat(scripts): add pdf:smoke for offline render-and-upload verification`
8. `feat(skills): add pdf-invoice for invoice / receipt / expense PDFs`
9. `feat(sendblue): accept optional mediaUrl with text-URL fallback`
10. `feat(sendblue): pick up latest pdfArtifact post-turn and attach via media_url`
11. `feat(scripts): add pdf:smoke:sendblue for end-to-end iMessage verification`
12. `feat(skills): add pdf-brief for daily/meeting/research summaries`
13. `feat(skills): add pdf-itinerary for trip plans, agendas, schedules`
14. `feat(skills): add pdf-resume for resumes, CVs, one-pagers`
15. `feat(skills): add pdf-newsletter for digests, roundups, weekly recaps`
16. `feat(skills): add pdf-reference for cheatsheets, glossaries, quick references`
17. `feat(debug): add FilesPanel for browsing pdfArtifacts with thumbnails`
18. `feat(debug): wire Files tab into dashboard navigation`
19. `docs: add manual trigger checklist for pdf-* skills`

(Tasks 17 and 21 are verification-only with no commits.)
