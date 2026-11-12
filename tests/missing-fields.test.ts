import { describe, expect, it } from "vitest";
import { listMissing } from "../src/intake/missing.js";
import type { BriefDraft } from "../src/intake/types.js";

const today = new Date("2026-11-02T12:00:00Z");

describe("missing fields", () => {
  it("asks for every required creative email item in one list", () => {
    const report = listMissing({ requestType: "Creative", taskType: "Email", properties: ["SMP"] }, today);
    const labels = report.items.map((item) => item.label);
    expect(labels).toContain("Your name");
    expect(labels).toContain("Your email");
    expect(labels).toContain("Request name");
    expect(labels).toContain("Audience / Distribution Plan");
    expect(labels).toContain("Recommended Copy / Details");
    expect(labels).toContain("When this needs to be live");
    expect(labels).not.toContain("Requested completion date");
    expect(labels).not.toContain("What happens if it's late");
    expect(labels).toContain("Photo Link");
    expect(labels).not.toContain("Assets");
    expect(labels).toContain("Final approver");
    expect(labels).toContain("CTA Link");
    expect(labels).not.toContain("Where it goes live");
    expect(labels).not.toContain("Final copy, or who is writing it and when it's due");
  });

  it("is empty once the brief is complete", () => {
    const report = listMissing(completeEmail(), today);
    expect(report.items).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("flags a date inside the lead time without blocking a filled consequence", () => {
    const draft = completeEmail();
    draft.requestedCompletionDate = "2026-11-04";
    const report = listMissing(draft, today);
    expect(report.items).toEqual([]);
    expect(report.warnings[0]).toMatch(/inside the 7-day lead time/);
  });

  it("marks Namastay offer fields as verbatim", () => {
    const report = listMissing({ requestType: "Marketing", taskType: "Offers", properties: ["AUP"] }, today);
    const title = report.items.find((item) => item.label === "Offer Title (match Namastay)");
    expect(title?.verbatim).toBe(true);
    expect(report.items.map((item) => item.label)).toContain("Promo Code");
    expect(report.items.map((item) => item.label)).toContain("Offer Terms & Conditions (match Namastay)");
  });

  it("still asks for copy when the task type has no copy question", () => {
    const report = listMissing({ requestType: "Web", taskType: "GMB Updates", properties: ["SMP"] }, today);
    expect(report.items.map((item) => item.label)).toContain("Final copy, or who is writing it and when it's due");
  });
});

function completeEmail(): BriefDraft {
  return {
    requesterName: "Elena Ruiz",
    requesterEmail: "elena@example.com",
    requestName: "Holiday newsletter",
    properties: ["SMP"],
    requestType: "Creative",
    taskType: "Email",
    requestedCompletionDate: "2026-12-01",
    consequenceOfDelay: "Members miss the sale.",
    approver: "DeeDee Brown",
    whereItGoesLive: "Members email",
    assets: ["https://drive.example.com/photo"],
    attachments: [{ ref: "https://drive.example.com/photo", kind: "photo" }],
    followUps: {
      "Audience / Distribution Plan": "Members",
      "Recommended Copy / Details": "Join us this December.",
    },
  };
}
