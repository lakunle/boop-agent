// convex/validators.ts
//
// Shared Convex validator shapes — extracted to keep schema.ts and mutation
// args in sync. If you add a field to an attachment, edit it here ONCE and
// both the schema (convex/schema.ts) and the messages:send args validator
// (convex/messages.ts) pick it up.

import { v } from "convex/values";

// All valid values for usageRecords.source. Add new literals here when a new
// model-calling module is introduced. Referenced from convex/schema.ts.
export const usageSourceValidator = v.union(
  v.literal("dispatcher"),
  v.literal("execution"),
  v.literal("extract"),
  v.literal("consolidation-proposer"),
  v.literal("consolidation-adversary"),
  v.literal("consolidation-judge"),
  v.literal("proactive"),
  v.literal("transcribe"),
  // inbound-attachment extractors (Task 10)
  v.literal("vision"),
  v.literal("pdf-extract"),
  v.literal("docx-extract"),
);

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
