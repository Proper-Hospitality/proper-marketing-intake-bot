import { FORM_URL } from "./catalog.js";
import { loadSlackAttachments, uploadLoadedAttachments } from "./task-files.js";
import { taskName } from "./brief.js";
import type { TurnAttachment } from "./capture.js";
import { rememberAttachment } from "./capture.js";
import type { ConversationState } from "../store/types.js";

/**
 * A thread that already has an Asana task. Never claim the brief is still
 * waiting on Confirm, and never swap in the intake form for a link they gave.
 */
export async function replyToFiledThread(input: {
  state: ConversationState;
  userText: string;
  attachments?: TurnAttachment[];
  slackToken?: string;
  asanaToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const state = input.state;
  for (const file of input.attachments ?? []) rememberAttachment(state.draft, file);
  if (state.taskGid && input.asanaToken && input.slackToken) {
    const loaded = await loadSlackAttachments({
      draft: state.draft,
      slackToken: input.slackToken,
      fetchImpl: input.fetchImpl,
      alreadyUploaded: state.uploadedSlackFileIds,
    });
    const uploaded = await uploadLoadedAttachments({
      taskGid: state.taskGid,
      asanaToken: input.asanaToken,
      files: loaded,
      fetchImpl: input.fetchImpl,
    });
    if (uploaded.length > 0) {
      state.uploadedSlackFileIds = [...(state.uploadedSlackFileIds ?? []), ...uploaded];
    }
  }

  const label = taskName(state.draft).replace(/^,\s*/, "").trim() || "this request";
  const lines = [
    `This is already filed: *${label}*.`,
    state.taskUrl ?? "",
  ];
  const files = state.draft.attachments ?? [];
  if (files.length > 0) {
    const names = files.map((file) => file.name || file.fileName || file.ref || "file").join(", ");
    lines.push(files.length === 1 ? `${names} is included on that task.` : `${names} are included on that task.`);
  } else if (/\battach/i.test(input.userText)) {
    lines.push("I don't have a file from this thread to put on the task.");
  }
  const userForms = (state.draft.providedLinks ?? []).filter((link) => link !== FORM_URL);
  if (userForms.length > 0) {
    lines.push(`The link you provided stays ${userForms.join(", ")}.`);
  } else if (/\bintake form\b/i.test(input.userText)) {
    lines.push(`The intake form is ${FORM_URL}. This request is already filed at the link above.`);
  }
  return lines.filter(Boolean).join("\n");
}
