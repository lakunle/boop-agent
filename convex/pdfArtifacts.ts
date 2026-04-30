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

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
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
    const pdfBytes = base64ToUint8Array(args.pdfBase64);
    const thumbBytes = base64ToUint8Array(args.thumbnailBase64);
    const pdfBlob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
    const thumbBlob = new Blob([thumbBytes.buffer as ArrayBuffer], { type: "image/png" });

    const storageId = await ctx.storage.store(pdfBlob);
    const thumbnailStorageId = await ctx.storage.store(thumbBlob);

    // ctx.storage.getUrl returns null only if the file doesn't exist — which
    // shouldn't happen since we just stored it. If it does, that's a real
    // failure (storage broken, file gone) and we should surface it instead
    // of silently caching an empty URL that breaks the iMessage attachment.
    const signedUrl = await ctx.storage.getUrl(storageId);
    const thumbnailUrl = await ctx.storage.getUrl(thumbnailStorageId);
    if (!signedUrl || !thumbnailUrl) {
      throw new Error(
        `pdfArtifacts.generate: storage.getUrl returned null after store (signedUrl=${!!signedUrl}, thumbnailUrl=${!!thumbnailUrl})`,
      );
    }

    const artifactId: string = await ctx.runMutation(
      internal.pdfArtifacts.createInternal,
      {
        artifactId: randomArtifactId(),
        conversationId: args.conversationId,
        kind: args.kind,
        filename: args.filename,
        storageId,
        thumbnailStorageId,
        fileSizeBytes: pdfBytes.byteLength,
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
      fileSizeBytes: pdfBytes.byteLength,
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
