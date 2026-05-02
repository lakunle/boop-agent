import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../convex/_generated/dataModel.js";
import { api } from "../convex/_generated/api.js";
import { describeImage, type VisionResult, type VisionOptions } from "./vision.js";
import { extractPdf, type PdfExtractResult } from "./pdf-extract.js";
import { extractDocx, type DocxExtractResult } from "./docx-extract.js";

export type AttachmentKind = "image" | "pdf" | "doc";

export interface ResolvedAttachment {
  kind: AttachmentKind;
  mimeType: string;
  sizeBytes: number;
  storageId: Id<"_storage">;
  signedUrl: string;
  description: string;
  filename?: string;
  costUsd: number;
  /** The model/tool used to extract the description. "gpt-4o" (or override)
   *  for images, "pdfjs+vision" for PDFs that hit selective vision rendering,
   *  "pdfjs" for text-heavy PDFs that never called vision, "mammoth" for docx,
   *  undefined for raw text/markdown reads. Used by usageRecords aggregation. */
  model?: string;
}

export interface AttachmentError {
  __error: true;
  userMessage: string;
  serverError: Error;
}

export function isAttachmentError(
  v: ResolvedAttachment | AttachmentError,
): v is AttachmentError {
  return (v as AttachmentError).__error === true;
}

/**
 * Try to detect a file's true mime type from its first bytes. Returns null
 * if no signature matches. Useful when the channel-provided content-type
 * is `application/octet-stream` (Telegram's CDN does this for photos
 * occasionally) or otherwise wrong.
 *
 * Covers the formats this resolver actually supports — keep in sync with
 * SUPPORTED_*_MIMES below.
 */
function sniffMime(bytes: Buffer): string | null {
  if (bytes.length < 4) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) return "image/png";

  // GIF: 47 49 46 38 (GIF8)
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
  ) return "image/gif";

  // WEBP: RIFF....WEBP — 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";

  // HEIC / HEIF: 00 00 00 ?? 66 74 79 70 (ftyp box) followed by a HEIC brand
  // (heic, heix, hevc, mif1, msf1, heim, heis, hevm, hevs)
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  ) {
    const brand = bytes.slice(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "mif1", "msf1", "heim", "heis", "hevm", "hevs"].includes(brand)) {
      return "image/heic";
    }
  }

  // PDF: 25 50 44 46 2D (%PDF-)
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) return "application/pdf";

  // ZIP-like (DOCX is a zip): 50 4B 03 04 OR 50 4B 05 06 (empty) OR 50 4B 07 08 (spanned)
  if (
    bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
     (bytes[2] === 0x05 && bytes[3] === 0x06) ||
     (bytes[2] === 0x07 && bytes[3] === 0x08))
  ) {
    // Note: this could be ANY zip (jar, xlsx, odt, etc.). The DOCX-specific
    // structure check would require unpacking [Content_Types].xml. For our
    // purposes we trust the channel's filename hint downstream — return the
    // docx mime here only when nothing else matched.
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return null;
}

export const ATTACHMENT_LIMITS = {
  maxImageBytes: 20 * 1024 * 1024,
  maxPdfBytes: 20 * 1024 * 1024,
  maxTextBytes: 200 * 1024,
  maxPdfPages: 20,
  perMessageVisionCostCapUsd: 1.5,
} as const;

function getCostCapUsd(): number {
  const fromEnv = process.env.BOOP_VISION_COST_CAP_USD;
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    console.warn(
      `[attachments] invalid BOOP_VISION_COST_CAP_USD=${fromEnv} — using default ${ATTACHMENT_LIMITS.perMessageVisionCostCapUsd}`,
    );
  }
  return ATTACHMENT_LIMITS.perMessageVisionCostCapUsd;
}

export const SUPPORTED_IMAGE_MIMES = new Set([
  "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/gif",
]);
export const SUPPORTED_PDF_MIMES = new Set(["application/pdf"]);
export const SUPPORTED_TEXT_MIMES = new Set(["text/plain", "text/markdown"]);
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// --- test injection points ---

interface StorageImpl {
  upload(
    bytes: Buffer,
    mimeType: string,
    filename: string | undefined,
  ): Promise<{ storageId: Id<"_storage">; signedUrl: string }>;
}

let _convexClient: ConvexHttpClient | null = null;
function getConvexClient(): ConvexHttpClient {
  if (!_convexClient) {
    const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
    if (!url) throw new Error("CONVEX_URL not set");
    _convexClient = new ConvexHttpClient(url);
  }
  return _convexClient;
}

let storageImpl: StorageImpl = {
  async upload(bytes, mimeType, _filename) {
    const client = getConvexClient();
    const uploadUrl = await client.mutation(api.attachmentStorage.generateUploadUrl, {});
    const putRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": mimeType },
      body: new Uint8Array(bytes),
    });
    if (!putRes.ok) {
      throw new Error(
        `storage PUT failed ${putRes.status}: ${await putRes.text().catch(() => "")}`,
      );
    }
    const { storageId } = (await putRes.json()) as { storageId: Id<"_storage"> };
    const recorded = await client.mutation(api.attachmentStorage.recordUploaded, {
      storageId,
      mimeType,
      sizeBytes: bytes.length,
    });
    return { storageId: recorded.storageId, signedUrl: recorded.signedUrl };
  },
};

let visionImpl: typeof describeImage = describeImage;
let extractorsImpl = {
  pdf: extractPdf,
  docx: extractDocx,
};

export function __setStorageForTesting(s: StorageImpl): void { storageImpl = s; }
export function __setVisionForTesting(v: typeof describeImage): void { visionImpl = v; }
export function __setExtractorsForTesting(
  e: { pdf?: typeof extractPdf; docx?: typeof extractDocx },
): void {
  if (e.pdf) extractorsImpl.pdf = e.pdf;
  if (e.docx) extractorsImpl.docx = e.docx;
}

const _defaultStorage = storageImpl;
const _defaultVision = visionImpl;
const _defaultExtractors: { pdf: typeof extractPdf; docx: typeof extractDocx } = {
  pdf: extractPdf,
  docx: extractDocx,
};

export function __resetStorageForTesting(): void { storageImpl = _defaultStorage; }
export function __resetVisionForTesting(): void { visionImpl = _defaultVision; }
export function __resetExtractorsForTesting(): void {
  extractorsImpl = { ..._defaultExtractors };
}

// --- main ---

function err(userMessage: string, serverError: Error): AttachmentError {
  return { __error: true, userMessage, serverError };
}

function megabytes(n: number): string {
  return (n / (1024 * 1024)).toFixed(1);
}

/**
 * Resolve an inbound attachment: validate, upload bytes to Convex storage,
 * extract a textual description via the right extractor (vision/pdf/docx),
 * and return either a ResolvedAttachment or a polite-user-message error.
 *
 * IMPORTANT: This function does NOT write a `usageRecords` row. The caller
 * (channel handler) is responsible for recording usage after a successful
 * resolution, using `result.costUsd` and the appropriate `source` literal:
 * - `"vision"` for image kind
 * - `"pdf-extract"` for pdf kind
 * - `"docx-extract"` for doc kind (regardless of .docx vs .txt vs .md sub-type)
 *
 * Pattern reference: server/channels/telegram.ts handles voice notes the
 * same way — transcribe.ts produces costUsd, the channel writes the row.
 *
 * The `source` parameter on this function ("telegram" | "sendblue") is
 * reserved for future per-channel routing decisions; currently unused.
 * Channel handlers should pass their channel id; tests pass either value.
 */
export async function resolveAttachment(
  bytes: Buffer,
  mimeType: string,
  filename: string | undefined,
  source: "telegram" | "sendblue",
): Promise<ResolvedAttachment | AttachmentError> {
  const sizeBytes = bytes.length;

  // If the channel-declared mime doesn't match any supported set, try
  // sniffing the actual bytes. Telegram's CDN sometimes serves photos as
  // application/octet-stream; this recovers gracefully.
  let effectiveMime = mimeType;
  const isKnown = (m: string) =>
    SUPPORTED_IMAGE_MIMES.has(m) || SUPPORTED_PDF_MIMES.has(m) ||
    SUPPORTED_TEXT_MIMES.has(m) || m === DOCX_MIME;

  if (!isKnown(effectiveMime)) {
    const sniffed = sniffMime(bytes);
    if (sniffed && isKnown(sniffed)) {
      console.log(
        `[attachments] sniffed mime ${sniffed} (declared was ${mimeType}, ${source})`,
      );
      effectiveMime = sniffed;
    }
  }

  let kind: AttachmentKind | null = null;
  let cap = 0;
  let typeLabel = "";

  if (SUPPORTED_IMAGE_MIMES.has(effectiveMime)) {
    kind = "image"; cap = ATTACHMENT_LIMITS.maxImageBytes; typeLabel = "image";
  } else if (SUPPORTED_PDF_MIMES.has(effectiveMime)) {
    kind = "pdf"; cap = ATTACHMENT_LIMITS.maxPdfBytes; typeLabel = "PDF";
  } else if (SUPPORTED_TEXT_MIMES.has(effectiveMime) || effectiveMime === DOCX_MIME) {
    kind = "doc"; cap = ATTACHMENT_LIMITS.maxTextBytes; typeLabel = "file";
  } else {
    return err(
      `I don't read that file type yet (${mimeType}). I can see photos (JPG/PNG/HEIC/WEBP/GIF), PDFs, and .txt/.md/.docx. Want to send it differently?`,
      new Error(`unsupported mime: ${mimeType}`),
    );
  }

  if (sizeBytes > cap) {
    return err(
      `That ${typeLabel} is ${megabytes(sizeBytes)} MB — I can only handle up to ${megabytes(cap)} MB. Try a smaller copy or split it.`,
      new Error(`size ${sizeBytes} > cap ${cap}`),
    );
  }

  // 1. Upload first so the bytes are durable even if extraction blows up.
  let stored: { storageId: Id<"_storage">; signedUrl: string };
  try {
    stored = await storageImpl.upload(bytes, effectiveMime, filename);
  } catch (e) {
    return err(
      `Couldn't save that attachment — try again in a moment?`,
      e as Error,
    );
  }

  // 2. Run the right extractor.
  let description = "";
  let costUsd = 0;
  let modelUsed: string | undefined;

  try {
    if (kind === "image") {
      const v = await visionImpl(bytes, effectiveMime);
      description = v.description;
      costUsd = v.costUsd;
      modelUsed = v.model;  // surface the actual model from VisionResult
    } else if (kind === "pdf") {
      const r = await extractorsImpl.pdf(bytes, getCostCapUsd());
      description = r.description +
        (r.truncatedReason === "cost-cap"
          ? `\n\n_(stopped at page ${r.pagesProcessed}/${r.pagesTotal} — costs were getting steep, send a tighter slice if you want the rest.)_`
          : r.truncatedReason === "page-cap"
            ? `\n\n_(processed first ${r.pagesProcessed} of ${r.pagesTotal} pages.)_`
            : "");
      costUsd = r.costUsd;
      // PDFs that triggered any vision call have non-zero cost; reflect that
      // in the model name. PDFs handled purely by text extraction get "pdfjs".
      modelUsed = r.costUsd > 0 ? "pdfjs+vision" : "pdfjs";
    } else {
      // kind === "doc"
      if (effectiveMime === DOCX_MIME) {
        const r = await extractorsImpl.docx(bytes);
        description = r.text;
        costUsd = 0;
        modelUsed = "mammoth";
      } else {
        // text/plain or text/markdown — see Fix I4 for byte-aware truncation
        const decoded = bytes.toString("utf-8");
        const fullByteLen = Buffer.byteLength(decoded, "utf-8");
        if (fullByteLen <= ATTACHMENT_LIMITS.maxTextBytes) {
          description = decoded;
        } else {
          // Conservative slice for utf-8 worst case (2 bytes/char), matching
          // docx-extract.ts. CJK-heavy text may slightly overshoot but the
          // truncation is bounded; the marker below is accurate.
          const truncated = decoded.slice(0, Math.floor(ATTACHMENT_LIMITS.maxTextBytes / 2));
          const totalKb = Math.round(fullByteLen / 1024);
          const capKb = Math.round(ATTACHMENT_LIMITS.maxTextBytes / 1024);
          description = `${truncated}\n\n[truncated — first ${capKb} KB of ${totalKb} KB]`;
        }
        costUsd = 0;
        // raw text reads — leave modelUsed undefined; the usage row uses a fallback.
      }
    }
  } catch (e) {
    const msg =
      kind === "image"
        ? "Trouble looking at that image — mind retrying or describing it in text?"
        : kind === "pdf"
          ? "That PDF wouldn't open on my end. Try re-exporting it or send screenshots?"
          : "Couldn't read that document — try exporting as PDF or .txt?";
    return err(msg, e as Error);
  }

  return {
    kind,
    mimeType: effectiveMime,
    sizeBytes,
    storageId: stored.storageId,
    signedUrl: stored.signedUrl,
    description,
    filename,
    costUsd,
    model: modelUsed,
  };
}
