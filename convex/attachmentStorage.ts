// convex/attachmentStorage.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Step 1 of upload: client requests a one-time URL to PUT raw bytes to.
 * The returned URL is good for one upload; client follows it with a PUT
 * containing the file body, and the response includes a `storageId` to
 * pass back to recordUploaded below.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Step 2 of upload: client tells us "the bytes are at this storageId now".
 * We sign a public URL via getUrl() and return it together with the
 * descriptor metadata. Mirrors the pattern in convex/pdfArtifacts.ts.
 *
 * Note: Convex storage URLs are stable for the lifetime of the stored
 * object; this is NOT a TTL-bounded signed URL. If a URL stops resolving
 * for any reason, re-sign via getSignedUrl below.
 */
export const recordUploaded = mutation({
  args: {
    storageId: v.id("_storage"),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.sizeBytes <= 0 || !Number.isFinite(args.sizeBytes)) {
      throw new Error(
        `attachmentStorage.recordUploaded: sizeBytes must be a positive finite number (got ${args.sizeBytes})`,
      );
    }
    if (!args.mimeType) {
      throw new Error(
        "attachmentStorage.recordUploaded: mimeType must not be empty",
      );
    }
    const signedUrl = await ctx.storage.getUrl(args.storageId);
    if (!signedUrl) {
      throw new Error(
        `attachmentStorage.recordUploaded: storage.getUrl returned null after store (storageId=${args.storageId})`,
      );
    }
    return {
      storageId: args.storageId,
      signedUrl,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
    };
  },
});

/**
 * Re-sign a stored attachment URL on demand. Use this if a cached signedUrl
 * stops resolving — Convex storage URLs are stable but nothing is forever.
 */
export const getSignedUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId);
  },
});
