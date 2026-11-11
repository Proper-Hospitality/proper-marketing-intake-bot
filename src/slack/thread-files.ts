import type { TurnAttachment } from "../intake/capture.js";
import type { SlackApi, SlackThreadMessage } from "./api.js";

export interface ThreadFileSource {
  ts?: string;
  files?: Array<{ id?: string; name?: string | null; permalink?: string; mimetype?: string }>;
}

/**
 * Files on the thread parent and on replies up through `throughTs`.
 * Slack file ids are kept once, parent first.
 */
export function filesFromThread(messages: ThreadFileSource[], throughTs?: string): TurnAttachment[] {
  const seen = new Set<string>();
  const files: TurnAttachment[] = [];
  messages.forEach((message, index) => {
    if (throughTs && message.ts && Number(message.ts) > Number(throughTs)) return;
    if (throughTs && !message.ts && index > 0) return;
    for (const file of message.files ?? []) {
      if (!file.id || seen.has(file.id)) continue;
      seen.add(file.id);
      files.push({
        slackFileId: file.id,
        name: file.name || undefined,
        permalink: file.permalink,
        mimetype: file.mimetype,
      });
    }
  });
  return files;
}

export function mergeThreadFiles(threadFiles: TurnAttachment[], current: TurnAttachment[]): TurnAttachment[] {
  const byId = new Map<string, TurnAttachment>();
  for (const file of [...threadFiles, ...current]) {
    const existing = byId.get(file.slackFileId);
    if (!existing) {
      byId.set(file.slackFileId, { ...file });
      continue;
    }
    byId.set(file.slackFileId, {
      slackFileId: file.slackFileId,
      name: file.name || existing.name,
      permalink: file.permalink || existing.permalink,
      mimetype: file.mimetype || existing.mimetype,
    });
  }
  return [...byId.values()];
}

/** Parent plus earlier replies. History is only used when replies omit the parent or its files. */
export async function collectThreadFiles(
  slack: Pick<SlackApi, "threadReplies" | "historyMessage">,
  channel: string,
  parentTs: string,
  throughTs?: string,
): Promise<TurnAttachment[]> {
  const replies = await slack.threadReplies(channel, parentTs);
  const parent = replies.find((message) => message.ts === parentTs);
  const messages: SlackThreadMessage[] = [...replies];
  if ((!parent || (parent.files?.length ?? 0) === 0) && slack.historyMessage) {
    const fromHistory = await slack.historyMessage(channel, parentTs);
    if (fromHistory && (fromHistory.files?.length ?? 0) > 0) {
      if (parent) parent.files = fromHistory.files;
      else messages.unshift(fromHistory);
    }
  }
  return filesFromThread(messages, throughTs);
}
