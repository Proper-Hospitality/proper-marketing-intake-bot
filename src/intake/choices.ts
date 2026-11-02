import { taskTypeNames } from "./catalog.js";
import { REQUEST_TYPES, type RequestType } from "./types.js";

/** Plain-language examples for people who don't know the request-type names. Drawn from each type's task list. */
export const REQUEST_TYPE_EXAMPLES: Record<RequestType, string> = {
  Creative: "new designs like emails, menus, social graphics, print and sales collateral, ads, decks, photo/video shoots",
  Web: "new pages, page edits, menu uploads, SEO, bug fixes",
  "CRM & Paid": "newsletter/SMS sends, pop ups, automated flows, ad strategy",
  Social: "feed posts, stories, influencer requests, profile updates",
  Marketing: "offers, marketing plans, copywriting, programming & activations",
};

export const REQUEST_TYPE_GUIDANCE = "Start with Creative for most new design. Offers go to Marketing. Quick edits can go straight to Web, CRM & Paid, or Social.";

export function formatRequestTypeChoices(): string {
  const bullets = REQUEST_TYPES.map((type) => `• *${type}* — ${REQUEST_TYPE_EXAMPLES[type]}`);
  return [...bullets, REQUEST_TYPE_GUIDANCE].join("\n");
}

export function formatTaskTypeChoices(requestType: RequestType): string {
  return taskTypeNames(requestType).map((name) => `• ${name}`).join("\n");
}
