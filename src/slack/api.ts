import type { WebClient } from "@slack/web-api";

export interface SlackApi {
  postMessage(args: { channel: string; threadTs?: string; text: string; blocks?: unknown[] }): Promise<{ ts?: string }>;
  updateMessage(args: { channel: string; ts: string; text: string; blocks?: unknown[] }): Promise<void>;
  userProfile(userId: string): Promise<{ name?: string; email?: string }>;
  threadReplies(channel: string, threadTs: string): Promise<Array<{ user?: string; text: string; botId?: string }>>;
  postEphemeral?(args: { channel: string; userId: string; threadTs?: string; text: string; blocks?: unknown[] }): Promise<{ ts?: string }>;
  permalink?(channel: string, messageTs: string): Promise<string | undefined>;
}

export function slackFromWebClient(client: WebClient): SlackApi {
  return {
    async postMessage(args) {
      const result = await client.chat.postMessage({
        channel: args.channel,
        thread_ts: args.threadTs,
        text: args.text.slice(0, 4000),
        blocks: args.blocks as never,
      });
      return { ts: result.ts };
    },
    async updateMessage(args) {
      await client.chat.update({
        channel: args.channel,
        ts: args.ts,
        text: args.text.slice(0, 4000),
        blocks: args.blocks as never,
      });
    },
    async userProfile(userId) {
      try {
        const info = await client.users.info({ user: userId });
        const profile = info.user?.profile;
        return {
          name: profile?.real_name || info.user?.real_name || info.user?.name,
          email: profile?.email,
        };
      } catch (error) {
        console.error(JSON.stringify({ msg: "slack_user_lookup_failed", error: error instanceof Error ? error.message : "unknown" }));
        return {};
      }
    },
    async postEphemeral(args) {
      const result = await client.chat.postEphemeral({
        channel: args.channel,
        user: args.userId,
        thread_ts: args.threadTs,
        text: args.text.slice(0, 4000),
        blocks: args.blocks as never,
      });
      return { ts: result.message_ts };
    },
    async permalink(channel, messageTs) {
      try {
        const result = await client.chat.getPermalink({ channel, message_ts: messageTs });
        return result.permalink;
      } catch (error) {
        console.error(JSON.stringify({ msg: "slack_permalink_failed", error: error instanceof Error ? error.message : "unknown" }));
        return undefined;
      }
    },
    async threadReplies(channel, threadTs) {
      try {
        const replies = await client.conversations.replies({ channel, ts: threadTs, limit: 30 });
        return (replies.messages ?? []).map((message) => ({
          user: message.user,
          text: message.text ?? "",
          botId: message.bot_id,
        }));
      } catch (error) {
        console.error(JSON.stringify({ msg: "slack_thread_read_failed", error: error instanceof Error ? error.message : "unknown" }));
        return [];
      }
    },
  };
}
