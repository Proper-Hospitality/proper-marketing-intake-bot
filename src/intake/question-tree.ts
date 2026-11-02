import { TASK_TYPE_FIELDS } from "./catalog.js";
import type { FollowUp, RequestType } from "./types.js";

export const SUPPORT_QUESTION: Record<RequestType, string> = {
  Creative: "What type of creative support do you need?",
  Web: "What type of website support do you need?",
  "CRM & Paid": "What type of CRM or paid media support do you need?",
  Social: "What type of social media support do you need?",
  Marketing: "What type of marketing support do you need?",
};

const copy = (required = true): FollowUp => ({
  label: "Recommended Copy / Details",
  required,
  kind: "longtext",
  satisfies: ["copy"],
});

const audience = (required = true): FollowUp => ({
  label: "Audience / Distribution Plan",
  required,
  kind: "longtext",
});

const photo = (required = false): FollowUp => ({
  label: "Photo Link",
  required,
  kind: "text",
  satisfies: ["assets"],
});

const cta = (required = false, label = "CTA Link"): FollowUp => ({
  label,
  required,
  kind: "text",
  satisfies: ["destination"],
});

const detailed = (required = true): FollowUp => ({
  label: "Detailed Request",
  required,
  kind: "longtext",
  satisfies: ["copy"],
});

const creativeDesign: FollowUp[] = [audience(), copy(), photo(), cta()];

const crmSend: FollowUp[] = [
  audience(),
  copy(),
  cta(true),
  { label: "Offer Details", required: false, kind: "longtext" },
  photo(),
];

const none: FollowUp[] = [];

const WELLNESS = [
  "Fitness Center",
  "Recovery",
  "Pool",
  "Beach",
  "Verbena Spa",
  "Surya Spa",
  "Estrella",
  "Retreat",
  "Run Club",
];

const PROGRAMMING = [
  "Proper Club",
  "Proper Presents",
  "DJs",
  "Live Music",
  "Shelborne Beach Club",
  "Proper Beach Club",
];

const TREE: Record<RequestType, Record<string, FollowUp[]>> = {
  Creative: {
    Email: creativeDesign,
    SMS: creativeDesign,
    "Pop Up": creativeDesign,
    "Web Page": creativeDesign,
    Social: creativeDesign,
    "Sales Collateral": creativeDesign,
    "Print Collateral": [
      { label: "Paper Size", required: true, kind: "text" },
      copy(),
      { label: "Planned Print Quantity", required: true, kind: "number" },
      photo(),
      cta(),
      audience(false),
    ],
    "Menu (F&B, Spa)": [
      {
        label: "Exact Menu Details with Pricing & Dietary Labels",
        required: true,
        kind: "longtext",
        verbatim: true,
        satisfies: ["copy"],
      },
      { label: "Link to Current Menu", required: false, kind: "text", satisfies: ["assets"] },
    ],
    Ad: [
      audience(),
      copy(),
      { label: "Asset Size", required: true, kind: "text" },
      photo(),
      cta(),
    ],
    "Digital Asset": [
      audience(),
      copy(),
      { label: "Asset Size", required: true, kind: "text" },
      photo(),
      cta(),
    ],
    Merch: [
      detailed(),
      { label: "Inspiration Link", required: false, kind: "text", satisfies: ["assets"] },
    ],
    "Brand Systems": [
      detailed(),
      { label: "File Formats Needed", required: false, kind: "text" },
      { label: "Inspiration Link", required: false, kind: "text", satisfies: ["assets"] },
    ],
    "Photo/Video Selection": [
      detailed(),
      { label: "Photo/Video Link", required: true, kind: "text", satisfies: ["assets"] },
    ],
    "Photo/Video Shoot": [
      {
        label: "Detailed Content Request (what are we capturing & when)",
        required: true,
        kind: "longtext",
        satisfies: ["copy"],
      },
      { label: "Requested Shoot Date(s)", required: false, kind: "text" },
      { label: "Requested Photographer?", required: false, kind: "text" },
    ],
    "Presentation / Deck": [audience(), copy()],
  },
  Web: {
    "New Page": [
      { label: "URL", required: true, kind: "text", satisfies: ["destination"] },
      { label: "Page Headline (Exact)", required: true, kind: "text", verbatim: true },
      {
        label: "Page Copy (Exact)",
        required: true,
        kind: "longtext",
        verbatim: true,
        satisfies: ["copy"],
      },
      { label: "Banner Photo Link", required: false, kind: "text", satisfies: ["assets"] },
      { label: "Figma Design Link", required: false, kind: "text", satisfies: ["assets"] },
    ],
    "Page Edit": [
      { label: "URL", required: true, kind: "text", satisfies: ["destination"] },
      {
        label: "Page Change Details (exact copy provided, if required)",
        required: true,
        kind: "longtext",
        verbatim: true,
        satisfies: ["copy"],
      },
    ],
    Happenings: [
      { label: "Event Name (Exact)", required: true, kind: "text", verbatim: true },
      {
        label: "Event Description (Exact)",
        required: true,
        kind: "longtext",
        verbatim: true,
        satisfies: ["copy"],
      },
      { label: "Event Date(s)", required: true, kind: "text" },
      { label: "Event Time (Start – End)", required: true, kind: "text" },
      { label: "Event Location", required: true, kind: "text" },
      cta(true),
      photo(),
    ],
    "Menu Upload": [
      { label: "Details", required: true, kind: "longtext", satisfies: ["copy"] },
      { label: "URL", required: false, kind: "text", satisfies: ["destination"] },
    ],
    SEO: [
      { label: "Details", required: true, kind: "longtext", satisfies: ["copy"] },
      { label: "URL", required: false, kind: "text", satisfies: ["destination"] },
    ],
    "Bug Fix": [
      { label: "Details", required: true, kind: "longtext", satisfies: ["copy"] },
      { label: "URL", required: false, kind: "text", satisfies: ["destination"] },
    ],
    Tracking: [
      { label: "Platform", required: true, kind: "text" },
      { label: "Details", required: true, kind: "longtext", satisfies: ["copy"] },
    ],
    Integrations: [
      { label: "Platform", required: true, kind: "text" },
      { label: "Details", required: true, kind: "longtext", satisfies: ["copy"] },
    ],
    Reporting: [
      { label: "Platform", required: true, kind: "text" },
      { label: "Details", required: true, kind: "longtext", satisfies: ["copy"] },
    ],
    "Brandfolder Upload": [
      { label: "Link to Organized Assets", required: true, kind: "text", satisfies: ["assets"] },
      { label: "Shoot Date", required: true, kind: "text" },
      { label: "Photographer", required: true, kind: "text" },
      { label: "Usage Rights", required: true, kind: "text" },
      { label: "F&B Outlet Name", required: false, kind: "text" },
      { label: "Rooms or Suites", required: false, kind: "text" },
      { label: "Meetings & Event Space Names", required: false, kind: "text" },
      { label: "Wellness", required: false, kind: "select", options: WELLNESS },
      { label: "Programming", required: false, kind: "select", options: PROGRAMMING },
    ],
    "Affiliate Import": [{ label: "Instructions", required: true, kind: "longtext", satisfies: ["copy"] }],
    "GMB Updates": none,
    "AI Optimization": none,
  },
  "CRM & Paid": {
    "Transactional Email": [
      { label: "Detailed Change Request", required: true, kind: "longtext", satisfies: ["copy"] },
      cta(),
      { label: "Figma Link", required: false, kind: "text", satisfies: ["assets"] },
    ],
    "Newsletter Send": [
      audience(),
      copy(),
      cta(true, "CTA Links"),
      { label: "Figma Link", required: false, kind: "text", satisfies: ["assets"] },
      { label: "Subject Line", required: false, kind: "text" },
    ],
    "SMS Send": crmSend,
    "Pop Up": crmSend,
    "Automated Flows (Abandon Cart, Exit Intent)": crmSend,
    "New User Journey (Subscriber Flows)": crmSend,
    Reporting: [detailed()],
    "Rate Code – Transactional Emails": [
      { label: "Rate Code", required: true, kind: "text", verbatim: true },
      {
        label: "Cancellation Policy (Exact Copy)",
        required: true,
        kind: "longtext",
        verbatim: true,
        satisfies: ["copy"],
      },
    ],
    "Ad Strategy": [
      audience(),
      copy(),
      { label: "Goal", required: true, kind: "text" },
      cta(true),
      { label: "Photo / Asset Link", required: false, kind: "text", satisfies: ["assets"] },
    ],
    "Ad Refresh": [
      { label: "Detailed Change Request", required: true, kind: "longtext", satisfies: ["copy"] },
      cta(true),
    ],
  },
  Social: {
    "Influencer Request": [
      {
        label: "Influencer Overview (social handle, requested trade, etc)",
        required: true,
        kind: "longtext",
        satisfies: ["copy"],
      },
      { label: "Reason for Visit (what are they promoting?)", required: false, kind: "longtext" },
    ],
    "Feed Post Request": [
      copy(),
      { label: "Photo / Asset Link", required: false, kind: "text", satisfies: ["assets"] },
    ],
    "Story Request": [
      copy(),
      { label: "Photo / Asset Link", required: false, kind: "text", satisfies: ["assets"] },
      { label: "Is this story recurring?", required: false, kind: "yesno", options: ["Yes", "No"] },
    ],
    "Profile Update": [detailed()],
    Reporting: [detailed()],
    "Content Planning": [detailed(false)],
    "Lo-Fi Content Filming": [detailed(false)],
    "Content Editing": [
      { label: "Link to Assets to Edit", required: false, kind: "text", satisfies: ["assets"] },
    ],
    Engagement: none,
    "Post Scheduling": none,
    "Story Uploads": none,
  },
  Marketing: {
    "Marketing Plan": [detailed()],
    Reporting: [detailed()],
    Offers: [
      { label: "Offer Title (match Namastay)", required: true, kind: "text", verbatim: true },
      { label: "Offer Inclusions", required: true, kind: "longtext", verbatim: true, satisfies: ["copy"] },
      { label: "Promo Code", required: true, kind: "text", verbatim: true },
      { label: "Rate Code", required: true, kind: "text", verbatim: true },
      {
        label: "Offer Terms & Conditions (match Namastay)",
        required: true,
        kind: "longtext",
        verbatim: true,
      },
      {
        label: "Does the Standard Cancellation Policy Apply?",
        required: true,
        kind: "yesno",
        options: ["Yes", "No"],
      },
      { label: "Offer Go Live Date", required: true, kind: "date" },
      { label: "Offer Book By Date (blank if Evergreen)", required: false, kind: "date" },
      { label: "Target Audience & Marketing Channel Details", required: false, kind: "longtext" },
    ],
    "Programming & Activations": [
      { label: "Event Details", required: true, kind: "longtext", satisfies: ["copy"] },
      { label: "Event Dates", required: false, kind: "text" },
      { label: "Event Link", required: false, kind: "text", satisfies: ["destination"] },
      { label: "Public or Private", required: false, kind: "select", options: ["Public", "Private"] },
      { label: "Overview of how Marketing/Creative can support", required: false, kind: "longtext" },
    ],
    "Copy Writing": none,
    "Listing Health": none,
    "Admin / Set Up": none,
    "Check Brief": none,
  },
};

export function followUpsFor(requestType: RequestType, taskType: string): FollowUp[] {
  const group = TREE[requestType];
  if (!Object.prototype.hasOwnProperty.call(group, taskType)) {
    throw new Error(`No question-tree entry for ${requestType} → ${taskType}.`);
  }
  return group[taskType];
}

export function assertQuestionTreeCoversCatalog(): void {
  for (const requestType of Object.keys(TASK_TYPE_FIELDS) as RequestType[]) {
    for (const taskType of Object.keys(TASK_TYPE_FIELDS[requestType].options)) {
      followUpsFor(requestType, taskType);
    }
  }
}

export const REQUEST_TYPE_GUIDANCE = [
  "Start with Creative for most new work. New web pages, emails, and social posts are designed before they are built.",
  "Offers go to Marketing → Offers.",
  "If the need is unclear, use Marketing → Marketing Plan and the team will help scope it.",
  "Quick edits and technical requests go directly to Web, CRM & Paid, or Social.",
].join(" ");

export const DISAMBIGUATION = [
  "Designing an email is Creative → Email. Sending a newsletter is CRM & Paid → Newsletter Send.",
  "Designing a pop up is Creative → Pop Up. Building or launching it is CRM & Paid → Pop Up.",
  "Designing a web page is Creative → Web Page. Building a new live page is Web → New Page. Editing an existing page is Web → Page Edit.",
  "Putting an offer on a web page is Web (New Page or Page Edit) because that is what gets built. Marketing → Offers is for setting up or planning the offer itself.",
  "A new offer is Marketing → Offers, not Creative.",
  "One deliverable per task. An IG flyer and a social recap are two tasks.",
].join(" ");

export function questionTreeText(): string {
  const lines: string[] = [];
  for (const requestType of Object.keys(TREE) as RequestType[]) {
    lines.push(`## ${requestType} → "${SUPPORT_QUESTION[requestType]}"`);
    for (const [taskType, fields] of Object.entries(TREE[requestType])) {
      if (fields.length === 0) {
        lines.push(`- ${taskType}: no extra questions`);
        continue;
      }
      const rendered = fields
        .map((field) => {
          const marks = [
            field.required ? "required" : "optional",
            field.verbatim ? "verbatim" : "",
            field.kind === "yesno" || field.kind === "select" ? `options: ${field.options?.join(", ")}` : "",
          ].filter(Boolean);
          return `${field.label} (${marks.join("; ")})`;
        })
        .join("; ");
      lines.push(`- ${taskType}: ${rendered}`);
    }
  }
  return lines.join("\n");
}
