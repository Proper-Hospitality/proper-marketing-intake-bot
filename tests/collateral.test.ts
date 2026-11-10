import { describe, expect, it } from "vitest";
import { runIntakeTurn, type Llm, type LlmContentBlock } from "../src/agent/run.js";
import { canonicalizeProperty } from "../src/intake/catalog.js";
import { applyAnswers } from "../src/intake/flow.js";
import { COLLATERAL_CATALOG } from "../src/intake/collateral/catalog.js";
import { PROPERTY_SALES_SOURCES, SALES_COLLATERAL_SOURCE_URL, unmatchedSourceNote } from "../src/intake/collateral/sources.js";
import { formatCollateralOffer } from "../src/intake/collateral/format.js";
import { matchCollateral, yearLabel } from "../src/intake/collateral/match.js";
import type { CollateralAsset } from "../src/intake/collateral/types.js";
import { emptyConversation } from "../src/store/types.js";

const TODAY = new Date("2026-11-05T12:00:00Z");

describe("existing collateral catalog", () => {
  it("keeps each SMP and SFP file's own year and does not borrow the HJLA/DTLA confirmation", () => {
    expect(COLLATERAL_CATALOG).toHaveLength(54);
    expect(COLLATERAL_CATALOG.filter((asset) => asset.active)).toHaveLength(45);
    expect(COLLATERAL_CATALOG.filter((asset) => asset.contentRead)).toHaveLength(26);
    expect(COLLATERAL_CATALOG.filter((asset) => asset.tier === "candidate")).toHaveLength(4);
    expect(COLLATERAL_CATALOG.filter((asset) => asset.tier === "pointer")).toHaveLength(2);
    const confirmed = COLLATERAL_CATALOG.filter((asset) => asset.yearProvenance === "user_confirmation");
    expect(confirmed.map((asset) => asset.id).sort()).toEqual([
      "dtla:DTLAP Capacity Chart.pdf",
      "dtla:DTLAP Fact Sheet Sports Teams.pdf",
      "dtla:DTLAP Fact Sheet.pdf",
      "dtla:DTLAP Meeting & Event Brochure.pdf",
      "dtla:DTLAPBanquet Menu2026.pdf",
      "dtla:Proper Fact Sheet.pdf",
      "hjla:Hotel June Brochure.pdf",
      "hjla:Hotel June Tour Script.docx",
    ]);
    expect(COLLATERAL_CATALOG.some((asset) =>
      asset.yearProvenance === "user_confirmation" && asset.appliesTo.some((code) => ["SMP", "SFP", "SMB"].includes(code) && asset.id !== "dtla:Proper Fact Sheet.pdf"),
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
    expect(fact.offer?.current.map((asset) => asset.id)).toEqual(["dtla:Proper Fact Sheet.pdf"]);
    expect(fact.offer?.unknownYear.some((asset) => asset.title === "Santa Monica Proper Fact Sheet")).toBe(true);
    expect(fact.offer?.unknownYear.every((asset) => asset.years.kind === "unknown")).toBe(true);
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
      yearUnspecified: true,
    });
    const offeredIds = [
      ...(sales.offer?.current ?? []),
      ...(sales.offer?.older ?? []),
      ...(sales.offer?.unknownYear ?? []),
      ...(sales.offer?.candidates ?? []),
    ].map((asset) => asset.id);
    expect(offeredIds.filter((id) => id.includes("Recovery") || id.includes("F0BP25X0X8B"))).toEqual(["smb:upload:The_Recovery_Room"]);
    expect(sales.offer?.pointers.map((asset) => asset.id)).toEqual(["smb:sp:1-RESOURCES"]);
    const salesText = formatCollateralOffer(sales.offer!);
    expect(salesText).toContain("The source returned 403");
    expect(salesText).toContain("not an indexed library");
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

    const portfolioOnly = (property: string) => matchCollateral({
      properties: [property],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    });
    for (const property of ["ABH", "Austin Proper", "APS"]) {
      const offer = portfolioOnly(property).offer;
      expect(offer?.current.map((asset) => asset.id)).toEqual(["dtla:Proper Fact Sheet.pdf"]);
      expect(offer?.current[0]?.summary).toMatch(/Santa Monica/);
      expect(offer?.current[0]?.appliesTo).not.toEqual(["DTLA"]);
    }
  });

  it("includes the eight HJLA and DTLA files and keeps 2026 older for a 2027 request", () => {
    expect(canonicalizeProperty("HJWLA")).toBe("HJWL");
    expect(canonicalizeProperty("DTLAP")).toBe("DTLA");
    const expected: Record<string, string> = {
      "hjla:Hotel June Brochure.pdf": "https://properhotels.sharepoint.com/sites/Openings/Shared%20Documents/Hotel%20June%20Los%20Angeles/HJLA%20Sales/Collateral/Hotel%20June%20Brochure.pdf",
      "hjla:Hotel June Tour Script.docx": "https://properhotels.sharepoint.com/sites/Openings/_layouts/15/Doc.aspx?sourcedoc=%7BBE677F1A-3135-433E-8CF6-9428B3B353BD%7D&file=Hotel%20June%20Tour%20Script.docx&action=default&mobileredirect=true",
      "dtla:Proper Fact Sheet.pdf": "https://properhotels.sharepoint.com/sites/DowntownLAProper/Shared%20Documents/Sales%20and%20Marketing/DTLAP%20Collateral/Proper%20Fact%20Sheet.pdf",
      "dtla:DTLAP Fact Sheet.pdf": "https://properhotels.sharepoint.com/sites/DowntownLAProper/Shared%20Documents/Sales%20and%20Marketing/DTLAP%20Collateral/DTLAP%20Fact%20Sheet.pdf",
      "dtla:DTLAP Fact Sheet Sports Teams.pdf": "https://properhotels.sharepoint.com/sites/DowntownLAProper/Shared%20Documents/Sales%20and%20Marketing/DTLAP%20Collateral/DTLAP%20Fact%20Sheet%20Sports%20Teams.pdf",
      "dtla:DTLAP Capacity Chart.pdf": "https://properhotels.sharepoint.com/sites/DowntownLAProper/Shared%20Documents/Sales%20and%20Marketing/DTLAP%20Collateral/DTLAP%20Capacity%20Chart.pdf",
      "dtla:DTLAP Meeting & Event Brochure.pdf": "https://properhotels.sharepoint.com/sites/DowntownLAProper/Shared%20Documents/Sales%20and%20Marketing/DTLAP%20Collateral/DTLAP%20Meeting%20%26%20Event%20Brochure.pdf",
      "dtla:DTLAPBanquet Menu2026.pdf": "https://properhotels.sharepoint.com/sites/DowntownLAProper/Shared%20Documents/Sales%20and%20Marketing/DTLAP%20Collateral/DTLAPBanquet%20Menu2026.pdf",
    };
    for (const [id, link] of Object.entries(expected)) {
      const asset = COLLATERAL_CATALOG.find((row) => row.id === id);
      expect(asset?.sourceUrl).toBe(link);
      expect(asset).toMatchObject({
        retrieval: "read",
        contentRead: true,
        active: true,
        yearProvenance: "user_confirmation",
        years: { kind: "year", year: 2026 },
      });
    }

    const brochure = matchCollateral({
      properties: ["HJLA"],
      taskType: "Sales Collateral",
      text: "brochure",
      requestedYear: 2026,
    });
    expect(brochure.offer?.current.map((asset) => asset.id)).toEqual(["hjla:Hotel June Brochure.pdf"]);

    const tour = matchCollateral({
      properties: ["Hotel June West LA"],
      taskType: "Sales Collateral",
      text: "tour script",
      requestedYear: 2026,
    });
    expect(tour.offer?.current.map((asset) => asset.id)).toEqual(["hjla:Hotel June Tour Script.docx"]);

    const menu2026 = matchCollateral({
      properties: ["DTLAP"],
      taskType: "Menu (F&B, Spa)",
      text: "banquet menu",
      requestedYear: 2026,
    });
    expect(menu2026.offer?.current.map((asset) => asset.id)).toEqual(["dtla:DTLAPBanquet Menu2026.pdf"]);

    const menu2027 = matchCollateral({
      properties: ["DTLA"],
      taskType: "Menu (F&B, Spa)",
      text: "banquet menu",
      requestedYear: 2027,
    });
    expect(menu2027.offer?.current).toEqual([]);
    expect(menu2027.offer?.older.map((asset) => asset.id)).toEqual(["dtla:DTLAPBanquet Menu2026.pdf"]);

    const capacity = matchCollateral({
      properties: ["DTLA"],
      taskType: "Sales Collateral",
      text: "capacity chart",
      requestedYear: 2026,
    });
    expect(capacity.offer?.current.map((asset) => asset.id)).toEqual(["dtla:DTLAP Capacity Chart.pdf"]);

    const dtlaBrochure = matchCollateral({
      properties: ["DTLA"],
      taskType: "Sales Collateral",
      text: "meeting brochure",
      requestedYear: 2026,
    });
    expect(dtlaBrochure.offer?.current.map((asset) => asset.id)).toEqual(["dtla:DTLAP Meeting & Event Brochure.pdf"]);

    const sheets = matchCollateral({
      properties: ["DTLA"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    });
    expect(sheets.offer?.current.map((asset) => asset.id).sort()).toEqual([
      "dtla:DTLAP Fact Sheet Sports Teams.pdf",
      "dtla:DTLAP Fact Sheet.pdf",
      "dtla:Proper Fact Sheet.pdf",
    ]);
    const portfolio = sheets.offer?.current.find((asset) => asset.id === "dtla:Proper Fact Sheet.pdf");
    expect(portfolio?.appliesTo).toEqual(["SMP", "SFP", "DTLA", "AUP", "HJM", "HJWL", "ABH", "APS", "TCH"]);
    expect(portfolio?.summary).toMatch(/Santa Monica/);
    expect(portfolio?.summary).toMatch(/San Francisco/);

    const smpFact = matchCollateral({
      properties: ["SMP"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    });
    expect(smpFact.offer?.unknownYear.some((asset) => asset.title === "Santa Monica Proper Fact Sheet")).toBe(true);
    expect(smpFact.offer?.unknownYear.every((asset) => asset.years.kind === "unknown")).toBe(true);
    expect(smpFact.offer?.current.map((asset) => asset.id)).toEqual(["dtla:Proper Fact Sheet.pdf"]);
  });

  it("adds Ryan Galvin's five Austin files with unknown years and two different floor plans", () => {
    expect(canonicalizeProperty("ATXP")).toBe("AUP");
    expect(canonicalizeProperty("atxp")).toBe("AUP");
    expect(canonicalizeProperty("Austin")).toBe("AUP");
    const thread = "https://properhospitalitycorp.slack.com/archives/C0B62QUHBK4/p1793928288710819";
    const files: Record<string, { fileId: string; contentRead: boolean; retrieval: string }> = {
      "atxp:upload:ATXP_Fact_Sheet": { fileId: "F0CFH30LNBE", contentRead: true, retrieval: "read" },
      "atxp:upload:Kappo_Kappo_Events": { fileId: "F0CFBCT6PUN", contentRead: true, retrieval: "read" },
      "atxp:upload:Updated_Floor_Plan": { fileId: "F0CEY0S35NK", contentRead: false, retrieval: "image_described" },
      "atxp:upload:Austin_Proper_Capacity_Chart": { fileId: "F0CFF8RLS01", contentRead: true, retrieval: "read" },
      "atxp:upload:Austin_Proper_Floor_Plan": { fileId: "F0CFBCUKK0E", contentRead: true, retrieval: "read" },
    };
    for (const [id, expected] of Object.entries(files)) {
      const asset = COLLATERAL_CATALOG.find((row) => row.id === id);
      expect(asset?.sourceUrl).toBe(thread);
      expect(asset?.sourceUrl).not.toContain("files.slack.com");
      expect(asset?.provenanceNote).toContain(expected.fileId);
      expect(asset).toMatchObject({
        appliesTo: ["AUP"],
        years: { kind: "unknown" },
        yearProvenance: "unknown",
        contentRead: expected.contentRead,
        retrieval: expected.retrieval,
        active: true,
      });
    }
    const fact = COLLATERAL_CATALOG.find((row) => row.id === "atxp:upload:ATXP_Fact_Sheet");
    expect(fact?.summary).toMatch(/2022/);
    expect(fact?.summary).toMatch(/award year/i);
    expect(fact?.years).toEqual({ kind: "unknown" });

    const factMatch = matchCollateral({
      properties: ["ATXP"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    });
    expect(factMatch.offer?.current.map((asset) => asset.id)).toEqual(["dtla:Proper Fact Sheet.pdf"]);
    expect(factMatch.offer?.unknownYear.map((asset) => asset.id)).toContain("atxp:upload:ATXP_Fact_Sheet");
    expect(factMatch.offer?.unknownYear.every((asset) => asset.years.kind === "unknown")).toBe(true);

    const kappo = matchCollateral({
      properties: ["Austin"],
      taskType: "Sales Collateral",
      text: "Kappo Kappo events",
    });
    expect(kappo.offer?.unknownYear.map((asset) => asset.id)).toEqual(["atxp:upload:Kappo_Kappo_Events"]);

    const capacity = matchCollateral({
      properties: ["Austin Proper"],
      taskType: "Sales Collateral",
      text: "capacity chart",
      requestedYear: 2027,
    });
    expect(capacity.offer?.current).toEqual([]);
    expect(capacity.offer?.older).toEqual([]);
    expect(capacity.offer?.unknownYear.map((asset) => asset.id)).toEqual(["atxp:upload:Austin_Proper_Capacity_Chart"]);

    const bothPlans = matchCollateral({
      properties: ["ATXP"],
      taskType: "Sales Collateral",
      text: "floor plan",
    });
    expect(bothPlans.offer?.unknownYear.map((asset) => asset.id).sort()).toEqual([
      "atxp:upload:Austin_Proper_Floor_Plan",
      "atxp:upload:Updated_Floor_Plan",
    ]);
    const updated = matchCollateral({
      properties: ["AUP"],
      taskType: "Sales Collateral",
      text: "updated floor plan",
    });
    expect(updated.offer?.unknownYear.map((asset) => asset.id)).toEqual(["atxp:upload:Updated_Floor_Plan"]);
    expect(formatCollateralOffer(updated.offer!)).toContain("no text layer");
    expect(formatCollateralOffer(updated.offer!)).not.toContain("Covers 2026");
    const salesPlan = matchCollateral({
      properties: ["ATXP"],
      taskType: "Sales Collateral",
      text: "second floor meeting floor plan",
    });
    expect(salesPlan.offer?.unknownYear.map((asset) => asset.id)).toEqual(["atxp:upload:Austin_Proper_Floor_Plan"]);

    expect(COLLATERAL_CATALOG.filter((asset) => asset.id.startsWith("hjla:") || asset.id.startsWith("dtla:")).length).toBe(8);
    expect(COLLATERAL_CATALOG.filter((asset) => asset.appliesTo.includes("SMP") && asset.yearProvenance === "user_confirmation").map((asset) => asset.id)).toEqual(["dtla:Proper Fact Sheet.pdf"]);
  });
});

  it("tells where sales docs live when no catalog file matches, and does not invent one", () => {
    expect(PROPERTY_SALES_SOURCES).toHaveLength(10);
    expect(COLLATERAL_CATALOG).toHaveLength(54);
    const declined = {
      templateDeclinedReason: "The team should design it",
      templateDeclinedFor: "Creative|Sales Collateral",
    };
    const ask = (property: string, requestName: string, taskType = "Sales Collateral") => {
      const state = emptyConversation(`C:${property}:${requestName}`);
      state.templateDeclinedReason = declined.templateDeclinedReason;
      state.templateDeclinedFor = declined.templateDeclinedFor;
      return applyAnswers(state, {
        requesterName: "Elena Ruiz",
        requesterEmail: "elena@example.com",
        requestName,
        properties: [property],
        requestType: "Creative",
        taskType,
      }, TODAY);
    };

    const aps = ask("APS", "capacity chart");
    expect(aps.kind).toBe("ask");
    if (aps.kind === "ask") {
      expect(aps.preface).toContain("Sales Resources");
      expect(aps.preface).toContain("https://properhospitalitycorp.slack.com/docs/T0ANG0N34PP/F0B9JBS0UFM");
      expect(aps.preface).toContain("Room Capacities");
      expect(aps.preface).toContain("Map & Room List");
      expect(aps.preface).toContain("not a file in the catalog");
      expect(aps.preface).not.toContain("capacity chart file");
    }

    const sfp = unmatchedSourceNote({ properties: ["SFP"], taskType: "Sales Collateral", text: "wedding flyer" });
    expect(sfp).toContain("not confirmed yet");
    expect(sfp).not.toContain("sharepoint.com");

    const myc = unmatchedSourceNote({ properties: ["MYC"], taskType: "Menu (F&B, Spa)", text: "banquet menu" });
    expect(myc).toContain("not confirmed yet");
    expect(myc).toContain("never posted");
    expect(myc).toContain("#myc-sales");

    const tch = unmatchedSourceNote({ properties: ["TCH"], taskType: "Sales Collateral", text: "tour script" });
    expect(tch).toContain("not confirmed yet");
    expect(tch).toContain("#tch-sales");

    const abh = unmatchedSourceNote({ properties: ["ABH"], taskType: "Sales Collateral", text: "brochure" });
    expect(abh).toContain("Collateral being updated, new files coming");
    expect(abh).toContain("Check back or ask marketing");
    expect(abh).toContain("Do not use older Avalon Beverly Hills files");
    expect(abh).toContain("imagery only");
    expect(abh).toContain("https://drive.google.com/drive/folders/1smEyn8ipOL_jRFrLggnWjG1zRzVnnZ7h");
    expect(abh).not.toContain("Proper Fact Sheet.pdf");
    const abhFacts = unmatchedSourceNote({
      properties: ["Avalon Beverly Hills"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    });
    expect(abhFacts).toContain("Collateral being updated, new files coming");
    expect(abhFacts).not.toContain("https://properhotels.sharepoint.com/sites/DowntownLAProper/");

    const austin = unmatchedSourceNote({ properties: ["ATXP"], taskType: "Sales Collateral", text: "brochure" });
    expect(austin).toContain("no centralized folder");
    expect(austin).toContain("ATXP Fact Sheet");
    expect(austin).toContain("Kappo Kappo Events");
    expect(austin).toContain("Updated Floor Plan");
    expect(austin).toContain("Austin Proper Capacity Chart");
    expect(austin).toContain("Austin Proper Floor Plan");
    expect(austin).toContain("https://properhospitalitycorp.slack.com/archives/C0B62QUHBK4/p1793928288710819");

    const apsFacts = matchCollateral({
      properties: ["APS"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    });
    const factIds = [...(apsFacts.offer?.current ?? []), ...(apsFacts.offer?.unknownYear ?? [])].map((asset) => asset.id);
    expect(factIds).toContain("aps:canva:DAG-70QWvfs");
    expect(factIds).toContain("aps:canva:DAG_e80rIHc");
    const decks = COLLATERAL_CATALOG.filter((asset) => asset.yearProvenance === "elena_current_export_nov_10_2026");
    expect(decks.map((asset) => asset.id).sort()).toEqual(["aps:canva:DAG-70QWvfs", "aps:canva:DAG_e80rIHc"]);
    expect(decks.every((asset) => asset.years.kind === "unknown")).toBe(true);
    const deckText = formatCollateralOffer({
      property: "APS",
      requestedYear: 2026,
      current: [],
      older: [],
      unknownYear: decks,
      candidates: [],
      pointers: [],
      yearUnspecified: false,
    });
    expect(deckText).toContain("Current per Elena (exported Nov 10, 2026, relayed via her assistant)");
    expect(deckText).not.toContain("user_confirmation");

    const melvyn = matchCollateral({
      properties: ["APS"],
      taskType: "Menu (F&B, Spa)",
      text: "Melvyn's prix-fixe menu",
      requestedYear: 2026,
    });
    expect(melvyn.offer?.current.map((asset) => asset.id)).toContain("aps:slack:F0BFYMJEK5K");
    expect(melvyn.offer?.current.find((asset) => asset.id === "aps:slack:F0BFYMJEK5K")?.yearProvenance).toBe("reported_by_source");
    expect(formatCollateralOffer(melvyn.offer!)).toContain("Jul 2026 as reported by the source, not printed");

    const hjla = PROPERTY_SALES_SOURCES.find((source) => source.property === "HJWL");
    expect(hjla?.links).toEqual(["https://properhotels.sharepoint.com/:f:/s/Openings/IgA18ewHhHKLQ6SgGEVH8FQkAbrrD6hGoayOczj8t6CW1Hs?e=fBwV7I"]);
    expect(hjla?.links.join(" ")).not.toContain("HJLA%20Sales");

    expect(unmatchedSourceNote({
      properties: ["SMP"],
      taskType: "Sales Collateral",
      text: "fact sheet",
      requestedYear: 2026,
    })).toBeUndefined();

    const smpCapacity = unmatchedSourceNote({ properties: ["Santa Monica Proper"], taskType: "Sales Collateral", text: "capacity chart" });
    expect(smpCapacity).toContain("Print Collateral");
    expect(smpCapacity).toContain("https://www.canva.com/d/7Hr7IQ7p_fwF3cS");
    expect(smpCapacity).toContain("https://www.canva.com/d/H8Vl4EBRTWrEh5s");
    expect(smpCapacity).toContain("Full list of where each property's sales docs live:");
    expect(smpCapacity).toContain(SALES_COLLATERAL_SOURCE_URL);

    const matched = matchCollateral({
      properties: ["SMP"],
      taskType: "Menu (F&B, Spa)",
      text: "banquet menu",
      requestedYear: 2027,
    });
    const matchedText = formatCollateralOffer(matched.offer!);
    expect(matchedText).toContain("Covers 2027");
    expect(matchedText).toContain("Full list of where each property's sales docs live:");
    expect(matchedText).toContain(SALES_COLLATERAL_SOURCE_URL);

    const state = emptyConversation("C:repeat");
    state.templateDeclinedReason = declined.templateDeclinedReason;
    state.templateDeclinedFor = "Creative|Menu (F&B, Spa)";
    const first = applyAnswers(state, {
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@example.com",
      requestName: "banquet menu",
      properties: ["MYC"],
      requestType: "Creative",
      taskType: "Menu (F&B, Spa)",
    }, TODAY);
    expect(first.kind === "ask" && first.preface).toContain("not confirmed yet");
    const second = applyAnswers(state, {}, TODAY);
    expect(second.kind === "ask" ? second.preface : undefined).toBeUndefined();
  });

  it("returns Elena's Shelborne files once and keeps the 2025 guide outdated", () => {
    const titles = COLLATERAL_CATALOG.map((asset) => asset.title);
    for (const excluded of ["Golf / Padel near The Shelborne", "The Shelborne Cabana Experiences", "4 Day Group Trip Itinerary", "Audiovisual Packages 2025"]) {
      expect(titles).not.toContain(excluded);
    }
    const guide = COLLATERAL_CATALOG.find((asset) => asset.id === "smb:upload:Meeting_Events_Information_Guide");
    expect(guide).toMatchObject({
      years: { kind: "year", year: 2025 },
      yearProvenance: "text",
      outdated: true,
      active: true,
    });
    const guideMatch = matchCollateral({
      properties: ["SMB"],
      taskType: "Sales Collateral",
      text: "meeting and events information guide",
      requestedYear: 2026,
    });
    expect(guideMatch.offer?.current.map((asset) => asset.id) ?? []).not.toContain(guide?.id);
    expect(guideMatch.offer?.older.map((asset) => asset.id)).toContain("smb:upload:Meeting_Events_Information_Guide");

    const menu = matchCollateral({
      properties: ["Shelborne"],
      taskType: "Menu (F&B, Spa)",
      text: "banquet menu",
      requestedYear: 2026,
    });
    expect(menu.offer?.current.map((asset) => asset.id)).toEqual(["smb:upload:Banquet_Menu"]);
    expect(menu.offer?.current[0]).toMatchObject({ yearProvenance: "filename", years: { kind: "year", year: 2026 } });

    const capacity = matchCollateral({
      properties: ["SMB"],
      taskType: "Sales Collateral",
      text: "capacity chart",
    });
    expect(capacity.offer?.unknownYear.map((asset) => asset.id)).toEqual(["smb:upload:Capacity_Chart"]);

    const recovery = matchCollateral({
      properties: ["SMB"],
      taskType: "Sales Collateral",
      text: "Recovery Room one-pager",
      requestedYear: 2026,
    });
    const recoveryIds = [
      ...(recovery.offer?.current ?? []),
      ...(recovery.offer?.older ?? []),
      ...(recovery.offer?.unknownYear ?? []),
      ...(recovery.offer?.candidates ?? []),
    ].map((asset) => asset.id);
    expect(recoveryIds.filter((id) => /recovery|F0BP25X0X8B/i.test(id))).toEqual(["smb:upload:The_Recovery_Room"]);

    const villa = matchCollateral({
      properties: ["SMB"],
      taskType: "Sales Collateral",
      text: "Villa 13 one-pager",
      yearUnspecified: true,
    });
    expect(villa.offer?.unknownYear.map((asset) => asset.id)).toContain("smb:upload:Villa_13_Conference_Setup");
    expect(villa.offer?.unknownYear.find((asset) => asset.id === "smb:upload:Villa_13_Conference_Setup")).toMatchObject({
      retrieval: "image_described",
      contentRead: false,
      years: { kind: "unknown" },
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
    let offer = first.text.includes("existing file")
      ? await runIntakeTurn({
        state,
        userText: "existing",
        slackUser: { id: "U1" },
        llm: scripted([{ type: "text", text: "unused" }]),
        today: TODAY,
      })
      : first.text.toLowerCase().includes("template")
      ? await runIntakeTurn({
        state,
        userText: "The team should design it",
        slackUser: { id: "U1" },
        llm: scripted([{ type: "text", text: "unused" }]),
        today: TODAY,
      })
      : first;
    if (offer.text.includes("Which year")) {
      offer = await runIntakeTurn({
        state,
        userText: "2026",
        slackUser: { id: "U1" },
        llm: scripted([{ type: "text", text: "unused" }]),
        today: TODAY,
      });
    }
    expect(offer.text).toContain("Santa Monica Proper Fact Sheet");
    expect(offer.text).toContain("Year not printed on the file");
    expect(offer.text).toContain("https://www.canva.com/d/SUMubvcHQ5mF1Dz");
    expect(offer.text).toContain("Proper Fact Sheet.pdf");
    expect(offer.text).toContain("Covers 2026");

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
