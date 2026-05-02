// pdfjs-dist's default entry expects a browser environment. The legacy build
// path provides a node-compatible ESM module. Types are re-exported from the
// main package, so we import from the legacy build and let TS resolve types
// via the main package's declarations.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { describeImage, type VisionResult, type VisionOptions } from "./vision.js";

export const MAX_PDF_PAGES = 20;
const MIN_TEXT_CHARS_FOR_TEXT_PATH = 100;

export interface PdfExtractResult {
  /** Concatenated per-page blocks. Each starts with `## Page N` or `## Page N (image)`. */
  description: string;
  /** Sum of vision costs across all pages this run. Always 0 for text-heavy PDFs. */
  costUsd: number;
  /** Number of pages we actually produced output for. */
  pagesProcessed: number;
  /** Total page count of the source PDF (may exceed MAX_PDF_PAGES). */
  pagesTotal: number;
  /** Set if processing stopped early. */
  truncatedReason?: "page-cap" | "cost-cap";
}

// Test-injection seam: tests replace this with a stub so they don't hit OpenAI.
type VisionFn = (
  bytes: Buffer,
  mime: string,
  options?: VisionOptions,
) => Promise<VisionResult>;
let visionImpl: VisionFn = describeImage;

export function __setVisionForTesting(fn: VisionFn): void {
  visionImpl = fn;
}

async function renderPageToPng(page: any): Promise<Buffer> {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");
  await page.render({
    canvasContext: ctx as any,
    viewport,
  }).promise;
  return canvas.toBuffer("image/png");
}

/**
 * Extract a PDF's content into a single description string. Text-heavy pages
 * use pdfjs's native text extraction (cheap, no API call). Image-heavy pages
 * (where extracted text is below the threshold) are rendered to PNG and
 * routed to OpenAI vision. Stops at MAX_PDF_PAGES or when accumulated vision
 * cost exceeds costCapUsd, whichever comes first.
 */
export async function extractPdf(
  bytes: Buffer,
  costCapUsd: number,
): Promise<PdfExtractResult> {
  let doc;
  try {
    // Cast to `any` to pass node-specific flags (`disableWorker`) that are not
    // in pdfjs-dist's TypeScript type declarations but are honoured at runtime.
    doc = await getDocument({
      data: new Uint8Array(bytes),
      // Node-required flags: no web worker, no font fetching, no eval.
      disableWorker: true,
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    } as any).promise;
  } catch (err) {
    throw new Error(`pdf parse failed: ${(err as Error).message}`);
  }

  const pagesTotal: number = doc.numPages;
  const limit = Math.min(pagesTotal, MAX_PDF_PAGES);
  const blocks: string[] = [];
  let costUsd = 0;
  let pagesProcessed = 0;
  let truncatedReason: PdfExtractResult["truncatedReason"];

  for (let n = 1; n <= limit; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const text = tc.items
      .map((it: any) => it.str ?? "")
      .join(" ")
      .trim();

    if (text.length >= MIN_TEXT_CHARS_FOR_TEXT_PATH) {
      blocks.push(`## Page ${n}\n${text}`);
      pagesProcessed++;
      continue;
    }

    // Image-only / scanned page: render to PNG, run vision.
    const png = await renderPageToPng(page);
    const visionResult = await visionImpl(png, "image/png", {
      pageContext: { page: n, total: pagesTotal },
    });
    costUsd += visionResult.costUsd;
    blocks.push(`## Page ${n} (image)\n${visionResult.description}`);
    pagesProcessed++;

    if (costUsd > costCapUsd) {
      truncatedReason = "cost-cap";
      break;
    }
  }

  if (!truncatedReason && pagesTotal > MAX_PDF_PAGES) {
    truncatedReason = "page-cap";
  }

  return {
    description: blocks.join("\n\n"),
    costUsd,
    pagesProcessed,
    pagesTotal,
    truncatedReason,
  };
}
