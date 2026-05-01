# Inbound File Attachments (Photos, PDFs, Text Docs) — Design Spec

**Date:** 2026-05-01
**Status:** Approved, ready for implementation plan

## Goal

Let Boop accept inbound files — photos, PDFs, and plain-text documents (.txt/.md/.docx) — over **both** Telegram and iMessage (Sendblue), describe them in the user message body, and persist them durably so sub-agents can fetch and re-analyze. The motivating use case is design-inspiration screenshots ("apply this slide's vibe to my pitch deck"), but the same plumbing covers receipts, invoices, contracts, scans, and forwarded decks.

## Why

The Telegram channel currently silently drops every inbound message that isn't text or voice — `msg.photo`, `msg.document`, `msg.sticker`, `msg.video`, etc. all hit the `else { res.json({ ok: true, skipped: true }) }` branch in `server/channels/telegram.ts:267–270`. The user gets no reply, no error, no log. Sendblue's MMS payload is read for `content` and `from_number` only; any `media_url` field is ignored. This shows up the moment a user is in any conversation that involves a visual artifact (the immediate trigger was the user sending a screenshot for design feedback, which Boop had explicitly invited a turn earlier).

There's also a single-channel risk: if we wire up only Telegram, the user has to remember which channel handles which media types. Sendblue MMS attachments are equally common — making the two channels behave the same removes a hidden footgun.

## Non-goals (v1)

- **Multimodal LLM input.** Dispatcher and execution agents stay text-only. The user message body is enriched with a vision-derived description and a signed URL; sub-agents that want pixel-level analysis can fetch the URL and run their own vision pass. No `handleUserMessage` signature change.
- **Video, GIFs, audio files, stickers** as inbound. Voice notes already work via `transcribe.ts`; everything else gets a polite "not supported yet" reply.
- **Outbound media changes.** The existing `pdfArtifacts` → `dispatch(..., { mediaUrl })` flow is untouched.
- **A new `analyze_image` tool exposed to sub-agents.** Sub-agents that need vision use existing primitives (HTTP fetch + their own `vision.ts` call).
- **Image editing or round-trip** ("crop this photo and send it back").
- **Preview thumbnails in the debug dashboard.** The signed URL is on the message row; the UI is free to render it as a separate task.
- **Full-text indexing** of attachment contents for memory recall. Memory still uses the message body text only.

---

## Architecture

```
   Telegram update / Sendblue MMS webhook
            │
            │  (1) parse + dedup + allowlist (existing)
            │  (2) extract media descriptor + caption
            │  (3) download bytes from channel CDN
            │  (4) early reject if size > cap or mime unsupported
            ▼
   server/attachments.ts :: resolveAttachment(bytes, mime, filename, source)
            │
            │  (5) upload bytes to Convex storage → storageId
            │  (6) sign URL → signedUrl (cached on the message row)
            │  (7) branch by mime:
            │        image  → server/vision.ts          (gpt-4o, single call)
            │        pdf    → server/pdf-extract.ts     (pdfjs text + selective vision)
            │        docx   → server/docx-extract.ts    (mammoth → text)
            │        txt/md → read bytes as utf-8
            │  (8) compose human-readable description
            │  (9) record usageRecords row
            │
            ▼
   { kind, mimeType, sizeBytes, storageId, signedUrl,
     description, costUsd, filename }
            │
            │  (10) channel composes user-message body (see "User-message format")
            │
            ▼
   existing runTurn(...)  ←  no signature change
            │
            ▼
   handleUserMessage / interaction-agent / spawn / dispatch
   (unchanged; sub-agents get URL + description via the spawn task string)
```

Five principles encoded:

1. **One resolver, every channel.** Channel handlers are the only place protocol details live (Telegram's `getFile` vs. Sendblue's CDN URL). Below `resolveAttachment` the code is identical for both. Adding Discord/WhatsApp later means: extract descriptor → download → call `resolveAttachment`.
2. **Vision-to-text at the channel layer.** Mirrors the voice-note pattern. Dispatcher LLM never pays vision tokens for routing decisions; sub-agents that care can re-analyze.
3. **Durable storage; throwaway processing.** Bytes go into Convex storage; the signed URL is stable for the lifetime of the stored object (matches the existing `pdfArtifacts` outbound pattern: cache the URL on the row, re-sign via a query if it ever stops resolving). Local temp files are not used — sub-agents that run minutes later still have a stable URL.
4. **No silent drops, ever.** Every inbound mime gets a user-visible reply, even if it's "not supported yet." The current silent-`skipped:true` was the root-cause bug; this design eliminates the category.
5. **Costs are explicit.** Each successful resolution writes a `usageRecords` row with `source: "vision" | "pdf-extract" | "docx-extract"` and the actual OpenAI spend.

---

## File layout

### New files

```
server/
├── attachments.ts        Single entry point. resolveAttachment + size/mime caps.
├── vision.ts             OpenAI vision call (one image). Mirrors transcribe.ts.
├── pdf-extract.ts        pdfjs text extraction + selective per-page vision.
└── docx-extract.ts       mammoth-based .docx → text. ~10 lines.

convex/
└── attachmentStorage.ts  Storage upload URL + sign helpers.
                          (generateUploadUrl, recordUploaded, getSignedUrl)
```

### Modified files

```
server/channels/telegram.ts        Branch on msg.photo / msg.document / msg.sticker /
                                   msg.video / msg.animation; pick largest photo size
                                   that fits the cap; call resolveAttachment; compose
                                   user-message body; reply politely on unsupported.

server/sendblue.ts                 Read media_url + media_urls from webhook body;
                                   fetch bytes from public CDN URL; HEAD-check
                                   content-type; same compose flow.

convex/schema.ts                   Add optional attachments[] to messages table.

convex/messages.ts                 messages:send accepts optional attachments arg.

.env.example                       Document BOOP_VISION_MODEL (default gpt-4o)
                                   and BOOP_VISION_COST_CAP_USD (default 1.50).
```

### Dependencies to add

| Package | Purpose | Native build? |
|---|---|---|
| `pdfjs-dist` | PDF text extraction + page-to-canvas rendering. Pin to a 4.x version known to work in node ESM. | Pure JS. |
| `@napi-rs/canvas` | Canvas backend for pdfjs page rendering. Provides `getContext('2d')` to pdfjs. | Native, but ships prebuilt arm64/x64 binaries — no compilation step on macOS or Linux. |
| `mammoth` | .docx → raw text. Standard in the JS ecosystem. | Pure JS. |

`mime-types` not added — content-type from the channel-provided headers + filename extension fallback are enough.

---

## Module contracts

### `server/attachments.ts`

```ts
export type AttachmentKind = "image" | "pdf" | "doc";

export interface ResolvedAttachment {
  kind: AttachmentKind;
  mimeType: string;
  sizeBytes: number;
  storageId: Id<"_storage">;
  signedUrl: string;               // cached; matches pdfArtifacts pattern. Re-sign via attachmentStorage:getSignedUrl if it ever fails.
  description: string;             // never empty on success; see partial-failure rules
  filename?: string;
  costUsd: number;
}

export interface AttachmentError {
  userMessage: string;             // ready-to-dispatch one-liner
  serverError: Error;              // logged to console, never sent to user
}

export const ATTACHMENT_LIMITS = {
  maxImageBytes: 20 * 1024 * 1024,
  maxPdfBytes: 20 * 1024 * 1024,
  maxTextBytes: 200 * 1024,
  maxPdfPages: 20,
  perMessageVisionCostCapUsd: 1.50,
} as const;

export const SUPPORTED_IMAGE_MIMES = new Set([
  "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/gif",
]);
export const SUPPORTED_PDF_MIMES = new Set(["application/pdf"]);
export const SUPPORTED_DOC_MIMES = new Set([
  "text/plain", "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
]);

export async function resolveAttachment(
  bytes: Buffer,
  mimeType: string,
  filename: string | undefined,
  source: "telegram" | "sendblue",
): Promise<ResolvedAttachment | AttachmentError>;
```

Internally:
- Validates size + mime up front; returns `AttachmentError` with a precise user message on rejection.
- Uploads bytes via `convex/attachmentStorage.ts:generateUploadUrl` then `recordUploaded`.
- Dispatches to the right extractor by mime, passing the per-message cost ceiling for the PDF path to honor.
- Returns one `ResolvedAttachment` (or `AttachmentError`) per file. Multi-file is the channel's responsibility — call `resolveAttachment` once per attachment and concatenate at the channel layer. In practice this only matters for Sendblue: Telegram delivers exactly one media per update, while Sendblue MMS can carry multiple URLs in a single payload.

### `server/vision.ts`

```ts
export interface VisionResult {
  description: string;
  costUsd: number;
  model: string;
}

export async function describeImage(
  bytes: Buffer,
  mimeType: string,
  options?: { promptHint?: string; pageContext?: { page: number; total: number } },
): Promise<VisionResult>;
```

Single OpenAI vision call (default model `gpt-4o`, overridable via `BOOP_VISION_MODEL`). System prompt: "Describe this image in 2–4 sentences. Capture: subject, layout/composition, dominant colors, typography style if any, text content if legible. Be concrete and visual; this description routes the image to a downstream agent." `promptHint` is appended (channels pass the user's caption as a hint). Throws on auth/network/HTTP errors. Cost calculated from response token usage.

### `server/pdf-extract.ts`

```ts
export interface PdfExtractResult {
  description: string;            // concatenated per-page text + vision blocks
  costUsd: number;
  pagesProcessed: number;
  pagesTotal: number;
  truncatedReason?: "page-cap" | "cost-cap";
}

export async function extractPdf(
  bytes: Buffer,
  costCapUsd: number,
): Promise<PdfExtractResult>;
```

Algorithm:
1. Load via `pdfjs-dist.getDocument(bytes)`. Get `pagesTotal`.
2. For each page up to `min(pagesTotal, 20)`:
   - Extract text via `page.getTextContent()`. If text length ≥ 100 chars, append `## Page N\n<text>` to description, no vision call.
   - If text < 100 chars (image-only/scanned), render to a canvas via `@napi-rs/canvas`, encode as PNG, call `vision.describeImage` with `pageContext: { page: N, total: pagesTotal }`. Append `## Page N (image)\n<vision description>`.
   - After each vision call, check accumulated `costUsd` against `costCapUsd`; if exceeded, set `truncatedReason: "cost-cap"` and break.
3. If `pagesTotal > 20`, set `truncatedReason: "page-cap"`.

### `server/docx-extract.ts`

```ts
export async function extractDocx(bytes: Buffer): Promise<{ text: string; costUsd: 0 }>;
```

Wraps `mammoth.extractRawText({ buffer: bytes })`. Truncates to 200 KB, suffixes `\n\n[truncated — first 200 KB of N KB]` if hit.

### `convex/attachmentStorage.ts`

```ts
export const generateUploadUrl = mutation({ ... });   // returns string
export const recordUploaded = mutation({              // body: { storageId, mimeType, sizeBytes }
  args: { storageId: v.id("_storage"), mimeType: v.string(), sizeBytes: v.number() },
  handler: async (ctx, args) => {
    const signedUrl = await ctx.storage.getUrl(args.storageId);
    if (!signedUrl) throw new Error("storage.getUrl returned null after store");
    return { signedUrl };
  },
});
export const getSignedUrl = query({ ... });           // re-sign on demand (matches pdfArtifacts:getUrl)
```

---

## User-message format

Every successful inbound with attachments produces one structured block per attachment, concatenated, prepended to the user's caption (if any). The body sent to `runTurn` looks like:

**Single image, with caption:**
```
🖼️ (image attached)

Caption: vibe for the deck

Description: Modern pitch deck slide. Dark navy background with a single
lime-green accent rule running vertically on the left. Bold serif headline
set in white. Sans-serif body text below. Half-bleed photograph on the right
edge. Brand mark in the top-left corner.

Link: https://convex-storage.example.com/abc123
```

**Single PDF, image-heavy:**
```
📄 (PDF attached, 12 pages — first 12 of 12 processed)

Description:
## Page 1
Cover slide. Bold wordmark in white on charcoal. Tagline in muted gray underneath.

## Page 2 (image)
Stat trio rendered as oversized white numerals on lime backgrounds.
...

Link: https://convex-storage.example.com/def456
```

**Multiple attachments, partial failure:**
```
🖼️ (image 1/2 attached)

Description: ...

Link: https://convex-storage.example.com/...

⚠️ (file 2/2: That PDF wouldn't open on my end. Try re-exporting it.)
```

**Caption-only (text):** unchanged from today.
**Voice + caption:** voice path takes precedence (matches existing `if (msg.voice)` logic).

---

## Schema changes (`convex/schema.ts`)

```ts
messages: defineTable({
  // ...existing fields (conversationId, role, content, turnId, createdAt)
  attachments: v.optional(
    v.array(
      v.object({
        kind: v.union(v.literal("image"), v.literal("pdf"), v.literal("doc")),
        mimeType: v.string(),
        sizeBytes: v.number(),
        storageId: v.id("_storage"),
        signedUrl: v.optional(v.string()),    // cached; can be re-signed via attachmentStorage:getSignedUrl
        description: v.optional(v.string()),
        filename: v.optional(v.string()),
      }),
    ),
  ),
}),
```

Inline (vs. separate table) because attachments are inseparable from their message and Convex's per-row 1MB limit is comfortable for our caps (≤5 attachments × small metadata, no inline bytes).

---

## Configuration

```
# Optional — model used for vision/extraction. Defaults to gpt-4o.
BOOP_VISION_MODEL=gpt-4o

# Optional — hard ceiling on vision spend per inbound message. Defaults to 1.50.
BOOP_VISION_COST_CAP_USD=1.50
```

No new required env. `OPENAI_API_KEY` is already required by `transcribe.ts`.

---

## Failure handling

Every failure path produces exactly one short, user-visible reply via `dispatch()`. Server-side full error always goes to console.

| Failure point | User-visible reply |
|---|---|
| Download from Telegram/MMS CDN fails | *"Couldn't fetch that file — try sending it again?"* |
| Size > cap | *"That \<image / PDF / file\> is \<X\> MB — I can only handle up to \<Y\> MB. Try a smaller copy or split it."* |
| Unsupported mime | *"I don't read that file type yet (\<mime\>). I can see photos (JPG/PNG/HEIC/WEBP), PDFs, and .txt/.md/.docx. Want to send it differently?"* |
| Convex storage upload fails | *"Couldn't save that attachment — try again in a moment?"* |
| Vision API fails | *"Trouble looking at that image — mind retrying or describing it in text?"* |
| PDF extraction fails entirely | *"That PDF wouldn't open on my end. Try re-exporting it or send screenshots?"* |
| .docx extraction fails | *"Couldn't read that .docx — try exporting as PDF or .txt?"* |
| Cost cap hit mid-PDF | Partial description still passed through. Suffix: *"(stopped at page \<N\>/\<total\> — costs were getting steep, send a tighter slice if you want the rest.)"* |
| Multi-attachment, partial fail | Per-attachment block in the user message; failed ones become `⚠️ (file N/M: <error>)`; successful ones render the full description block. Turn still runs. |

Two non-obvious choices documented in the architecture above:

- **Dedup is claimed before processing**, not after, matching the existing voice path. Avoids double-processing on Telegram retries; trade-off is that if processing fails post-claim, the user has to manually resend.
- **Early `res.json({ok:true})`** before the long-running vision call, matching the voice path. Keeps Telegram's 60s webhook timeout from firing during a 5–10s vision pass.

---

## Testing

### Unit tests (new in `tests/`)

| File | Coverage |
|---|---|
| `vision.test.ts` | Mock OpenAI fetch. Assert request shape (model name, image base64-encoded, role/content blocks, prompt hint passthrough), response parse, cost calc from token usage. |
| `pdf-extract.test.ts` | Fixtures: `text-only.pdf`, `image-only.pdf`, `mixed.pdf`, `corrupt.pdf` in `tests/fixtures/`. Assert text-only path makes zero vision calls; image-only path makes N vision calls; mixed path matches expected mix; corrupt PDF throws caught. Truncation at page cap and cost cap honored. |
| `docx-extract.test.ts` | One fixture .docx, assert text comes back, truncation at 200 KB. |
| `attachments.test.ts` | Drive `resolveAttachment` end-to-end with mocked vision + extractors. Assert size cap rejects, unknown mime rejects, multi-attachment partial failure, cost recording row written. |

### Integration tests (extend `scripts/telegram-smoke.mjs`)

- New step: post synthetic Telegram update with `message.photo: [{file_id, file_size, width, height}]`. Stub `downloadTelegramFile` to return a fixture image. Assert turn runs and the user message body contains `🖼️ (image attached)`.
- New step: same with `message.document` carrying a PDF fixture.
- New step: oversized photo → assert error reply, no turn.

### Sendblue manual checklist

No programmatic smoke (Sendblue doesn't expose a webhook simulator). Add to the existing manual verification doc:
- Send real MMS image from a personal device
- Verify reply arrives
- Verify Convex `messages` row has `attachments[0].signedUrl` and that URL is publicly accessible
- Verify `usageRecords` row written with `source: "vision"`

### Cost regression

In `pdf-extract.test.ts`: assert that a 10-page text-heavy fixture stays under $0.005 total. Catches accidental "vision-on-every-page" regressions.

---

## Risks & open questions

These are flagged for the implementation plan, not for this design:

1. **Sendblue webhook payload for inbound MMS.** Field names (`media_url` single vs. `media_urls` array vs. nested `attachments[]`) need confirmation against current Sendblue docs. The plan's first task includes a docs fetch + a real-MMS smoke; the destructure in `sendblue.ts` adapts to whatever shape comes back.
2. **`@napi-rs/canvas` install on Apple Silicon.** Ships prebuilt arm64 binaries; smoke as the first plan step (`npm install` + a one-line render test). Fallback if it fails: switch to `pdfjs-dist`'s built-in `NodeCanvasFactory` or extract via `pdftoppm` from `poppler-utils`.
3. **`pdfjs-dist` version pinning.** v4 changed the node init API. Plan should pin to a specific minor version known to work with our ESM setup.
4. **Convex storage cost & lifecycle.** Convex storage is metered and (by default) permanent — files persist until explicitly deleted. v1 doesn't add an auto-cleanup policy; for a personal-volume agent this is fine, but a follow-up should add a periodic prune job (e.g. drop attachments older than 90 days that aren't referenced by any pinned message). CHANGELOG entry should mention the new storage usage.
5. **HEIC support.** OpenAI's vision API accepts HEIC, but `pdfjs-dist`'s rendering doesn't matter here. Telegram converts iPhone photos to JPEG automatically; Sendblue MMS may pass HEIC through. Plan should include an HEIC fixture in tests.

---

## Out of scope (explicitly punted)

- Multimodal LLM input on dispatcher or sub-agents.
- A new `analyze_image(attachmentId)` tool exposed to sub-agents.
- Preview thumbnails in the debug dashboard.
- Image editing or outbound image generation (existing `pdfArtifacts` path is untouched).
- Memory recall over attachment contents.
- Telegram group/channel handling (still rejected at `chat_id < 0`).
- Inbound video, audio files, GIFs, stickers (polite "not supported" reply only).
- Captions in non-Latin scripts requiring transliteration before description (vision model handles them natively in v1).
