import { renderEmailText } from "./parse.js";
import type { LoadedAttachment } from "../task-files.js";
import type { ConversationState } from "../../store/types.js";

/**
 * The Slack email file is the original. Upload a text copy only when that file
 * could not be downloaded, so the task still has the email and we do not attach
 * the same message twice.
 */
export function emailFallbackFile(
  state: ConversationState,
  loadedIds: string[],
  alreadyUploaded: string[],
): LoadedAttachment | undefined {
  const email = state.emailIntake;
  if (!email?.bodyText.trim()) return undefined;
  const textId = `email-text:${email.messageTs}`;
  if (alreadyUploaded.includes(textId)) return undefined;
  const emailFileId = email.files.find((file) => file.role === "email")?.slackFileId;
  if (emailFileId && (loadedIds.includes(emailFileId) || alreadyUploaded.includes(emailFileId))) return undefined;
  return {
    slackFileId: textId,
    name: "forwarded-email.txt",
    bytes: new TextEncoder().encode(renderEmailText(email)),
    mimetype: "text/plain",
  };
}
