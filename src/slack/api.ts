import type { WebClient } from "@slack/web-api";

export interface SlackFileRef {
  id?: string;
  name?: string | null;
  permalink?: string;
  mimetype?: string;
}

export interface SlackThreadMessage {
  ts?: string;
  user?: string;
  text: string;
  botId?: string;
  files?: SlackFileRef[];
}

export interface SlackApi {
  postMessage(args: { channel: string; threadTs?: string; text: string; blocks?: unknown[] }): Promise<{ ts?: string }>;
  /** Direct message, used to send rush approval buttons to DeeDee and Koral. */
  postDm?(args: { userId: string; text: string; blocks?: unknown[] }): Promise<void>;
  updateMessage(args: { channel: string; ts: string; text: string; blocks?: unknown[] }): Promise<void>;
  userProfile(userId: string): Promise<{ name?: string; email?: string }>;
  /** Resolve a requester email to a Slack member. Absent when the workspace has no match. */
  userByEmail?(email: string): Promise<{ id: string; name?: string } | undefined>;
  threadReplies(channel: string, threadTs: string): Promise<SlackThreadMessage[]>;
  /** One channel message, used when conversations.replies does not include the parent file. */
  historyMessage?(channel: string, ts: string): Promise<SlackThreadMessage | null>;
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
    async postDm(args) {
      const opened = await client.conversations.open({ users: args.userId });
      const channel = opened.channel && typeof opened.channel === "object" && "id" in opened.channel
        ? opened.channel.id
        : undefined;
      if (!channel) throw new Error(`Could not open a direct message with ${args.userId}.`);
      await client.chat.postMessage({
        channel,
        text: args.text.slice(0, 4000),
        blocks: args.blocks as never,
      });
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
    async userByEmail(email) {
      try {
        const info = await client.users.lookupByEmail({ email });
        const user = info.user;
        if (!user?.id) return undefined;
        return {
          id: user.id,
          name: user.profile?.real_name || user.real_name || user.name,
        };
      } catch (error) {
        const code = error && typeof error === "object" && "data" in error
          ? String((error as { data?: { error?: string } }).data?.error ?? "")
          : "";
        if (code !== "users_not_found") {
          console.error(JSON.stringify({
            msg: "slack_email_lookup_failed",
            error: error instanceof Error ? error.message : "unknown",
          }));
        }
        return undefined;
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
        const replies = await client.conversations.replies({ channel, ts: threadTs, limit: 200 });
        return (replies.messages ?? []).map(mapThreadMessage);
      } catch (error) {
        console.error(JSON.stringify({ msg: "slack_thread_read_failed", error: error instanceof Error ? error.message : "unknown" }));
        return [];
      }
    },
    async historyMessage(channel, ts) {
      try {
        const history = await client.conversations.history({
          channel,
          latest: ts,
          oldest: ts,
          inclusive: true,
          limit: 1,
        });
        const message = history.messages?.[0];
        return message ? mapThreadMessage(message) : null;
      } catch (error) {
        console.error(JSON.stringify({ msg: "slack_history_read_failed", error: error instanceof Error ? error.message : "unknown" }));
        return null;
      }
    },
  };
}

function mapThreadMessage(message: {
  ts?: string;
  user?: string;
  text?: string;
  bot_id?: string;
  files?: Array<{ id?: string; name?: string | null; permalink?: string; mimetype?: string }>;
}): SlackThreadMessage {
  return {
    ts: message.ts,
    user: message.user,
    text: message.text ?? "",
    botId: message.bot_id,
    files: message.files,
  };
}
