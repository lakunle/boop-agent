// server/channels/attachment-helpers.ts
//
// Channel-agnostic helpers that consume the resolveAttachment result and
// either format it into a user-message body block or write a usageRecords
// row. Shared between server/channels/telegram.ts and server/sendblue.ts.

import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import type { ResolvedAttachment } from "../attachments.js";
import type { ConversationId } from "./types.js";

/**
 * Strip runtime-only fields from a ResolvedAttachment to produce the
 * shape persisted on a message row. The channel handler passes the
 * result via ParsedInbound.attachments → messages.send.attachments.
 */
export function toPersistedAttachment(r: ResolvedAttachment): {
  kind: typeof r.kind;
  mimeType: string;
  sizeBytes: number;
  storageId: typeof r.storageId;
  signedUrl?: string;
  description?: string;
  filename?: string;
} {
  return {
    kind: r.kind,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    storageId: r.storageId,
    signedUrl: r.signedUrl,
    description: r.description,
    filename: r.filename,
  };
}

/**
 * Compose the structured user-message block for a single resolved attachment.
 * Matches the spec's "User-message format" section: header → caption →
 * filename → description → link, separated by blank lines.
 */
export function formatAttachmentBlock(
  resolved: ResolvedAttachment,
  index: number | null,
  total: number,
  caption: string | undefined,
): string {
  const emoji = resolved.kind === "image" ? "🖼️" : resolved.kind === "pdf" ? "📄" : "📎";
  const label =
    resolved.kind === "image"
      ? "image"
      : resolved.kind === "pdf"
        ? "PDF"
        : "file";
  const counter = index !== null && total > 1 ? ` ${index + 1}/${total}` : "";
  return [
    `${emoji} (${label} attached${counter})`,
    caption ? `Caption: ${caption}` : null,
    resolved.filename ? `Filename: ${resolved.filename}` : null,
    `Description: ${resolved.description}`,
    `Link: ${resolved.signedUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Record the usage row after a successful resolveAttachment call. Mirrors
 * the voice-note usage recording pattern in server/channels/telegram.ts.
 * Fire-and-forget — failures are logged but don't block the turn.
 */
export async function recordAttachmentUsage(
  resolved: ResolvedAttachment,
  conversationId: ConversationId,
  channelLabel: string,
): Promise<void> {
  const source =
    resolved.kind === "image"
      ? "vision"
      : resolved.kind === "pdf"
        ? "pdf-extract"
        : "docx-extract";
  await convex
    .mutation(api.usageRecords.record, {
      source,
      conversationId,
      // Prefer the surfaced model from the resolver (e.g. "gpt-4o" for vision
      // including BOOP_VISION_MODEL override; "pdfjs" / "pdfjs+vision" for PDFs;
      // "mammoth" for docx). Falls back to the source name for raw text reads.
      model: resolved.model ?? source,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: resolved.costUsd,
      durationMs: 0,
    })
    .catch((err) =>
      console.warn(`[${channelLabel}] attachment usage record failed`, err),
    );
}
