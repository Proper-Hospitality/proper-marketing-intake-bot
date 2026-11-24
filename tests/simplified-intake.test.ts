import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyAnswers } from "../src/intake/flow.js";
import { followUpsForFlow, taskTypesForFlow } from "../src/intake/question-tree.js";
import { catalogFromRecords, loadCreatorStudio, type CreatorStudioTemplate } from "../src/intake/creator-studio.js";
import { taskTypeNames } from "../src/intake/catalog.js";
import { rushApproverFor } from "../src/intake/rush.js";
import {
  brandLeadFor,
  hardRequestsCreateAsana,
  integrationsApprover,
  resolveWorkflow,
} from "../src/intake/workflows.js";
import { emptyConversation, type ConversationState } from "../src/store/types.js";

function simplified(key: string): ConversationState {
  const state = emptyConversation(key);
  state.intakeFlow = "simplified";
  return state;
}

const MONDAY_MORNING = new Date("2026-11-23T16:00:00Z");
const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/creator-studio.json", import.meta.url), "utf8"),
) as CreatorStudioTemplate[];

describe("bucket routing", () => {
  it("asks new or edit only where both exist, and that answer picks the bucket", () => {
    const email = simplified("C:email");
    const asked = applyAnswers(email, {
      requestType: "Creative",
      taskType: "Email",
      requestName: "Holiday note",
      properties: ["SMP"],
    }, MONDAY_MORNING);
    expect(asked.kind).toBe("ask_novelty");

    const edit = applyAnswers(email, { novelty: "edit" }, MONDAY_MORNING);
    expect(edit.kind).not.toBe("hard_question");
    expect(email.draft.workflowBucket).toBe("Editing Assets");
    expect(email.draft.workflowOwner).toBe("Julia");
    expect(email.draft.approver).toBe("Genevieve");

    const created = resolveWorkflow({
      requestType: "Creative",
      taskType: "Email",
      novelty: "new",
      properties: ["SMP"],
    });
    expect(created).toMatchObject({
      bucket: "New Assets",
      difficulty: "hard",
      owner: "Genevieve (Sr. Designer) or Julia (Designer)",
    });
    expect(created?.ownerNote).toMatch(/TODO/);
  });

  it("keeps edits and seasonal refreshes easy, and everything else hard", () => {
    expect(resolveWorkflow({ requestType: "Web", taskType: "Page Edit" })).toMatchObject({
      bucket: "Page Edit",
      difficulty: "easy",
      owner: "Elizabeth",
      approver: "Elizabeth",
    });
    expect(resolveWorkflow({ requestType: "Web", taskType: "Happenings" })?.difficulty).toBe("easy");
    expect(resolveWorkflow({ requestType: "Web", taskType: "Menu Upload" })?.difficulty).toBe("easy");
    expect(resolveWorkflow({ requestType: "Web", taskType: "New Page", requesterName: "Elena Ruiz" })).toMatchObject({
      bucket: "New Page",
      difficulty: "hard",
      owner: "Elizabeth",
      approver: "Elena Ruiz (requestor and/or submitter)",
    });
    expect(resolveWorkflow({ requestType: "Web", taskType: "Bug Fix" })).toMatchObject({
      bucket: "Bugs",
      difficulty: "hard",
      owner: "Elizabeth",
      approver: "Elizabeth",
    });
    expect(resolveWorkflow({ requestType: "Web", taskType: "SEO" })?.approver).toBe("Elizabeth");
    expect(resolveWorkflow({ requestType: "Web", taskType: "Tracking" })?.approver).toBe("Tatiana");
    expect(resolveWorkflow({ requestType: "Web", taskType: "Reporting" })?.approver).toBe("Tatiana");
    expect(resolveWorkflow({ requestType: "CRM & Paid", taskType: "Ad Refresh" })).toMatchObject({
      department: "Digital Ads",
      bucket: "Seasonal Refresh",
      difficulty: "easy",
      owner: "Jack",
      approver: "Jack",
    });
    expect(resolveWorkflow({ requestType: "CRM & Paid", taskType: "Ad Strategy" })).toMatchObject({
      department: "Digital Ads",
      difficulty: "hard",
      approver: "Tatiana",
    });
    expect(resolveWorkflow({
      requestType: "CRM & Paid",
      taskType: "Pop Up",
      novelty: "edit",
    })).toMatchObject({ department: "CRM", bucket: "Seasonal Refresh", difficulty: "easy", approver: "Jack" });
    expect(resolveWorkflow({
      requestType: "CRM & Paid",
      taskType: "Pop Up",
      novelty: "new",
    })).toMatchObject({ department: "CRM", bucket: "New Campaign", difficulty: "hard", approver: "Tatiana" });
    expect(resolveWorkflow({
      requestType: "CRM & Paid",
      taskType: "Reporting",
      reportingLane: "paid",
    })?.department).toBe("Digital Ads");
    expect(resolveWorkflow({
      requestType: "CRM & Paid",
      taskType: "Reporting",
      reportingLane: "crm",
    })?.department).toBe("CRM");
    expect(resolveWorkflow({ requestType: "Social", taskType: "Story Request", properties: ["SMP"] })).toMatchObject({
      difficulty: "hard",
      bucket: "New Posts/Stories",
      owner: "Savannah",
    });
    expect(resolveWorkflow({ requestType: "Social", taskType: "Feed Post Request", properties: ["TCH"] })?.owner).toBe("Kat");
    expect(resolveWorkflow({ requestType: "Marketing", taskType: "Offers", properties: ["SMP"] })).toMatchObject({
      department: "Brand",
      bucket: "New Work",
      difficulty: "hard",
      approver: "Kinsey",
    });
  });

  it("drops Brandfolder Upload and Affiliate Import, and treats Pop Up as a Klaviyo CRM task", () => {
    expect(taskTypeNames("Web")).toContain("Brandfolder Upload");
    expect(taskTypesForFlow("Web", "simplified")).not.toContain("Brandfolder Upload");
    expect(taskTypesForFlow("Web", "simplified")).not.toContain("Affiliate Import");
    expect(taskTypesForFlow("Creative", "simplified")).not.toContain("Pop Up");
    expect(taskTypesForFlow("Web", "classic")).toContain("Brandfolder Upload");
    expect(taskTypeNames("Web")).toContain("Integrations");
    const popup = followUpsForFlow("CRM & Paid", "Pop Up", "simplified").filter((field) => field.required).map((field) => field.label);
    expect(popup).toEqual(["Copy for Klaviyo", "Photo for Klaviyo"]);
    expect(followUpsForFlow("CRM & Paid", "Pop Up", "classic").map((field) => field.label)).toContain("Audience / Distribution Plan");

    const state = simplified("C:popup");
    const asked = applyAnswers(state, {
      requestType: "Creative",
      taskType: "Pop Up",
      requestName: "Spa popup",
      properties: ["SMP"],
    }, MONDAY_MORNING);
    expect(state.draft.requestType).toBe("CRM & Paid");
    expect(state.draft.taskType).toBe("Pop Up");
    expect(asked.kind).toBe("ask_novelty");
    const refresh = applyAnswers(state, { novelty: "edit" }, MONDAY_MORNING);
    expect(refresh.kind).not.toBe("hard_question");
    expect(state.draft.workflowBucket).toBe("Seasonal Refresh");
    expect(state.draft.whereItGoesLive).toBe("Klaviyo");
    expect(state.draft.approver).toBe("Jack");
  });

  it("leaves the Integrations approver as TODO until it is configured", () => {
    const open = resolveWorkflow({ requestType: "Web", taskType: "Integrations", env: {} });
    expect(open).toMatchObject({
      department: "Web",
      bucket: "Integrations",
      difficulty: "hard",
      owner: "Elizabeth",
      approver: "TODO",
      approverTodo: true,
    });
    expect(open?.ownerNote).toMatch(/TODO/);
    expect(integrationsApprover({ INTEGRATIONS_APPROVER: "Sam Lee" })).toEqual({ name: "Sam Lee", todo: false });
    expect(resolveWorkflow({
      requestType: "Web",
      taskType: "Integrations",
      env: { INTEGRATIONS_APPROVER: "Sam Lee" },
    })?.approver).toBe("Sam Lee");
    expect(hardRequestsCreateAsana({})).toBe(false);
    expect(hardRequestsCreateAsana({ HARD_REQUESTS_CREATE_ASANA: "true" })).toBe(true);
  });
});

describe("Creator Studio", () => {
  it("skips the lookup when no catalog is configured", () => {
    expect(loadCreatorStudio({}).configured).toBe(false);
    const state = simplified("C:page");
    const outcome = applyAnswers(state, {
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@example.com",
      requestName: "Homepage hero",
      properties: ["SMP"],
      requestType: "Web",
      taskType: "Page Edit",
    }, MONDAY_MORNING);
    expect(outcome.kind).not.toBe("creator_studio");
    expect(state.phase).not.toBe("creator_studio");
  });

  it("sends the template link and does not file a task when the fixture matches", () => {
    const catalog = catalogFromRecords(FIXTURE);
    const match = catalog.find({
      requestType: "Creative",
      taskType: "Email",
      text: "Holiday email for the season",
      properties: ["SMP"],
    });
    expect(match?.url).toBe("https://creatorstudio.example/templates/holiday-email-smp");
    expect(catalog.find({
      requestType: "Creative",
      taskType: "Email",
      text: "Holiday email",
      properties: ["AUP"],
    })).toBeNull();

    const previous = process.env.CREATOR_STUDIO_CATALOG_JSON;
    process.env.CREATOR_STUDIO_CATALOG_JSON = JSON.stringify(FIXTURE);
    try {
      const state = simplified("C:studio");
      const outcome = applyAnswers(state, {
        requestType: "Creative",
        taskType: "Email",
        novelty: "edit",
        requestName: "Holiday email",
        properties: ["SMP"],
      }, MONDAY_MORNING);
      expect(outcome.kind).toBe("creator_studio");
      if (outcome.kind === "creator_studio") {
        expect(outcome.text).toContain("https://creatorstudio.example/templates/holiday-email-smp");
        expect(outcome.text).toContain("didn't create an Asana task");
      }
      expect(state.phase).toBe("creator_studio");
    } finally {
      if (previous === undefined) delete process.env.CREATOR_STUDIO_CATALOG_JSON;
      else process.env.CREATOR_STUDIO_CATALOG_JSON = previous;
    }
  });
});

describe("new requests in the simplified flow", () => {
  it("asks the property before naming a manager", () => {
    const state = simplified("C:no-property");
    const asked = applyAnswers(state, {
      requestType: "Creative",
      taskType: "Email",
      novelty: "new",
      requestName: "Holiday email",
    }, MONDAY_MORNING);
    expect(asked.kind).toBe("ask_property");
    if (asked.kind === "ask_property") expect(asked.prompt).toContain("property");
  });

  it("asks the three brief questions, then the required email questions, and mentions DeeDee for SMB", () => {
    const state = simplified("C:smb-email");
    const first = applyAnswers(state, {
      requesterName: "Elena Ruiz",
      requestType: "Creative",
      taskType: "Email",
      novelty: "new",
      requestName: "Email for SMB",
      properties: ["SMB"],
    }, MONDAY_MORNING);
    expect(first.kind).toBe("hard_question");
    if (first.kind !== "hard_question") return;
    expect(first.notice).toBe("This is a new request, so it needs approval from <@U0B6N3RE23T>.");
    expect(first.prompt).toBe("What do you need this for? For example, a promotion, an event, or to drive bookings.");
    expect(`${first.notice} ${first.prompt}`).not.toMatch(/TODO|Genevieve|Julia|Talley|paste the notes|will connect/i);

    const second = applyAnswers(state, { businessProblem: "Guests are not opening the last email." }, MONDAY_MORNING);
    expect(second.kind).toBe("hard_question");
    if (second.kind === "hard_question") {
      expect(second.prompt).toBe("How will we know it worked? For example, more bookings, sign-ups, or clicks.");
      expect(second.notice).toBeUndefined();
    }

    const third = applyAnswers(state, { successLooksLike: "More bookings from the email." }, MONDAY_MORNING);
    expect(third.kind).toBe("hard_question");
    if (third.kind === "hard_question") {
      expect(third.prompt).toBe("Is there a budget for this? If not, just say no.");
    }

    const audience = applyAnswers(state, { budget: "No extra budget." }, MONDAY_MORNING);
    expect(audience.kind).toBe("task_question");
    if (audience.kind === "task_question") {
      expect(audience.id).toBe("followup:Audience / Distribution Plan");
      expect(audience.prompt).toBe("Who should get this, and where will they see it?");
      expect(audience.prompt).not.toMatch(/\b(assets|distribution|deliverable|creative)\b/i);
    }

    const copy = applyAnswers(state, {
      followUps: { "Audience / Distribution Plan": "SMB guests on the newsletter list" },
    }, MONDAY_MORNING);
    expect(copy.kind).toBe("task_question");
    if (copy.kind === "task_question") {
      expect(copy.id).toBe("followup:Recommended Copy / Details");
      expect(copy.prompt).toBe("What should the text (copy) say?");
      expect(copy.prompt).not.toMatch(/\bassets\b/i);
    }

    const done = applyAnswers(state, {
      followUps: { "Recommended Copy / Details": "Join us at Shelborne this weekend." },
    }, MONDAY_MORNING);
    expect(done.kind).toBe("hard_done");
    if (done.kind === "hard_done") {
      expect(done.text).toContain("<@U0B6N3RE23T>");
      expect(done.text).toContain("Nothing was filed");
      expect(done.text).not.toMatch(/TODO|Genevieve|Julia|Talley/);
    }
  });

  it("mentions Koral for Collective and DeeDee for Lake Tahoe", () => {
    expect(brandLeadFor(["SMP"]).id).toBe("U0B6N3RE23T");
    expect(brandLeadFor(["LTP"]).name).toBe("DeeDee Brown");
    expect(brandLeadFor(["TCH"]).id).toBe("U0B5F1HN98Q");
    expect(rushApproverFor(["LTP"]).name).toBe("Kinsey East");
    const collective = simplified("C:social");
    const asked = applyAnswers(collective, {
      requestType: "Social",
      taskType: "Feed Post Request",
      novelty: "new",
      requestName: "Roof night",
      properties: ["TCH"],
    }, MONDAY_MORNING);
    expect(asked.kind).toBe("hard_question");
    if (asked.kind === "hard_question") {
      expect(asked.notice).toContain("<@U0B5F1HN98Q>");
      expect(asked.notice).not.toMatch(/Kat|Genevieve|TODO/);
    }
  });
});
