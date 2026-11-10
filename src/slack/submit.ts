import { addTaskComment, createIntakeTask, userFacingAsanaError } from "../intake/asana.js";
import { FORM_URL, formatDisplayDate } from "../intake/catalog.js";
import { isReadyToConfirm } from "../intake/missing.js";
import { taskName } from "../intake/brief.js";
import type { ConversationState } from "../store/types.js";
import type { Store } from "../store/types.js";

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
    return { text: "That date needs approval from Koral Captain or DeeDee Brown before I can file it. Nothing was created." };
  }
  if (!isReadyToConfirm(state.draft)) {
    return { text: "The brief is missing something, so I didn't create a task. Tell me what to change and I'll show a new summary." };
  }

  state.phase = "submitting";
  await input.store.saveConversation(state);
  try {
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
    if (state.draft.rushApprovedBy) {
      await addTaskComment({
        token: input.token,
        taskGid: result.taskGid,
        text: `Rush approved by ${state.draft.rushApprovedBy}`,
        fetchImpl: input.fetchImpl,
      });
    }
    await input.store.saveConversation(state);
    const date = state.draft.requestedCompletionDate ? formatDisplayDate(state.draft.requestedCompletionDate) : "no date";
    const lines = [
      `Filed *${taskName(state.draft)}* as ${state.draft.requestType} → ${state.draft.taskType}.`,
      result.permalinkUrl,
      `Requested date: ${date}.`,
      result.automation.summary,
    ];
    if (!result.automation.ok) {
      lines.push("The task link is above. The team can still open it, but the automatic routing may not have finished.");
    }
    if (state.draft.pricePending) {
      lines.push("Price is still pending. Reply in the Asana task or in this thread with the price when you have it.");
    }
    return { text: lines.join("\n") };
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
