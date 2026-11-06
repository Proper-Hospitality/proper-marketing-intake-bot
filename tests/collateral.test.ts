import { describe, expect, it } from "vitest";
import { runIntakeTurn, type Llm, type LlmContentBlock } from "../src/agent/run.js";
import { canonicalizeProperty } from "../src/intake/catalog.js";
import { COLLATERAL_CATALOG } from "../src/intake/collateral/catalog.js";
import { formatCollateralOffer } from "../src/intake/collateral/format.js";
import { matchCollateral, yearLabel } from "../src/intake/collateral/match.js";
import type { CollateralAsset } from "../src/intake/collateral/types.js";
import { emptyConversation } from "../src/store/types.js";

const TODAY = new Date("2026-11-05T12:00:00Z");

describe("existing collateral catalog", () => {
  it("keeps each SMP and SFP file's own year and does not borrow the HJLA/DTLA confirmation", () => {
    expect(COLLATERAL_CATALOG).toHaveLength(31);
    expect(COLLATERAL_CATALOG.filter((asset) => asset.active)).toHaveLength(22);
    expect(COLLATERAL_CATALOG.filter((asset) => asset.contentRead)).toHaveLength(5);
    expect(COLLATERAL_CATALOG.filter((asset) => asset.tier === "candidate")).toHaveLength(5);
    expect(COLLATERAL_CATALOG.filter((asset) => asset.tier === "pointer")).toHaveLength(2);
    expect(COLLATERAL_CATALOG.some((asset) => asset.yearProvenance === "user_confirmation")).toBe(false);
    expect(COLLATERAL_CATALOG.some((asset) =>
      asset.appliesTo.some((code) => ["AUP", "HJWL", "DTLA", "ABH", "APS"].includes(code)),
    )).toBe(false);

    const holiday2025 = COLLATERAL_CATALOG.find((asset) => asset.title === "SMP Holiday Menu 2025");
    const holiday2026 = COLLATERAL_CATALOG.find((asset) => asset.title === "SMP Holiday Menu 2026");
    const range = COLLATERAL_CATALOG.find((asset) => asset.title === "SMP Bar & Beverage Menu 2026-2027");
    const fact = COLLATERAL_CATALOG.find((asset) => asset.title === "Santa Monica Proper Fact Sheet");
    const proposal = COLLATERAL_CATALOG.find((asset) => asset.id === "smp:canva:DAHHIWQS2Fo");
    const sfpFact = COLLATERAL_CATALOG.find((asset) => asset.title === "SFP-Fact-Sheet-2025_ADA.pdf");
    const sfpMenu = COLLATERAL_CATALOG.find((asset) => asset.title === "Banquet Menu.pdf");
    expect(holiday2025).toMatchObject({ outdated: true, active: false, yearProvenance: "text" });
    expect(yearLabel(holiday2025!.years)).toBe("2025");
    expect(yearLabel(holiday2026!.years)).toBe("2026");
    expect(range!.years).toEqual({ kind: "range", from: 2026, to: 2027 });
    expect(fact!.years.kind).toBe("unknown");
    expect(proposal).toMatchObject({ active: false, outdated: false });
    expect(sfpFact).toMatchObject({
      yearProvenance: "filename",
      outdated: true,
      contentRead: false,
      tier: "candidate",
      retrieval: "metadata_only",
    });
    expect(sfpMenu).toMatchObject({ contentRead: false, years: { kind: "unknown" }, tier: "candidate" });
  });

  it("matches property, type, and year, and leaves unknown years unknown", () => {
    const menus2027 = matchCollateral({
      properties: ["SMP"],
      taskType: "Menu (F&B, Spa)",
      text: "banquet menu for 2027",
      requestedYear: 2027,
    });
    expect(menus2027.offer?.current.every((asset) => asset.years.kind === "range")).toBe(true);
    expect(menus2027.offer?.current.some((asset) => asset.title.includes("2026-2027"))).toBe(true);
    expect(menus2027.offer?.current.some((asset) => asset.title === "SMP Holiday Menu 2026")).toBe(false);

    const holiday2027 = matchCollateral({
      properties: ["Santa Monica Proper"],
      taskType: "Menu (F&B, Spa)",
      text: "holiday menu",
      requestedYear: 2027,
    });
    expect(holiday2027.offer?.current).toEqual([]);
    expect(holiday2027.offer?.older.map((asset) => asset.title)).toContain("SMP Holiday Menu 2026");
    expect(holiday2027.offer?.older.map((asset) => asset.title)).toContain("SMP Holiday Menu 2025");

    const holidayOpen = matchCollateral({
      properties: ["SMP"],
      taskType: "Menu (F&B, Spa)",
      text: "holiday menu",
    });
    expect(holidayOpen.needsYear).toBe(true);
    expect(holidayOpen.offer).toBeUndefined();

    const fact = matchCollateral({
      properties: ["SMP"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    });
    expect(fact.offer?.current).toEqual([]);
    expect(fact.offer?.unknownYear.some((asset) => asset.title === "Santa Monica Proper Fact Sheet")).toBe(true);
    expect(fact.offer?.unknownYear.some((asset) => asset.id === "smp:canva:DAHHIWQS2Fo")).toBe(false);

    const sfpPdf = matchCollateral({
      properties: ["SFP"],
      taskType: "Menu (F&B, Spa)",
      text: "banquet menu",
      requestedYear: 2026,
    });
    expect(sfpPdf.offer?.current).toEqual([]);
    expect(sfpPdf.offer?.unknownYear).toEqual([]);
    expect(sfpPdf.offer?.candidates.map((asset) => asset.title)).toEqual(["Banquet Menu.pdf"]);
    expect(sfpPdf.offer?.candidates[0]?.contentRead).toBe(false);
    expect(formatCollateralOffer(sfpPdf.offer!)).toContain("No verified file is in the catalog");
    expect(formatCollateralOffer(sfpPdf.offer!)).toContain("The file was not downloaded or read.");
    expect(formatCollateralOffer(sfpPdf.offer!)).not.toContain("Covers 2026");

    const urls = [
      ...(menus2027.offer?.current ?? []),
      ...(holiday2027.offer?.older ?? []),
      ...(fact.offer?.unknownYear ?? []),
    ].map((asset) => asset.sourceUrl);
    const catalogUrls = new Set(COLLATERAL_CATALOG.map((asset) => asset.sourceUrl));
    expect(urls.every((url) => catalogUrls.has(url))).toBe(true);
    expect(urls).not.toContain("https://www.canva.com/d/eOJCoOYc3-xSTb3");
  });

  it("uses HJLA and HJWLA as Hotel June, drops archived files, and does not treat a portfolio sheet as DTLA-only", () => {
    expect(canonicalizeProperty("hjla")).toBe("HJWL");
    expect(canonicalizeProperty("HJWLA")).toBe("HJWL");
    expect(canonicalizeProperty("hotel june los angeles")).toBe("HJWL");
    const fixture: CollateralAsset[] = [
      {
        id: "hjwl-current",
        title: "Hotel June fact sheet",
        summary: "Current Hotel June fact sheet.",
        kind: "fact-sheet",
        appliesTo: ["HJWL"],
        years: { kind: "year", year: 2026 },
        yearProvenance: "user_confirmation",
        provenanceNote: "Elena confirmed the current HJLA folder is 2026.",
        sourceUrl: "https://example.com/hjwl",
        sourceKind: "sharepoint",
        contentRead: true,
        outdated: false,
        active: true,
      },
      {
        id: "hjwl-old",
        title: "Hotel June fact sheet OLD",
        summary: "Archived.",
        kind: "fact-sheet",
        appliesTo: ["HJWL"],
        years: { kind: "year", year: 2024 },
        yearProvenance: "filename",
        provenanceNote: "OLD folder.",
        sourceUrl: "https://example.com/hjwl-old",
        sourceKind: "sharepoint",
        contentRead: true,
        outdated: false,
        active: false,
      },
      {
        id: "portfolio",
        title: "Proper Fact Sheet.pdf",
        summary: "Opens with Santa Monica and San Francisco. Stored in the Downtown LA folder.",
        kind: "fact-sheet",
        appliesTo: ["SMP", "SFP"],
        years: { kind: "year", year: 2026 },
        yearProvenance: "user_confirmation",
        provenanceNote: "Folder was DTLA. Text is Santa Monica and San Francisco.",
        sourceUrl: "https://example.com/portfolio",
        sourceKind: "sharepoint",
        contentRead: true,
        outdated: false,
        active: true,
      },
    ];
    const june = matchCollateral({
      properties: ["HJLA"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    }, fixture);
    expect(june.offer?.current.map((asset) => asset.id)).toEqual(["hjwl-current"]);
    const archived = matchCollateral({
      properties: ["HJWLA"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2024,
    }, fixture);
    expect(archived.offer).toBeUndefined();
    const dtla = matchCollateral({
      properties: ["DTLA"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    }, fixture);
    expect(dtla.offer).toBeUndefined();
    const smp = matchCollateral({
      properties: ["SMP"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    }, fixture);
    expect(smp.offer?.current.map((asset) => asset.id)).toEqual(["portfolio"]);
    expect(smp.offer?.current[0]?.appliesTo).toEqual(["SMP", "SFP"]);
    expect(smp.offer?.current[0]?.summary).toMatch(/Santa Monica/);
    expect(smp.offer?.current[0]?.summary).toMatch(/San Francisco/);
  });

  it("offers Shelborne as source leads and does not invent ABH, Austin, or APS files", () => {
    expect(canonicalizeProperty("shelborne")).toBe("SMB");
    const sales = matchCollateral({
      properties: ["Shelborne"],
      taskType: "Sales Collateral",
      text: "sales collateral",
    });
    expect(sales.offer?.current).toEqual([]);
    expect(sales.offer?.candidates.map((asset) => asset.id)).toEqual(["smb:slack:F0BP25X0X8B"]);
    expect(sales.offer?.pointers.map((asset) => asset.id)).toEqual(["smb:sp:1-RESOURCES"]);
    const salesText = formatCollateralOffer(sales.offer!);
    expect(salesText).toContain("No verified file is in the catalog");
    expect(salesText).toContain("The source returned 403");
    expect(salesText).toContain("not an indexed library");
    expect(salesText).toContain("The file was not downloaded or read.");
    expect(salesText).toContain("(2026)");
    expect(salesText).not.toContain("Covers 2026");
    expect(salesText).not.toContain("1-PICTURES");

    const photos = matchCollateral({
      properties: ["SMB"],
      taskType: "Sales Collateral",
      text: "photos",
    });
    expect(photos.offer?.pointers.map((asset) => asset.id)).toEqual(["smb:sp:1-PICTURES"]);
    expect(photos.offer?.candidates).toEqual([]);
    expect(formatCollateralOffer(photos.offer!)).toContain("Imagery folder only");

    const ocean = matchCollateral({
      properties: ["SMP"],
      taskType: "Presentation / Deck",
      text: "Ocean Way cabanas partnership deck",
    });
    expect(ocean.offer?.candidates.map((asset) => asset.id)).toEqual(["smp:canva:DAHQtuWCJSw"]);
    expect(ocean.offer?.current).toEqual([]);
    expect(formatCollateralOffer(ocean.offer!)).toContain("Canva denied access");
    expect(formatCollateralOffer(ocean.offer!)).toContain("year not on the file");

    const genericFact = matchCollateral({
      properties: ["SMP"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    });
    expect(genericFact.offer?.candidates.some((asset) => asset.id === "smp:canva:DAHQtuWCJSw")).toBe(false);

    expect(matchCollateral({
      properties: ["ABH"],
      taskType: "Sales Collateral",
      text: "fact sheet",
    }).offer).toBeUndefined();
    expect(matchCollateral({
      properties: ["Austin Proper"],
      taskType: "Sales Collateral",
      text: "fact sheet",
    }).offer).toBeUndefined();
    expect(matchCollateral({
      properties: ["APS"],
      taskType: "Sales Collateral",
      text: "fact sheet",
    }).offer).toBeUndefined();
  });
});

describe("existing collateral in the intake", () => {
  it("offers the 2027 link, accepts it without filing, and does not offer it twice", async () => {
    const state = emptyConversation("C1:collateral");
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      throw new Error("Asana should not be called");
    }) as typeof fetch;
    const first = await runIntakeTurn({
      state,
      userText: "Banquet menu for Santa Monica Proper for 2027",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_menu",
        name: "record_answers",
        input: {
          requestName: "Banquet menu 2027",
          properties: ["SMP"],
          requestType: "Creative",
          taskType: "Menu (F&B, Spa)",
        },
      }]),
      today: TODAY,
      fetchImpl,
    });
    let offer = first;
    if (first.text.toLowerCase().includes("template")) {
      offer = await runIntakeTurn({
        state,
        userText: "The team should design it",
        slackUser: { id: "U1" },
        llm: scripted([{ type: "text", text: "unused" }]),
        today: TODAY,
        fetchImpl,
      });
    }
    expect(offer.text).toContain("Covers 2027");
    expect(offer.text).toContain("https://www.canva.com/d/lDClpeXaDInUFe1");
    expect(offer.text).not.toContain("https://www.canva.com/d/eOJCoOYc3-xSTb3");
    expect(offer.confirm).toBeUndefined();
    expect(calls).toEqual([]);

    const accepted = await runIntakeTurn({
      state,
      userText: "I'll use this",
      slackUser: { id: "U1" },
      llm: scripted([{ type: "text", text: "should not run" }]),
      today: TODAY,
      fetchImpl,
    });
    expect(accepted.text).toContain("Nothing was filed");
    expect(accepted.confirm).toBeUndefined();
    expect(state.phase).toBe("collateral_accepted");
    expect(calls).toEqual([]);
  });

  it("asks the year when holiday files disagree, then continues intake once with the answers kept", async () => {
    const state = emptyConversation("C1:holiday");
    const first = await runIntakeTurn({
      state,
      userText: "Holiday menu for SMP",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_holiday",
        name: "record_answers",
        input: {
          requestName: "Holiday menu",
          properties: ["SMP"],
          requestType: "Creative",
          taskType: "Menu (F&B, Spa)",
        },
      }]),
      today: TODAY,
    });
    expect(first.text).toContain("Which year");
    expect(first.text).not.toContain("https://www.canva.com/");

    const picked = await runIntakeTurn({
      state,
      userText: "2026",
      slackUser: { id: "U1" },
      llm: scripted([{ type: "text", text: "unused" }]),
      today: TODAY,
    });
    expect(picked.text).toContain("SMP Holiday Menu 2026");
    expect(picked.text).toContain("Covers 2026");
    expect(picked.text).toContain("SMP Holiday Menu 2025");
    expect(picked.text).toContain("Older than 2026");
    expect(state.draft.requestName).toBe("Holiday menu");

    const declined = await runIntakeTurn({
      state,
      userText: "That's outdated, I need a new one",
      slackUser: { id: "U1" },
      llm: scripted([{ type: "text", text: "should not run" }]),
      today: TODAY,
    });
    expect(declined.text).not.toContain("https://www.canva.com/d/yTbfD6cdPDC52bw");
    expect(declined.confirm).toBeUndefined();
    expect(state.draft.requestName).toBe("Holiday menu");
    expect(state.draft.requesterEmail).toBe("elena@example.com");
    expect(state.phase).not.toBe("collateral_offered");

    const next = await runIntakeTurn({
      state,
      userText: "December 1, the guest menus would be wrong",
      slackUser: { id: "U1" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_date",
        name: "record_answers",
        input: {
          requestedCompletionDate: "2026-12-01",
          consequenceOfDelay: "The guest menus would be wrong",
        },
      }]),
      today: TODAY,
    });
    expect(next.text).not.toContain("https://www.canva.com/d/yTbfD6cdPDC52bw");
    expect(state.draft.requestedCompletionDate).toBe("2026-12-01");
    expect(state.draft.consequenceOfDelay).toBe("The guest menus would be wrong");
  });

  it("keeps an unknown-year fact sheet unknown and says the SFP PDF was not read", async () => {
    const state = emptyConversation("C1:fact");
    const first = await runIntakeTurn({
      state,
      userText: "Fact sheet for Santa Monica Proper",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_fact",
        name: "record_answers",
        input: {
          requestName: "Fact sheet",
          properties: ["SMP"],
          requestType: "Creative",
          taskType: "Sales Collateral",
        },
      }]),
      today: TODAY,
    });
    const offer = first.text.toLowerCase().includes("template")
      ? await runIntakeTurn({
        state,
        userText: "The team should design it",
        slackUser: { id: "U1" },
        llm: scripted([{ type: "text", text: "unused" }]),
        today: TODAY,
      })
      : first;
    expect(offer.text).toContain("Santa Monica Proper Fact Sheet");
    expect(offer.text).toContain("Year not printed on the file");
    expect(offer.text).not.toContain("Covers 2026");
    expect(offer.text).toContain("https://www.canva.com/d/SUMubvcHQ5mF1Dz");

    const sfp = emptyConversation("C1:sfp");
    const sfpTurn = await runIntakeTurn({
      state: sfp,
      userText: "Banquet menu for San Francisco Proper",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_sfp",
        name: "record_answers",
        input: {
          requestName: "SFP banquet menu",
          properties: ["SFP"],
          requestType: "Creative",
          taskType: "Menu (F&B, Spa)",
        },
      }]),
      today: TODAY,
    });
    const sfpOffer = sfpTurn.text.toLowerCase().includes("template")
      ? await runIntakeTurn({
        state: sfp,
        userText: "The team should design it",
        slackUser: { id: "U1" },
        llm: scripted([{ type: "text", text: "unused" }]),
        today: TODAY,
      })
      : sfpTurn;
    expect(sfpOffer.text).toContain("Banquet Menu.pdf");
    expect(sfpOffer.text).toContain("No verified file is in the catalog");
    expect(sfpOffer.text).toContain("The file was not downloaded or read.");
    expect(sfpOffer.text).toContain("year not on the file");
    expect(sfpOffer.text).not.toContain("Covers 2026");
  });
});

function scripted(content: LlmContentBlock[]): Llm {
  return { async complete() { return { content }; } };
}
