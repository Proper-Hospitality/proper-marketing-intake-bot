import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HEALTH_PATH, PROCESS_BEFORE_RESPONSE, SLACK_EVENTS_PATH, createBoltApp } from "../src/bolt/app.js";

describe("Render HTTP server", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_SIGNING_SECRET = "test-signing-secret";
    const { expressApp } = createBoltApp();
    server = createServer(expressApp);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("acks Slack before the slow work by leaving processBeforeResponse off", () => {
    expect(PROCESS_BEFORE_RESPONSE).toBe(false);
    expect(SLACK_EVENTS_PATH).toBe("/slack/events");
    expect(HEALTH_PATH).toBe("/health");
  });

  it("answers the Render health check", async () => {
    const response = await fetch(`${base}${HEALTH_PATH}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("rejects an unsigned post to the Slack endpoint", async () => {
    const response = await fetch(`${base}${SLACK_EVENTS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "event_callback" }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});