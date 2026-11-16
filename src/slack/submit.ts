import { addTaskComment, addTaskFollowers, createIntakeTask, userFacingAsanaError } from "../intake/asana.js";
import { searchWorkspaceUsers } from "../tasks/complete.js";
import { emailFallbackFile } from "../intake/email/attach.js";
import { failedAttachmentLine, loadSlackAttachments, uploadLoadedAttachments } from "../intake/task-files.js";
import { FORM_URL } from "../intake/catalog.js";
import { rushApproverFor, rushBlockedText } from "../intake/rush.js";
import { stripFileEcho } from "../intake/urls.js";
import { isReadyToConfirm } from "../intake/missing.js";
import { taskName } from "../intake/brief.js";
import type { ConversationState } from "../store/types.js";
import type { Store } from "../store/types.js";

async function addNamedFollowers(input: {
  token: string;
  taskGid: string;
  names: string[];
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (input.names.length === 0) return;
  try {
    const followers: string[] = [];
    for (const name of input.names) {
      if (name.includes("@")) {
        followers.push(name);
        continue;
      }
      const people = await searchWorkspaceUsers({
        token: input.token,
        query: name,
        fetchImpl: input.fetchImpl,
      });
      const match = people.find((person) => person.name.toLowerCase() === name.toLowerCase())
        ?? (people.length === 1 ? people[0] : undefined);
      if (match) followers.push(match.gid);
    }
    if (followers.length > 0) {
      await addTaskFollowers({
        token: input.token,
        taskGid: input.taskGid,
        followers,
        fetchImpl: input.fetchImpl,
      });
    }
  } catch (error) {
    console.error(JSON.stringify({ msg: "follower_add_failed", error: userFacingAsanaError(error) }));
  }
}

export class ConfirmationRequiredError extends Error {
  constructor() {
    super("Refusing to create an Asana task without explicit confirmation.");
    this.name = "ConfirmationRequiredError";
  }
}

export async function submitConfirmedBrief(input: {
  confirmed: boolean;
  version: number;
  state: ConversationState;
  store: Store;
  token: string;
  fetchImpl?: typeof fetch;
  slackThread?: string;
  slackToken?: string;
}): Promise<{ text: string }> {
  if (!input.confirmed) throw new ConfirmationRequiredError();
  const state = input.state;
  if (state.phase === "submitted" && state.taskUrl) {
    return { text: `This was already filed: ${state.taskUrl}` };
  }
  if (state.confirmVersion !== input.version) {
    return { text: "That confirm button is out of date. Ask for a fresh summary and use the new Confirm button." };
  }
  if (state.phase !== "awaiting_confirm" && !(state.taskGid && state.fieldsApplied < 3)) {
    return { text: "There's no brief waiting to be filed. Tell me what you need and I'll collect it first." };
  }
  if (state.draft.rushBlock && state.draft.rushApprovedFor !== state.draft.requestedCompletionDate) {
    return { text: rushBlockedText(rushApproverFor(state.draft.properties).name) };
  }
  if (!isReadyToConfirm(state.draft)) {
    return { text: "The brief is missing something, so I didn't create a task. Tell me what to change and I'll show a new summary." };
  }

  state.phase = "submitting";
  await input.store.saveConversation(state);
  try {
    const loaded = await loadSlackAttachments({
      draft: state.draft,
      slackToken: input.slackToken,
      fetchImpl: input.fetchImpl,
      alreadyUploaded: state.uploadedSlackFileIds,
    });
    const emailText = emailFallbackFile(
      state,
      loaded.loaded.map((file) => file.slackFileId),
      state.uploadedSlackFileIds ?? [],
    );
    const filesToUpload = emailText ? [...loaded.loaded, emailText] : loaded.loaded;
    const result = await createIntakeTask({
      draft: state.draft,
      templateOffer: state.templateOffer,
      slackThread: input.slackThread,
      token: input.token,
      existingTaskGid: state.taskGid,
      fieldsAlreadyApplied: state.taskGid ? state.fieldsApplied : 0,
      fetchImpl: input.fetchImpl,
      onProgress: async (progress) => {
        state.taskGid = progress.taskGid;
        state.fieldsApplied = progress.fieldsApplied;
        await input.store.saveConversation(state);
      },
    });
    state.phase = "submitted";
    state.taskGid = result.taskGid;
    state.taskUrl = result.permalinkUrl;
    state.fieldsApplied = 3;
    await addNamedFollowers({
      token: input.token,
      taskGid: result.taskGid,
      names: state.draft.alsoNotify ?? [],
      fetchImpl: input.fetchImpl,
    });
    if (state.draft.rushApprovedBy) {
      await addTaskComment({
        token: input.token,
        taskGid: result.taskGid,
        text: `Rush approved by ${state.draft.rushApprovedBy}`,
        fetchImpl: input.fetchImpl,
      });
    }
    const uploaded = await uploadLoadedAttachments({
      taskGid: result.taskGid,
      asanaToken: input.token,
      files: filesToUpload,
      fetchImpl: input.fetchImpl,
    });
    if (uploaded.uploaded.length > 0) {
      state.uploadedSlackFileIds = [...(state.uploadedSlackFileIds ?? []), ...uploaded.uploaded];
    }
    const failed = [...loaded.failed, ...uploaded.failed];
    if (failed.length > 0) {
      await addTaskComment({
        token: input.token,
        taskGid: result.taskGid,
        text: failedAttachmentLine(failed),
        fetchImpl: input.fetchImpl,
      });
    }
    await input.store.saveConversation(state);
    const attachedNames = (state.draft.attachments ?? [])
      .filter((file) => !file.slackFileId || (state.uploadedSlackFileIds ?? []).includes(file.slackFileId))
      .map(attachmentFileName)
      .filter((name): name is string => Boolean(name));
    return { text: filedConfirmation(state.draft, result.permalinkUrl, attachedNames) };
  } catch (error) {
    console.error(JSON.stringify({ msg: "asana_submit_failed", error: userFacingAsanaError(error) }));
    state.phase = state.taskGid ? "submitting" : "awaiting_confirm";
    await input.store.saveConversation(state);
    const created = state.taskUrl || (state.taskGid ? `https://app.asana.com/0/0/${state.taskGid}` : "");
    return {
      text: created
        ? `I created the Asana task but couldn't finish setting the fields, so the board automations may not have run. I stopped rather than guessing.\n${created}\n${userFacingAsanaError(error)}\nYou can press Confirm again to retry the remaining fields, or use the form: ${FORM_URL}`
        : `I couldn't file this in Asana. No task was created.\n${userFacingAsanaError(error)}\nYou can press Confirm to try again, or use the form: ${FORM_URL}`,
    };
  }
}

/** Slack confirmation: the task name, the Asana link, and filenames. No file URLs. */
export function filedConfirmation(draft: Parameters<typeof taskName>[0], taskUrl: string, attachedNames: string[]): string {
  const lines = [`Filed *${taskName(draft)}*`, taskUrl];
  const names = [...new Set(attachedNames.map((name) => stripFileEcho(name)).filter((name) => name && !/slack\.com\/files/i.test(name)))];
  if (names.length > 0) lines.push(`Attached: ${names.join(", ")}.`);
  return lines.join("\n");
}

function attachmentFileName(file: { name?: string; fileName?: string; ref?: string }): string | undefined {
  const named = [file.name, file.fileName].find((value) => value && !/^https?:\/\//i.test(value));
  if (!named) return undefined;
  const clean = stripFileEcho(named);
  return clean || undefined;
}
