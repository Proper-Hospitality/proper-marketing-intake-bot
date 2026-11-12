import { describe, expect, it } from "vitest";
import { taskName } from "../src/intake/task-name.js";

describe("standard task names", () => {
  it("builds a scannable name and does not repeat the property or type", () => {
    expect(taskName({
      properties: ["SMP"],
      requestType: "Web",
      taskType: "New Page",
      requestName: "SMP new page holiday offer",
    })).toBe("SMP | New Page | Holiday Offer");

    expect(taskName({
      properties: ["HJWL"],
      requestType: "Web",
      taskType: "Menu Upload",
      requestName: "Hotel June West LA dinner menu",
    })).toBe("HJWL | Menu Upload | Dinner Menu");

    expect(taskName({
      properties: ["SFP"],
      requestType: "Web",
      taskType: "Happenings",
      requestName: "San Francisco art week",
    })).toBe("SFP | Happenings | Art Week");
  });

  it("names each split email request on its own", () => {
    const shared = { properties: ["LTP"], requesterName: "Jamie Mark" };
    expect(taskName({
      ...shared,
      requestType: "Web",
      taskType: "Page Edit",
      requestName: "Lake Tahoe membership interest form",
    })).toBe("LTP | Page Edit | Membership Interest Form");
    expect(taskName({
      ...shared,
      requestType: "CRM & Paid",
      taskType: "Newsletter Send",
      requestName: "membership questionnaire",
    })).toBe("LTP | Newsletter Send | Membership Questionnaire");
  });
});
