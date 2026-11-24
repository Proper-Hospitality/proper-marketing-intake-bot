import { describe, expect, it } from "vitest";
import { formatQuestions } from "../src/intake/brief.js";
import { taskTypeNames } from "../src/intake/catalog.js";
import { formatRequestTypeChoices, formatTaskTypeChoices, REQUEST_TYPE_EXAMPLES } from "../src/intake/choices.js";
import { listMissing } from "../src/intake/missing.js";
import { REQUEST_TYPES, type RequestType } from "../src/intake/types.js";

const RATE_CODE = "Rate Code \u2013 Transactional Emails";

/** Labels from the live intake form. Order matters. */
const FORM_TASK_TYPES: Record<RequestType, string[]> = {
  Creative: [
    "Email",
    "SMS",
    "Pop Up",
    "Web Page",
    "Social",
    "Sales Collateral",
    "Print Collateral",
    "Menu (F&B, Spa)",
    "Ad",
    "Digital Asset",
    "Merch",
    "Brand Systems",
    "Photo/Video Selection",
    "Photo/Video Shoot",
    "Presentation / Deck",
  ],
  Web: [
    "New Page",
    "Page Edit",
    "Happenings",
    "Menu Upload",
    "SEO",
    "Bug Fix",
    "Tracking",
    "Integrations",
    "Reporting",
    "Brandfolder Upload",
    "Affiliate Import",
    "GMB Updates",
    "AI Optimization",
  ],
  "CRM & Paid": [
    "Transactional Email",
    "Newsletter Send",
    "SMS Send",
    "Pop Up",
    "Automated Flows (Abandon Cart, Exit Intent)",
    "New User Journey (Subscriber Flows)",
    "Reporting",
    RATE_CODE,
    "Ad Strategy",
    "Ad Refresh",
  ],
  Social: [
    "Influencer Request",
    "Feed Post Request",
    "Story Request",
    "Profile Update",
    "Reporting",
    "Engagement",
    "Content Planning",
    "Post Scheduling",
    "Story Uploads",
    "Lo-Fi Content Filming",
    "Content Editing",
  ],
  Marketing: [
    "Marketing Plan",
    "Reporting",
    "Offers",
    "Programming & Activations",
    "Copy Writing",
    "Listing Health",
    "Admin / Set Up",
    "Check Brief",
  ],
};

describe("request and task type lists", () => {
  it("matches the live form's task type labels exactly", () => {
    for (const requestType of REQUEST_TYPES) {
      expect(taskTypeNames(requestType)).toEqual(FORM_TASK_TYPES[requestType]);
    }
  });

  it("explains each request type in plain language, with Creative spelled out", () => {
    const text = formatRequestTypeChoices();
    expect(text).toContain("• *Creative* — new designs like emails, menus, social graphics, print and sales collateral, ads, decks, photo/video shoots");
    expect(text).toContain("• *Web* — new pages, page edits, menu uploads, SEO, bug fixes");
    expect(text).toContain("• *CRM & Paid* — newsletter/SMS sends, pop ups, automated flows, ad strategy");
    expect(text).toContain("• *Social* — feed posts, stories, influencer requests, profile updates");
    expect(text).toContain("• *Marketing* — offers, marketing plans, copywriting, programming & activations");
    expect(text).toContain("Start with Creative for most new design. Offers go to Marketing. Quick edits can go straight to Web, CRM & Paid, or Social.");
    expect(Object.keys(REQUEST_TYPE_EXAMPLES)).toEqual([...REQUEST_TYPES]);
    expect(text).not.toContain("• Photo/Video Shoot");
  });

  it("asks what we can help with using those examples", () => {
    const text = formatQuestions({
      userId: "U1",
      items: listMissing({}).items,
      warnings: [],
      draft: {},
    });
    expect(text).toContain("Who is this request for?");
    expect(text).not.toContain("What should the team help with?");
    expect(text).not.toContain("1. *Your email*");
  });

  it("asks what we can help with, with the examples, only once that is the next question", () => {
    const draft = {
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@example.com",
      requestName: "Holiday menu",
      properties: ["SMP"],
    };
    const text = formatQuestions({
      userId: "U1",
      items: listMissing(draft).items,
      warnings: [],
      draft,
    });
    expect(text).toContain("What should the team help with?");
    expect(text).toContain("• *Creative* — new designs like emails, menus, social graphics");
    expect(text).toContain("Start with Creative for most new design.");
    expect(text).not.toContain("Who is this request for?");
  });

  it("lists every task type once a request type is chosen", () => {
    const draft = {
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@example.com",
      requestName: "Holiday menu",
      properties: ["SMP"],
      requestType: "Creative" as const,
    };
    const text = formatQuestions({
      userId: "U1",
      items: listMissing(draft).items,
      warnings: [],
      draft,
    });
    expect(text).toContain("What kind of Creative is this?");
    expect(formatTaskTypeChoices("Creative").split("\n")).toEqual(FORM_TASK_TYPES.Creative.map((name) => `• ${name}`));
    for (const name of FORM_TASK_TYPES.Creative) {
      expect(text).toContain(`• ${name}`);
    }
    expect(text).not.toContain("• *Web*");
    expect(formatTaskTypeChoices("CRM & Paid")).toContain(`• ${RATE_CODE}`);
    expect(formatTaskTypeChoices("Marketing")).toContain("• Check Brief");
    expect(formatTaskTypeChoices("Web")).toContain("• AI Optimization");
    expect(formatTaskTypeChoices("Social")).toContain("• Lo-Fi Content Filming");
  });
});
