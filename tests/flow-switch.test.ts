import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/agent/prompt.js";
import { intakeTools } from "../src/agent/tools.js";
import { applyAnswers } from "../src/intake/flow.js";
import {
  MARKETING_ASANA_BOT_CHANNEL,
  assignIntakeFlow,
  flowForChannel,
} from "../src/intake/flow-switch.js";
import { emptyConversation } from "../src/store/types.js";

const TEST_CHANNEL = "C0CLGRR3Z28";
const EMAIL_CHANNEL = "C0EMAILINTAKE";

describe("per-channel intake flow", () => {
  it("keeps classic as the default, including marketing-asana-bot and email intake", () => {
    expect(flowForChannel(MARKETING_ASANA_BOT_CHANNEL, "")).toBe("classic");
    expect(flowForChannel(TEST_CHANNEL, "")).toBe("classic");
    expect(flowForChannel(EMAIL_CHANNEL, "")).toBe("classic");
    expect(flowForChannel(undefined, TEST_CHANNEL)).toBe("classic");
    expect(flowForChannel(MARKETING_ASANA_BOT_CHANNEL, TEST_CHANNEL)).toBe("classic");
    expect(flowForChannel(EMAIL_CHANNEL, TEST_CHANNEL)).toBe("classic");
    expect(flowForChannel(TEST_CHANNEL, `${TEST_CHANNEL}, C0OTHER`)).toBe("simplified");
  });

  it("runs simplified only in a listed channel and remembers that choice on the thread", () => {
    const fresh = emptyConversation(`${TEST_CHANNEL}:1`);
    fresh.channel = TEST_CHANNEL;
    assignIntakeFlow(fresh, TEST_CHANNEL);
    expect(fresh.intakeFlow).toBe("simplified");

    fresh.channel = MARKETING_ASANA_BOT_CHANNEL;
    assignIntakeFlow(fresh, "");
    expect(fresh.intakeFlow).toBe("simplified");

    const classic = emptyConversation(`${MARKETING_ASANA_BOT_CHANNEL}:1`);
    classic.channel = MARKETING_ASANA_BOT_CHANNEL;
    assignIntakeFlow(classic, TEST_CHANNEL);
    expect(classic.intakeFlow).toBe("classic");

    const email = emptyConversation(`${EMAIL_CHANNEL}:mail`);
    email.channel = EMAIL_CHANNEL;
    assignIntakeFlow(email, TEST_CHANNEL);
    expect(email.intakeFlow).toBe("classic");

    const started = emptyConversation(`${TEST_CHANNEL}:old`);
    started.channel = TEST_CHANNEL;
    started.messages.push({ role: "user", content: "already started" });
    assignIntakeFlow(started, TEST_CHANNEL);
    expect(started.intakeFlow).toBe("classic");
  });

  it("leaves a classic Bug Fix on the main-branch path and uses simplified only when the thread is marked", () => {
    const classic = emptyConversation("C:classic-bug");
    classic.intakeFlow = "classic";
    const classicOutcome = applyAnswers(classic, {
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@properhotel.com",
      requestName: "Booking widget",
      properties: ["SMP"],
      requestType: "Web",
      taskType: "Bug Fix",
    });
    expect(classicOutcome.kind).not.toBe("hard_question");
    expect(classicOutcome.kind).not.toBe("hard_handoff");
    expect(classic.draft.intakeFlow).toBeUndefined();

    const simplified = emptyConversation("C:simple-bug");
    simplified.intakeFlow = "simplified";
    const simplifiedOutcome = applyAnswers(simplified, {
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@properhotel.com",
      requestName: "Booking widget",
      properties: ["SMP"],
      requestType: "Web",
      taskType: "Bug Fix",
    });
    expect(simplifiedOutcome.kind).toBe("hard_question");
    expect(simplified.draft.intakeFlow).toBe("simplified");
  });

  it("keeps the classic prompt and tool schema identical to the main path", () => {
    const classic = emptyConversation("C:prompt");
    classic.intakeFlow = "classic";
    const prompt = buildSystemPrompt(classic, { name: "Elena Ruiz" });
    expect(prompt).not.toContain("Simplified routing");
    expect(prompt).toContain("Designing a pop up is Creative → Pop Up.");
    expect(JSON.stringify(intakeTools("classic"))).not.toContain("businessProblem");
    expect(JSON.stringify(intakeTools(undefined))).toBe(JSON.stringify(intakeTools("classic")));

    const simplified = emptyConversation("C:prompt-s");
    simplified.intakeFlow = "simplified";
    const simplifiedPrompt = buildSystemPrompt(simplified, { name: "Elena Ruiz" });
    expect(simplifiedPrompt.startsWith(prompt)).toBe(true);
    expect(simplifiedPrompt).toContain("Simplified routing");
    expect(JSON.stringify(intakeTools("simplified"))).toContain("businessProblem");
  });
});
