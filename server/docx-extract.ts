import mammoth from "mammoth";

/** Cap for extracted text. Above this we truncate with a marker. */
export const MAX_DOCX_TEXT_BYTES = 200 * 1024;

export interface DocxExtractResult {
  /** Extracted plain text. Truncated at MAX_DOCX_TEXT_BYTES if needed. */
  text: string;
  /** Always 0 — mammoth runs locally; no API spend. */
  costUsd: 0;
  /** True iff the source text exceeded MAX_DOCX_TEXT_BYTES and was truncated. */
  truncated: boolean;
  /** Total byte length of the extracted text BEFORE truncation. */
  totalBytes: number;
}

/**
 * Extract plain text from a .docx (Word) file via mammoth. Truncates at
 * 200 KB with a `[truncated — first 200 KB of N KB]` marker. Throws on
 * structural failure (corrupt zip, missing required parts).
 */
export async function extractDocx(bytes: Buffer): Promise<DocxExtractResult> {
  let raw: { value: string };
  try {
    raw = await mammoth.extractRawText({ buffer: bytes });
  } catch (err) {
    throw new Error(`docx extraction failed: ${(err as Error).message}`);
  }

  const fullBytes = Buffer.byteLength(raw.value, "utf8");
  if (fullBytes <= MAX_DOCX_TEXT_BYTES) {
    return {
      text: raw.value,
      costUsd: 0,
      truncated: false,
      totalBytes: fullBytes,
    };
  }

  // Truncate by character count to roughly half the byte limit (utf8 worst case
  // is 4 bytes per char), then add a marker. This is conservative — real docx
  // text is typically 1–2 bytes/char so we'll usually stop well below the cap.
  const truncatedText = raw.value.slice(0, Math.floor(MAX_DOCX_TEXT_BYTES / 2));
  const totalKb = Math.round(fullBytes / 1024);
  return {
    text: `${truncatedText}\n\n[truncated — first 200 KB of ${totalKb} KB]`,
    costUsd: 0,
    truncated: true,
    totalBytes: fullBytes,
  };
}
