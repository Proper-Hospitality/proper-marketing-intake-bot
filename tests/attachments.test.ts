import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runIntakeTurn, type Llm } from "../src/agent/run.js";
import {
  ATTACHMENT_KIND_HINT,
  MENU_PDF_PATTERN,
  applyAttachmentAnswer,
  captureIncomingFiles,
} from "../src/intake/attachments.js";
import { buildDescription, formatSummary } from "../src/intake/brief.js";
import { FORM_URL, PROJECT_GID, SECTION_GID, WORKSPACE_GID } from "../src/intake/catalog.js";
import { applyAnswers } from "../src/intake/flow.js";
import { listMissing } from "../src/intake/missing.js";
import { HANDLER_FAILURE_TEXT } from "../src/slack/failure.js";
import { emptyConversation } from "../src/store/types.js";
import type { BriefDraft } from "../src/intake/types.js";

const today = new Date("2026-11-10T20:00:00Z");
const silent: Llm = { async complete() { throw new Error("Claude should not be asked"); } };

describe("attachment kinds", () => {
  it("does not ask about files when the request has none", () => {
    const report = listMissing(finishedEmail(), today);
    expect(report.items).toEqual([]);
    expect(report.items.map((item) => item.id).join(" ")).not.toMatch(/attachment/);
  });

  it("asks which kind a provided file is, then continues once it is a photo", async () => {
    const state = emptyConversation("C:photo");
    state.phase = "collecting";
    state.draft = {
      ...finishedEmail(),
      assets: ["https://drive.example.com/photo"],
    };
    const missing = listMissing(state.draft, today);
    expect(missing.items.map((item) => item.id)).toEqual(["attachmentKind:0"]);
    expect(missing.items[0]?.hint).toBe(ATTACHMENT_KIND_HINT);
    expect(missing.items[0]?.hint).toContain("menu or brochure");
    expect(missing.items[0]?.hint).toContain("A photo needed for the page");
    expect(missing.items[0]?.hint).toContain("built as a page");
    expect(missing.items[0]?.hint).toContain("previous version");
    state.lastAskedId = "attachmentKind:0";
    state.lastAskedLabel = missing.items[0]?.label;

    const reply = await runIntakeTurn({
      state,
      userText: "A photo needed for the page",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: silent,
      today,
    });
    expect(state.draft.attachments?.[0]?.kind).toBe("photo");
    expect(reply.confirm?.version).toBe(1);
    expect(reply.text).not.toContain("Prefer the form");
    expect(reply.text).not.toContain("form.asana.com");
  });

  it("asks a menu upload for a file, accepts a website link, and requires an upload-ready PDF", async () => {
    const state = emptyConversation("C:menu-upload");
    state.phase = "collecting";
    state.draft = menuUploadDraft();
    const provide = listMissing(state.draft, today);
    expect(provide.items.map((item) => item.id)).toEqual(["attachmentProvide"]);
    expect(provide.items[0]?.hint).toContain("Dropbox");
    expect(provide.items[0]?.hint).toContain("website");
    state.lastAskedId = "attachmentProvide";
    state.lastAskedLabel = "Upload or link for this file";

    const linked = await runIntakeTurn({
      state,
      userText: "It's already on the website https://www.properhotel.com/santa-monica/dining",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: silent,
      today,
    });
    expect(state.draft.attachments?.map((item) => item.ref)).toContain("https://www.properhotel.com/santa-monica/dining");
    expect(linked.text).toContain("What kind of file is");

    state.lastAskedId = "attachmentKind:0";
    const kind = await runIntakeTurn({
      state,
      userText: "A PDF of a menu or brochure that needs to be linked onto a page",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: silent,
      today,
    });
    expect(state.draft.attachments?.[0]?.kind).toBe("menu_or_brochure");
    expect(kind.text).toContain("Figma Buzz");
    expect(kind.text).toContain(MENU_PDF_PATTERN);
    expect(kind.text).toContain("SMP_Outlet_MenuName_MonthYear");
    expect(kind.text).toContain("one menu per file");
    expect(kind.text).toContain("Let marketing recommend");
    expect(kind.confirm).toBeUndefined();
  });

  it("rejects a Figma Buzz file and a two-menu file, then accepts one clearly named PDF", async () => {
    const state = emptyConversation("C:buzz");
    state.phase = "collecting";
    state.draft = {
      ...menuUploadDraft(),
      attachments: [{ ref: "https://www.figma.com/buzz/abc", kind: "menu_or_brochure" }],
    };
    state.lastAskedId = "attachmentPdf:0";
    state.lastAskedLabel = "Upload-ready PDF";
    const buzz = await runIntakeTurn({
      state,
      userText: "yes",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: silent,
      today,
    });
    expect(buzz.text).toContain("Figma Buzz");
    expect(state.draft.attachments?.[0]?.uploadReady).toBeUndefined();
    expect(buzz.confirm).toBeUndefined();

    const sided = applyAttachmentAnswer(
      state.draft,
      "attachmentPdf:0",
      "https://www.dropbox.com/s/abc/SMP_Dinner_Both_Menus_side_by_side.pdf",
    );
    expect(sided).toBe("need_pdf");
    expect(state.draft.attachments?.[0]?.uploadReady).toBeUndefined();

    const ready = await runIntakeTurn({
      state,
      userText: "https://www.dropbox.com/s/abc/SMP_Calabra_Dinner_Nov2026.pdf",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: silent,
      today,
    });
    expect(state.draft.attachments?.[0]).toMatchObject({
      kind: "menu_or_brochure",
      uploadReady: true,
      ref: "https://www.dropbox.com/s/abc/SMP_Calabra_Dinner_Nov2026.pdf",
    });
    expect(ready.confirm?.version).toBe(1);
    const description = buildDescription({ draft: state.draft, templateOffer: null });
    expect(description).toContain("Attachment type: PDF of a menu or brochure to link onto a page");
    expect(description).toContain("https://www.dropbox.com/s/abc/SMP_Calabra_Dinner_Nov2026.pdf");
    expect(description).toContain("## Brief");
    expect(ready.text).toContain("PDF of a menu or brochure to link onto a page");

    const named: BriefDraft = {
      ...menuUploadDraft(),
      attachments: [{ ref: "SMP_Calabra_Dinner_Nov2026.pdf", kind: "menu_or_brochure" }],
    };
    expect(applyAttachmentAnswer(named, "attachmentPdf:0", "yes")).toBe("recorded");
    expect(named.attachments?.[0]?.uploadReady).toBe(true);
    const generic: BriefDraft = {
      ...menuUploadDraft(),
      attachments: [{ ref: "menu.pdf", kind: "menu_or_brochure" }],
    };
    expect(applyAttachmentAnswer(generic, "attachmentPdf:0", "yes")).toBe("need_pdf");
    expect(generic.attachments?.[0]?.uploadReady).toBeUndefined();
  });

  it("flags a menu the requester cannot export so marketing can see it", async () => {
    const state = emptyConversation("C:defer");
    state.phase = "collecting";
    state.draft = {
      ...menuUploadDraft(),
      attachments: [{ ref: "Figma Buzz file", kind: "menu_or_brochure" }],
    };
    state.lastAskedId = "attachmentPdf:0";
    state.lastAskedLabel = "Upload-ready PDF for Figma Buzz file";
    const reply = await runIntakeTurn({
      state,
      userText: "Let marketing recommend",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: silent,
      today,
    });
    expect(state.draft.attachments?.[0]?.pdfDeferred).toBe(true);
    expect(reply.confirm?.version).toBe(1);
    const description = buildDescription({ draft: state.draft, templateOffer: null });
    expect(description).toContain("Attachment type: PDF of a menu or brochure to link onto a page");
    expect(description).toContain("Figma Buzz file");
    expect(description).toContain("Flagged for marketing (Let marketing recommend)");
  });

  it("asks about each file before it asks for a PDF", () => {
    const draft: BriefDraft = {
      ...menuUploadDraft(),
      attachments: [
        { ref: "Calabra-dinner.pdf" },
        { ref: "https://www.dropbox.com/s/hero/pool.jpg" },
      ],
    };
    expect(listMissing(draft, today).items.map((item) => item.id)).toEqual([
      "attachmentKind:0",
      "attachmentKind:1",
    ]);
    expect(applyAttachmentAnswer(draft, "attachmentKind:0", "photo")).toBe("recorded");
    expect(applyAttachmentAnswer(draft, "attachmentKind:1", "context: previous version")).toBe("recorded");
    expect(listMissing(draft, today).items).toEqual([]);
    const description = buildDescription({ draft, templateOffer: null });
    expect(description).toContain("Attachment 1 type: Photo needed for the page");
    expect(description).toContain("Attachment 2 type: Context: a previous version of the asset, or a deck with background");
    expect(description).toContain("Calabra-dinner.pdf");
    expect(description).toContain("https://www.dropbox.com/s/hero/pool.jpg");
  });

  it("keeps an existing-file check ahead of the attachment questions", () => {
    const state = emptyConversation("C:existing");
    const outcome = applyAnswers(state, {
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@example.com",
      requestName: "Dinner menu",
      properties: ["SMP"],
      requestType: "Creative",
      taskType: "Menu (F&B, Spa)",
      attachments: [{ ref: "https://www.dropbox.com/s/abc/SMP_Calabra_Dinner_Nov2026.pdf" }],
    }, today);
    expect(outcome.kind === "ask_collateral_year" || outcome.kind === "offer_collateral" || outcome.kind === "ask_deliverable").toBe(true);
  });

  it("reads a Slack upload and a Dropbox link off the message", () => {
    const draft: BriefDraft = {};
    captureIncomingFiles(draft, "Menus attached\nFiles: SMP_Calabra_Dinner_Nov2026.pdf, lobby.png");
    captureIncomingFiles(draft, "Dropbox too https://www.dropbox.com/s/abc/offer.pdf");
    expect(draft.involvesFiles).toBe(true);
    expect(draft.attachments?.map((item) => item.ref)).toEqual([
      "SMP_Calabra_Dinner_Nov2026.pdf",
      "lobby.png",
      "https://www.dropbox.com/s/abc/offer.pdf",
    ]);
  });
});

describe("current Asana form", () => {
  it("uses only Kinsey's form link, and files onto the New Intake Board", () => {
    const files = [
      ...walk("src"),
      ...walk("tests"),
      "README.md",
      "manifest.json",
      "render.yaml",
      ".env.example",
    ];
    const urls = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/https:\/\/form\.asana\.com\/\?[^\s)"']+/g)) urls.add(match[0]);
    }
    expect([...urls]).toEqual([FORM_URL]);
    expect(FORM_URL).toBe("https://form.asana.com/?k=JYO_VqiFFnSlwJs_3XoMIg&d=361605662576941");
    expect(HANDLER_FAILURE_TEXT).toContain(FORM_URL);
    expect(PROJECT_GID).toBe("1217171684008018");
    expect(SECTION_GID).toBe("1217518666052136");
    expect(WORKSPACE_GID).toBe("361605662576941");
    const summary = formatSummary({
      draft: finishedEmail(),
      warnings: [],
      templateOffer: null,
      duplicates: [],
    });
    expect(summary).not.toContain("Prefer the form");
    expect(summary).not.toContain("form.asana.com");
  });
});

function finishedEmail(): BriefDraft {
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
    assetsOwner: "Elena Ruiz",
    assetsDue: "2026-11-20",
    followUps: {
      "Audience / Distribution Plan": "Members",
      "Recommended Copy / Details": "Join us this December.",
    },
  };
}

function menuUploadDraft(): BriefDraft {
  return {
    requesterName: "Elena Ruiz",
    requesterEmail: "elena@example.com",
    requestName: "Calabra dinner menu",
    properties: ["SMP"],
    requestType: "Web",
    taskType: "Menu Upload",
    requestedCompletionDate: "2026-12-01",
    consequenceOfDelay: "The site still shows the old menu.",
    approver: "DeeDee Brown",
    whereItGoesLive: "https://www.properhotel.com/santa-monica/dining",
    followUps: { Details: "Replace the dinner menu." },
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|md|json|yml|yaml|example)$/.test(path)) out.push(path);
  }
  return out;
}
