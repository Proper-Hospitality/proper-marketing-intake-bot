import { describe, expect, it } from "vitest";
import {
  buildCreateTaskBody,
} from "../src/intake/asana.js";
import {
  buildIntakeFieldUpdates,
  FIELD_UPDATE_ORDER,
  PROJECT_GID,
  PROPERTY_FIELD_GID,
  REQUEST_TYPE_FIELD_GID,
  REQUEST_TYPE_OPTIONS,
  SECTION_GID,
  TASK_TYPE_FIELDS,
} from "../src/intake/catalog.js";
import { assertQuestionTreeCoversCatalog } from "../src/intake/question-tree.js";
import type { RequestType } from "../src/intake/types.js";
import { buildDescription, taskName } from "../src/intake/brief.js";

const taskTypes: Record<RequestType, string> = {
  Creative: "Email",
  Web: "New Page",
  "CRM & Paid": "Newsletter Send",
  Social: "Feed Post Request",
  Marketing: "Offers",
};

describe("intake field order", () => {
  it("updates Request Type, then Task Type, then Property", () => {
    const updates = buildIntakeFieldUpdates({
      requestType: "Creative",
      taskType: "Email",
      properties: ["SMP", "AUP"],
    });
    expect(updates.map((update) => update.step)).toEqual([...FIELD_UPDATE_ORDER]);
    expect(updates[0]).toEqual({
      step: "requestType",
      fieldGid: REQUEST_TYPE_FIELD_GID,
      value: REQUEST_TYPE_OPTIONS.Creative,
    });
    expect(updates[1]).toEqual({
      step: "taskType",
      fieldGid: TASK_TYPE_FIELDS.Creative.gid,
      value: TASK_TYPE_FIELDS.Creative.options.Email,
    });
    expect(updates[2].fieldGid).toBe(PROPERTY_FIELD_GID);
    expect(updates[2].value).toEqual(["1217171490189061", "1217171490189058"]);
  });

  it("uses only the task-type field that matches the request type", () => {
    for (const requestType of Object.keys(taskTypes) as RequestType[]) {
      const updates = buildIntakeFieldUpdates({
        requestType,
        taskType: taskTypes[requestType],
        properties: ["Corporate"],
      });
      expect(updates.map((update) => update.step)).toEqual(["requestType", "taskType", "property"]);
      expect(updates[1].fieldGid).toBe(TASK_TYPE_FIELDS[requestType].gid);
      const otherTaskFields = (Object.keys(TASK_TYPE_FIELDS) as RequestType[])
        .filter((type) => type !== requestType)
        .map((type) => TASK_TYPE_FIELDS[type].gid);
      expect(otherTaskFields).not.toContain(updates[1].fieldGid);
    }
  });

  it("rejects unknown task types and empty properties", () => {
    expect(() => buildIntakeFieldUpdates({ requestType: "Creative", taskType: "New Page", properties: ["SMP"] })).toThrow(/Unknown task type/);
    expect(() => buildIntakeFieldUpdates({ requestType: "Web", taskType: "New Page", properties: [] })).toThrow(/property/i);
  });

  it("keeps the three intake fields out of the create payload", () => {
    const body = buildCreateTaskBody(
      {
        requesterName: "Elena Ruiz",
        requesterEmail: "elena@example.com",
        requestName: "Holiday newsletter",
        properties: ["SMP"],
        requestType: "Creative",
        taskType: "Email",
        requestedCompletionDate: "2026-12-01",
      },
      "notes",
    );
    expect(body.data.projects).toEqual([PROJECT_GID]);
    expect(body.data.memberships).toEqual([{ project: PROJECT_GID, section: SECTION_GID }]);
    expect(body.data.name).toBe("SMP, Holiday newsletter");
    const fieldGids = Object.keys(body.data.custom_fields);
    expect(fieldGids).not.toContain(REQUEST_TYPE_FIELD_GID);
    expect(fieldGids).not.toContain(PROPERTY_FIELD_GID);
    for (const field of Object.values(TASK_TYPE_FIELDS)) {
      expect(fieldGids).not.toContain(field.gid);
    }
    expect(body.data.custom_fields["1217171832440041"]).toBe("Elena Ruiz");
    expect(body.data.custom_fields["1217171537317137"]).toEqual({ date: "2026-12-01" });
  });

  it("names the task the way the form does and keeps the brief layout", () => {
    expect(taskName({ properties: ["AUP", "SFP"], requestName: "Q1 group offer" })).toBe("AUP, SFP, Q1 group offer");
    const notes = buildDescription({
      draft: {
        requesterName: "Elena Ruiz",
        requesterEmail: "elena@example.com",
        requestName: "Weekly happenings",
        properties: ["SMP"],
        requestedCompletionDate: "2026-12-01",
        consequenceOfDelay: "The week goes out blank.",
        requestType: "Social",
        taskType: "Feed Post Request",
        approver: "DeeDee Brown",
        followUps: { "Recommended Copy / Details": "This weekend at SMP." },
        templateUnusedReason: "Wants the team to design it.",
      },
      templateOffer: {
        matches: [{ id: "EAHJyAsHwPs", name: "SMP-Happenings", useFor: "Weekly happenings, SMP", url: "https://www.canva.com/brand/brand-templates/EAHJyAsHwPs", score: 1 }],
        duplicateName: false,
        needsProperty: false,
      },
      slackThread: "https://slack.com/archives/C1/p1",
    });
    expect(notes).toContain("Name:\nElena Ruiz");
    expect(notes).toContain("What can we help you with?:\nSocial");
    expect(notes).toContain("## Brief");
    expect(notes).toContain("Not used because: Wants the team to design it.");
    expect(notes).toContain("Drafted from Slack: https://slack.com/archives/C1/p1");
  });

  it("covers every catalog task type in the question tree", () => {
    expect(() => assertQuestionTreeCoversCatalog()).not.toThrow();
  });
});
