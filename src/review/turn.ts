import { addTaskComment } from "../intake/asana.js";
import type { Store } from "../store/types.js";
import { applyReviewReply } from "./loop.js";
import { loadReviewForUser, loadReviewSession, saveReviewSession } from "./store.js";

export async function handleReviewMessage(input: {
  store: Store;
  userId: string;
  text: string;
  asanaToken?: string;
  fetchImpl?: typeof fetch;
  today?: Date;
  postDm: (userId: string, text: string) => Promise<void>;
}): Promise<boolean> {
  const session = await loadReviewForUser(input.store, input.userId);
  if (!session) return false;
  if (session.phase !== "awaiting_choice" && session.phase !== "awaiting_feedback") return false;
  const action = applyReviewReply(session, input.text, input.today ?? new Date());
  await saveReviewSession(input.store, action.session);
  if (action.kind === "ignore") return true;
  if ((action.kind === "comment" || action.kind === "approve" || action.kind === "escalate") && input.asanaToken) {
    await addTaskComment({
      token: input.asanaToken,
      taskGid: action.session.taskGid,
      text: action.comment,
      fetchImpl: input.fetchImpl,
    });
  }
  await input.postDm(input.userId, action.kind === "ask" ? action.text : action.text);
  return true;
}

export async function handleReviewButton(input: {
  store: Store;
  userId: string;
  taskGid: string;
  choice: "approve" | "changes";
  asanaToken?: string;
  fetchImpl?: typeof fetch;
  today?: Date;
  postDm: (userId: string, text: string) => Promise<void>;
}): Promise<void> {
  const session = await loadReviewSession(input.store, input.taskGid);
  if (!session || session.approverSlackId !== input.userId) return;
  await handleReviewMessage({
    ...input,
    text: input.choice === "approve" ? "approve" : "request changes",
  });
}
