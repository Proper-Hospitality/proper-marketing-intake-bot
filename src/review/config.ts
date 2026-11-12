/**
 * Straightforward requests Elizabeth can approve herself.
 * Override with REVIEW_APPROVER_NAME, REVIEW_APPROVER_SLACK_ID, and
 * REVIEW_APPROVER_TYPES (comma-separated task types).
 */
export interface ConfiguredReviewer {
  name: string;
  slackId: string;
  taskTypes: string[];
}

const DEFAULT_TYPES = ["SEO", "Bug Fix", "Menu Upload"];

export function configuredReviewer(taskType: string | undefined, env: NodeJS.ProcessEnv = process.env): ConfiguredReviewer | undefined {
  if (!taskType) return undefined;
  const name = (env.REVIEW_APPROVER_NAME || "Elizabeth Van Bergen").trim();
  const slackId = (env.REVIEW_APPROVER_SLACK_ID || "U0CBTQ82WHW").trim();
  const raw = (env.REVIEW_APPROVER_TYPES || DEFAULT_TYPES.join(",")).split(",");
  const taskTypes = raw.map((item) => item.trim()).filter(Boolean);
  if (!name || !slackId) return undefined;
  if (!taskTypes.some((type) => type.toLowerCase() === taskType.toLowerCase())) return undefined;
  return { name, slackId, taskTypes };
}

export const MAX_REVIEW_ROUNDS = 2;
