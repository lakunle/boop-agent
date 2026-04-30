import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** True if the chat_id is in the dynamic Convex allowlist (env-var allowlist is checked separately in server code). */
export const isAllowed = query({
  args: { chatId: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("telegramAllowedChatIds")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    return Boolean(row);
  },
});

/** Record a rejected chat_id for later approval. Updates lastSeenAt + attemptCount on repeat attempts. */
export const recordPending = mutation({
  args: {
    chatId: v.number(),
    username: v.optional(v.string()),
    firstName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("telegramPendingAllowlist")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenAt: now,
        attemptCount: existing.attemptCount + 1,
        // Refresh username/firstName in case the user changed them.
        username: args.username ?? existing.username,
        firstName: args.firstName ?? existing.firstName,
      });
      return;
    }
    await ctx.db.insert("telegramPendingAllowlist", {
      chatId: args.chatId,
      username: args.username,
      firstName: args.firstName,
      firstSeenAt: now,
      lastSeenAt: now,
      attemptCount: 1,
    });
  },
});

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("telegramPendingAllowlist")
      .order("desc")
      .collect();
  },
});

/** Approve a pending chat_id: add to allowed table, remove from pending. */
export const allow = mutation({
  args: { chatId: v.number() },
  handler: async (ctx, args) => {
    const existingAllowed = await ctx.db
      .query("telegramAllowedChatIds")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (!existingAllowed) {
      await ctx.db.insert("telegramAllowedChatIds", {
        chatId: args.chatId,
        approvedAt: Date.now(),
      });
    }
    const pending = await ctx.db
      .query("telegramPendingAllowlist")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (pending) await ctx.db.delete(pending._id);
  },
});

/** Drop a pending chat_id without approving. */
export const dismiss = mutation({
  args: { chatId: v.number() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("telegramPendingAllowlist")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .unique();
    if (pending) await ctx.db.delete(pending._id);
  },
});
