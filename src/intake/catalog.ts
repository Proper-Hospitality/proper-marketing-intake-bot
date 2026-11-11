import { REQUEST_TYPES, type RequestType } from "./types.js";

/** New Intake Board. Automations live here. Never create the task anywhere else. */
export const PROJECT_GID = "1217171684008018";
/** Section: "New requests - Manually Created". */
export const SECTION_GID = "1217518666052136";
export const WORKSPACE_GID = "361605662576941";

/**
 * Current Marketing Intake Form (Kinsey East, Nov 2026).
 * The bot is the intake path. Share this link only when someone asks for the form,
 * or when Asana filing itself fails. Do not send people to an older form.
 */
export const FORM_URL = "https://form.asana.com/?k=JYO_VqiFFnSlwJs_3XoMIg&d=361605662576941";
export const BOARD_URL =
  "https://app.asana.com/1/361605662576941/project/1217171684008018/list/1217171463540671";

export const REQUEST_TYPE_FIELD_GID = "1217171671548482";
export const PROPERTY_FIELD_GID = "1217171832439860";

export const REQUESTER_NAME_GID = "1217171832440041";
export const REQUESTER_EMAIL_GID = "1217171832440046";
export const COMPLETION_DATE_GID = "1217171537317137";

/**
 * The three intake fields, in the only order that fires the board automations.
 * They are never included on the create call.
 */
export const FIELD_UPDATE_ORDER = ["requestType", "taskType", "property"] as const;
export type FieldUpdateStep = (typeof FIELD_UPDATE_ORDER)[number];

export interface TaskTypeField {
  gid: string;
  options: Record<string, string>;
}

export const REQUEST_TYPE_OPTIONS: Record<RequestType, string> = {
  Creative: "1217171671548483",
  Web: "1217171671548484",
  "CRM & Paid": "1217171671548485",
  Social: "1217171671548486",
  Marketing: "1217171671548487",
};

/**
 * Enabled task-type options only.
 * Creative's disabled legacy options (New Page, SEO, Offers, and the rest) are omitted.
 * Those requests belong on Web, CRM & Paid, Social, or Marketing.
 */
export const TASK_TYPE_FIELDS: Record<RequestType, TaskTypeField> = {
  Creative: {
    gid: "1217171671548492",
    options: {
      Email: "1217171671548493",
      SMS: "1217171671548494",
      "Pop Up": "1217171671548495",
      "Web Page": "1217171671548496",
      Social: "1217171671548497",
      "Sales Collateral": "1217171671548498",
      "Print Collateral": "1217171671548499",
      "Menu (F&B, Spa)": "1217171671548500",
      Ad: "1217171671548501",
      "Digital Asset": "1217171671548502",
      Merch: "1217171671548503",
      "Brand Systems": "1217171671548504",
      "Photo/Video Selection": "1217171671548505",
      "Photo/Video Shoot": "1217171671548506",
      "Presentation / Deck": "1217171832439829",
    },
  },
  Web: {
    gid: "1217204969658409",
    options: {
      "New Page": "1217204969658410",
      "Page Edit": "1217204969658411",
      Happenings: "1217204969658412",
      "Menu Upload": "1217204969658413",
      SEO: "1217204969658414",
      "Bug Fix": "1217204969658415",
      Tracking: "1217204969658416",
      Integrations: "1217204969658417",
      Reporting: "1217204969658418",
      "Brandfolder Upload": "1217204743054427",
      "Affiliate Import": "1217204743054428",
      "GMB Updates": "1217820809382749",
      "AI Optimization": "1218742316844451",
    },
  },
  "CRM & Paid": {
    gid: "1217204743054493",
    options: {
      "Transactional Email": "1217204743054494",
      "Newsletter Send": "1217204743054495",
      "SMS Send": "1217204743054496",
      "Pop Up": "1217204743054497",
      "Automated Flows (Abandon Cart, Exit Intent)": "1217204743054498",
      "New User Journey (Subscriber Flows)": "1217204743054499",
      Reporting: "1217204743054500",
      "Rate Code – Transactional Emails": "1217204743054501",
      "Ad Strategy": "1217204743054502",
      "Ad Refresh": "1217204743054503",
    },
  },
  Social: {
    gid: "1217204743054505",
    options: {
      "Influencer Request": "1217204743054506",
      "Feed Post Request": "1217204743054507",
      "Story Request": "1217204743054508",
      "Profile Update": "1217204743054509",
      Reporting: "1217204743054510",
      Engagement: "1218457406335775",
      "Content Planning": "1218457406335776",
      "Post Scheduling": "1218457406335777",
      "Story Uploads": "1218457406335778",
      "Lo-Fi Content Filming": "1218457406335785",
      "Content Editing": "1218457406335786",
    },
  },
  Marketing: {
    gid: "1217204743054512",
    options: {
      "Marketing Plan": "1217204743054513",
      Reporting: "1217204743054514",
      Offers: "1217204743054515",
      "Programming & Activations": "1217204743054516",
      "Copy Writing": "1219645717161658",
      "Listing Health": "1219645717161682",
      "Admin / Set Up": "1219645717161683",
      "Check Brief": "1219818869602427",
    },
  },
};

/**
 * Enabled property options.
 * Skipped as disabled: All By Proper (1217171490189057), Residences (1217171490189064),
 * legacy New Projects (1217171490189074). Use New Projects/Development instead.
 */
export const PROPERTIES: Record<string, string> = {
  "All Properties": "1217171490189055",
  "All Proper": "1217171490189056",
  AUP: "1217171490189058",
  DTLA: "1217171490189059",
  SFP: "1217171490189060",
  SMP: "1217171490189061",
  "Proper Club": "1217171490189063",
  SMB: "1217171490189062",
  "All Collective": "1219742169884261",
  MYC: "1217171490189071",
  TCH: "1217171490189070",
  HJWL: "1217171490189065",
  HJM: "1217171490189066",
  ABH: "1217171490189067",
  APS: "1217171490189068",
  ING: "1217171490189069",
  LTP: "1217171490189072",
  DAL: "1217171490189073",
  MIN: "1219899638720492",
  Corporate: "1219741922295993",
  "New Projects/Development": "1219974242435102",
};

/** Informational only. The board automations set Routing Bucket. This bot does not. */
export const ROUTING_BUCKET_FIELD_GID = "1217171490189079";

/**
 * Who to name when someone doesn't have an answer.
 * DeeDee Brown: Proper hotels and By Proper hotels.
 * Koral Captain: The Collective.
 * Codes left out of both sets (All Properties, MIN, Corporate, New Projects/Development)
 * name both, because they aren't one brand.
 */
const PROPER_CODES = new Set([
  "All Proper",
  "AUP", // Austin Proper
  "DTLA", // Downtown LA Proper
  "SFP", // San Francisco Proper
  "SMP", // Santa Monica Proper
  "LTP", // Lake Tahoe Proper
  "Proper Club",
  "SMB", // The Shelborne By Proper
]);
const COLLECTIVE_CODES = new Set([
  "All Collective",
  "MYC", // Montauk Yacht Club
  "TCH", // The Culver Hotel
  "HJWL", // Hotel June West LA
  "HJM", // Hotel June Malibu
  "ABH", // Avalon Beverly Hills
  "APS", // Avalon Palm Springs
  "ING", // Ingleside Estate
  "DAL", // Dallas, not a Proper hotel
]);
const NEW_PROJECT_CODES = new Set(["New Projects/Development"]);

export function expectedRoutingBucket(properties: string[]): string | undefined {
  const buckets = new Set<string>();
  for (const property of properties) {
    if (PROPER_CODES.has(property)) buckets.add("Proper & By Proper");
    else if (COLLECTIVE_CODES.has(property)) buckets.add("Collective");
    else if (NEW_PROJECT_CODES.has(property)) buckets.add("New Projects");
  }
  if (buckets.size === 1) return [...buckets][0];
  if (buckets.size > 1) return "Mixed";
  return undefined;
}

export function secondContact(properties: string[]): string {
  const bucket = expectedRoutingBucket(properties);
  if (bucket === "Collective") return "Koral Captain (Collective)";
  if (bucket === "Proper & By Proper") return "DeeDee Brown (Proper & By Proper)";
  return "DeeDee Brown (Proper & By Proper) or Koral Captain (Collective)";
}

const PROPERTY_NICKNAMES: Record<string, string> = {
  "all properties": "All Properties",
  "all proper": "All Proper",
  austin: "AUP",
  "austin proper": "AUP",
  atxp: "AUP",
  aup: "AUP",
  dtla: "DTLA",
  dtlap: "DTLA",
  "downtown la": "DTLA",
  "downtown la proper": "DTLA",
  "downtown los angeles": "DTLA",
  "la proper": "DTLA",
  sfp: "SFP",
  "san francisco": "SFP",
  "san francisco proper": "SFP",
  smp: "SMP",
  "santa monica": "SMP",
  "santa monica proper": "SMP",
  "proper club": "Proper Club",
  club: "Proper Club",
  smb: "SMB",
  shelborne: "SMB",
  "all collective": "All Collective",
  collective: "All Collective",
  myc: "MYC",
  tch: "TCH",
  culver: "TCH",
  "culver hotel": "TCH",
  "the culver hotel": "TCH",
  hjwl: "HJWL",
  hjla: "HJWL",
  hjwla: "HJWL",
  "hotel june west la": "HJWL",
  "hotel june los angeles": "HJWL",
  hjm: "HJM",
  "hotel june malibu": "HJM",
  abh: "ABH",
  "avalon beverly hills": "ABH",
  "beverly hills": "ABH",
  aps: "APS",
  ing: "ING",
  ingleside: "ING",
  "ingleside estate": "ING",
  ltp: "LTP",
  "lake tahoe proper": "LTP",
  "lake tahoe": "LTP",
  tahoe: "LTP",
  dal: "DAL",
  dallas: "DAL",
  min: "MIN",
  minneapolis: "MIN",
  corporate: "Corporate",
  "new projects": "New Projects/Development",
  "new projects/development": "New Projects/Development",
  development: "New Projects/Development",
};

export function canonicalizeProperty(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (PROPERTIES[trimmed]) return trimmed;
  const nick = PROPERTY_NICKNAMES[trimmed.toLowerCase()];
  if (nick) return nick;
  const code = Object.keys(PROPERTIES).find((name) => name.toLowerCase() === trimmed.toLowerCase());
  return code;
}

const INFER_SKIP = new Set([
  "club",
  "development",
  "corporate",
  "collective",
  "new projects",
  "new projects/development",
]);

/** Property codes named by the email or message, longest place names first. */
export function inferProperties(text: string): string[] {
  const found: string[] = [];
  text = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[a-z0-9.-]+\.(?:com|net|org|hotel)\b/gi, " ");
  const phrases = Object.entries(PROPERTY_NICKNAMES)
    .filter(([phrase]) => !INFER_SKIP.has(phrase))
    .filter(([phrase]) => phrase.includes(" ") || phrase.length >= 5)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, code] of phrases) {
    const pattern = new RegExp(`(?<![a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "i");
    if (pattern.test(text) && !found.includes(code)) found.push(code);
  }
  for (const code of Object.keys(PROPERTIES)) {
    if (!/^[A-Z]{2,5}$/.test(code)) continue;
    if (new RegExp(`\\b${code}\\b`).test(text) && !found.includes(code)) found.push(code);
  }
  return found;
}

/** "Lake Tahoe (LTP)" when we know a place name, otherwise the code. */
export function propertyPhrase(code: string): string {
  const phrases = Object.entries(PROPERTY_NICKNAMES)
    .filter(([, value]) => value === code)
    .map(([phrase]) => phrase)
    .filter((phrase) => phrase.includes(" "));
  const named = phrases
    .filter((phrase) => !phrases.some((other) => other !== phrase && phrase.includes(other)))
    .sort((a, b) => b.split(" ").length - a.split(" ").length || a.length - b.length)[0];
  if (!named) return code;
  const title = named.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  return `${title} (${code})`;
}

const REQUEST_ALIASES: Record<string, RequestType> = {
  creative: "Creative",
  web: "Web",
  website: "Web",
  crm: "CRM & Paid",
  "crm & paid": "CRM & Paid",
  "crm and paid": "CRM & Paid",
  paid: "CRM & Paid",
  "paid media": "CRM & Paid",
  social: "Social",
  marketing: "Marketing",
};

export function canonicalizeRequestType(input: string): RequestType | undefined {
  const trimmed = input.trim();
  if ((REQUEST_TYPES as readonly string[]).includes(trimmed)) return trimmed as RequestType;
  return REQUEST_ALIASES[trimmed.toLowerCase()];
}

const TASK_ALIASES: Record<RequestType, Record<string, string>> = {
  Creative: {
    email: "Email",
    "e-mail": "Email",
    sms: "SMS",
    "pop up": "Pop Up",
    popup: "Pop Up",
    "pop-up": "Pop Up",
    "web page": "Web Page",
    webpage: "Web Page",
    social: "Social",
    "sales collateral": "Sales Collateral",
    "print collateral": "Print Collateral",
    print: "Print Collateral",
    menu: "Menu (F&B, Spa)",
    ad: "Ad",
    "digital asset": "Digital Asset",
    merch: "Merch",
    merchandise: "Merch",
    "brand systems": "Brand Systems",
    "photo/video selection": "Photo/Video Selection",
    "photo selection": "Photo/Video Selection",
    "video selection": "Photo/Video Selection",
    "photo/video shoot": "Photo/Video Shoot",
    "photo shoot": "Photo/Video Shoot",
    "video shoot": "Photo/Video Shoot",
    deck: "Presentation / Deck",
    presentation: "Presentation / Deck",
  },
  Web: {
    "new page": "New Page",
    "page edit": "Page Edit",
    edit: "Page Edit",
    happenings: "Happenings",
    "menu upload": "Menu Upload",
    seo: "SEO",
    "bug fix": "Bug Fix",
    bug: "Bug Fix",
    tracking: "Tracking",
    integrations: "Integrations",
    reporting: "Reporting",
    "brandfolder upload": "Brandfolder Upload",
    brandfolder: "Brandfolder Upload",
    "affiliate import": "Affiliate Import",
    "gmb updates": "GMB Updates",
    gmb: "GMB Updates",
    "ai optimization": "AI Optimization",
  },
  "CRM & Paid": {
    "transactional email": "Transactional Email",
    newsletter: "Newsletter Send",
    "newsletter send": "Newsletter Send",
    sms: "SMS Send",
    "sms send": "SMS Send",
    "pop up": "Pop Up",
    popup: "Pop Up",
    "automated flows": "Automated Flows (Abandon Cart, Exit Intent)",
    "abandon cart": "Automated Flows (Abandon Cart, Exit Intent)",
    "new user journey": "New User Journey (Subscriber Flows)",
    reporting: "Reporting",
    "rate code": "Rate Code – Transactional Emails",
    "ad strategy": "Ad Strategy",
    "ad refresh": "Ad Refresh",
  },
  Social: {
    influencer: "Influencer Request",
    "influencer request": "Influencer Request",
    "feed post": "Feed Post Request",
    feed: "Feed Post Request",
    story: "Story Request",
    "story request": "Story Request",
    "profile update": "Profile Update",
    reporting: "Reporting",
    engagement: "Engagement",
    "content planning": "Content Planning",
    "post scheduling": "Post Scheduling",
    "story uploads": "Story Uploads",
    "lo-fi content filming": "Lo-Fi Content Filming",
    "content editing": "Content Editing",
  },
  Marketing: {
    "marketing plan": "Marketing Plan",
    plan: "Marketing Plan",
    reporting: "Reporting",
    offer: "Offers",
    offers: "Offers",
    "programming & activations": "Programming & Activations",
    programming: "Programming & Activations",
    "copy writing": "Copy Writing",
    copywriting: "Copy Writing",
    "listing health": "Listing Health",
    "admin / set up": "Admin / Set Up",
    admin: "Admin / Set Up",
    "check brief": "Check Brief",
  },
};

export function canonicalizeTaskType(requestType: RequestType, input: string): string | undefined {
  const options = TASK_TYPE_FIELDS[requestType].options;
  const trimmed = input.trim();
  if (options[trimmed]) return trimmed;
  const exact = Object.keys(options).find((name) => name.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  return TASK_ALIASES[requestType][trimmed.toLowerCase()];
}

export function taskTypeNames(requestType: RequestType): string[] {
  return Object.keys(TASK_TYPE_FIELDS[requestType].options);
}

export function propertyNames(): string[] {
  return Object.keys(PROPERTIES);
}

export interface FieldUpdate {
  step: FieldUpdateStep;
  fieldGid: string;
  value: string | string[];
}

export function buildIntakeFieldUpdates(input: {
  requestType: RequestType;
  taskType: string;
  properties: string[];
}): FieldUpdate[] {
  const requestOption = REQUEST_TYPE_OPTIONS[input.requestType];
  const taskField = TASK_TYPE_FIELDS[input.requestType];
  const taskOption = taskField.options[input.taskType];
  if (!taskOption) {
    throw new Error(`Unknown task type "${input.taskType}" for ${input.requestType}.`);
  }
  if (input.properties.length === 0) {
    throw new Error("At least one property is required.");
  }
  const propertyGids = input.properties.map((property) => {
    const gid = PROPERTIES[property];
    if (!gid) throw new Error(`Unknown property "${property}".`);
    return gid;
  });
  const updates: FieldUpdate[] = [
    { step: "requestType", fieldGid: REQUEST_TYPE_FIELD_GID, value: requestOption },
    { step: "taskType", fieldGid: taskField.gid, value: taskOption },
    { step: "property", fieldGid: PROPERTY_FIELD_GID, value: propertyGids },
  ];
  if (updates.map((update) => update.step).join(",") !== FIELD_UPDATE_ORDER.join(",")) {
    throw new Error("Field update order drifted from Request Type, Task Type, Property.");
  }
  return updates;
}

export function normalizeDate(input: string): string | undefined {
  const trimmed = input.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const year = iso?.[1] ?? us?.[3];
  const month = iso?.[2] ?? us?.[1]?.padStart(2, "0");
  const day = iso?.[3] ?? us?.[2]?.padStart(2, "0");
  if (!year || !month || !day) return undefined;
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const date = new Date(Date.UTC(Number(year), numericMonth - 1, numericDay));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== numericMonth - 1 ||
    date.getUTCDate() !== numericDay
  ) {
    return undefined;
  }
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(iso: string): string {
  return formatDateInTimeZone(iso, "short");
}

export function formatFullDate(iso: string): string {
  return formatDateInTimeZone(iso, "long");
}

function formatDateInTimeZone(iso: string, month: "short" | "long"): string {
  const [year, monthNumber, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    month,
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function daysUntil(iso: string, today: Date): number {
  const [year, month, day] = iso.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - start) / 86_400_000);
}
