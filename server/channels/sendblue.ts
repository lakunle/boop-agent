import type { Channel, ChannelId, ConversationId, SendOpts } from "./types.js";
import { stripChannelPrefix } from "./types.js";
import {
  sendImessage,
  startTypingLoop as startSendblueTypingLoop,
  createSendblueRouter,
} from "../sendblue.js";

export const sendblueChannel: Channel = {
  id: "sms" as ChannelId,
  label: "Sendblue (iMessage)",
  webhookPath: "/sendblue",

  isConfigured(): boolean {
    return Boolean(process.env.SENDBLUE_API_KEY && process.env.SENDBLUE_API_SECRET);
  },

  async send(conversationId: ConversationId, text: string, opts: SendOpts = {}): Promise<void> {
    const number = stripChannelPrefix(conversationId);
    await sendImessage(number, text, opts);
  },

  startTypingLoop(conversationId: ConversationId): () => void {
    const number = stripChannelPrefix(conversationId);
    return startSendblueTypingLoop(number);
  },

  webhookRouter() {
    return createSendblueRouter();
  },
};
