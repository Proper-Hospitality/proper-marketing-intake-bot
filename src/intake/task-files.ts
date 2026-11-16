import { listTaskAttachmentNames, uploadTaskAttachment, userFacingAsanaError } from "./asana.js";
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

export interface AttachmentFailure {
  name: string;
  link?: string;
}

export interface LoadedSlackFiles {
  loaded: LoadedAttachment[];
  failed: AttachmentFailure[];
}

export function failedAttachmentLine(failed: AttachmentFailure[]): string {
  const parts = failed.map((file) => file.link ? `${file.name} ${file.link}` : file.name);
  return `Attachments (upload failed): ${parts.join(", ")}`;
}

/** Download Slack files with the bot token. The bytes are uploaded onto the task. */
export async function loadSlackAttachments(input: {
  draft: BriefDraft;
  slackToken?: string;
  fetchImpl?: typeof fetch;
  alreadyUploaded?: string[];
}): Promise<LoadedSlackFiles> {
  if (!input.slackToken) return { loaded: [], failed: [] };
  const skip = new Set(input.alreadyUploaded ?? []);
  const loaded: LoadedAttachment[] = [];
  const failed: AttachmentFailure[] = [];
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
      if (!file.ref || /slack\.com\/files/i.test(file.ref)) file.ref = file.name || file.ref;
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
      failed.push({
        name: file.name || file.fileName || "attachment",
        link: file.permalink,
      });
    }
  }
  return { loaded, failed };
}

export async function uploadLoadedAttachments(input: {
  taskGid: string;
  asanaToken: string;
  files: LoadedAttachment[];
  fetchImpl?: typeof fetch;
}): Promise<{ uploaded: string[]; failed: AttachmentFailure[] }> {
  if (input.files.length === 0) return { uploaded: [], failed: [] };
  const uploaded: string[] = [];
  const failed: AttachmentFailure[] = [];
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
      const reason = userFacingAsanaError(error);
      console.error(JSON.stringify({ msg: "asana_attachment_failed", fileId: file.slackFileId, error: reason }));
      failed.push({ name: file.name, link: file.permalink });
    }
  }
  return { uploaded, failed };
}

function normalizeFileName(name: string | undefined): string {
  return name?.trim().toLowerCase() ?? "";
}

export type { TurnAttachment };
