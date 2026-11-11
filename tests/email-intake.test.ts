import { describe, expect, it, vi } from "vitest";
import { applyAnswers } from "../src/intake/flow.js";
import { beginEmailIntake, handleEmailSplitAction } from "../src/intake/email/turn.js";
import { proposeEmailBriefs } from "../src/intake/email/parse.js";
import { readSlackEmailFile } from "../src/slack/files.js";
import { handleConfirmAction, handleIncomingMessage } from "../src/slack/handle.js";
import { dispatchUserMessage } from "../src/slack/dispatch.js";
import { normalizeSlackMessage } from "../src/slack/incoming.js";
import type { SlackApi } from "../src/slack/api.js";
import type { Llm } from "../src/agent/run.js";
import { MemoryStore } from "../src/store/memory.js";
import { emptyConversation } from "../src/store/types.js";
import { TAHOE_BODY, TAHOE_CHANNEL, TAHOE_SUBJECT, TAHOE_TS, tahoeSlackEvent } from "./fixtures/tahoe-email.js";

const TODAY = new Date("2026-11-11T20:00:00Z");

describe("forwarded email intake", () => {
  it("proposes four briefs for the Lake Tahoe membership email", () => {
    const proposals = proposeEmailBriefs({ subject: TAHOE_SUBJECT, bodyText: TAHOE_BODY });
    expect(proposals.map((proposal) => `${proposal.requestType} → ${proposal.taskType}`)).toEqual([
      "Web → Page Edit",
      "CRM & Paid → Newsletter Send",
      "CRM & Paid → New User Journey (Subscriber Flows)",
      "Marketing → Marketing Plan",
    ]);
    expect(proposals[0]?.detail).toContain("Incline Village");
    expect(proposals[0]?.detail).toContain("South Shore");
    expect(proposals[1]?.detail).toContain("500+");
    expect(proposals[2]?.detail).toContain("info@");
    expect(proposals[3]?.detail).toContain("how often");
  });

  it("drops Email-app messages in normalize, then drafts them only in an email channel", async () => {
    const event = tahoeSlackEvent();
    expect(normalizeSlackMessage(event)).toBeNull();
    await withEmailChannel(async () => {
      const store = new MemoryStore();
      const { slack, posts } = recordingSlack();
      const result = await dispatchUserMessage({
        event,
        store,
        onMessage: async () => {
          throw new Error("an email must not enter the human intake path");
        },
        postError: async () => {
          throw new Error("should not fail");
        },
        onEmail: (email) => beginEmailIntake({ store, slack, today: TODAY }, email),
        botId: "BINTAKE",
        botUserId: "UINTAKE",
        loadEmailFile: async () => {
          throw new Error("plain_text is already on the event");
        },
      });
      expect(result).toBe("email");
      expect(posts).toHaveLength(1);
      expect(posts[0]?.threadTs).toBe(TAHOE_TS);
      const text = posts[0]?.text ?? "";
      expect(text).toContain("4 separate");
      expect(text).toContain("Jamie Mark");
      expect(text).toContain("SVP Memberships, Partnerships & PR");
      expect(text).toContain("rowan.smith@properhospitality.com");
      expect(text).toContain(TAHOE_SUBJECT);
      expect(text).toContain("Web → Page Edit");
      expect(text).toContain("Newsletter Send");
      expect(text).toContain("New User Journey");
      expect(text).toContain("Marketing → Marketing Plan");
      expect(text).toContain("Incline Village");
      expect(text).toContain("500+");
      expect(text).toContain("info@");
      expect(text).toContain("how often");
      expect(text).toContain("Nothing is filed");
      expect(JSON.stringify(posts[0]?.blocks)).toContain("email_split");
      expect(JSON.stringify(posts[0]?.blocks)).not.toContain("confirm_intake");
      const saved = await store.getConversation(`${TAHOE_CHANNEL}:${TAHOE_TS}`);
      expect(saved?.phase).toBe("awaiting_email_split");
      expect(saved?.emailIntake?.proposals).toHaveLength(4);
      expect(saved?.draft.requesterName).toBe("Jamie Mark");
      expect(saved?.draft.requesterEmail).toBe("jamie.mark@properhospitality.com");
      expect(saved?.draft.attachments?.map((file) => file.slackFileId)).toEqual(["FEMAIL", "FLIST"]);
      expect(saved?.draft.attachments?.every((file) => file.kind === "context")).toBe(true);

      const again = await dispatchUserMessage({
        event,
        store,
        onMessage: async () => {
          throw new Error("retry");
        },
        postError: async () => {
          throw new Error("retry should be ignored");
        },
        onEmail: (email) => beginEmailIntake({ store, slack, today: TODAY }, email),
        botId: "BINTAKE",
        botUserId: "UINTAKE",
      });
      expect(again).toBe("email");
      expect(posts).toHaveLength(1);
    });
  });

  it("starts the first brief after the forwarder agrees to split, and keeps Jamie as the requester", async () => {
    await withEmailChannel(async () => {
      const store = new MemoryStore();
      const { slack, posts } = recordingSlack();
      await dispatchUserMessage({
        event: tahoeSlackEvent(),
        store,
        onMessage: async () => undefined,
        postError: async () => undefined,
        onEmail: (email) => beginEmailIntake({ store, slack, today: TODAY }, email),
        botId: "BINTAKE",
      });
      const llm: Llm = {
        async complete() {
          throw new Error("agreeing to split must not call Claude");
        },
      };
      await handleIncomingMessage({ store, slack, llm, today: TODAY }, {
        channel: TAHOE_CHANNEL,
        userId: "UROWAN",
        text: "yes",
        ts: "1762880001.000200",
        threadTs: TAHOE_TS,
        isDm: false,
      });
      const brief = posts[1]?.text ?? "";
      expect(brief).toContain("Brief 1 of 4");
      expect(brief).toContain("Web → Page Edit");
      expect(brief).toContain("Jamie Mark");
      expect(brief).toContain("Rowan Smith");
      expect(brief).toContain("*Property*");
      expect(brief).not.toMatch(/what kind of file/i);
      expect(JSON.stringify(posts[1]?.blocks)).not.toContain("confirm_intake");
      const state = await store.getConversation(`${TAHOE_CHANNEL}:${TAHOE_TS}`);
      expect(state?.phase).toBe("collecting");
      expect(state?.emailIntake?.mode).toBe("split");
      expect(state?.draft.requestType).toBe("Web");
      expect(state?.draft.taskType).toBe("Page Edit");
      expect(state?.draft.requesterName).toBe("Jamie Mark");

      const answering: Llm = {
        async complete() {
          return {
            content: [{
              type: "tool_use",
              id: "toolu_email",
              name: "record_answers",
              input: {
                requesterName: "Rowan Smith",
                requesterEmail: "rowan.smith@properhospitality.com",
                requestType: "Creative",
                taskType: "Email",
                properties: ["Corporate"],
              },
            }],
          };
        },
      };
      await handleIncomingMessage({ store, slack, llm: answering, today: TODAY }, {
        channel: TAHOE_CHANNEL,
        userId: "UROWAN",
        text: "Corporate",
        ts: "1762880002.000200",
        threadTs: TAHOE_TS,
        isDm: false,
      });
      const after = await store.getConversation(`${TAHOE_CHANNEL}:${TAHOE_TS}`);
      expect(after?.draft.requesterName).toBe("Jamie Mark");
      expect(after?.draft.requesterEmail).toBe("jamie.mark@properhospitality.com");
      expect(after?.draft.requestType).toBe("Web");
      expect(after?.draft.taskType).toBe("Page Edit");
      expect(after?.draft.properties).toEqual(["Corporate"]);
    });
  });

  it("keeps one Marketing Plan brief when the forwarder declines the split", async () => {
    await withEmailChannel(async () => {
      const store = new MemoryStore();
      const { slack, posts, updates } = recordingSlack();
      await beginEmailIntake({ store, slack, today: TODAY }, {
        source: "mailbox",
        channel: TAHOE_CHANNEL,
        messageTs: TAHOE_TS,
        forwarder: { name: "Rowan Smith", email: "rowan.smith@properhospitality.com" },
        originalSender: {
          name: "Jamie Mark",
          email: "jamie.mark@properhospitality.com",
          title: "SVP Memberships, Partnerships & PR",
        },
        forwarded: true,
        subject: TAHOE_SUBJECT,
        bodyText: TAHOE_BODY,
        files: [],
      });
      expect(posts[0]?.text).toContain("4 separate");
      await handleEmailSplitAction({ store, slack, today: TODAY }, {
        choice: "one",
        channel: TAHOE_CHANNEL,
        messageTs: "posted",
        threadTs: TAHOE_TS,
      });
      expect(updates[0]).toContain("Keeping this as one");
      const text = posts[1]?.text ?? "";
      expect(text).toContain("Marketing → Marketing Plan");
      expect(text).toContain("500+");
      expect(text).toContain("info@");
      expect(text).not.toContain("Brief 1 of 4");
      const state = await store.getConversation(`${TAHOE_CHANNEL}:${TAHOE_TS}`);
      expect(state?.emailIntake?.mode).toBe("single");
      expect(state?.emailIntake?.proposals).toHaveLength(1);
      expect(state?.draft.followUps?.["Detailed Request"]).toContain("Incline Village");
    });
  });

  it("ignores auto-replies, empty mail, the bot's own posts, and human chatter", async () => {
    await withEmailChannel(async () => {
      const store = new MemoryStore();
      const seen: string[] = [];
      const base = {
        store,
        onMessage: async (message: { text: string }) => {
          seen.push(message.text);
        },
        postError: async () => undefined,
        onEmail: async () => {
          throw new Error("noise must not start intake");
        },
        botId: "BINTAKE",
        botUserId: "UINTAKE",
      };
      const ooo = await dispatchUserMessage({
        ...base,
        event: tahoeSlackEvent({
          ts: "2.2",
          files: [{
            id: "FOOO",
            filetype: "email",
            mode: "email",
            subject: "Automatic reply: Out of Office",
            plain_text: "I am currently out of the office until Monday.",
            from: [{ original: "Jamie Mark <jamie.mark@properhospitality.com>" }],
          }],
        }),
      });
      const empty = await dispatchUserMessage({
        ...base,
        event: tahoeSlackEvent({
          ts: "2.3",
          files: [{
            id: "FEMPTY",
            filetype: "email",
            mode: "email",
            subject: "FYI",
            plain_text: "Thanks!",
            from: [{ original: "Rowan Smith <rowan.smith@properhospitality.com>" }],
          }],
        }),
      });
      const loop = await dispatchUserMessage({
        ...base,
        event: tahoeSlackEvent({ bot_id: "BINTAKE", user: "UINTAKE", ts: "2.4" }),
      });
      const chatter = await dispatchUserMessage({
        ...base,
        event: {
          type: "message",
          channel: TAHOE_CHANNEL,
          channel_type: "channel",
          user: "U1",
          text: "Can you design a holiday menu?",
          ts: "2.5",
        },
      });
      const otherBot = await dispatchUserMessage({
        ...base,
        event: {
          type: "message",
          channel: TAHOE_CHANNEL,
          bot_id: "BOTHER",
          user: "UOTHER",
          text: "I filed this already",
          ts: "2.6",
        },
      });
      expect(ooo).toBe("ignored");
      expect(empty).toBe("ignored");
      expect(loop).toBe("ignored");
      expect(chatter).toBe("ignored");
      expect(otherBot).toBe("ignored");
      expect(seen).toEqual([]);
    });
  });

  it("still accepts a human thread reply, and a human post when the channel is also an intake channel", async () => {
    const previousIntake = process.env.SLACK_INTAKE_CHANNELS;
    process.env.SLACK_INTAKE_CHANNELS = TAHOE_CHANNEL;
    try {
      await withEmailChannel(async () => {
        const store = new MemoryStore();
        const seen: string[] = [];
        const reply = await dispatchUserMessage({
          event: {
            type: "message",
            channel: TAHOE_CHANNEL,
            channel_type: "channel",
            user: "U1",
            text: "Corporate",
            ts: "4.4",
            thread_ts: "parent",
          },
          store,
          onMessage: async (message) => {
            seen.push(message.text);
          },
          postError: async () => undefined,
          onEmail: async () => {
            throw new Error("a thread reply is not a new email");
          },
        });
        expect(reply).toBe("ignored");
        const existing = emptyConversation(`${TAHOE_CHANNEL}:parent`);
        await store.saveConversation(existing);
        const inThread = await dispatchUserMessage({
          event: {
            type: "message",
            channel: TAHOE_CHANNEL,
            channel_type: "channel",
            user: "U1",
            text: "Corporate",
            ts: "4.5",
            thread_ts: "parent",
          },
          store,
          onMessage: async (message) => {
            seen.push(message.text);
          },
          postError: async () => undefined,
          onEmail: async () => {
            throw new Error("a thread reply is not a new email");
          },
        });
        expect(inThread).toBe("handled");
        const top = await dispatchUserMessage({
          event: {
            type: "message",
            channel: TAHOE_CHANNEL,
            channel_type: "channel",
            user: "U1",
            text: "Need a holiday email for SMP",
            ts: "4.6",
          },
          store,
          onMessage: async (message) => {
            seen.push(message.text);
          },
          postError: async () => undefined,
          onEmail: async () => {
            throw new Error("a person posting is not an email");
          },
        });
        expect(top).toBe("handled");
        expect(seen).toEqual(["Corporate", "Need a holiday email for SMP"]);
      });
    } finally {
      if (previousIntake === undefined) delete process.env.SLACK_INTAKE_CHANNELS;
      else process.env.SLACK_INTAKE_CHANNELS = previousIntake;
    }
  });

  it("reads the email body from files.info when the event omits it", async () => {
    await withEmailChannel(async () => {
      const store = new MemoryStore();
      const { slack, posts } = recordingSlack();
      let loads = 0;
      await dispatchUserMessage({
        event: tahoeSlackEvent({
          files: [{ id: "FEMAIL", name: "email.eml", filetype: "email", mode: "email" }],
        }),
        store,
        onMessage: async () => undefined,
        postError: async () => undefined,
        onEmail: (email) => beginEmailIntake({ store, slack, today: TODAY }, email),
        loadEmailFile: async (fileId) => {
          loads += 1;
          expect(fileId).toBe("FEMAIL");
          return {
            subject: TAHOE_SUBJECT,
            plainText: TAHOE_BODY,
            from: [{ original: "Rowan Smith <rowan.smith@properhospitality.com>" }],
          };
        },
      });
      expect(loads).toBe(1);
      expect(posts[0]?.text).toContain("Jamie Mark");
      expect(posts[0]?.text).toContain("4 separate");
    });
  });

  it("uploads the email and its attachment once per task, and blocks a next-day date", async () => {
    await withEmailChannel(async () => {
      const store = new MemoryStore();
      const { slack } = recordingSlack();
      await beginEmailIntake({ store, slack, today: TODAY }, await inboundFromEvent());
      await handleIncomingMessage({
        store,
        slack,
        llm: { async complete() { throw new Error("no"); } },
        today: TODAY,
      }, {
        channel: TAHOE_CHANNEL,
        userId: "UROWAN",
        text: "yes split them",
        ts: "1762880001.000200",
        threadTs: TAHOE_TS,
        isDm: false,
      });
      const state = await store.getConversation(`${TAHOE_CHANNEL}:${TAHOE_TS}`);
      if (!state) throw new Error("missing conversation");
      const rushed = applyAnswers(state, { requestedCompletionDate: "2026-11-12" }, TODAY);
      expect(rushed.kind).toBe("rush_required");
      const ready = applyAnswers(state, {
        properties: ["Corporate"],
        requestedCompletionDate: "2026-12-01",
        consequenceOfDelay: "The membership launch list stays incomplete.",
        approver: "Jamie Mark",
        followUps: { URL: "https://www.properhotel.com/lake-tahoe/membership" },
      }, TODAY);
      expect(ready.kind).toBe("confirm");
      await store.saveConversation(state);
      const firstVersion = state.confirmVersion;

      const names: string[] = [];
      const notes: string[] = [];
      let tasks = 0;
      const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        const method = init?.method ?? "GET";
        if (href.includes("files.info")) {
          const id = new URL(href).searchParams.get("file");
          const email = id === "FEMAIL";
          return json({
            ok: true,
            file: {
              name: email ? "email.eml" : "interest-list.xlsx",
              mimetype: email ? "message/rfc822" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              permalink: `https://files.slack.com/${id}`,
              url_private_download: `https://files.slack.com/${id}`,
            },
          });
        }
        if (href.includes("files.slack.com")) return new Response(Uint8Array.from([1, 2, 3, 4]));
        if (method === "GET" && href.includes("/attachments")) return json({ data: [] });
        if (method === "POST" && href.includes("/attachments")) {
          const file = init?.body instanceof FormData ? init.body.get("file") : undefined;
          names.push(file instanceof File ? file.name : "upload");
          return json({ data: { gid: `ATT${names.length}` } });
        }
        if (method === "POST" && href.endsWith("/tasks")) {
          tasks += 1;
          notes.push(typeof init?.body === "string" ? init.body : "");
          return json({ data: { gid: `T${tasks}` } });
        }
        if (method === "PUT") return json({ data: { gid: `T${tasks}` } });
        return json({
          data: {
            gid: `T${tasks}`,
            permalink_url: `https://app.asana.com/0/1/T${tasks}`,
            memberships: [{
              project: { gid: "1217171684008018", name: "New Intake Board" },
              section: { name: "New requests - Submitted via Form" },
            }],
            custom_fields: [
              { name: "Request Type_New Intake Board", display_value: "Web" },
              { name: "Web Task Type", display_value: "Page Edit" },
              { name: "Property List_New Intake Board", display_value: "Corporate" },
              { name: "Status in Que", display_value: "New Request" },
              { name: "Estimated time", display_value: "2h" },
            ],
          },
        });
      });

      await handleConfirmAction({
        store,
        slack,
        asanaToken: "asana-token",
        slackToken: "xoxb-test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }, {
        version: firstVersion,
        channel: TAHOE_CHANNEL,
        messageTs: "confirm-1",
        threadTs: TAHOE_TS,
      });
      expect(names).toEqual(["email.eml", "interest-list.xlsx"]);
      expect(names).not.toContain("forwarded-email.txt");
      expect(notes[0]).toContain("Jamie Mark");
      expect(notes[0]).toContain("Rowan Smith");
      expect(notes[0]).toContain(TAHOE_SUBJECT);
      const filed = await store.getConversation(`${TAHOE_CHANNEL}:${TAHOE_TS}`);
      expect(filed?.phase).toBe("collecting");
      expect(filed?.emailIntake?.activeIndex).toBe(1);
      expect(filed?.uploadedSlackFileIds).toEqual([]);
      expect(filed?.draft.requestType).toBe("CRM & Paid");
      expect(filed?.draft.attachments?.map((file) => file.slackFileId)).toEqual(["FEMAIL", "FLIST"]);

      await handleConfirmAction({
        store,
        slack,
        asanaToken: "asana-token",
        slackToken: "xoxb-test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }, {
        version: firstVersion,
        channel: TAHOE_CHANNEL,
        messageTs: "confirm-1",
        threadTs: TAHOE_TS,
      });
      expect(names).toEqual(["email.eml", "interest-list.xlsx"]);

      if (!filed) throw new Error("missing filed state");
      const second = applyAnswers(filed, {
        properties: ["Corporate"],
        requestedCompletionDate: "2026-12-01",
        consequenceOfDelay: "The questionnaire misses the launch.",
        approver: "Jamie Mark",
        followUps: { "CTA Links": "Same questions as the membership page form" },
      }, TODAY);
      expect(second.kind).toBe("confirm");
      await store.saveConversation(filed);
      await handleConfirmAction({
        store,
        slack,
        asanaToken: "asana-token",
        slackToken: "xoxb-test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }, {
        version: filed.confirmVersion,
        channel: TAHOE_CHANNEL,
        messageTs: "confirm-2",
        threadTs: TAHOE_TS,
      });
      expect(names).toEqual(["email.eml", "interest-list.xlsx", "email.eml", "interest-list.xlsx"]);
      const done = await store.getConversation(`${TAHOE_CHANNEL}:${TAHOE_TS}`);
      expect(done?.emailIntake?.filed.map((item) => item.gid)).toEqual(["T1", "T2"]);
      expect(done?.emailIntake?.activeIndex).toBe(2);
      expect(done?.phase).toBe("collecting");
      expect(done?.uploadedSlackFileIds).toEqual([]);
      expect(done?.draft.attachments?.map((file) => file.slackFileId)).toEqual(["FEMAIL", "FLIST"]);
    });
  });
});

describe("Slack email file metadata", () => {
  it("maps subject, from, and plain_text from files.info", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("files.info")) {
        return json({
          ok: true,
          file: {
            name: "note.eml",
            mimetype: "message/rfc822",
            subject: "Hello",
            plain_text: "Please design the banner.",
            from: [{ name: "Jamie Mark", address: "jamie.mark@properhospitality.com" }],
            headers: { "auto-submitted": "no" },
            attachments: [{ id: "FIMG", name: "banner.png" }],
          },
        });
      }
      throw new Error(`unexpected ${href}`);
    });
    const details = await readSlackEmailFile({
      token: "xoxb-test",
      fileId: "FEMAIL",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(details?.subject).toBe("Hello");
    expect(details?.plainText).toContain("Please design the banner.");
    expect(details?.from?.[0]?.address).toBe("jamie.mark@properhospitality.com");
    expect(details?.attachments?.[0]?.id).toBe("FIMG");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("downloads HTML when files.info has no plain_text", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("files.info")) {
        return json({
          ok: true,
          file: {
            name: "note.eml",
            mimetype: "text/html",
            url_private_download: "https://files.slack.com/note.eml",
          },
        });
      }
      return new Response("<p>Please add the form.</p>");
    });
    const details = await readSlackEmailFile({
      token: "xoxb-test",
      fileId: "FEMAIL",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(details?.plainText).toContain("Please add the form.");
    expect(details?.plainText).not.toContain("<p>");
  });
});

async function inboundFromEvent() {
  const { resolveInboundEmail } = await import("../src/intake/email/slack-event.js");
  const resolved = await resolveInboundEmail(tahoeSlackEvent(), {});
  if (resolved.status !== "email") throw new Error(resolved.status);
  return resolved.email;
}

function recordingSlack(): { slack: SlackApi; posts: Array<{ text: string; threadTs?: string; blocks?: unknown }>; updates: string[] } {
  const posts: Array<{ text: string; threadTs?: string; blocks?: unknown }> = [];
  const updates: string[] = [];
  const slack: SlackApi = {
    async postMessage(args) {
      posts.push(args);
      return { ts: "posted" };
    },
    async updateMessage(args) {
      updates.push(args.text);
    },
    async userProfile() {
      return { name: "Rowan Smith", email: "rowan.smith@properhospitality.com" };
    },
    async threadReplies() {
      return [];
    },
  };
  return { slack, posts, updates };
}

async function withEmailChannel(run: () => Promise<void>): Promise<void> {
  const previous = process.env.SLACK_EMAIL_INTAKE_CHANNELS;
  process.env.SLACK_EMAIL_INTAKE_CHANNELS = TAHOE_CHANNEL;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.SLACK_EMAIL_INTAKE_CHANNELS;
    else process.env.SLACK_EMAIL_INTAKE_CHANNELS = previous;
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
