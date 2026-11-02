import type { RequestType } from "./types.js";

export interface TemplateAppliesTo {
  requestType: RequestType;
  taskTypes: string[];
}

export interface CanvaTemplate {
  id: string;
  name: string;
  useFor: string;
  appliesTo: TemplateAppliesTo[];
  any: string[];
  all?: string[];
  /** Reject this template when the request text contains any of these phrases. */
  unless?: string[];
  properties: string[];
  family: string;
  older?: boolean;
  preferIf?: string[];
  /** True when another live template uses this exact name. */
  duplicateName?: boolean;
}

export interface ArchivedTemplate {
  id: string;
  name: string;
  reason: string;
}

export const CANVA_TEMPLATE_BASE = "https://www.canva.com/brand/brand-templates";

export function templateUrl(id: string): string {
  return `${CANVA_TEMPLATE_BASE}/${id}`;
}

/**
 * Not for reuse. Kept so a match can never return them, including the 2026
 * one-off that would otherwise look current.
 */
export const ARCHIVED_TEMPLATES: ArchivedTemplate[] = [
  { id: "EAHFpg0J5Y0", name: "xArchive SMP Palma Proper Sounds", reason: "archived" },
  { id: "EAHUpJlPwUs", name: "Title", reason: "one-off" },
  { id: "EAHMB7c-Jas", name: "Copy of Proper-FirstAgencyIncentive", reason: "one-off" },
  { id: "EAHFpt_7ROE", name: "June Tennis Clinic", reason: "one-off" },
  { id: "EAHFpOUCusM", name: "2025-Q3-Summer-Offers", reason: "one-off" },
  { id: "EAHFpFgne3E", name: "SMP_PP_APF_FRIEZE", reason: "one-off" },
  { id: "EAHFpBSaock", name: "AUP_Social_SXSW_Story_2026", reason: "one-off" },
];

const SOCIAL: TemplateAppliesTo[] = [
  { requestType: "Creative", taskTypes: ["Social"] },
  { requestType: "Social", taskTypes: ["Feed Post Request", "Story Request"] },
];

const SALES: TemplateAppliesTo[] = [
  { requestType: "Creative", taskTypes: ["Sales Collateral"] },
  { requestType: "Marketing", taskTypes: ["Offers"] },
];

const PRINT: TemplateAppliesTo[] = [{ requestType: "Creative", taskTypes: ["Print Collateral"] }];
const MENU: TemplateAppliesTo[] = [{ requestType: "Creative", taskTypes: ["Menu (F&B, Spa)"] }];
const DECK: TemplateAppliesTo[] = [{ requestType: "Creative", taskTypes: ["Presentation / Deck"] }];
const DIGITAL: TemplateAppliesTo[] = [{ requestType: "Creative", taskTypes: ["Digital Asset"] }];

function tpl(
  partial: Omit<CanvaTemplate, "properties"> & { properties?: string[] },
): CanvaTemplate {
  return { properties: [], ...partial };
}

export const CANVA_TEMPLATES: CanvaTemplate[] = [
  tpl({
    id: "EAHLiqx7MHM",
    name: "Proper-Social-Happenings-2026",
    useFor: "Happenings, all Proper",
    appliesTo: SOCIAL,
    any: ["happening"],
    family: "happenings",
  }),
  tpl({
    id: "EAHJyAsHwPs",
    name: "SMP-Happenings",
    useFor: "Weekly happenings, SMP",
    appliesTo: SOCIAL,
    any: ["happening"],
    properties: ["SMP"],
    family: "happenings",
  }),
  tpl({
    id: "EAHLp0KEPQs",
    name: "TCH-Social-Happenings-2026",
    useFor: "Weekly happenings, TCH",
    appliesTo: SOCIAL,
    any: ["happening"],
    properties: ["TCH"],
    family: "happenings",
  }),
  tpl({
    id: "EAHLuFeYCwI",
    name: "HJ-WeeklyHappenings-2026",
    useFor: "Weekly happenings, HJ",
    appliesTo: SOCIAL,
    any: ["happening"],
    properties: ["HJWL", "HJM"],
    family: "happenings",
  }),
  tpl({
    id: "EAHLq3m72VA",
    name: "ING-WeeklyHappenings-2026",
    useFor: "Weekly happenings, ING",
    appliesTo: SOCIAL,
    any: ["happening"],
    properties: ["ING"],
    family: "happenings",
  }),
  tpl({
    id: "EAHLoWvK5-c",
    name: "APS-WeeklyHappenings-2026",
    useFor: "Weekly happenings, APS",
    appliesTo: SOCIAL,
    any: ["happening"],
    properties: ["APS"],
    family: "happenings",
  }),
  tpl({
    id: "EAHLofMvYd8",
    name: "ABH-WeeklyHappenings-2026",
    useFor: "Weekly happenings, ABH",
    appliesTo: SOCIAL,
    any: ["happening"],
    properties: ["ABH"],
    family: "happenings",
  }),
  tpl({
    id: "EAHMGUl1fOU",
    name: "Shelborne-WeeklyHappenings-2026",
    useFor: "Weekly happenings, SMB (Shelborne)",
    appliesTo: SOCIAL,
    any: ["happening"],
    properties: ["SMB"],
    family: "happenings",
  }),
  tpl({
    id: "EAHLijRrE2U",
    name: "Proper-Social-DJSets-2026",
    useFor: "DJ sets",
    appliesTo: SOCIAL,
    any: ["dj"],
    family: "dj",
  }),
  tpl({
    id: "EAHJx45W9QA",
    name: "SMP_Palma_DJSets",
    useFor: "DJ sets, SMP Palma",
    appliesTo: SOCIAL,
    any: ["dj"],
    all: ["palma"],
    properties: ["SMP"],
    family: "dj",
  }),
  tpl({
    id: "EAHLjCRgyak",
    name: "Proper-Social-ProperSoundsLineup-2026",
    useFor: "Music lineup (Proper Sounds)",
    appliesTo: SOCIAL,
    any: ["proper sounds", "music lineup", "sounds lineup"],
    family: "sounds-lineup",
  }),
  tpl({
    id: "EAHFjMjHCm8",
    name: "ProperPresents-Lineup",
    useFor: "Proper Presents lineup",
    appliesTo: SOCIAL,
    any: ["proper presents lineup", "presents lineup"],
    family: "presents-lineup",
  }),
  tpl({
    id: "EAGteKYmqpY",
    name: "ProperPresents_Template",
    useFor: "Proper Presents, other",
    appliesTo: SOCIAL,
    any: ["proper presents"],
    family: "presents",
  }),
  tpl({
    id: "EAG5oWwaryo",
    name: "PP_Lineup_template",
    useFor: "Lineup, general",
    appliesTo: SOCIAL,
    any: ["lineup"],
    family: "lineup",
  }),
  tpl({
    id: "EAHVrNTlM1M",
    name: "Proper-Social-Press-2026",
    useFor: "Press feature",
    appliesTo: SOCIAL,
    any: ["press"],
    family: "press",
    duplicateName: true,
  }),
  tpl({
    id: "EAHHycjf7Ug",
    name: "Proper-Social-Press-2026",
    useFor: "Press feature",
    appliesTo: SOCIAL,
    any: ["press"],
    family: "press",
    duplicateName: true,
  }),
  tpl({
    id: "EAG5oZW2opw",
    name: "Press_Template",
    useFor: "Press, older",
    appliesTo: SOCIAL,
    any: ["press"],
    family: "press",
    older: true,
  }),
  tpl({
    id: "EAHFjA_koEo",
    name: "Proper_EventRecap_IGStory",
    useFor: "Event recap story",
    appliesTo: SOCIAL,
    any: ["event recap", "recap story"],
    family: "recap",
  }),
  tpl({
    id: "EAGteKsBuUs",
    name: "PP_RecapStory_Template",
    useFor: "Recap story",
    appliesTo: SOCIAL,
    any: ["recap"],
    family: "recap",
  }),
  tpl({
    id: "EAGldCymBM0",
    name: "Proper-IGStoryTemplate",
    useFor: "General IG story",
    appliesTo: SOCIAL,
    any: ["ig story", "instagram story", "story template"],
    family: "ig-story",
  }),
  tpl({
    id: "EAHFjLMtTp4",
    name: "Proper-Carouseltemplate",
    useFor: "Carousel",
    appliesTo: SOCIAL,
    any: ["carousel"],
    family: "carousel",
  }),
  tpl({
    id: "EAHFjM4jFAY",
    name: "Proper_ArtistinFocus_Carousel",
    useFor: "Artist carousel",
    appliesTo: SOCIAL,
    any: ["artist carousel", "artist in focus"],
    family: "artist-carousel",
  }),
  tpl({
    id: "EAG5YaWIOc0",
    name: "PP - Artist Flyer Template",
    useFor: "Artist flyer",
    appliesTo: SOCIAL,
    any: ["artist flyer", "artist feature"],
    family: "artist-flyer",
  }),
  tpl({
    id: "EAHFpvxlDTw",
    name: "SMP Arc De Soleil Artist Feature",
    useFor: "Artist feature, SMP",
    appliesTo: SOCIAL,
    any: ["arc de soleil", "artist feature"],
    properties: ["SMP"],
    family: "artist-flyer",
  }),
  tpl({
    id: "EAHFjM7HJog",
    name: "Proper-EventFlyer",
    useFor: "Event flyer",
    appliesTo: SOCIAL,
    any: ["event flyer", "flyer"],
    family: "event-flyer",
  }),
  tpl({
    id: "EAGi23395pU",
    name: "VinylNights-Template",
    useFor: "Vinyl nights",
    appliesTo: SOCIAL,
    any: ["vinyl"],
    family: "vinyl",
  }),
  tpl({
    id: "EAHFpgsHpQ8",
    name: "SMP_RunClub",
    useFor: "Run club, SMP",
    appliesTo: SOCIAL,
    any: ["run club", "runclub"],
    properties: ["SMP"],
    family: "run-club",
  }),
  tpl({
    id: "EAHFpgBeE48",
    name: "SMP Camp Fitness",
    useFor: "Fitness, SMP",
    appliesTo: SOCIAL,
    any: ["fitness", "camp fitness"],
    properties: ["SMP"],
    family: "fitness",
  }),
  tpl({
    id: "EAHFpn_80v8",
    name: "Sunset Tennis Club",
    useFor: "Tennis",
    appliesTo: SOCIAL,
    any: ["tennis"],
    family: "tennis",
  }),
  tpl({
    id: "EAHFpfYf20U",
    name: "SMP-summerperks",
    useFor: "Summer perks, SMP",
    appliesTo: SOCIAL,
    any: ["summer perk"],
    properties: ["SMP"],
    family: "summer-perks",
  }),
  tpl({
    id: "EAHFpspzuv4",
    name: "Proper-TL",
    useFor: "Proper-TL story",
    appliesTo: SOCIAL,
    any: ["proper tl"],
    family: "proper-tl",
  }),
  tpl({
    id: "EAHLp1xACjE",
    name: "Proper-LinkedIn-GeneralPost-2026",
    useFor: "LinkedIn general post",
    appliesTo: SOCIAL,
    any: ["linkedin"],
    unless: ["job", "hiring", "tradeshow", "trade show"],
    family: "linkedin",
  }),
  tpl({
    id: "EAHJxxtUsXA",
    name: "Linkedin-Tradeshow_Template",
    useFor: "LinkedIn tradeshow",
    appliesTo: SOCIAL,
    any: ["tradeshow", "trade show"],
    family: "linkedin-tradeshow",
  }),
  tpl({
    id: "EAHLpizwGLs",
    name: "Proper-LinkedIn-JobPostings-2026",
    useFor: "LinkedIn job posting",
    appliesTo: SOCIAL,
    any: ["job posting", "job post", "hiring", "linkedin hiring", "linkedin job"],
    family: "linkedin-job",
  }),
  tpl({
    id: "EAHFpinmz4g",
    name: "Proper_LinkedIn_JobPostings_Tahoe",
    useFor: "LinkedIn job posting, Tahoe",
    appliesTo: SOCIAL,
    any: ["tahoe", "job tahoe"],
    all: ["job"],
    family: "linkedin-job",
  }),
  tpl({
    id: "EAHFi2CczNM",
    name: "Hiring_SMPLinkedIn_4:5",
    useFor: "LinkedIn hiring, SMP",
    appliesTo: SOCIAL,
    any: ["hiring", "job posting", "job post", "linkedin hiring"],
    properties: ["SMP"],
    family: "linkedin-job",
  }),
  tpl({
    id: "EAHFpjY4uB8",
    name: "Hiring_AUP LinkedIn_4:5",
    useFor: "LinkedIn hiring, AUP",
    appliesTo: SOCIAL,
    any: ["hiring", "job posting", "job post", "linkedin hiring"],
    properties: ["AUP"],
    family: "linkedin-job",
  }),

  tpl({
    id: "EAHMBrpdhYs",
    name: "Proper-Offer/Catering-8.5x11-2026",
    useFor: "Offer or catering flyer (8.5x11)",
    appliesTo: SALES,
    any: ["offer", "catering", "flyer"],
    family: "offer-flyer",
  }),
  tpl({
    id: "EAHKadNU7zE",
    name: "Proper_Offer/Catering_8.5x11_Template",
    useFor: "Offer or catering flyer, older",
    appliesTo: SALES,
    any: ["offer", "catering", "flyer"],
    family: "offer-flyer",
    older: true,
  }),
  tpl({
    id: "EAHMIHmQKsA",
    name: "Proper-Q1GroupOffer-2026",
    useFor: "Group offer",
    appliesTo: SALES,
    any: ["group offer"],
    family: "group-offer",
  }),
  tpl({
    id: "EAHYwn5ZpCU",
    name: "Proper-Q1GroupOffer-Template",
    useFor: "Group offer, older",
    appliesTo: SALES,
    any: ["group offer"],
    family: "group-offer",
    older: true,
  }),
  tpl({
    id: "EAHLuZgnH4U",
    name: "GroupSummerOffer",
    useFor: "Summer group offer",
    appliesTo: SALES,
    any: ["summer group"],
    family: "group-offer",
  }),
  tpl({
    id: "EAHMBl9wbAk",
    name: "Proper-BT-SalesFlyer-2026",
    useFor: "Business travel sales flyer",
    appliesTo: SALES,
    any: ["business travel", "bt flyer", "bt sales"],
    family: "bt-flyer",
  }),
  tpl({
    id: "EAHMIL-yfVQ",
    name: "BT Flyer",
    useFor: "Business travel flyer, older",
    appliesTo: SALES,
    any: ["business travel", "bt flyer"],
    family: "bt-flyer",
    older: true,
  }),
  tpl({
    id: "EAHMCDclNHA",
    name: "SMP-FactSheet-2026",
    useFor: "Fact sheet, SMP",
    appliesTo: SALES,
    any: ["fact sheet", "factsheet"],
    properties: ["SMP"],
    family: "fact-sheet",
  }),
  tpl({
    id: "EAHMCBuEJxk",
    name: "SFP-FactSheet-2026",
    useFor: "Fact sheet, SFP",
    appliesTo: SALES,
    any: ["fact sheet", "factsheet"],
    properties: ["SFP"],
    family: "fact-sheet",
  }),
  tpl({
    id: "EAHMCFLRJCo",
    name: "DTLA-FactSheet-2026",
    useFor: "Fact sheet, DTLA",
    appliesTo: SALES,
    any: ["fact sheet", "factsheet"],
    properties: ["DTLA"],
    family: "fact-sheet",
  }),
  tpl({
    id: "EAHMCAK0B84",
    name: "AustinProper-FactSheet-2026",
    useFor: "Fact sheet, AUP",
    appliesTo: SALES,
    any: ["fact sheet", "factsheet"],
    properties: ["AUP"],
    family: "fact-sheet",
  }),
  tpl({
    id: "EAG7tNsa-Vk",
    name: "Shelborne_FactSheet",
    useFor: "Fact sheet, SMB",
    appliesTo: SALES,
    any: ["fact sheet", "factsheet"],
    properties: ["SMB"],
    family: "fact-sheet",
  }),
  tpl({
    id: "EAG5Qs_zsYE",
    name: "SantaMonica_FactSheet",
    useFor: "Fact sheet, older",
    appliesTo: SALES,
    any: ["fact sheet", "factsheet"],
    properties: ["SMP"],
    family: "fact-sheet",
    older: true,
  }),
  tpl({
    id: "EAG7tIkqe0o",
    name: "Austin_FactSheet",
    useFor: "Fact sheet, older",
    appliesTo: SALES,
    any: ["fact sheet", "factsheet"],
    properties: ["AUP"],
    family: "fact-sheet",
    older: true,
  }),
  tpl({
    id: "EAG7Qvqlv88",
    name: "Shelborne_SalesDoc",
    useFor: "Sales doc, SMB",
    appliesTo: SALES,
    any: ["sales doc", "sales document"],
    properties: ["SMB"],
    family: "sales-doc",
  }),
  tpl({
    id: "EAHMB_FHEIA",
    name: "Proper-GroupSales-PortfolioBrochure (Short)-2026",
    useFor: "Group sales brochure, short",
    appliesTo: SALES,
    any: ["group sales brochure", "portfolio brochure", "short brochure"],
    preferIf: ["short"],
    family: "brochure",
  }),
  tpl({
    id: "EAHMCDUKtJI",
    name: "Proper-GroupSales-PortfolioBrochure (Long)-2026",
    useFor: "Group sales brochure, long",
    appliesTo: SALES,
    any: ["group sales brochure", "portfolio brochure", "long brochure"],
    preferIf: ["long"],
    family: "brochure",
  }),

  tpl({
    id: "EAHFi1cMfXE",
    name: "Proper-BusinessCard-Template",
    useFor: "Business card (3.5x2 in)",
    appliesTo: PRINT,
    any: ["business card"],
    family: "business-card",
  }),
  tpl({
    id: "EAHFpPr31Ok",
    name: "Amenity Postcard",
    useFor: "Amenity postcard",
    appliesTo: PRINT,
    any: ["postcard", "amenity card"],
    family: "postcard",
  }),
  tpl({
    id: "EAHJyJDmlrg",
    name: "SMP_POOLRULES_7x10",
    useFor: "Pool rules sign, SMP (7x10)",
    appliesTo: PRINT,
    any: ["pool rule", "pool sign"],
    properties: ["SMP"],
    family: "pool-rules",
  }),
  tpl({
    id: "EAHNgYLv80s",
    name: "CaravanCantina-InviteTemplate-2026",
    useFor: "Invitation",
    appliesTo: PRINT,
    any: ["invitation", "invite"],
    family: "invitation",
  }),

  tpl({
    id: "EAG_kd17cpk",
    name: "5X7_ProperEventMenu",
    useFor: "Event menu (5x7)",
    appliesTo: MENU,
    any: ["event menu", "5x7"],
    family: "event-menu",
  }),

  tpl({
    id: "EAG5QpsXDDg",
    name: "Proper-BrandDeckTemplate",
    useFor: "Brand deck",
    appliesTo: DECK,
    any: ["brand deck", "brand presentation"],
    family: "brand-deck",
  }),
  tpl({
    id: "EAGldPNjS-0",
    name: "Proper-PresentationTemplate",
    useFor: "General presentation",
    appliesTo: DECK,
    any: ["presentation", "deck", "slides"],
    family: "presentation",
  }),
  tpl({
    id: "EAHJyAoESjU",
    name: "Proper_ArtDirection_Deck",
    useFor: "Art direction deck",
    appliesTo: DECK,
    any: ["art direction"],
    family: "art-direction",
  }),
  ...propertyDecks(),

  tpl({
    id: "EAG7_FXe02k",
    name: "ShelborneWebsite-HeaderImageSizeTemplate",
    useFor: "Website header image, SMB",
    appliesTo: DIGITAL,
    any: ["header", "website header"],
    properties: ["SMB"],
    family: "website-header",
  }),
];

function propertyDecks(): CanvaTemplate[] {
  const rows: Array<[string, string, string]> = [
    ["AUP Presentation Template", "EAHEzXlCnmg", "AUP"],
    ["SFP Presentation Template", "EAHEzf3t6Zs", "SFP"],
    ["SMP Presentation Template", "EAHEzaOv53o", "SMP"],
    ["DTLAP Presentation Template", "EAHEzQvDUFw", "DTLA"],
    ["SHEL Presentation Template", "EAHEzXqCA0A", "SMB"],
    ["HJWLA Presentation Template", "EAHEzBJq-_E", "HJWL"],
    ["HJM Presentation Template", "EAHEzf7SSCs", "HJM"],
    ["ABH Presentation Template", "EAHEzMJDwAE", "ABH"],
    ["APS Presentation Template", "EAHEzBEzQiM", "APS"],
    ["ING Presentation Template", "EAHEzL8Sxsg", "ING"],
    ["MYC_Presenation Template", "EAHEzM6414o", "MYC"],
    ["TCH Presentation Template", "EAHFigBd7wQ", "TCH"],
  ];
  return rows.map(([name, id, property]) =>
    tpl({
      id,
      name,
      useFor: `${property} presentation`,
      appliesTo: DECK,
      any: ["presentation", "deck", "slides"],
      properties: [property],
      family: "presentation",
    }),
  );
}

export interface TemplateMatch {
  id: string;
  name: string;
  useFor: string;
  url: string;
  score: number;
}

export interface TemplateMatchResult {
  matches: TemplateMatch[];
  duplicateName: boolean;
  needsProperty: boolean;
  note?: string;
}

export interface TemplateQuery {
  requestType: RequestType;
  taskType: string;
  properties: string[];
  text: string;
}

const PRESS_DUPLICATE_NOTE =
  "Two templates are both named Proper-Social-Press-2026 (EAHVrNTlM1M and EAHHycjf7Ug). Both are included. Ask which one to use.";

export function matchTemplates(query: TemplateQuery): TemplateMatchResult {
  const haystack = normalize(query.text);
  const keywordHits = CANVA_TEMPLATES.filter(
    (template) => applies(template, query) && keywordsMatch(template, haystack),
  );

  if (query.properties.length === 0 && keywordHits.some((template) => template.properties.length > 0)) {
    return {
      matches: [],
      duplicateName: false,
      needsProperty: true,
      note: "A property-specific template may fit. Ask which property before offering a template.",
    };
  }

  const eligible = keywordHits.filter((template) => propertyAllowed(template, query.properties));
  const withoutOlderShadows = dropOlderWhenNewerExists(eligible);
  const scored = withoutOlderShadows
    .map((template) => ({ template, score: scoreTemplate(template, haystack) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name) || a.template.id.localeCompare(b.template.id));

  if (scored.length === 0) {
    return { matches: [], duplicateName: false, needsProperty: false };
  }

  const top = scored[0].score;
  const winners = scored.filter((row) => row.score === top);
  const duplicateName = winners.length > 1 && winners.every((row) => row.template.name === winners[0].template.name);
  let note: string | undefined;
  if (duplicateName) note = PRESS_DUPLICATE_NOTE;
  else if (winners.length > 1) note = "More than one template fits equally. Share each name and link.";

  return {
    matches: winners.map((row) => ({
      id: row.template.id,
      name: row.template.name,
      useFor: row.template.useFor,
      url: templateUrl(row.template.id),
      score: row.score,
    })),
    duplicateName,
    needsProperty: false,
    note,
  };
}

function applies(template: CanvaTemplate, query: TemplateQuery): boolean {
  return template.appliesTo.some(
    (rule) => rule.requestType === query.requestType && rule.taskTypes.includes(query.taskType),
  );
}

function propertyAllowed(template: CanvaTemplate, properties: string[]): boolean {
  if (template.properties.length === 0) return true;
  return template.properties.some((property) => properties.includes(property));
}

function keywordsMatch(template: CanvaTemplate, haystack: string): boolean {
  if (template.any.length === 0) return false;
  if (!template.any.some((keyword) => haystack.includes(normalize(keyword)))) return false;
  if ((template.unless ?? []).some((keyword) => haystack.includes(normalize(keyword)))) return false;
  return (template.all ?? []).every((keyword) => haystack.includes(normalize(keyword)));
}

function dropOlderWhenNewerExists(templates: CanvaTemplate[]): CanvaTemplate[] {
  const familiesWithCurrent = new Set(
    templates.filter((template) => !template.older).map((template) => template.family),
  );
  return templates.filter((template) => !template.older || !familiesWithCurrent.has(template.family));
}

function scoreTemplate(template: CanvaTemplate, haystack: string): number {
  let best = 0;
  for (const keyword of template.any) {
    const normalized = normalize(keyword);
    if (haystack.includes(normalized)) best = Math.max(best, normalized.length);
  }
  if (best === 0) return 0;
  let score = 10 + best;
  if (template.properties.length > 0) score += 50;
  for (const hint of template.preferIf ?? []) {
    if (haystack.includes(normalize(hint))) score += 20;
  }
  return score;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9+&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function duplicateNameGroups(): Array<{ name: string; ids: string[] }> {
  const byName = new Map<string, string[]>();
  for (const template of CANVA_TEMPLATES) {
    const ids = byName.get(template.name) ?? [];
    ids.push(template.id);
    byName.set(template.name, ids);
  }
  return [...byName.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ name, ids }));
}
