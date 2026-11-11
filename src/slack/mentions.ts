/** Off unless SLACK_MENTIONS_ENABLED is true, yes, on, or 1. */
export function mentionsEnabled(raw = process.env.SLACK_MENTIONS_ENABLED): boolean {
  return /^(1|true|yes|on)$/i.test((raw ?? "").trim());
}

/** First name from "Jamie Mark" or "Jamie Mark <jamie@properhotel.com>". */
export function firstName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const display = name.split("<")[0]?.replace(/,.*/, "").trim() ?? "";
  const first = display.split(/\s+/).filter(Boolean)[0];
  if (!first || first.toLowerCase() === "unknown" || first.startsWith("<@")) return undefined;
  return first;
}

/**
 * Greeting for a reply. Mentions stay off while email intake is being tested.
 * With the flag on, a Slack id becomes <@U...>. Otherwise the first name.
 */
export function greet(input: { userId?: string; name?: string }): string {
  if (mentionsEnabled() && input.userId) return `Hi <@${input.userId}>!`;
  const name = firstName(input.name);
  return name ? `Hi ${name}!` : "Hi!";
}
