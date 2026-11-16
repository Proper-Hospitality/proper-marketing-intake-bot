import { describe, expect, it } from "vitest";
import { taskName } from "../src/intake/task-name.js";

describe("standard task names", () => {
  it("uses the property and the request name, the way the form does", () => {
    expect(taskName({
      properties: ["SMP"],
      requestType: "Web",
      taskType: "New Page",
      requestName: "Holiday offer",
    })).toBe("SMP, Holiday offer");

    expect(taskName({
      properties: ["HJWL"],
      requestType: "Web",
      taskType: "Menu Upload",
      requestName: "Dinner menu",
    })).toBe("HJWL, Dinner menu");

    expect(taskName({
      properties: ["MIN"],
      requestType: "CRM & Paid",
      taskType: "Newsletter Send",
      requestName: "Local Announcement Email",
    })).toBe("MIN, Local Announcement Email");
  });

  it("names each split email request on its own", () => {
    const shared = { properties: ["LTP"], requesterName: "Jamie Mark" };
    expect(taskName({
      ...shared,
      requestType: "Web",
      taskType: "Page Edit",
      requestName: "Lake Tahoe membership interest form",
    })).toBe("LTP, Lake Tahoe membership interest form");
    expect(taskName({
      ...shared,
      requestType: "CRM & Paid",
      taskType: "Newsletter Send",
      requestName: "membership questionnaire",
    })).toBe("LTP, membership questionnaire");
  });
});
