# Boop PDF Skills — Design Spec

**Date:** 2026-04-29
**Status:** Approved, ready for implementation plan

## Goal

Give Boop the ability to **design and generate beautifully designed PDFs** for six everyday document types — brief, invoice, itinerary, resume, newsletter, reference — and deliver them as iMessage attachments. Every PDF goes through `boop-design` as the design quality gate so output is consistent and intentional, not generic AI aesthetic.

## Why

Today Boop replies in plain text only. Many real personal-agent requests ("make me an invoice", "summarize today as a brief", "pull together a trip itinerary") want a real document, not a wall of bullets. Adding a PDF capability makes Boop genuinely useful for tasks where the artifact is the answer.

## Non-goals (v1)

- Encrypted PDFs
- RTL / CJK-heavy layouts (works but untested)
- Visual regression / pixel-diff tests
- A 7th doc type — adding more is straightforward later
- Sending PDFs to third parties (drafts-and-send already covers that for email/Slack/Drive via Composio)

---

## Architecture

```
User: "make me an invoice for $4200 to Acme..."
  │
  ▼
Interaction agent → spawn_agent(task)
  │
  ▼
Execution agent
  ├─ SDK auto-picks the matching pdf-* skill
  ├─ Skill body: "Load boop-design first via the Skill tool"
  ├─ Agent reads boop-design (typography, OKLCH, layout laws)
  ├─ Agent writes HTML+CSS following boop-design + skill template
  ├─ Agent calls mcp__boop-pdf__generate_pdf({ html, filename, kind, conversationId })
  │     ├─ Puppeteer renders → PDF buffer
  │     ├─ Puppeteer also captures a 200×260 PNG thumbnail
  │     ├─ pdfArtifacts.upload (action) → Id<"_storage">
  │     ├─ pdfArtifacts.thumbnail.upload (action) → Id<"_storage">
  │     ├─ pdfArtifacts.create (mutation) → artifactId
  │     └─ Returns { artifactId, signedUrl, thumbnailUrl, pageCount, fileSizeBytes }
  └─ Agent returns one short summary line to interaction agent
  │
  ▼
Interaction agent
  ├─ Queries pdfArtifacts.latestForConversation({ conversationId, since: turnStart })
  └─ sendImessage(toNumber, text, { mediaUrl: artifact.signedUrl })
        ├─ Sendblue accepts → iMessage attachment lands
        └─ Sendblue rejects (size/plan/carrier) → fallback: text + URL
```

Three principles encoded in this shape:

1. **Decoupled handoff via Convex** — the execution agent stores the artifact; the interaction agent picks it up. The agent's text return value never carries the URL. Clean, single source of truth.
2. **boop-design is the universal gate** — every visual output flows through it. Enforced by skill prompt; reinforced by sharpening the skill description.
3. **Attachment-first, URL-fallback** — best UX when it works (iMessage attachment), graceful degrade when it doesn't.

---

## Component 1 — The six PDF skills

Each lives at `.claude/skills/pdf-<kind>/SKILL.md`. All follow the same shape; only the type-specific bits differ.

### Canonical skill structure (`pdf-invoice` shown)

```yaml
---
name: pdf-invoice
description: |
  Generate a beautifully designed invoice, receipt, or expense report as a
  PDF. Use when the user asks for an invoice, a bill, a receipt, an expense
  report, or "send me a PDF for $X to <client>". Always renders through
  boop-design for typography, color, and layout discipline.
---

# pdf-invoice

You produce a polished, business-ready invoice PDF.

## Pipeline (do not skip steps)

1. **Load `boop-design` via the Skill tool first.** Read it in full before
   writing any HTML. Its design laws (OKLCH only, semantic color names,
   ≥1.25-stop heading/body weight contrast, 65–75ch line length, the spacing
   scale, the absolute bans) are non-negotiable.
2. Extract invoice data. Required: payee, payer, line items, currency, total.
   Optional: due date, terms, notes, logo. If a required field is missing,
   ask the interaction agent to clarify.
3. Apply layout rules in §Layout below.
4. Generate semantic HTML using §Template. Inline all CSS in a single
   `<style>` block. Do NOT pull external assets — Puppeteer prints offline.
5. Call `mcp__boop-pdf__generate_pdf` with `{ html, filename, kind: "invoice",
   conversationId }`. The renderer hands the signed URL to the interaction
   agent; you do not deliver the file yourself.
6. Return ONE short summary line. Example: "Generated INV-2026-0042 — $4,200
   to Acme, due Apr 12." Do NOT paste the URL — the interaction agent
   attaches it automatically.

## Layout (invoice-specific, on top of boop-design)

- Single column, 32mm margins. A4 default; US Letter if currency is USD.
- Top band: payee identity (left) and metadata block (right — number, issue,
  due, total).
- Line-items table: 4 columns (description, qty, rate, total). Right-align
  numerics. `font-variant-numeric: tabular-nums`.
- Totals stack right-aligned below the table: subtotal, tax (if any), total.
  Total is the only emphasis — heavier weight, no color.
- One accent color max, used only on the total row's underline.

## Template

[~80-line reference HTML+CSS using OKLCH variables]

## Examples

[3 example prompts → expected filename → expected summary]
```

### Variation table

| Skill | Trigger phrases (frontmatter) | Page count | Layout signature |
|---|---|---|---|
| `pdf-brief` | "summarize today", "morning brief", "meeting prep", "weekly review" | 1–3 | hierarchical headings, prose blocks |
| `pdf-invoice` | "invoice", "bill", "receipt", "expense report" | 1 | header + line-item table + totals |
| `pdf-itinerary` | "trip plan", "itinerary", "agenda", "schedule for trip" | 1–N | timeline rows, day separators |
| `pdf-resume` | "resume", "CV", "one-pager", "profile" | 1 (strict) | sidebar + main, dense |
| `pdf-newsletter` | "digest", "roundup", "weekly newsletter" | 1–4 | 2-column flow, masthead |
| `pdf-reference` | "cheatsheet", "quick reference", "glossary" | 1–2 | dense table, monospace-friendly |

### Skill description budget

Each description is ~250 chars. Six skills ≈ 1.5k chars. Boop-design's description ≈ 300 chars. Total against the ~15k `SLASH_COMMAND_TOOL_CHAR_BUDGET` is well under budget.

---

## Component 2 — `boop-design` wiring

`skills/boop-design/SKILL.md` is currently at the wrong path — the execution agent loads `.claude/skills/`, so the file is dead weight today.

**Action:** Move (`git mv`) `skills/boop-design/SKILL.md` → `.claude/skills/boop-design/SKILL.md`. Remove the empty `skills/` directory afterward.

**Description sharpen** — replace the current generic description with:

> Boop's design law book. Use when generating any visual artifact (PDFs, HTML, slide layouts) to enforce typography, color (OKLCH), spacing, and motion rules. Required reading before producing visual output.

This wording trips the SDK's auto-pick on PDF and visual tasks, even when no explicit `pdf-*` skill calls it. Keeps it as a redundant safety net even if a skill prompt drifts.

`user-invocable: false` stays — boop-design is not a thing the user invokes; it's auto-engaged by the agent.

---

## Component 3 — `boop-pdf` MCP tool

Lives at `server/pdf-tools.ts`, registered in `execution-agent.ts` alongside `boop-drafts`.

### Tool surface

```ts
generate_pdf({
  html: string,                            // full HTML doc with inlined <style>
  filename: string,                        // e.g. "invoice-acme-2026-04-29.pdf"
  kind: "brief" | "invoice" | "itinerary"
      | "resume" | "newsletter" | "reference",
  conversationId?: string,                 // injected by spawn
}) => {
  artifactId: string,
  storageId: string,
  signedUrl: string,                       // for Sendblue media_url
  thumbnailUrl: string,                    // for the dashboard Files tab
  pageCount: number,
  fileSizeBytes: number,
}
```

### Implementation notes

- **One Chromium per server**, reused across renders. Boot cost (~500ms) only on first render. Restart the browser every 100 renders to keep memory bounded.
- **Per-render `page` lifecycle** in `try/finally`. Never leak a page on error.
- **Render config:** A4 default, 20mm uniform margins (skill can override), `printBackground: true`, `waitUntil: "networkidle0"`.
- **30s render timeout** via `Promise.race`. On timeout: kill the page, return `{ error: "render_timeout" }`.
- **Thumbnail:** after `page.pdf()` completes (the `page` is still alive), set viewport to 200×283 (preserves A4 aspect ratio), then `page.screenshot({ type: "png", fullPage: false })`. The single screenshot of viewport-1 is the thumbnail — no downsample step needed. ~150ms extra per render.
- **Graceful shutdown:** `process.on("SIGTERM", () => browserPromise?.then(b => b.close()))` to avoid orphan Chromium processes when `npm run dev` restarts.

### Wiring in `execution-agent.ts`

```ts
const pdfServer = opts.conversationId
  ? createPdfMcp(opts.conversationId)
  : undefined;

const mcpServers = {
  ...integrationServers,
  ...(draftServer ? { "boop-drafts": draftServer } : {}),
  ...(pdfServer ? { "boop-pdf": pdfServer } : {}),
};
```

`allowedTools`'s existing `mcp__${name}__*` glob picks it up automatically.

The execution-agent system prompt gets one new line:

```
- If you generated a PDF via the boop-pdf tool, do NOT paste the URL in your
  response. The interaction agent attaches it automatically. Just say what
  you produced — e.g. "Generated INV-2026-0042 — $4,200 to Acme."
```

And one new line in Safety:

```
- If a PDF render fails, retry once with a simpler layout. If the second
  attempt fails, return a single sentence telling the user what failed and
  offer a plain-text fallback. Never paste the raw error.
```

---

## Component 4 — Convex schema and storage

### Table: `pdfArtifacts` in `convex/schema.ts`

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
  .index("by_conversation", ["conversationId", "createdAt"])
  .index("by_artifact", ["artifactId"])
  .index("by_kind", ["kind", "createdAt"]),
```

`kind` stays strict (`v.union` of 6 literals) as documentation. Adding a 7th is a one-line + Convex migration when needed.

### Module: `convex/pdfArtifacts.ts`

Five exported functions:

| Function | Type | Purpose |
|---|---|---|
| `upload` | action | Receives base64 PDF, writes blob to `ctx.storage`, returns `Id<"_storage">` |
| `uploadThumbnail` | action | Same shape, mimeType `image/png` |
| `create` | mutation | Inserts the metadata row, generates `artifactId`, returns it |
| `getUrl` | query | Wraps `ctx.storage.getUrl(storageId)` |
| `latestForConversation` | query | `(conversationId, since) → row \| null`, used by interaction agent |
| `listForConversation` | query | Latest 50 for the dashboard's Files tab |

`signedUrl` is cached on the row at create-time so dashboard list queries don't re-query storage. Convex `storage.getUrl()` URLs are stable for the file's lifetime, so the cache is always valid.

### CLAUDE.md compliance

`convex/_generated/ai/guidelines.md` will be loaded **before** writing any of the schema or module functions in implementation. Validators, indexes, and the action/mutation/query split are all areas where the guidelines override training defaults.

---

## Component 5 — Sendblue integration

### Extended `sendImessage` signature in `server/sendblue.ts`

```ts
export async function sendImessage(
  toNumber: string,
  text: string,
  opts: { mediaUrl?: string } = {},
): Promise<void>
```

Behavior:
- Attach `media_url` on the **first chunk only** (Sendblue treats each call as a separate message; multi-chunk + media would deliver the file once per chunk).
- On Sendblue 4xx with media attached: fallback path re-sends as `text + "\n\n" + mediaUrl`. Logs the rejection reason.
- On generic Sendblue failure: existing error-logging path stays intact.

### Interaction-agent pickup in `server/interaction-agent.ts`

After the dispatcher resolves a turn:

```ts
const turnStart = /* captured at top of handleUserMessage */;
const reply = /* dispatcher result string */;

const artifact = await convex.query(api.pdfArtifacts.latestForConversation, {
  conversationId,
  since: turnStart,
});

await sendImessage(
  fromNumber,
  reply,
  artifact ? { mediaUrl: artifact.signedUrl } : {},
);
```

`since: turnStart` ensures only PDFs produced **during this turn** attach. A later "thanks!" message won't re-attach last hour's invoice.

### Multi-PDF turns

If the agent generates 2+ PDFs in one turn, only the latest attaches. Older ones live in the dashboard's Files tab. Acceptable for v1; user can text "send me the other one" as a follow-up.

---

## Component 6 — Debug dashboard Files tab

New tab in `debug/`. Lists `pdfArtifacts` rows with:
- Thumbnail (200×260 PNG from Convex storage)
- Filename, kind, page count, file size
- Conversation it was produced in (linked)
- Click → opens an iframe of the PDF + the agent log that produced it

Data source: `api.pdfArtifacts.listForConversation` (or a new `listAll` for cross-conversation browsing). React Query (the dashboard's existing pattern) handles realtime via Convex subscriptions automatically.

---

## Error handling — what happens, what user sees

| Failure | Behavior | User experience |
|---|---|---|
| Chromium fails to launch | Tool throws; agent returns canned message | "Couldn't generate the PDF — the renderer didn't start. Run `npx puppeteer browsers install chrome`." |
| Page crash mid-render | Per-render try/finally closes page, browser intact. Agent retries once with simpler layout. | One quiet retry; if that fails, "had trouble rendering this — want a plain text version?" |
| Render hangs | 30s timeout via `Promise.race`. Page killed, returns `render_timeout`. | Same canned recovery |
| PDF too large for Sendblue | Fallback path: text + signed URL | "Your invoice — too big to attach, here's the link: …" |
| Convex storage upload fails | Tool surfaces error, agent retries once | "Couldn't save the PDF (storage error). Try again in a moment." |
| Signed URL not yet reachable | One retry with 1.5s delay, then text+URL fallback | Slight delay; never an empty message |
| Both attachment and URL fallback fail | Artifact stays in `pdfArtifacts`. Agent appends: "I made the PDF but couldn't deliver it through iMessage — open the dashboard's Files tab to grab it." | Honest message + recoverable artifact |
| Agent skips boop-design | Behavioral risk only; not a technical error. Skill description + body both reinforce the rule. | Lower-quality PDF if it slips; we tighten prompts on observed drift |
| Multi-PDF turn | Latest attaches; rest in dashboard | Sees one attachment |
| Server restart mid-render | Render lost. Heartbeat flips agent to `failed` after 15min. | User re-asks (same as today's stuck-agent recovery) |
| OOM Chromium | Counter ≥100 → auto-restart browser before next render | Transparent |
| Missing `conversationId` (e.g. headless automation) | Artifact stored with `conversationId: undefined`. Pickup query won't find it; dashboard shows it. | Acceptable for headless flows |

---

## Verification (no test framework — matches project style)

### 1. `npm run typecheck`

Existing gate. New files must pass.

### 2. `scripts/pdf-smoke.mjs` — full happy-path without Sendblue

```
npm run pdf:smoke
```

For each of the 6 doc kinds:
- Renders a fixed sample HTML
- Uploads to Convex storage
- Creates the metadata row
- Prints the signed URL

Asserts: browser launches; all 6 render without error; PDFs >5KB and <5MB; rows created with correct `kind`; URLs return 200.

### 3. `scripts/pdf-smoke-sendblue.mjs` — opt-in iMessage round-trip

```
npm run pdf:smoke:sendblue -- --to +1...
```

Generates one sample invoice, calls `sendImessage` with `media_url`. Confirms attachment delivery on your Sendblue plan + carrier.

### 4. `docs/superpowers/specs/pdf-skills-trigger-checklist.md` — manual

3 example prompts per skill listed. Run from iMessage or dashboard Chat tab. Confirm the right skill fires. Tighten descriptions on misses.

### 5. boop-design enforcement — manual visual

After each `pdf-*` skill is implemented, generate one of each kind, eyeball against boop-design's laws (OKLCH, weight contrast, accent restraint, banned-pattern absence, body line length, line-height). Tighten skill prompt on misses.

### 6. Files tab in debug dashboard

Day-to-day verification surface. Every PDF browsable, with thumbnail + source conversation + agent log.

---

## What gets added

```
.claude/skills/
  ├── boop-design/
  │   └── SKILL.md                       # MOVED from skills/ + sharpened description
  ├── pdf-brief/SKILL.md                 # NEW
  ├── pdf-invoice/SKILL.md               # NEW
  ├── pdf-itinerary/SKILL.md             # NEW
  ├── pdf-resume/SKILL.md                # NEW
  ├── pdf-newsletter/SKILL.md            # NEW
  └── pdf-reference/SKILL.md             # NEW

skills/                                  # REMOVED (only contained boop-design)

server/
  ├── pdf-tools.ts                       # NEW: Puppeteer + boop-pdf MCP
  ├── execution-agent.ts                 # MOD: register boop-pdf MCP, system prompt additions
  ├── interaction-agent.ts               # MOD: pickup + attach artifact
  └── sendblue.ts                        # MOD: optional mediaUrl arg + fallback

convex/
  ├── schema.ts                          # MOD: pdfArtifacts table
  └── pdfArtifacts.ts                    # NEW: upload, uploadThumbnail, create, getUrl,
                                         #      latestForConversation, listForConversation

debug/
  └── src/                               # NEW: Files tab listing artifacts

scripts/
  ├── pdf-smoke.mjs                      # NEW
  └── pdf-smoke-sendblue.mjs             # NEW

package.json                             # MOD: puppeteer dep, pdf:smoke + pdf:smoke:sendblue scripts
docs/superpowers/specs/
  ├── 2026-04-29-boop-pdf-skills-design.md  # this file
  └── pdf-skills-trigger-checklist.md    # NEW
```

## Dependencies to add

- `puppeteer` (latest stable). Bundles its own Chromium download — ~200MB once. No `puppeteer-core` because we want the bundled binary for zero-config installs.

## Open questions for implementation

None blocking. Implementation should follow Convex AI guidelines (`convex/_generated/ai/guidelines.md`) for the schema and any database functions.

## Rollout

Single PR. No feature flag — six skills are dormant by default (the SDK only loads them when their description matches), so shipping them adds capability without changing existing behavior. The MCP tool registration and `sendImessage` signature change are backward-compatible (optional arg).
