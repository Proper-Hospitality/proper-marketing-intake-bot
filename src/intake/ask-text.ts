import { propertyPhrase } from "./catalog.js";
import { leadTimeFor, leadTimeSentence } from "./lead-time.js";
import type { MissingItem } from "./missing.js";
import type { BriefDraft } from "./types.js";

/** A short acknowledgement. Not the bare "Got it." */
export function naturalAck(input: { lastId?: string; draft: BriefDraft }): string {
  const properties = input.draft.properties ?? [];
  if (input.lastId === "properties" && properties.length === 1) {
    return `Perfect, ${properties[0]} it is.`;
  }
  if (input.lastId === "properties" && properties.length > 1) {
    return `Perfect, ${properties.join(" and ")} it is.`;
  }
  const variety = ["Great, thanks!", "Perfect.", "Sounds good."];
  const index = (input.lastId ?? "x").length % variety.length;
  return variety[index] ?? "Great, thanks!";
}

export const LEADING_ACK = /^(?:Perfect[^\n]*|Great, thanks!|Sounds good\.)\n\n/;

export function placeName(draft: BriefDraft): string {
  const code = draft.properties?.[0];
  if (!code) return "";
  return propertyPhrase(code).replace(/\s*\([^)]*\)\s*$/, "");
}

export function fieldQuestion(item: MissingItem, draft: BriefDraft): string {
  const specific = byId(item, draft) ?? byLabel(item.label, draft);
  if (specific) return specific;
  if (/\?\s*$/.test(item.label)) {
    return `${item.label} A yes or no, or a short answer, is enough so the brief stays specific.`;
  }
  return fallback(item, draft);
}

export function isBareFieldPrompt(text: string, label: string): boolean {
  const bare = label.trim();
  return text.split("\n").some((line) => {
    const trimmed = line.trim();
    if (trimmed === `*${bare}*`) return true;
    if (/—\s*\*[^*]+\*\s*$/.test(trimmed)) return true;
    return trimmed === bare && !bare.endsWith("?");
  });
}

export function friendlyRecap(draft: BriefDraft): string {
  const name = draft.requestName?.trim() || "this request";
  return `Here's what I have for ${name}. Want me to file this?\nNothing is filed until you click *Confirm*.`;
}

function byId(item: MissingItem, draft: BriefDraft): string | undefined {
  const what = requestLabel(draft);
  const place = placeName(draft);
  switch (item.id) {
    case "requesterName":
      return "Who is this request for? I need their name so the task is filed under the right person.";
    case "requesterEmail":
      return "What's the best email for that person? It goes on the task so the team can follow up. For example, first.last@properhotel.com.";
    case "requestName":
      return `What should we call this? A short name is enough, and I'll add the property to the title. For example, ${place ? `${place} ` : ""}membership interest form.`;
    case "properties":
      return "Which property is this for? A code is perfect, like SMP or LTP. I use it to route the task and to check for a template.";
    case "requestType":
      return "What should the team help with? Pick the closest fit so this lands with the right people.";
    case "taskType":
      return `What kind of ${draft.requestType ?? "request"} is this? That tells me which details I still need.`;
    case "timing":
      return `When do you need ${what}, and what happens if it's late? A real date helps the team plan, and the consequence is what gets a rush prioritized. For example, Dec 4, because invitations go out that week.`;
    case "requestedCompletionDate":
      return `When do you need ${what} live? ${leadTimeFor(draft).phrase}. A real date, not ASAP.`;
    case "copyReady":
      return `Is the copy for ${what} ready? If yes, paste it. If not, who is writing it and by when?`;
    case "copyPlan":
      return `Who is writing the copy for ${what}, and when will it be ready?`;
    case "designNeeded":
      return `Do you need design for ${what}, or can the web team build it from the existing layout?`;
    case "menuPdf":
      return item.hint ?? "Send a ready-to-upload PDF, one menu per file. The dev team can't open a Figma or Figma Buzz link.";
    case "consequenceOfDelay":
      return `What happens if ${what} is late? One line is enough, so the team knows what slips.`;
    case "approver":
      return `Who signs off on ${what}? One person, so the team knows who to check with.`;
    case "copy":
      return `What's the final copy for ${what}, or who is writing it and when it's due? Paste it here, or name the owner and the date.`;
    case "assets":
      return `Where are the files for ${what}? A Brandfolder, Dropbox, Drive, or Slack link works. A photo of a menu doesn't.`;
    case "whereItGoesLive":
      return `Where does ${what} go live? A URL, channel, or handle, so the team knows the destination.`;
    case "eventWhen":
      return "When is the event? I need the date plus the start and end time.";
    default:
      return undefined;
  }
}

function byLabel(label: string, draft: BriefDraft): string | undefined {
  const what = requestLabel(draft);
  const place = placeName(draft) || "the property";
  if (label === "URL") return pageUrlQuestion(draft);
  if (/page change details/i.test(label)) {
    return `What should change on the ${place} page? Send the exact copy if you have it, so the web team isn't guessing.`;
  }
  if (/page headline/i.test(label)) {
    return `What's the headline for this ${place} page? Send it exactly as it should appear.`;
  }
  if (/page copy/i.test(label)) {
    return `What's the page copy? Paste the exact text you want on the ${place} page.`;
  }
  if (/audience/i.test(label)) {
    return `Who is ${what} for, and where does it go? For example, ${audienceExample(draft)}.`;
  }
  if (/recommended copy/i.test(label)) {
    return `What should ${what} say? A draft or the key points is enough, so the team isn't inventing the message.`;
  }
  if (/^cta link/i.test(label)) {
    return `Where should ${what} send people? A URL is best, so the button or link goes to the right place.`;
  }
  if (/detailed request/i.test(label)) {
    return `What do you need the team to do for ${what}? A few sentences on the outcome is enough.`;
  }
  if (/detailed change/i.test(label)) {
    return `What should change? Describe the edit so the team can match it.`;
  }
  if (/subject line/i.test(label)) {
    return "What subject line do you want? Send the exact words if you have them.";
  }
  if (/rate code/i.test(label) && !/cancellation/i.test(label)) {
    return "What's the rate code? Send it exactly as it should appear. Don't invent one if you don't have it.";
  }
  if (/promo code/i.test(label)) {
    return "What's the promo code? Send the exact code, the way a guest would type it.";
  }
  if (/offer title/i.test(label)) {
    return "What's the offer title? Match the Namastay name so the systems line up.";
  }
  if (/event name/i.test(label)) {
    return "What's the event called? Send the exact name you want published.";
  }
  if (/event description/i.test(label)) {
    return "How should the event be described? Paste the exact copy.";
  }
  if (/event date/i.test(label)) {
    return "What date is the event? For example, Dec 12.";
  }
  if (/event time/i.test(label)) {
    return "What time does it start and end? For example, 6pm to 9pm.";
  }
  if (/event location/i.test(label)) {
    return `Where at ${place} does the event happen? A room or outlet name is enough.`;
  }
  if (/platform/i.test(label)) {
    return `Which platform is ${what} on? For example, Google, Meta, or the website.`;
  }
  if (label === "Details") {
    return `What are the details for ${what}? A short note on what should change is enough.`;
  }
  if (/goal/i.test(label)) {
    return `What's the goal for ${what}? For example, more membership signups.`;
  }
  return undefined;
}

export function shortNeed(item: MissingItem, draft: BriefDraft): string {
  if (item.id === "timing") return "when this is due, and what happens if it's late";
  if (item.id === "requestedCompletionDate") return `when this needs to be live (${leadTimeFor(draft).phrase.charAt(0).toLowerCase()}${leadTimeFor(draft).phrase.slice(1)})`;
  if (item.id === "copyReady") return "whether the copy is ready (paste it, or who is writing it and by when)";
  if (item.id === "copyPlan") return "who is writing the copy, and by when";
  if (item.id === "designNeeded") return "whether design is needed";
  if (item.id === "menuPdf") return "a ready-to-upload PDF (the dev team can't open Figma or Figma Buzz)";
  if (item.label === "What it replaces and where it sits") return "what this replaces, and where it sits on the page";
  if (item.label === "When the old offer comes down") return "when the old offer comes down";
  if (item.label === "What replaces it in ads or evergreen campaigns") return "what replaces it in ads or evergreen campaigns";
  if (item.label === "Rate or promo codes in transactional emails") return "whether rate or promo codes in transactional emails are affected";
  if (item.label === "Offer copy, rules, and photo") return "whether the copy, rules and regulations, and a photo are attached";
  if (item.id === "consequenceOfDelay") return "what happens if it's late";
  if (item.id === "approver") return "who signs off";
  if (item.id === "properties") return "which property this is for";
  if (item.id === "requestName") return "a short name for the request";
  if (item.id === "requestType") return "what kind of help you need";
  if (item.id === "taskType") return "what kind of piece this is";
  if (item.label === "URL" || item.id.endsWith(":URL")) {
    return draft.taskType === "New Page" ? "where the new page should live" : "the link to the current page";
  }
  if (/page change/i.test(item.label)) return "what should change on the page";
  if (/copy/i.test(item.label)) return "the copy, or the key points";
  if (/audience/i.test(item.label)) return "who this is for";
  const words = item.label.replace(/\s*\([^)]*\)/g, "").trim();
  return `${words.charAt(0).toLowerCase()}${words.slice(1)}`;
}

export function knownFacts(draft: BriefDraft): string[] {
  const lines: string[] = [];
  if (draft.properties?.length) lines.push(`Hotel: ${draft.properties.join(", ")}`);
  if (draft.taskType) lines.push(`This looks like ${draft.taskType}`);
  if (draft.requestName) lines.push(`Name: ${draft.requestName}`);
  if (draft.requestedCompletionDate) lines.push(`Due ${draft.requestedCompletionDate}`);
  if (draft.copyReady === true) lines.push("Copy is ready");
  if (draft.copyReady === false) lines.push("Copy is not ready yet");
  if (draft.designNeeded === true) lines.push("Design is needed");
  if (draft.designNeeded === false) lines.push("No new design");
  return lines;
}

export function formatNeedsList(input: {
  items: MissingItem[];
  draft: BriefDraft;
  opening: boolean;
  today?: Date;
  duplicates?: Array<{ name: string; url?: string }>;
}): string {
  const bullets = input.items.map((item) => `• ${shortNeed(item, input.draft)}`);
  const similar = (input.duplicates ?? []).slice(0, 2).map((task) => `I see an open task that looks similar: ${task.name}${task.url ? ` — ${task.url}` : ""}. Tell me if this is the same one.`);
  const kept = input.draft.consequenceOfDelay ? [`If it's late: ${input.draft.consequenceOfDelay}`, ""] : [];
  const heard = knownFacts(input.draft);
  const lead = leadTimeSentence(input.draft, input.today ?? new Date());
  const heardBlock = heard.length > 0 ? ["I have this so far. Tell me if any of it is wrong:", ...heard.map((line) => `• ${line}`), ""] : [];
  const leadBlock = lead ? [lead, ""] : [];
  if (!input.opening) {
    return [...kept, ...leadBlock, "Thanks. I still need:", ...bullets, ...similar].filter((line) => line !== undefined).join("\n");
  }
  return [
    ...kept,
    "Thank you for your request. We have some more information to gather before we can submit it.",
    "",
    ...heardBlock,
    ...leadBlock,
    "We need:",
    ...bullets,
    ...similar,
    "You can answer all of these now, or we can chat through it.",
  ].join("\n");
}

function audienceExample(draft: BriefDraft): string {
  const blob = `${draft.taskType ?? ""} ${draft.requestName ?? ""} ${draft.whereItGoesLive ?? ""}`;
  if (/email|sms|newsletter/i.test(draft.taskType ?? "")) {
    return "the membership interest list, or the weekly newsletter";
  }
  if (/social/i.test(draft.taskType ?? "")) {
    return "the Instagram feed, a story, or a specific channel";
  }
  if (/homepage|web page|landing/i.test(blob)) {
    return "the homepage, a landing page, or a specific spot on the page";
  }
  if (/ad|digital|signage|print|collateral|menu/i.test(blob)) {
    return "the homepage, an in-room screen, or a printed piece";
  }
  return "where guests will see it";
}

function pageUrlQuestion(draft: BriefDraft): string {
  const place = placeName(draft) || "this";
  const blob = `${draft.requestName ?? ""} ${draft.taskType ?? ""}`;
  const membership = /membership/i.test(blob);
  const page = membership ? `${place} membership page` : `${place} page`;
  if (draft.taskType === "New Page") {
    return `Where should the new ${page} live? A URL or a path is enough (for example properhotel.com/...), so the web team knows where to build it.`;
  }
  const why = /form/i.test(blob)
    ? "so the web team knows exactly where the new form goes"
    : "so the web team knows exactly which page to change";
  return `Which page should we update? Please send the link to the current ${page} on the website (for example properhotel.com/...), ${why}.`;
}

function requestLabel(draft: BriefDraft): string {
  return draft.requestName?.trim() || "this";
}

function fallback(item: MissingItem, draft: BriefDraft): string {
  const what = requestLabel(draft);
  const place = placeName(draft);
  const where = place ? ` for ${place}` : "";
  const name = item.label.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return `For ${what}${where}, I still need ${name.charAt(0).toLowerCase()}${name.slice(1)}. The team uses that on the brief, so a short answer in your own words is perfect.`;
}
