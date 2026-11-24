import { describe, expect, it, vi } from "vitest";
import { buildDescription, formatSummary } from "../src/intake/brief.js";
import { extractLinks, rememberAttachment } from "../src/intake/capture.js";
import { applyAnswers } from "../src/intake/flow.js";
import { attachmentMissing, markEmailSlices } from "../src/intake/attachments.js";
import {
  NEW_PROPERTY_APPROVER,
  NEW_PROPERTY_APPROVER_CODES,
  applyDefaultApprover,
} from "../src/intake/catalog.js";
import { NORMAL_24_HOUR_SENDS, isNormal24HourSend, leadTimeIsTight, leadTimeSentence } from "../src/intake/lead-time.js";
import { listMissing } from "../src/intake/missing.js";
import { applyRushBlock } from "../src/intake/relative-date.js";
import { rushApproverFor, rushApprovers, rushExplanation } from "../src/intake/rush.js";
import { startRushApproval } from "../src/intake/rush-approval.js";
import { failedAttachmentLine, uploadLoadedAttachments } from "../src/intake/task-files.js";
import { taskName } from "../src/intake/task-name.js";
import { submitConfirmedBrief } from "../src/slack/submit.js";
import { MemoryStore } from "../src/store/memory.js";
import { emptyConversation } from "../src/store/types.js";
import type { BriefDraft } from "../src/intake/types.js";

const TODAY = new Date("2026-11-16T18:00:00Z");
const NEXT_DAY = "2026-11-17";

describe("Kinsey's Asana task shape", () => {
  it("keeps the request name and drops a pasted Asana task and a Slack label", () => {
    expect(taskName(kinseyDraft())).toBe("MIN, Local Announcement Email");
    expect(extractLinks("<http://properhotel.com/minneapolis|properhotel.com/minneapolis>")).toEqual([
      "http://properhotel.com/minneapolis",
    ]);
    expect(extractLinks("http://properhotel.com/minneapolis%7Cproperhotel.com/minneapolis")).toEqual([
      "http://properhotel.com/minneapolis",
    ]);
    expect(extractLinks("this is what it should look like https://app.asana.com/0/1/1220581549470491")).toEqual([]);
    expect(extractLinks("Kelly section CTA: https://www.kellywearstler.com/pages/interior-projects#hotels")).toEqual([
      "https://www.kellywearstler.com/pages/interior-projects#hotels",
    ]);
  });

  it("writes form pairs, one sign-off, and filenames without Slack links", () => {
    const draft = kinseyDraft();
    const notes = buildDescription({ draft, templateOffer: null, slackThread: "https://slack.com/archives/C1/p1" });
    expect(notes).toContain("Name:\nKinsey East");
    expect(notes).toContain("Email address:\nkinsey.east@properhotel.com");
    expect(notes).toContain("Request Name:\nLocal Announcement Email");
    expect(notes).toContain("Property:\nMIN");
    expect(notes).toContain("Requested Completion Date:\nNov 17, 2026");
    expect(notes).toContain("What can we help you with?:\nCRM & Paid");
    expect(notes).toContain("What type of CRM or paid media support do you need?:\nNewsletter Send");
    expect(notes).toContain("Audience / Distribution Plan:\nMinnesota Database");
    expect(notes).toContain("Recommended Copy / Details:\nslices attached\nshould send at 11am CST");
    expect(notes).toContain("CTA Links:\nCTA for most is http://properhotel.com/minneapolis");
    expect(notes).toContain("https://www.kellywearstler.com/pages/interior-projects#hotels");
    expect(notes).toContain("Figma Link:\nN/A");
    expect(notes).toContain("Subject Line:\nWe're headed to Minneapolis");
    expect(notes).toContain("Approver:\nKinsey East");
    expect(notes).toContain("Sign-off:\nKinsey East");
    expect(notes).not.toContain("## Brief");
    expect(notes).not.toContain("## Assets");
    expect(notes).not.toContain("Attachment type:");
    expect(notes).not.toContain("Link you provided");
    expect(notes).not.toContain("slack.com/files");
    expect(notes).not.toContain("app.asana.com");
    expect(notes).not.toContain("%7C");
    expect(notes).not.toContain("More than 15,000 square feet");
    expect(notes).not.toContain("approver to be confirmed");
    expect(notes.match(/properhotel\.com\/minneapolis/g)).toHaveLength(1);

    const summary = formatSummary({ draft, warnings: [], templateOffer: null, duplicates: [] });
    expect(summary).toContain("Task name: *MIN, Local Announcement Email*");
    expect(summary).toContain("Approver: Kinsey East");
    expect(summary).toContain("Sign-off: Kinsey East");
    expect(summary).toContain("Attachments: Group 1.png, Group 2.png, Group 3.png, Group 4.png");
    expect(summary).not.toContain("Goes live:");
    expect(summary).not.toContain("Link you provided");
    expect(summary).not.toContain("File:");
    expect(summary).not.toContain("Assets:");
    expect(summary).not.toContain("\nCopy:");
    expect(summary).not.toContain("slack.com");
    expect(summary).not.toContain("%7C");
    expect(summary.match(/CTA Links:/g)).toHaveLength(1);
  });

  it("does not ask what kind of file a described email slice is", () => {
    const draft = kinseyDraft();
    for (const file of draft.attachments ?? []) delete file.kind;
    expect(attachmentMissing(draft).map((item) => item.id)).not.toContain("attachmentKind:0");
    expect(draft.attachments?.every((file) => file.kind === "email_slice")).toBe(true);

    const described: BriefDraft = {
      requestType: "Creative",
      taskType: "Email",
      attachments: [{ ref: "slice.png", name: "slice.png" }],
    };
    rememberAttachment(described, { slackFileId: "F9", name: "slice.png", mimetype: "image/png" });
    markEmailSlices(described, "the files are the slices of the email");
    expect(described.attachments?.[0]?.kind).toBe("email_slice");
    expect(attachmentMissing(described).some((item) => item.id.startsWith("attachmentKind:"))).toBe(false);
  });
});

describe("24 hour CRM sends", () => {
  it("treats next-day Newsletter Send and SMS Send as normal", () => {
    expect(NORMAL_24_HOUR_SENDS).toEqual(["Newsletter Send", "SMS Send"]);
    const newsletter = kinseyDraft();
    newsletter.properties = ["SMP"];
    newsletter.requesterEmail = "elena@properhotel.com";
    applyRushBlock(newsletter, TODAY);
    expect(newsletter.rushBlock).toBeUndefined();
    expect(isNormal24HourSend(newsletter)).toBe(true);
    expect(leadTimeIsTight(newsletter, TODAY)).toBe(false);
    expect(leadTimeSentence(newsletter, TODAY)).not.toContain("7-day");
    expect(listMissing(newsletter, TODAY).warnings.join(" ")).not.toContain("7-day");

    const sms: BriefDraft = {
      ...kinseyDraft(),
      properties: ["SMP"],
      requesterEmail: "elena@properhotel.com",
      taskType: "SMS Send",
      followUps: {
        "Audience / Distribution Plan": "Minnesota Database",
        "Recommended Copy / Details": "We're headed to Minneapolis",
        "CTA Link": "http://properhotel.com/minneapolis",
      },
    };
    applyRushBlock(sms, TODAY);
    expect(sms.rushBlock).toBeUndefined();
    expect(leadTimeIsTight(sms, TODAY)).toBe(false);

    const sameDay = kinseyDraft();
    sameDay.requestedCompletionDate = "2026-11-16";
    sameDay.requesterEmail = "elena@properhotel.com";
    applyRushBlock(sameDay, TODAY);
    expect(sameDay.rushBlock).toBe("same_day");

    const weekend = kinseyDraft();
    weekend.requestedCompletionDate = "2026-11-21";
    applyRushBlock(weekend, TODAY);
    expect(weekend.rushBlock).toBe("weekend");

    const friday = new Date("2026-11-13T18:00:00Z");
    const monday = kinseyDraft();
    monday.requestedCompletionDate = "2026-11-16";
    monday.requesterEmail = "elena@properhotel.com";
    applyRushBlock(monday, friday);
    expect(monday.rushBlock).toBe("friday_monday");

    const offer: BriefDraft = {
      requestType: "Marketing",
      taskType: "Offers",
      requestedCompletionDate: NEXT_DAY,
    };
    applyRushBlock(offer, TODAY);
    expect(offer.rushBlock).toBe("next_day");
    const email: BriefDraft = {
      requestType: "Creative",
      taskType: "Email",
      requestedCompletionDate: NEXT_DAY,
    };
    expect(leadTimeIsTight(email, TODAY)).toBe(true);
    expect(leadTimeSentence(email, TODAY)).toContain("inside the 7-day lead time");
  });

  it("files Kinsey's MIN newsletter straight through after Confirm", async () => {
    const state = emptyConversation("C:min");
    state.draft.attachments = kinseyDraft().attachments;
    const outcome = applyAnswers(state, {
      requesterName: "Kinsey East",
      requesterEmail: "kinsey.east@properhotel.com",
      requestName: "Local Announcement Email",
      properties: ["MIN"],
      requestType: "CRM & Paid",
      taskType: "Newsletter Send",
      requestedCompletionDate: NEXT_DAY,
      consequenceOfDelay: "We miss the announcement.",
      followUps: kinseyDraft().followUps,
    }, TODAY);
    expect(outcome.kind).toBe("confirm");
    expect(state.draft.rushBlock).toBeUndefined();
    expect(state.draft.approver).toBe("Kinsey East");
    expect(state.phase).toBe("awaiting_confirm");
    expect(listMissing(state.draft, TODAY).warnings.join(" ")).not.toContain("inside the 7-day lead time");

    const store = new MemoryStore();
    await store.saveConversation(state);
    const calls: string[] = [];
    let notes = "";
    const filed = await submitConfirmedBrief({
      confirmed: true,
      version: state.confirmVersion,
      state,
      store,
      token: "asana",
      slackToken: "xoxb-test",
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        const method = init?.method ?? "GET";
        calls.push(`${method} ${href}`);
        if (typeof init?.body === "string" && href.endsWith("/tasks")) notes = init.body;
        if (href.includes("files.info")) {
          const id = new URL(href).searchParams.get("file") ?? "file";
          return json({
            ok: true,
            file: {
              name: `${id}.png`,
              mimetype: "image/png",
              permalink: `https://slack.example/files/${id}`,
              url_private: `https://files.slack.com/${id}`,
            },
          });
        }
        if (href.includes("files.slack.com")) return new Response(Uint8Array.from([1, 2, 3]));
        if (method === "POST" && href.endsWith("/tasks")) return json({ data: { gid: "T-MIN" } });
        if (method === "POST" && href.includes("/attachments")) return json({ data: { gid: "ATT" } });
        if (method === "GET" && href.includes("/attachments")) return json({ data: [] });
        if (method === "PUT") return json({ data: { gid: "T-MIN" } });
        return json({
          data: {
            gid: "T-MIN",
            permalink_url: "https://app.asana.com/0/1/T-MIN",
            memberships: [
              { project: { gid: "1217171684008018", name: "New Intake Board" }, section: { name: "New requests - Submitted via Form" } },
            ],
            custom_fields: [
              { name: "Request Type_New Intake Board", display_value: "CRM & Paid" },
              { name: "CRM & Paid Task Type", display_value: "Newsletter Send" },
              { name: "Property List_New Intake Board", display_value: "MIN" },
              { name: "Status in Que", display_value: "New Request" },
              { name: "Estimated time", display_value: "1h" },
            ],
          },
        });
      }) as unknown as typeof fetch,
    });
    expect(filed.text).toContain("https://app.asana.com/0/1/T-MIN");
    expect(filed.text).not.toContain("needs approval");
    expect(notes).toContain("MIN, Local Announcement Email");
    expect(notes).toContain("Sign-off:\\nKinsey East");
    expect(notes).not.toContain("slack.example");
    expect(calls.filter((call) => call.includes("/attachments") && call.startsWith("POST"))).toHaveLength(4);
    expect(state.uploadedSlackFileIds).toHaveLength(4);
  });
});

describe("rush approval by brand", () => {
  it("asks DeeDee for Proper and By Proper, Koral for Collective, and DeeDee when the bucket is unknown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(rushApproverFor(["SMP"])).toMatchObject({ name: "DeeDee Brown", id: "U0B6N3RE23T" });
      expect(rushApproverFor(["SMB"])).toMatchObject({ name: "DeeDee Brown", id: "U0B6N3RE23T" });
      expect(rushApproverFor(["HJWL"])).toMatchObject({ name: "Koral Captain", id: "U0B5F1HN98Q" });
      expect(warn).not.toHaveBeenCalled();

      expect(rushApproverFor(["MIN"])).toMatchObject({ name: "Kinsey East", id: "U0ANYBQHGCR" });
      expect(warn).not.toHaveBeenCalled();
      expect(rushExplanation("next_day", NEXT_DAY, "DeeDee Brown")).toContain("I'll ask DeeDee Brown");
      expect(rushExplanation("next_day", NEXT_DAY, "Koral Captain")).toContain("I'll ask Koral Captain");
      expect(rushExplanation("next_day", NEXT_DAY, "DeeDee Brown")).not.toContain("and Koral");

      const store = new MemoryStore();
      const collective = emptyConversation("C:collective");
      collective.draft.properties = ["TCH"];
      const collectiveDms: string[] = [];
      await startRushApproval({
        state: collective,
        store,
        date: NEXT_DAY,
        reason: "next_day",
        summary: "Culver needs this tomorrow.",
        channel: "C1",
        postDm: async (userId) => { collectiveDms.push(userId); },
      });
      expect(collectiveDms).toEqual(["U0B5F1HN98Q"]);

      const unknown = emptyConversation("C:unknown");
      unknown.draft.properties = ["Corporate"];
      const unknownDms: string[] = [];
      await startRushApproval({
        state: unknown,
        store,
        date: NEXT_DAY,
        reason: "next_day",
        summary: "Corporate needs this tomorrow.",
        channel: "C1",
        postDm: async (userId) => { unknownDms.push(userId); },
      });
      expect(unknownDms).toEqual(["U0B6N3RE23T"]);
      expect(warn.mock.calls.length).toBeGreaterThan(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("new-property sign-off", () => {
  it("defaults to Kinsey East and leaves rush approval with Koral and DeeDee", () => {
    expect(NEW_PROPERTY_APPROVER).toMatchObject({
      name: "Kinsey East",
      email: "kinsey.east@properhotel.com",
      slackId: "U0ANYBQHGCR",
    });
    expect([...NEW_PROPERTY_APPROVER_CODES]).toEqual(["MIN", "LTP", "DAL", "New Projects/Development"]);
    for (const code of NEW_PROPERTY_APPROVER_CODES) {
      const draft: BriefDraft = { properties: [code] };
      applyDefaultApprover(draft);
      expect(draft.approver).toBe("Kinsey East");
    }
    const named: BriefDraft = { properties: ["MIN"], approver: "DeeDee Brown" };
    applyDefaultApprover(named);
    expect(named.approver).toBe("DeeDee Brown");
    const proper: BriefDraft = { properties: ["SMP"] };
    applyDefaultApprover(proper);
    expect(proper.approver).toBeUndefined();
    const approvers = rushApprovers();
    expect(approvers.map((person) => person.id)).toEqual(["U0B5F1HN98Q", "U0B6N3RE23T"]);
    expect(approvers.map((person) => person.name).join(" ")).not.toContain("Kinsey");
  });

  it("puts a failed Slack upload on one line", async () => {
    const result = await uploadLoadedAttachments({
      taskGid: "T",
      asanaToken: "asana",
      files: [{
        slackFileId: "F1",
        name: "Group 1.png",
        bytes: Uint8Array.from([1]),
        permalink: "https://slack.example/files/F1",
      }],
      fetchImpl: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch,
    });
    expect(failedAttachmentLine(result.failed)).toBe(
      "Attachments (upload failed): Group 1.png https://slack.example/files/F1",
    );
  });
});

function kinseyDraft(): BriefDraft {
  return {
    requesterName: "Kinsey East",
    requesterEmail: "kinsey.east@properhotel.com",
    requestName: "Local Announcement Email",
    properties: ["MIN"],
    requestType: "CRM & Paid",
    taskType: "Newsletter Send",
    requestedCompletionDate: NEXT_DAY,
    consequenceOfDelay: "We miss the announcement.",
    followUps: {
      "Audience / Distribution Plan": "Minnesota Database",
      "Recommended Copy / Details": "slices attached\nshould send at 11am CST",
      "CTA Links": "CTA for most is http://properhotel.com/minneapolis\nKelly section CTA: https://www.kellywearstler.com/pages/interior-projects#hotels",
      "Subject Line": "We're headed to Minneapolis",
    },
    attachments: [1, 2, 3, 4].map((n) => ({
      slackFileId: `F${n}`,
      name: `Group ${n}.png`,
      mimetype: "image/png",
      permalink: `https://slack.example/files/F${n}`,
      ref: `Group ${n}.png`,
      specs: n === 1 ? "More than 15,000 square feet of meeting space." : undefined,
    })),
    providedLinks: ["https://app.asana.com/0/1/1220581549470491"],
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
