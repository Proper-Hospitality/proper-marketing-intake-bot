export type IntakeFlow = "classic" | "simplified";

/** #marketing-asana-bot. Classic unless this id is added to SIMPLIFIED_FLOW_CHANNELS. */
export const MARKETING_ASANA_BOT_CHANNEL = "C0CBU9X6F0F";

export function simplifiedChannelIds(raw = process.env.SIMPLIFIED_FLOW_CHANNELS): Set<string> {
  return new Set((raw ?? "").split(/[,\s]+/).map((id) => id.trim()).filter(Boolean));
}

/** Classic everywhere until a channel id is listed. Email channels and DMs follow the same rule. */
export function flowForChannel(channel: string | undefined, raw = process.env.SIMPLIFIED_FLOW_CHANNELS): IntakeFlow {
  if (channel && simplifiedChannelIds(raw).has(channel)) return "simplified";
  return "classic";
}

/**
 * Lock the flow on the thread. A thread that already started without a stored
 * flow stays classic, so adding a channel to the list does not flip it mid-conversation.
 */
export function assignIntakeFlow(state: {
  intakeFlow?: IntakeFlow;
  channel?: string;
  messages: Array<{ role: string }>;
  phase: string;
  taskGid?: string;
}, raw = process.env.SIMPLIFIED_FLOW_CHANNELS): void {
  if (state.intakeFlow) return;
  const alreadyStarted = state.messages.length > 0 || state.phase !== "collecting" || Boolean(state.taskGid);
  state.intakeFlow = alreadyStarted ? "classic" : flowForChannel(state.channel, raw);
}
