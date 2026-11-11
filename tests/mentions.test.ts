import { afterEach, describe, expect, it } from "vitest";
import { formatPropertyQuestion, formatQuestions } from "../src/intake/brief.js";
import { formatSplitProposal } from "../src/intake/email/present.js";
import { greet, mentionsEnabled } from "../src/slack/mentions.js";
import { emptyConversation } from "../src/store/types.js";

describe("slack mentions flag", () => {
  const previous = process.env.SLACK_MENTIONS_ENABLED;
  afterEach(() => {
    if (previous === undefined) delete process.env.SLACK_MENTIONS_ENABLED;
    else process.env.SLACK_MENTIONS_ENABLED = previous;
  });

  it("is off unless the env flag is turned on", () => {
    delete process.env.SLACK_MENTIONS_ENABLED;
    expect(mentionsEnabled()).toBe(false);
    expect(mentionsEnabled("")).toBe(false);
    expect(mentionsEnabled("false")).toBe(false);
    expect(mentionsEnabled("true")).toBe(true);
    expect(mentionsEnabled("yes")).toBe(true);
  });

  it("uses a first name in Slack and email replies while mentions are off", () => {
    delete process.env.SLACK_MENTIONS_ENABLED;
    const slack = formatQuestions({
      userId: "U1",
      who: "Elena Ruiz",
      items: [{ id: "requestName", label: "Request name" }],
      warnings: [],
      draft: {},
      offerHelp: true,
    });
    const property = formatPropertyQuestion("U1", "Elena Ruiz");
    const state = emptyConversation("C:1");
    state.emailIntake = {
      source: "slack-channel-email",
      messageTs: "1",
      subject: "FW: Lake Tahoe",
      originalRequester: "Jamie Mark <jamie.mark@properhotel.com>",
      originalName: "Jamie Mark",
      originalEmail: "jamie.mark@properhotel.com",
      requesterSlackId: "UJAMIE",
      forwarder: "Elena Ruiz <elena.ruiz@properhotel.com>",
      forwarded: true,
      bodyText: "Please update the form.",
      proposals: [{
        title: "Lake Tahoe membership interest form",
        detail: "Update the Lake Tahoe membership page interest form.",
        summary: "Update the Lake Tahoe membership page interest form.",
        requestType: "Web",
        taskType: "Page Edit",
      }],
      filed: [],
      files: [],
    };
    const email = formatSplitProposal(state);
    const help = "If you don't have it, say skip or not sure and DeeDee Brown (Proper & By Proper) may know.";
    for (const text of [slack, property, email, help, greet({ userId: "UDEEDEE", name: "DeeDee Brown" })]) {
      expect(text).not.toMatch(/<@U[A-Z0-9]+>/);
    }
    expect(slack).toContain("Hi Elena!");
    expect(property).toContain("Hi Elena!");
    expect(email).toContain("Hi Jamie!");
    expect(help).toContain("DeeDee Brown");
  });

  it("mentions the Slack member only when the flag is on", () => {
    process.env.SLACK_MENTIONS_ENABLED = "true";
    const text = formatQuestions({
      userId: "UJAMIE",
      who: "Jamie Mark",
      items: [{ id: "requestName", label: "Request name" }],
      warnings: [],
      draft: {},
    });
    expect(text).toContain("Hi <@UJAMIE>!");
  });
});
