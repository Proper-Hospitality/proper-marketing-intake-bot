import { addTaskComment, listTaskAttachmentNames, uploadTaskAttachment, userFacingAsanaError } from "./asana.js";
import type { TurnAttachment } from "./capture.js";
import { downloadSlackFile } from "../slack/files.js";
import type { BriefDraft } from "./types.js";

export interface LoadedAttachment {
  slackFileId: string;
  name: string;
  bytes: Uint8Array;
  mimetype?: string;
  permalink?: string;
}

/** Download Slack files so the task notes can include the permalink before create. */
export async function loadSlackAttachments(input: {
  draft: BriefDraft;
  slackToken?: string;
  fetchImpl?: typeof fetch;
  alreadyUploaded?: string[];
}): Promise<LoadedAttachment[]> {
  if (!input.slackToken) return [];
  const skip = new Set(input.alreadyUploaded ?? []);
  const loaded: LoadedAttachment[] = [];
  for (const file of input.draft.attachments ?? []) {
    if (!file.slackFileId || skip.has(file.slackFileId)) continue;
    try {
      const downloaded = await downloadSlackFile({
        token: input.slackToken,
        fileId: file.slackFileId,
        fetchImpl: input.fetchImpl,
      });
      file.name = downloaded.name || file.name;
      file.permalink = downloaded.permalink || file.permalink;
      file.mimetype = downloaded.mimetype || file.mimetype;
      if (!file.ref) file.ref = file.permalink || file.name;
      loaded.push({
        slackFileId: file.slackFileId,
        name: downloaded.name || file.name || "attachment",
        bytes: downloaded.bytes,
        mimetype: downloaded.mimetype || file.mimetype,
        permalink: downloaded.permalink || file.permalink,
      });
    } catch (error) {
      console.error(JSON.stringify({
        msg: "slack_attachment_download_failed",
        fileId: file.slackFileId,
        error: error instanceof Error ? error.message : "unknown",
      }));
    }
  }
  return loaded;
}

export async function uploadLoadedAttachments(input: {
  taskGid: string;
  asanaToken: string;
  files: LoadedAttachment[];
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  if (input.files.length === 0) return [];
  const uploaded: string[] = [];
  const namesOnTask = new Set<string>();
  try {
    for (const name of await listTaskAttachmentNames({
      token: input.asanaToken,
      taskGid: input.taskGid,
      fetchImpl: input.fetchImpl,
    })) {
      namesOnTask.add(normalizeFileName(name));
    }
  } catch (error) {
    console.error(JSON.stringify({
      msg: "asana_attachment_list_failed",
      taskGid: input.taskGid,
      error: userFacingAsanaError(error),
    }));
  }
  for (const file of input.files) {
    const nameKey = normalizeFileName(file.name);
    if (nameKey && namesOnTask.has(nameKey)) {
      uploaded.push(file.slackFileId);
      continue;
    }
    try {
      await uploadTaskAttachment({
        token: input.asanaToken,
        taskGid: input.taskGid,
        name: file.name,
        bytes: file.bytes,
        mimetype: file.mimetype,
        fetchImpl: input.fetchImpl,
      });
      uploaded.push(file.slackFileId);
      if (nameKey) namesOnTask.add(nameKey);
    } catch (error) {
      const link = file.permalink ? ` ${file.permalink}` : "";
      const reason = userFacingAsanaError(error);
      console.error(JSON.stringify({ msg: "asana_attachment_failed", fileId: file.slackFileId, error: reason }));
      try {
        await addTaskComment({
          token: input.asanaToken,
          taskGid: input.taskGid,
          text: `Slack file ${file.name}${link} could not be uploaded. ${reason}`,
          fetchImpl: input.fetchImpl,
        });
      } catch (commentError) {
        console.error(JSON.stringify({
          msg: "asana_attachment_comment_failed",
          error: commentError instanceof Error ? commentError.message : "unknown",
        }));
      }
    }
  }
  return uploaded;
}

function normalizeFileName(name: string | undefined): string {
  return name?.trim().toLowerCase() ?? "";
}

export type { TurnAttachment };
