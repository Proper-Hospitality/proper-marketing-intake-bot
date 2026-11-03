import { describe, expect, it } from "vitest";
import {
  ARCHIVED_TEMPLATES,
  CANVA_TEMPLATES,
  duplicateNameGroups,
  matchTemplates,
  templateUrl,
} from "../src/intake/templates.js";

const ARCHIVED_THIS_ROUND = [
  "EAHJx45W9QA",
  "EAHFjMjHCm8",
  "EAGteKYmqpY",
  "EAG5oWwaryo",
  "EAHHycjf7Ug",
  "EAG5oZW2opw",
  "EAHFjA_koEo",
  "EAGteKsBuUs",
  "EAGldCymBM0",
  "EAG5YaWIOc0",
  "EAHFpvxlDTw",
  "EAGi23395pU",
  "EAHFpgBeE48",
  "EAHFpfYf20U",
  "EAHFpspzuv4",
  "EAHLp1xACjE",
  "EAHLpizwGLs",
  "EAHFi2CczNM",
  "EAHFi1cMfXE",
  "EAHJyJDmlrg",
] as const;

describe("canva template matching", () => {
  it("offers only the remaining Proper-Social-Press-2026 template", () => {
    expect(duplicateNameGroups()).toEqual([]);
    const result = matchTemplates({
      requestType: "Social",
      taskType: "Feed Post Request",
      properties: ["All Proper"],
      text: "press feature for the new restaurant",
    });
    expect(result.duplicateName).toBe(false);
    expect(result.matches.map((match) => match.id)).toEqual(["EAHVrNTlM1M"]);
    expect(result.matches[0].name).toBe("Proper-Social-Press-2026");
    expect(result.matches[0].url).toBe(templateUrl("EAHVrNTlM1M"));
    expect(result.note).toBeUndefined();
  });

  it("keeps 55 suggestable templates and 27 blocked ones, and never suggests an archived id", () => {
    expect(CANVA_TEMPLATES).toHaveLength(55);
    expect(ARCHIVED_TEMPLATES).toHaveLength(27);
    expect(ARCHIVED_TEMPLATES.filter((template) => template.reason === "archived")).toHaveLength(21);
    expect(ARCHIVED_TEMPLATES.filter((template) => template.reason === "one-off")).toHaveLength(6);

    const archived = new Set(ARCHIVED_TEMPLATES.map((template) => template.id));
    expect(archived.size).toBe(ARCHIVED_TEMPLATES.length);
    const suggestable = new Set(CANVA_TEMPLATES.map((template) => template.id));
    expect(suggestable.size).toBe(CANVA_TEMPLATES.length);
    for (const id of archived) expect(suggestable.has(id)).toBe(false);

    expect(ARCHIVED_TEMPLATES.find((template) => template.id === "EAHUpJlPwUs")).toEqual({
      id: "EAHUpJlPwUs",
      name: "APS-ING-HolidayEventsFlyer",
      reason: "one-off",
    });
    for (const id of ARCHIVED_THIS_ROUND) {
      expect(ARCHIVED_TEMPLATES.find((template) => template.id === id)?.reason).toBe("archived");
    }

    const bait = [
      "press feature for the new restaurant",
      "business cards for the team",
      "linkedin job posting",
      "linkedin",
      "palma dj set",
      "dj set",
      "proper presents lineup",
      "proper presents",
      "lineup",
      "event recap story",
      "recap",
      "ig story",
      "instagram story",
      "artist flyer",
      "artist feature",
      "arc de soleil",
      "vinyl nights",
      "camp fitness",
      "fitness",
      "summer perks",
      "proper tl",
      "pool rules",
      "pool sign",
      "holiday events flyer",
      "SXSW story 2026",
      "hiring",
      ...CANVA_TEMPLATES.flatMap((template) => [template.name, ...template.any]),
    ];
    const properties = [[], ["SMP"], ["AUP"], ["All Proper"], ["DTLA"], ["SFP"], ["APS"], ["ING"]];
    const routes = [
      ["Social", "Feed Post Request"],
      ["Social", "Story Request"],
      ["Creative", "Social"],
      ["Creative", "Print Collateral"],
      ["Creative", "Sales Collateral"],
      ["Marketing", "Offers"],
    ] as const;
    for (const [requestType, taskType] of routes) {
      for (const propertyList of properties) {
        for (const text of bait) {
          const result = matchTemplates({ requestType, taskType, properties: propertyList, text });
          for (const match of result.matches) {
            expect(archived.has(match.id)).toBe(false);
          }
        }
      }
    }
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
    }).matches).toEqual([]);

    expect(matchTemplates({
      requestType: "Creative",
      taskType: "Print Collateral",
      properties: ["SMP"],
      text: "amenity postcard",
    }).matches.map((match) => match.id)).toEqual(["EAHFpPr31Ok"]);

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

  it("does not suggest an archived LinkedIn template", () => {
    const compliment = matchTemplates({
      requestType: "Social",
      taskType: "Story Request",
      properties: ["SMP"],
      text: "great job on the story",
    });
    expect(compliment.matches).toEqual([]);
    const hiring = matchTemplates({
      requestType: "Social",
      taskType: "Feed Post Request",
      properties: ["SMP"],
      text: "linkedin job posting",
    });
    expect(hiring.matches).toEqual([]);
    const austin = matchTemplates({
      requestType: "Social",
      taskType: "Feed Post Request",
      properties: ["AUP"],
      text: "linkedin job posting",
    });
    expect(austin.matches.map((match) => match.id)).toEqual(["EAHFpjY4uB8"]);
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
