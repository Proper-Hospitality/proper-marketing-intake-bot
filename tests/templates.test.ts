import { describe, expect, it } from "vitest";
import {
  ARCHIVED_TEMPLATES,
  CANVA_TEMPLATES,
  duplicateNameGroups,
  matchTemplates,
  templateUrl,
} from "../src/intake/templates.js";

describe("canva template matching", () => {
  it("keeps both Proper-Social-Press-2026 templates and flags the shared name", () => {
    const groups = duplicateNameGroups();
    expect(groups).toEqual([{ name: "Proper-Social-Press-2026", ids: ["EAHVrNTlM1M", "EAHHycjf7Ug"] }]);
    const result = matchTemplates({
      requestType: "Social",
      taskType: "Feed Post Request",
      properties: ["All Proper"],
      text: "press feature for the new restaurant",
    });
    expect(result.duplicateName).toBe(true);
    expect(result.matches.map((match) => match.id).sort()).toEqual(["EAHHycjf7Ug", "EAHVrNTlM1M"]);
    expect(result.matches.every((match) => match.name === "Proper-Social-Press-2026")).toBe(true);
    expect(result.note).toMatch(/both named Proper-Social-Press-2026/);
    expect(result.matches.map((match) => match.url)).toEqual([
      templateUrl("EAHHycjf7Ug"),
      templateUrl("EAHVrNTlM1M"),
    ]);
    expect(result.matches.map((match) => match.id)).not.toContain("EAG5oZW2opw");
  });

  it("never returns archived or one-off templates", () => {
    const archived = new Set(ARCHIVED_TEMPLATES.map((template) => template.id));
    for (const template of CANVA_TEMPLATES) expect(archived.has(template.id)).toBe(false);
    const ids = new Set(CANVA_TEMPLATES.map((template) => template.id));
    expect(ids.size).toBe(CANVA_TEMPLATES.length);
    const sxsw = matchTemplates({
      requestType: "Social",
      taskType: "Story Request",
      properties: ["AUP"],
      text: "SXSW story 2026",
    });
    expect(sxsw.matches.map((match) => match.id)).not.toContain("EAHFpBSaock");
  });

  it("prefers the property happenings template over the all-Proper one", () => {
    const smp = matchTemplates({
      requestType: "Social",
      taskType: "Feed Post Request",
      properties: ["SMP"],
      text: "weekly happenings",
    });
    expect(smp.matches.map((match) => match.id)).toEqual(["EAHJyAsHwPs"]);

    const dtla = matchTemplates({
      requestType: "Creative",
      taskType: "Social",
      properties: ["DTLA"],
      text: "weekly happenings",
    });
    expect(dtla.matches.map((match) => match.id)).toEqual(["EAHLiqx7MHM"]);
  });

  it("asks for a property before offering a property-specific template", () => {
    const result = matchTemplates({
      requestType: "Social",
      taskType: "Story Request",
      properties: [],
      text: "weekly happenings story",
    });
    expect(result.needsProperty).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("prefers the 2026 offer flyer over the older one", () => {
    const result = matchTemplates({
      requestType: "Marketing",
      taskType: "Offers",
      properties: ["All Proper"],
      text: "offer flyer for catering",
    });
    expect(result.matches.map((match) => match.id)).toEqual(["EAHMBrpdhYs"]);
    expect(result.matches.map((match) => match.id)).not.toContain("EAHKadNU7zE");
  });

  it("prefers a group offer over the generic flyer, and the 2026 file over the older one", () => {
    const result = matchTemplates({
      requestType: "Creative",
      taskType: "Sales Collateral",
      properties: ["SFP"],
      text: "Q1 group offer",
    });
    expect(result.matches.map((match) => match.id)).toEqual(["EAHMIHmQKsA"]);
  });

  it("uses the property presentation template", () => {
    const result = matchTemplates({
      requestType: "Creative",
      taskType: "Presentation / Deck",
      properties: ["AUP"],
      text: "sales deck",
    });
    expect(result.matches.map((match) => match.name)).toEqual(["AUP Presentation Template"]);
    expect(result.matches[0].id).toBe("EAHEzXlCnmg");
  });

  it("matches print and event-menu templates, and leaves design types with no template alone", () => {
    expect(matchTemplates({
      requestType: "Creative",
      taskType: "Print Collateral",
      properties: ["Corporate"],
      text: "business cards for the team",
    }).matches.map((match) => match.id)).toEqual(["EAHFi1cMfXE"]);

    expect(matchTemplates({
      requestType: "Creative",
      taskType: "Menu (F&B, Spa)",
      properties: ["SMP"],
      text: "event menu for the dinner",
    }).matches.map((match) => match.id)).toEqual(["EAG_kd17cpk"]);

    expect(matchTemplates({
      requestType: "Creative",
      taskType: "Menu (F&B, Spa)",
      properties: ["SMP"],
      text: "spa menu update",
    }).matches).toEqual([]);

    for (const taskType of ["Email", "SMS", "Pop Up", "Web Page", "Ad", "Merch"]) {
      expect(matchTemplates({
        requestType: "Creative",
        taskType,
        properties: ["SMP"],
        text: "please design this",
      }).matches).toEqual([]);
    }

    expect(matchTemplates({
      requestType: "Web",
      taskType: "New Page",
      properties: ["SMP"],
      text: "new meetings page",
    }).matches).toEqual([]);

    expect(matchTemplates({
      requestType: "CRM & Paid",
      taskType: "Newsletter Send",
      properties: ["SMP"],
      text: "send the newsletter",
    }).matches).toEqual([]);
  });

  it("does not treat a compliment as a LinkedIn job post", () => {
    const compliment = matchTemplates({
      requestType: "Social",
      taskType: "Story Request",
      properties: ["SMP"],
      text: "great job on the story",
    });
    expect(compliment.matches.map((match) => match.id)).not.toContain("EAHLpizwGLs");
    const hiring = matchTemplates({
      requestType: "Social",
      taskType: "Feed Post Request",
      properties: ["SMP"],
      text: "linkedin job posting",
    });
    expect(hiring.matches.map((match) => match.id)).toEqual(["EAHFi2CczNM"]);
  });

  it("prefers the 2026 fact sheet over the older Santa Monica file", () => {
    const result = matchTemplates({
      requestType: "Creative",
      taskType: "Sales Collateral",
      properties: ["SMP"],
      text: "fact sheet",
    });
    expect(result.matches.map((match) => match.id)).toEqual(["EAHMCDclNHA"]);
  });
});
