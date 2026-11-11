import { describe, expect, it } from "vitest";
import { fieldQuestion, isBareFieldPrompt } from "../src/intake/ask-text.js";
import { formatQuestions } from "../src/intake/brief.js";
import { propertyNames, secondContact, taskTypeNames } from "../src/intake/catalog.js";
import { listMissing } from "../src/intake/missing.js";
import { followUpsFor } from "../src/intake/question-tree.js";
import { REQUEST_TYPES, type RequestType } from "../src/intake/types.js";

const DEEDEE = ["All Proper", "AUP", "DTLA", "SFP", "SMP", "LTP", "Proper Club", "SMB"];
const KORAL = ["All Collective", "MYC", "TCH", "HJWL", "HJM", "ABH", "APS", "ING", "DAL"];
const EITHER = ["All Properties", "MIN", "Corporate", "New Projects/Development"];

describe("property managers", () => {
  it("names DeeDee for Proper and By Proper, and Koral for The Collective", () => {
    expect([...DEEDEE, ...KORAL, ...EITHER].sort()).toEqual([...propertyNames()].sort());
    for (const code of DEEDEE) {
      expect(secondContact([code]), code).toBe("DeeDee Brown (Proper & By Proper)");
    }
    for (const code of KORAL) {
      expect(secondContact([code]), code).toBe("Koral Captain (Collective)");
    }
    for (const code of EITHER) {
      expect(secondContact([code]), code).toContain("DeeDee Brown");
      expect(secondContact([code]), code).toContain("Koral Captain");
    }
  });
});

describe("questions are sentences", () => {
  it("never sends a bare field name", () => {
    const drafts = [
      {},
      {
        requesterName: "Jamie Mark",
        requesterEmail: "jamie.mark@properhotel.com",
        requestName: "Lake Tahoe membership interest form",
        properties: ["LTP"],
        requestType: "Web" as const,
        taskType: "Page Edit",
      },
    ];
    for (const draft of drafts) {
      const item = listMissing(draft).items[0];
      if (!item) continue;
      const text = formatQuestions({ items: [item], warnings: [], draft, offerHelp: true });
      expect(isBareFieldPrompt(text, item.label), text).toBe(false);
      expect(text).not.toMatch(/— \*/);
      expect(text.split("If you don't have it").length - 1).toBeLessThanOrEqual(1);
    }
    for (const requestType of REQUEST_TYPES) {
      for (const taskType of taskTypes(requestType)) {
        const draft = {
          requesterName: "Jamie Mark",
          requesterEmail: "jamie.mark@properhotel.com",
          requestName: "Lake Tahoe membership interest form",
          properties: ["LTP"],
          requestType,
          taskType,
        };
        for (const field of followUpsFor(requestType, taskType)) {
          const item = { id: `followup:${field.label}`, label: field.label };
          const text = fieldQuestion(item, draft);
          expect(isBareFieldPrompt(text, field.label), `${requestType} ${taskType} ${field.label}: ${text}`).toBe(false);
          expect(text.length).toBeGreaterThan(field.label.length + 20);
          expect(text).toMatch(/[.?!]/);
        }
      }
    }
  });

  it("asks for the Lake Tahoe membership page URL in plain language", () => {
    const text = fieldQuestion(
      { id: "followup:URL", label: "URL" },
      {
        requestName: "Lake Tahoe membership interest form",
        properties: ["LTP"],
        requestType: "Web",
        taskType: "Page Edit",
      },
    );
    expect(text).toContain("Lake Tahoe membership page");
    expect(text).toContain("properhotel.com/");
    expect(text).toContain("where the new form goes");
    expect(text).not.toBe("*URL*");
  });
});

function taskTypes(requestType: RequestType): string[] {
  return taskTypeNames(requestType);
}
