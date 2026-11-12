import type { Store } from "../store/types.js";
import type { ReviewParty, ReviewSession } from "./loop.js";

const TTL_SECONDS = 60 * 60 * 24 * 90;

export function reviewPartyKey(taskGid: string): string {
  return `review:party:${taskGid}`;
}

export function reviewSessionKey(taskGid: string): string {
  return `review:session:${taskGid}`;
}

export function reviewUserKey(slackUserId: string): string {
  return `review:user:${slackUserId}`;
}

export async function saveReviewParty(store: Store, party: ReviewParty): Promise<void> {
  await store.setValue(reviewPartyKey(party.taskGid), JSON.stringify(party), TTL_SECONDS);
}

export async function loadReviewParty(store: Store, taskGid: string): Promise<ReviewParty | undefined> {
  const raw = await store.getValue(reviewPartyKey(taskGid));
  if (!raw) return undefined;
  return JSON.parse(raw) as ReviewParty;
}

export async function saveReviewSession(store: Store, session: ReviewSession): Promise<void> {
  await store.setValue(reviewSessionKey(session.taskGid), JSON.stringify(session), TTL_SECONDS);
  if (session.approverSlackId) {
    await store.setValue(reviewUserKey(session.approverSlackId), session.taskGid, TTL_SECONDS);
  }
}

export async function loadReviewSession(store: Store, taskGid: string): Promise<ReviewSession | undefined> {
  const raw = await store.getValue(reviewSessionKey(taskGid));
  if (!raw) return undefined;
  return JSON.parse(raw) as ReviewSession;
}

export async function loadReviewForUser(store: Store, slackUserId: string): Promise<ReviewSession | undefined> {
  const taskGid = await store.getValue(reviewUserKey(slackUserId));
  if (!taskGid) return undefined;
  return loadReviewSession(store, taskGid);
}
