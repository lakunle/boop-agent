// convex/validators.ts
//
// Shared Convex validator shapes — extracted to keep schema.ts and mutation
// args in sync. If you add a field to an attachment, edit it here ONCE and
// both the schema (convex/schema.ts) and the messages:send args validator
// (convex/messages.ts) pick it up.

import { v } from "convex/values";

export const attachmentElementValidator = v.object({
  kind: v.union(v.literal("image"), v.literal("pdf"), v.literal("doc")),
  mimeType: v.string(),
  sizeBytes: v.number(),
  storageId: v.id("_storage"),
  signedUrl: v.optional(v.string()),
  description: v.optional(v.string()),
  filename: v.optional(v.string()),
});

export const attachmentsFieldValidator = v.optional(
  v.array(attachmentElementValidator),
);
