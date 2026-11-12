import { describe, expect, it } from "vitest";
import { formatNeedsList } from "../src/intake/ask-text.js";
import { routingSignOff, ROUTING_BUCKET_OPTION_GIDS } from "../src/intake/catalog.js";
import { rememberRequestFacts } from "../src/intake/capture.js";
import { leadTimeFor, leadTimeIsTight, workingDaysUntil } from "../src/intake/lead-time.js";
import { listMissing } from "../src/intake/missing.js";
import { buildDescription, formatSummary } from "../src/intake/brief.js";

const WEDNESDAY = new Date("2026-11-11T18:00:00Z");

describe("Elena's intake flow", () => {
  it("uses Kinsey's working-day lead times and checks in only when the date is tighter", () => {
    expect(leadTimeFor({ taskType: "New Page" })).toMatchObject({ days: 10, kind: "working" });
    expect(leadTimeFor({ taskType: "Offers" }).days).toBe(5);
    expect(leadTimeFor({ taskType: "Page Edit" }).days).toBe(3);
    expect(leadTimeFor({ taskType: "Happenings" }).days).toBe(1);
    expect(leadTimeFor({ taskType: "Menu Upload" }).days).toBe(1);
    expect(workingDaysUntil("2026-11-12", WEDNESDAY)).toBe(1);
    expect(leadTimeIsTight({ taskType: "Happenings", requestedCompletionDate: "2026-11-12" }, WEDNESDAY)).toBe(false);
    expect(leadTimeIsTight({ taskType: "Page Edit", requestedCompletionDate: "2026-11-12" }, WEDNESDAY)).toBe(true);

    const tight = listMissing({
      requesterName: "Kinsey East",
      requesterEmail: "kinsey@properhotel.com",
      requestName: "Homepage edit",
      properties: ["SMP"],
      requestType: "Web",
      taskType: "Page Edit",
      requestedCompletionDate: "2026-11-12",
      followUps: {
        URL: "https://www.properhotel.com/santa-monica",
        "Page Change Details (exact copy provided, if required)": "Update the hero line.",
        "What it replaces and where it sits": "Hero, same spot",
      },
      copyReady: true,
      designNeeded: false,
      approver: "Kinsey East",
    }, WEDNESDAY);
    expect(tight.warnings.join(" ")).toContain("Page edits need about 3 working days");
    expect(tight.items.map((item) => item.id)).toContain("consequenceOfDelay");

    const comfortable = listMissing({
      requesterName: "Kinsey East",
      requesterEmail: "kinsey@properhotel.com",
      requestName: "Gift page",
      properties: ["HJWL"],
      requestType: "Web",
      taskType: "New Page",
      requestedCompletionDate: "2026-12-04",
      followUps: {
        URL: "https://www.thehoteljune.com/west-los-angeles/offers/gift",
        "Page Headline (Exact)": "A Gift For You",
        "Page Copy (Exact)": "Up to 40% off.",
        "What it replaces and where it sits": "Replaces Gathering Season, first on the offers page",
      },
      copyReady: true,
      designNeeded: false,
      approver: "Kinsey East",
    }, WEDNESDAY);
    expect(comfortable.items.map((item) => item.id)).not.toContain("consequenceOfDelay");
    expect(comfortable.warnings.join(" ")).not.toContain("tighter");
  });

  it("asks web questions in Elizabeth's order and offer questions only for an offer", () => {
    const web = listMissing({
      requesterName: "Kinsey East",
      requesterEmail: "kinsey@properhotel.com",
      requestName: "Gift page",
      properties: ["HJWL"],
      requestType: "Web",
      taskType: "New Page",
    }, WEDNESDAY);
    const ids = web.items.map((item) => item.id);
    expect(ids.indexOf("copyReady")).toBeLessThan(ids.indexOf("designNeeded"));
    expect(ids.indexOf("designNeeded")).toBeLessThan(ids.indexOf("requestedCompletionDate"));
    expect(ids.indexOf("requestedCompletionDate")).toBeLessThan(ids.indexOf("followup:What it replaces and where it sits"));
    expect(ids.some((id) => id.includes("old offer"))).toBe(false);

    const offer = listMissing({
      requesterName: "Kinsey East",
      requesterEmail: "kinsey@properhotel.com",
      requestName: "Replace the valet offer",
      properties: ["SMP"],
      requestType: "Web",
      taskType: "Page Edit",
      notes: "This is an offer swap.",
    }, WEDNESDAY);
    const labels = offer.items.map((item) => item.label);
    expect(labels).toContain("When the old offer comes down");
    expect(labels).toContain("What replaces it in ads or evergreen campaigns");
    expect(labels).toContain("Rate or promo codes in transactional emails");
    expect(labels).toContain("Offer copy, rules, and photo");
  });

  it("asks for a menu PDF up front and rejects a Figma link", () => {
    const missing = listMissing({
      requesterName: "Kinsey East",
      requesterEmail: "kinsey@properhotel.com",
      requestName: "Dinner menu",
      properties: ["SFP"],
      requestType: "Web",
      taskType: "Menu Upload",
      attachments: [{ ref: "https://www.figma.com/buzz/abc", kind: "menu_or_brochure" }],
    }, WEDNESDAY);
    const pdf = missing.items.find((item) => item.id === "attachmentPdf:0" || item.id === "attachmentProvide");
    expect(pdf?.hint).toContain("can't open a Figma");
    expect(pdf?.hint).toContain("upload-ready PDF");
  });

  it("prefills the first message and shows one list with those guesses", () => {
    const draft: Parameters<typeof rememberRequestFacts>[0] = {};
    rememberRequestFacts(draft, "New page for SMP. Copy is not ready. Jamie Mark is writing it. No design. It replaces Gathering Season and sits in the first spot. Also notify DeeDee Brown.");
    expect(draft.properties).toEqual(["SMP"]);
    expect(draft.requestType).toBe("Web");
    expect(draft.taskType).toBe("New Page");
    expect(draft.copyReady).toBe(false);
    expect(draft.copyOwner).toBe("Jamie Mark");
    expect(draft.designNeeded).toBe(false);
    expect(draft.followUps?.["What it replaces and where it sits"]).toContain("Gathering Season");
    expect(draft.alsoNotify).toEqual(["DeeDee Brown"]);

    const missing = listMissing({
      ...draft,
      requesterName: "Kinsey East",
      requesterEmail: "kinsey@properhotel.com",
      requestName: "SMP landing page",
    }, WEDNESDAY);
    expect(missing.items.map((item) => item.id)).not.toContain("copyReady");
    expect(missing.items.map((item) => item.id)).not.toContain("designNeeded");
    expect(missing.items.map((item) => item.id)).not.toContain("properties");
    const text = formatNeedsList({ items: missing.items, draft: { ...draft, requestName: "SMP landing page" }, opening: true, today: WEDNESDAY });
    expect(text).toContain("I have this so far");
    expect(text).toContain("This looks like New Page");
    expect(text).toContain("You can answer all of these now, or we can chat through it.");
    expect(text.match(/We need:/g)).toHaveLength(1);
  });

  it("shows the routing group in the confirmation without a person's name or an Asana option id", () => {
    expect(ROUTING_BUCKET_OPTION_GIDS["Proper & By Proper"]).toBe("");
    expect(ROUTING_BUCKET_OPTION_GIDS.Collective).toBe("");
    const proper = routingSignOff(["SFP"]);
    expect(proper.bucket).toBe("Proper & By Proper");
    expect(proper.signOff).toBe("Proper & By Proper approver to be confirmed");
    expect(proper.signOff).not.toMatch(/DeeDee|Koral/);
    const summary = formatSummary({
      draft: {
        requesterName: "Kinsey East",
        requesterEmail: "kinsey@properhotel.com",
        requestName: "Homepage",
        properties: ["HJWL"],
        requestType: "Web",
        taskType: "Page Edit",
        requestedCompletionDate: "2026-12-04",
        approver: "Kinsey East",
      },
      warnings: [],
      templateOffer: null,
      duplicates: [],
    });
    expect(summary).toContain("Routing bucket: Collective");
    expect(summary).toContain("Collective approver to be confirmed");
    expect(summary).toContain("Task name:");
    expect(summary).not.toMatch(/Sign-off:.*DeeDee|Sign-off:.*Koral/);
    const notes = buildDescription({
      draft: {
        requesterName: "Kinsey East",
        requesterEmail: "kinsey@properhotel.com",
        requestName: "Homepage",
        properties: ["SMP"],
        requestType: "Web",
        taskType: "Page Edit",
        alsoNotify: ["DeeDee Brown"],
      },
      templateOffer: null,
    });
    expect(notes).toContain("Also notify: DeeDee Brown");
  });
});
