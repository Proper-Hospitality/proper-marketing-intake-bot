import { expectedRoutingBucket } from "./catalog.js";
import { rushApprovers, type RushApprover } from "./rush.js";
import type { RequestType } from "./types.js";

/**
 * Owner and approver matrix from the Nov 23 workshop, with Elena's Nov 23 answers.
 * Easy means an edit or a seasonal refresh. Everything else is hard.
 */

export type WorkNovelty = "new" | "edit";
export type ReportingLane = "paid" | "crm";
export type Difficulty = "easy" | "hard";

export interface WorkflowAssignment {
  department: string;
  bucket: string;
  difficulty: Difficulty;
  owner: string;
  approver: string;
  /** People to suggest for the kickoff. */
  suggestions: string[];
  /** The approver is still a placeholder. */
  approverTodo?: boolean;
  /** The owner split is not decided yet. */
  ownerNote?: string;
}

export const INTEGRATIONS_APPROVER_TODO = "TODO";

/** Shown on every hard handoff. Koral and DeeDee stay named together, with the property each one covers. */
export const BRAND_LEADS_TOGETHER =
  "Koral Captain (Collective) and DeeDee Brown (Proper & By Proper, including Lake Tahoe)";

const CREATIVE_DUAL = new Set([
  "Email",
  "SMS",
  "Ad",
  "Web Page",
  "Menu (F&B, Spa)",
  "Print Collateral",
  "Sales Collateral",
  "Social",
  "Merch",
  "Digital Asset",
  "Presentation / Deck",
]);

const CREATIVE_DIRECTION = new Set([
  "Brand Systems",
  "Photo/Video Selection",
  "Photo/Video Shoot",
]);

const CRM_DUAL = new Set([
  "Pop Up",
  "Automated Flows (Abandon Cart, Exit Intent)",
]);

const CRM_EASY = new Set([
  "Transactional Email",
  "Rate Code – Transactional Emails",
  "Ad Refresh",
]);

const CRM_HARD = new Set([
  "Newsletter Send",
  "SMS Send",
  "New User Journey (Subscriber Flows)",
  "Ad Strategy",
  "Reporting",
]);

const WEB_EASY = new Set(["Page Edit", "Happenings", "Menu Upload"]);

const WEB_HARD = new Set(["New Page", "Bug Fix", "SEO", "Tracking", "Reporting", "Integrations"]);

const SOCIAL_POSTS = new Set(["Feed Post Request", "Story Request"]);

const SOCIAL_STRATEGY = new Set(["Profile Update"]);

const BRAND_NEW = new Set(["Marketing Plan", "Offers", "Programming & Activations"]);

export function integrationsApprover(env: NodeJS.ProcessEnv = process.env): { name: string; todo: boolean } {
  const set = env.INTEGRATIONS_APPROVER?.trim();
  if (!set || set.toUpperCase() === INTEGRATIONS_APPROVER_TODO) {
    return { name: INTEGRATIONS_APPROVER_TODO, todo: true };
  }
  return { name: set, todo: false };
}

export function hardRequestsCreateAsana(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test((env.HARD_REQUESTS_CREATE_ASANA ?? "").trim());
}

/** Creative asset types and CRM Pop Up / Automated Flows can be either new or an edit. */
export function needsNoveltyQuestion(requestType: RequestType | undefined, taskType: string | undefined): boolean {
  if (!requestType || !taskType) return false;
  if (requestType === "Creative" && CREATIVE_DUAL.has(taskType)) return true;
  if (requestType === "CRM & Paid" && CRM_DUAL.has(taskType)) return true;
  return false;
}

/** CRM & Paid Reporting is either paid media or CRM. The owner is Jack either way. */
export function needsReportingLane(requestType: RequestType | undefined, taskType: string | undefined): boolean {
  return requestType === "CRM & Paid" && taskType === "Reporting";
}

export function parseNoveltyAnswer(text: string): WorkNovelty | undefined {
  const plain = text.trim().replace(/[.!?]+$/g, "");
  if (!plain || plain.length > 160) return undefined;
  const edit = /\b(edit|editing|refresh|revise|tweak|existing)\b/i.test(plain);
  const fresh = /\b(brand new|from scratch|net new)\b/i.test(plain) || /^new\b/i.test(plain) || /\bit'?s new\b/i.test(plain);
  if (edit && !fresh) return "edit";
  if (fresh && !edit) return "new";
  return undefined;
}

export function parseReportingLane(text: string): ReportingLane | undefined {
  const plain = text.trim().replace(/[.!?]+$/g, "");
  if (!plain || plain.length > 80) return undefined;
  if (/^(paid|ads?|digital ads|paid media)\b/i.test(plain)) return "paid";
  if (/^(crm|email|lifecycle)\b/i.test(plain)) return "crm";
  return undefined;
}

/** A clear "edit" or "new" already in the request, so the bot does not ask again. */
export function inferNovelty(text: string): WorkNovelty | undefined {
  const edit = /\b(edit|editing|refresh|revise|tweak)\b/i.test(text) || /\bupdate the existing\b/i.test(text);
  const fresh = /\b(brand new|from scratch|net new)\b/i.test(text);
  if (edit && !fresh) return "edit";
  if (fresh && !edit) return "new";
  return undefined;
}

export function inferReportingLane(text: string): ReportingLane | undefined {
  const paid = /\b(paid media|digital ads|ad reporting)\b/i.test(text);
  const crm = /\bcrm reporting\b/i.test(text);
  if (paid && !crm) return "paid";
  if (crm && !paid) return "crm";
  return undefined;
}

/**
 * The Proper / Collective split from rushApproverFor.
 * New properties stay on that split. Kinsey approves brand new work. She is not who the request is handed to.
 * Lake Tahoe (LTP) is Proper, so it goes to DeeDee.
 */
export function brandLeadFor(properties: string[] | undefined, env: NodeJS.ProcessEnv = process.env): RushApprover {
  const people = rushApprovers(env);
  const deedee = people.find((person) => person.name === "DeeDee Brown") ?? people[1];
  const koral = people.find((person) => person.name === "Koral Captain") ?? people[0];
  const bucket = expectedRoutingBucket(properties ?? []);
  if (bucket === "Proper & By Proper") return deedee;
  if (bucket === "Collective") return koral;
  console.warn(JSON.stringify({
    msg: "brand_lead_bucket_unknown",
    properties: properties ?? [],
    bucket: bucket ?? null,
    fallback: deedee.name,
  }));
  return deedee;
}

export function resolveWorkflow(input: {
  requestType?: RequestType;
  taskType?: string;
  novelty?: WorkNovelty;
  reportingLane?: ReportingLane;
  properties?: string[];
  requesterName?: string;
  env?: NodeJS.ProcessEnv;
}): WorkflowAssignment | undefined {
  const { requestType, taskType } = input;
  if (!requestType || !taskType) return undefined;
  if (requestType === "Creative") return creativeWorkflow(taskType, input.novelty);
  if (requestType === "Web") return webWorkflow(taskType, input.requesterName, input.env);
  if (requestType === "CRM & Paid") return crmWorkflow(taskType, input.novelty, input.reportingLane);
  if (requestType === "Social") return socialWorkflow(taskType, input.properties);
  if (requestType === "Marketing") return marketingWorkflow(taskType, input.properties);
  return undefined;
}

function creativeWorkflow(taskType: string, novelty: WorkNovelty | undefined): WorkflowAssignment | undefined {
  if (CREATIVE_DIRECTION.has(taskType)) {
    return {
      department: "Creative",
      bucket: "Direction, Brand Systems & Photoshoots",
      difficulty: "hard",
      owner: "Genevieve (Sr. Designer) or Talley",
      approver: "Talley or the stakeholder",
      suggestions: ["Genevieve", "Talley"],
      ownerNote: "Sr. Designer or Talley, by the project.",
    };
  }
  if (!CREATIVE_DUAL.has(taskType) || !novelty) return undefined;
  if (novelty === "edit") {
    return {
      department: "Creative",
      bucket: "Editing Assets",
      difficulty: "easy",
      owner: "Julia",
      approver: "Genevieve",
      suggestions: ["Julia", "Genevieve"],
    };
  }
  return {
    department: "Creative",
    bucket: "New Assets",
    difficulty: "hard",
    owner: "Genevieve (Sr. Designer) or Julia (Designer)",
    approver: "Talley if Genevieve owns it; Genevieve if Julia owns it",
    suggestions: ["Genevieve", "Julia", "Talley"],
    ownerNote: "TODO: the Genevieve vs Julia split is with Kinsey. It depends on the project and the property.",
  };
}

function webWorkflow(
  taskType: string,
  requesterName: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
): WorkflowAssignment | undefined {
  if (WEB_EASY.has(taskType)) {
    return {
      department: "Web",
      bucket: "Page Edit",
      difficulty: "easy",
      owner: "Elizabeth",
      approver: "Elizabeth",
      suggestions: ["Elizabeth"],
    };
  }
  if (taskType === "Integrations") {
    const approver = integrationsApprover(env);
    return {
      department: "Web",
      bucket: "Integrations",
      difficulty: "hard",
      owner: "Elizabeth",
      approver: approver.todo ? INTEGRATIONS_APPROVER_TODO : approver.name,
      approverTodo: approver.todo,
      suggestions: ["Elizabeth"],
      ownerNote: approver.todo
        ? "TODO: Integrations has no approver in the matrix. Confirm it with Kinsey and set INTEGRATIONS_APPROVER."
        : undefined,
    };
  }
  if (!WEB_HARD.has(taskType)) return undefined;
  if (taskType === "New Page") {
    const requestor = requesterName?.trim();
    return {
      department: "Web",
      bucket: "New Page",
      difficulty: "hard",
      owner: "Elizabeth",
      approver: requestor ? `${requestor} (requestor and/or submitter)` : "Requestor and/or submitter",
      suggestions: ["Elizabeth"],
    };
  }
  if (taskType === "Bug Fix") {
    return {
      department: "Web",
      bucket: "Bugs",
      difficulty: "hard",
      owner: "Elizabeth",
      approver: "Elizabeth",
      suggestions: ["Elizabeth"],
    };
  }
  if (taskType === "SEO") {
    return {
      department: "Web",
      bucket: "Audit & Reporting",
      difficulty: "hard",
      owner: "Elizabeth",
      approver: "Elizabeth",
      suggestions: ["Elizabeth"],
    };
  }
  return {
    department: "Web",
    bucket: "Audit & Reporting",
    difficulty: "hard",
    owner: "Elizabeth",
    approver: "Tatiana",
    suggestions: ["Elizabeth", "Tatiana"],
  };
}

function crmWorkflow(
  taskType: string,
  novelty: WorkNovelty | undefined,
  reportingLane: ReportingLane | undefined,
): WorkflowAssignment | undefined {
  if (taskType === "Ad Refresh") {
    return seasonal("Digital Ads", "Jack");
  }
  if (taskType === "Ad Strategy") {
    return campaign("Digital Ads", "Jack");
  }
  if (CRM_EASY.has(taskType)) {
    return seasonal("CRM", "Jack");
  }
  if (CRM_DUAL.has(taskType)) {
    if (!novelty) return undefined;
    return novelty === "edit" ? seasonal("CRM", "Jack") : campaign("CRM", "Jack");
  }
  if (taskType === "Reporting") {
    if (!reportingLane) return undefined;
    return audit(reportingLane === "paid" ? "Digital Ads" : "CRM", "Jack");
  }
  if (CRM_HARD.has(taskType)) return campaign(taskType === "Ad Strategy" ? "Digital Ads" : "CRM", "Jack");
  return undefined;
}

function seasonal(department: string, owner: string): WorkflowAssignment {
  return {
    department,
    bucket: "Seasonal Refresh",
    difficulty: "easy",
    owner,
    approver: owner,
    suggestions: [owner],
  };
}

function campaign(department: string, owner: string): WorkflowAssignment {
  return {
    department,
    bucket: "New Campaign",
    difficulty: "hard",
    owner,
    approver: "Tatiana",
    suggestions: [owner, "Tatiana"],
  };
}

function audit(department: string, owner: string): WorkflowAssignment {
  return {
    department,
    bucket: "Audit & Reporting",
    difficulty: "hard",
    owner,
    approver: "Tatiana",
    suggestions: [owner, "Tatiana"],
  };
}

function socialOwner(properties: string[] | undefined): { owner: string; suggestions: string[] } {
  const bucket = expectedRoutingBucket(properties ?? []);
  if (bucket === "Collective") return { owner: "Kat", suggestions: ["Kat"] };
  if (bucket === "Proper & By Proper") return { owner: "Savannah", suggestions: ["Savannah"] };
  return {
    owner: "Kat (Collective), Savannah (Proper & By Proper), or Jess, Sadie, Haley, or Mia",
    suggestions: ["Kat", "Savannah", "Jess", "Sadie", "Haley", "Mia"],
  };
}

function socialWorkflow(taskType: string, properties: string[] | undefined): WorkflowAssignment {
  const owner = socialOwner(properties);
  const lead = brandLeadFor(properties);
  if (SOCIAL_POSTS.has(taskType)) {
    return {
      department: "Social",
      bucket: "New Posts/Stories",
      difficulty: "hard",
      owner: owner.owner,
      approver: lead.name,
      suggestions: owner.suggestions,
    };
  }
  if (SOCIAL_STRATEGY.has(taskType)) {
    return {
      department: "Social",
      bucket: "Strategy",
      difficulty: "hard",
      owner: owner.owner,
      approver: "Elizabeth",
      suggestions: [...owner.suggestions, "Elizabeth"],
    };
  }
  if (taskType === "Reporting") {
    return {
      department: "Social",
      bucket: "Audit & Reporting",
      difficulty: "hard",
      owner: owner.owner,
      approver: "Tatiana",
      suggestions: [...owner.suggestions, "Tatiana"],
    };
  }
  return {
    department: "Social",
    bucket: "Engagement, Content & Influencers",
    difficulty: "hard",
    owner: owner.owner,
    approver: lead.name,
    suggestions: owner.suggestions,
  };
}

function marketingWorkflow(taskType: string, properties: string[] | undefined): WorkflowAssignment | undefined {
  const lead = brandLeadFor(properties);
  if (BRAND_NEW.has(taskType)) {
    return {
      department: "Brand",
      bucket: "New Work",
      difficulty: "hard",
      owner: lead.name,
      approver: "Kinsey",
      suggestions: [lead.name, "Kinsey"],
    };
  }
  if (taskType === "Reporting") {
    return {
      department: "Brand",
      bucket: "Reporting & Auditing",
      difficulty: "hard",
      owner: lead.name,
      approver: "Tatiana",
      suggestions: [lead.name, "Tatiana"],
    };
  }
  return undefined;
}

/** A single person's name the easy path can file as the approver. */
export function concreteApprover(workflow: WorkflowAssignment): string | undefined {
  if (workflow.approverTodo) return undefined;
  if (/^(Elizabeth|Jack|Julia|Genevieve|Tatiana|Kinsey|Kat|Savannah)$/.test(workflow.approver)) {
    return workflow.approver;
  }
  if (workflow.approver === "DeeDee Brown" || workflow.approver === "Koral Captain") return workflow.approver;
  return undefined;
}
