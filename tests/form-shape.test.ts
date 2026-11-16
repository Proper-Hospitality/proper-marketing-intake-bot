import { describe, expect, it } from "vitest";
import { runIntakeTurn, type Llm, type LlmContentBlock } from "../src/agent/run.js";
import { applyFileRoles, attachmentMissing } from "../src/intake/attachments.js";
import { buildDescription, formatSummary, taskName } from "../src/intake/brief.js";
import { taskTypeNames } from "../src/intake/catalog.js";
import { proposeEmailBriefs } from "../src/intake/email/parse.js";
import { followUpsFor } from "../src/intake/question-tree.js";
import { submitConfirmedBrief } from "../src/slack/submit.js";
import { MemoryStore } from "../src/store/memory.js";
import { emptyConversation } from "../src/store/types.js";
import { REQUEST_TYPES, type BriefDraft, type RequestType } from "../src/intake/types.js";

const LITERAL = "has to be sent tomorrow - most send tasks will be 24 hour turnaround. that's normal.";
const TODAY = new Date("2026-11-16T18:00:00Z");

describe("every request type uses the form shape", () => {
  it("keeps each task type's own labels, filenames, and no Slack link list", () => {
    const seen: string[] = [];
    for (const requestType of REQUEST_TYPES) {
      for (const taskType of taskTypeNames(requestType)) {
        seen.push(`${requestType} → ${taskType}`);
        const draft = sample(requestType, taskType);
        applyFileRoles(draft, "the files are attached for this request");
        expect(taskName(draft), taskType).toBe(`SMP, ${taskType} sample`);
        const notes = buildDescription({ draft, templateOffer: null });
        expect(notes, taskType).not.toMatch(/slack\.com/i);
        expect(notes, taskType).not.toContain("Link you provided");
        expect(notes, taskType).not.toContain("## Assets");
        expect(notes, taskType).not.toContain("## Brief");
        let cursor = notes.indexOf("What can we help you with?:");
        expect(cursor, taskType).toBeGreaterThan(0);
        const supportAt = notes.indexOf(`${supportLabel(requestType)}:`);
        expect(supportAt, taskType).toBeGreaterThan(cursor);
        cursor = supportAt;
        for (const field of followUpsFor(requestType, taskType)) {
          const marker = `${field.label}:\n`;
          const at = notes.indexOf(marker);
          expect(at, `${requestType} ${taskType} ${field.label}`).toBeGreaterThan(cursor);
          cursor = at;
          if (field.required) expect(notes.slice(at, at + marker.length + 80), field.label).toContain(`Exact ${field.label}`);
          else expect(notes.slice(at, at + marker.length + 4), field.label).toContain("N/A");
        }
        const summary = formatSummary({ draft, warnings: [], templateOffer: null, duplicates: [] });
        expect(summary.match(/Attachments:/g), taskType).toHaveLength(1);
        expect(summary, taskType).toContain("Attachments: post.png");
        expect(summary, taskType).not.toMatch(/slack\.com/i);
        expect(attachmentMissing(draft).some((item) => item.id.startsWith("attachmentKind")), taskType).toBe(false);
      }
    }
    expect(seen.length).toBeGreaterThan(40);
  });

  it("uses a sensible file role and does not invent page content", () => {
    const social: BriefDraft = {
      requestType: "Social",
      taskType: "Feed Post Request",
      attachments: [{ name: "roof.png", ref: "roof.png", mimetype: "image/png", slackFileId: "F1" }],
    };
    applyFileRoles(social);
    expect(social.attachments?.[0]?.kind).toBe("post_asset");
    expect(attachmentMissing(social).some((item) => item.label.startsWith("What kind of file"))).toBe(false);

    const web: BriefDraft = {
      requestType: "Web",
      taskType: "Page Edit",
      attachments: [{ name: "homepage.pdf", ref: "homepage.pdf" }],
    };
    applyFileRoles(web, "please update the homepage");
    expect(web.attachments?.[0]?.kind).not.toBe("page_content");

    applyFileRoles(web, "this PDF is the page content to build as a page");
    expect(web.attachments?.[0]?.kind).toBe("page_content");
    expect(attachmentMissing(web).some((item) => item.label.startsWith("What kind of file"))).toBe(false);

    const described: BriefDraft = {
      requestType: "Creative",
      taskType: "Web Page",
      attachments: [{ name: "hero.png", ref: "hero.png", mimetype: "image/png" }],
    };
    applyFileRoles(described, "the files are the photos for the page");
    expect(described.attachments?.[0]?.kind).toBe("photo");
    expect(attachmentMissing(described).some((item) => item.label.startsWith("What kind of file"))).toBe(false);
  });
});

describe("exact requester words", () => {
  it("keeps Kinsey's sentence instead of a rewritten consequence", async () => {
    const state = emptyConversation("C:literal");
    state.phase = "collecting";
    state.lastAskedId = "consequenceOfDelay";
    state.lastAskedLabel = "What happens if it's late";
    state.draft = sample("CRM & Paid", "Newsletter Send");
    delete state.draft.consequenceOfDelay;
    const llm: Llm = {
      async complete() {
        return {
          content: [{
            type: "tool_use",
            id: "toolu_why",
            name: "record_answers",
            input: { consequenceOfDelay: "We miss the announcement." },
          } satisfies LlmContentBlock],
        };
      },
    };
    await runIntakeTurn({
      state,
      userText: LITERAL,
      slackUser: { id: "U0ANYBQHGCR", name: "Kinsey East", email: "kinsey.east@properhotel.com" },
      llm,
      today: TODAY,
    });
    expect(state.draft.consequenceOfDelay).toBe(LITERAL);
    const notes = buildDescription({ draft: state.draft, templateOffer: null });
    const summary = formatSummary({ draft: state.draft, warnings: [], templateOffer: null, duplicates: [] });
    expect(notes).toContain(`Consequence of Delay:\n${LITERAL}`);
    expect(summary).toContain(LITERAL);
    expect(notes).not.toContain("We miss the announcement.");
    expect(summary).not.toContain("We miss the announcement.");
  });
});

describe("Jack's CRM follow-up and a rush-approved filing", () => {
  it("copies the email's exact words and uploads the slice", () => {
    const detail = "Please send this questionnaire to the membership list. Keep the breakfast question and the visit question exactly as I wrote them.";
    const [proposal] = proposeEmailBriefs({ subject: "Membership questionnaire", bodyText: detail });
    expect(proposal?.taskType).toBe("Newsletter Send");
    expect(proposal?.followUps?.["Recommended Copy / Details"]).toBe(detail);
    expect(proposal?.followUps?.["Audience / Distribution Plan"]).toBe(detail);
    const draft: BriefDraft = {
      ...sample("CRM & Paid", "Newsletter Send"),
      requestName: proposal?.title,
      properties: ["LTP"],
      followUps: proposal?.followUps,
      attachments: [{
        slackFileId: "F-SLICE",
        name: "slices.png",
        ref: "slices.png",
        mimetype: "image/png",
        permalink: "https://properhospitalitycorp.slack.com/files/F-SLICE/slices.png",
      }],
    };
    applyFileRoles(draft, "slices attached");
    expect(draft.attachments?.[0]?.kind).toBe("email_slice");
    const notes = buildDescription({ draft, templateOffer: null });
    const summary = formatSummary({ draft, warnings: [], templateOffer: null, duplicates: [] });
    expect(notes).toContain(detail);
    expect(notes).not.toMatch(/slack\.com/i);
    expect(summary).toContain("Attachments: slices.png");
    expect(summary.match(/Attachments:/g)).toHaveLength(1);
    expect(taskName(draft)).toBe(`LTP, ${proposal?.title}`);
  });

  it("files a rush-approved task with the same notes and the original filename", async () => {
    const state = emptyConversation("C:rush-shape");
    state.phase = "awaiting_confirm";
    state.confirmVersion = 1;
    state.draft = {
      ...sample("Social", "Feed Post Request"),
      requestedCompletionDate: "2026-11-17",
      whereItGoesLive: "Instagram",
      rushApprovedFor: "2026-11-17",
      rushApprovedBy: "DeeDee Brown",
    };
    delete state.draft.rushBlock;
    const notes = buildDescription({ draft: state.draft, templateOffer: null });
    expect(notes).toContain("Recommended Copy / Details:\nExact Recommended Copy / Details");
    expect(notes).toContain("Photo / Asset Link:\nN/A");
    expect(notes).toContain("Rush approved by DeeDee Brown");
    expect(notes).not.toMatch(/slack\.com/i);
    const store = new MemoryStore();
    await store.saveConversation(state);
    const uploads: string[] = [];
    const filed = await submitConfirmedBrief({
      confirmed: true,
      version: 1,
      state,
      store,
      token: "asana",
      slackToken: "xoxb-test",
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        const method = init?.method ?? "GET";
        if (href.includes("files.info")) {
          return json({
            ok: true,
            file: {
              name: "post.png",
              mimetype: "image/png",
              permalink: "https://slack.example/files/F-POST",
              url_private: "https://files.slack.com/post.png",
            },
          });
        }
        if (href.includes("files.slack.com")) return new Response(Uint8Array.from([1]));
        if (method === "POST" && href.includes("/attachments")) {
          uploads.push("post.png");
          return json({ data: { gid: "ATT" } });
        }
        if (method === "GET" && href.includes("/attachments")) return json({ data: [] });
        if (method === "POST" && href.endsWith("/tasks")) return json({ data: { gid: "T-RUSH" } });
        if (method === "PUT") return json({ data: { gid: "T-RUSH" } });
        if (method === "POST" && href.includes("/stories")) return json({ data: {} });
        return json({
          data: {
            gid: "T-RUSH",
            permalink_url: "https://app.asana.com/0/1/T-RUSH",
            memberships: [
              { project: { gid: "1217171684008018", name: "New Intake Board" }, section: { name: "New requests - Submitted via Form" } },
            ],
            custom_fields: [
              { name: "Request Type_New Intake Board", display_value: "Social" },
              { name: "Social Task Type", display_value: "Feed Post Request" },
              { name: "Property List_New Intake Board", display_value: "SMP" },
              { name: "Status in Que", display_value: "New Request" },
              { name: "Estimated time", display_value: "1h" },
            ],
          },
        });
      }) as unknown as typeof fetch,
    });
    expect(filed.text).toContain("https://app.asana.com/0/1/T-RUSH");
    expect(filed.text).not.toContain("needs approval");
    expect(uploads).toEqual(["post.png"]);
    expect(state.uploadedSlackFileIds).toContain("F-POST");
  });
});

function sample(requestType: RequestType, taskType: string): BriefDraft {
  const followUps: Record<string, string> = {};
  for (const field of followUpsFor(requestType, taskType)) {
    if (field.required) followUps[field.label] = `Exact ${field.label} for ${taskType}.`;
  }
  return {
    requesterName: "Kinsey East",
    requesterEmail: "kinsey.east@properhotel.com",
    requestName: `${taskType} sample`,
    properties: ["SMP"],
    requestType,
    taskType,
    requestedCompletionDate: "2026-12-01",
    consequenceOfDelay: LITERAL,
    approver: "DeeDee Brown",
    followUps,
    attachments: [{
      slackFileId: "F-POST",
      name: "post.png",
      ref: "post.png",
      mimetype: "image/png",
      permalink: "https://properhospitalitycorp.slack.com/files/F-POST/post.png",
    }],
  };
}

function supportLabel(requestType: RequestType): string {
  if (requestType === "Creative") return "What type of creative support do you need?";
  if (requestType === "Web") return "What type of website support do you need?";
  if (requestType === "CRM & Paid") return "What type of CRM or paid media support do you need?";
  if (requestType === "Social") return "What type of social media support do you need?";
  return "What type of marketing support do you need?";
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
