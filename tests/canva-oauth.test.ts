import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { registerCanvaRoutes } from "../src/canva/routes.js";
import {
  CANVA_SCOPES,
  beginCanvaConnect,
  finishCanvaConnect,
  getCanvaAccessToken,
  redirectUri,
} from "../src/canva/oauth.js";
import { MemoryStore } from "../src/store/memory.js";

const ORIGINAL_ID = process.env.CANVA_CLIENT_ID;
const ORIGINAL_SECRET = process.env.CANVA_CLIENT_SECRET;

afterEach(() => {
  if (ORIGINAL_ID === undefined) delete process.env.CANVA_CLIENT_ID;
  else process.env.CANVA_CLIENT_ID = ORIGINAL_ID;
  if (ORIGINAL_SECRET === undefined) delete process.env.CANVA_CLIENT_SECRET;
  else process.env.CANVA_CLIENT_SECRET = ORIGINAL_SECRET;
});

describe("Canva OAuth", () => {
  it("starts PKCE, stores the verifier, and refreshes an expired access token", async () => {
    process.env.CANVA_CLIENT_ID = "client-id";
    process.env.CANVA_CLIENT_SECRET = "client-secret";
    const store = new MemoryStore();
    const url = new URL(await beginCanvaConnect(store, "https://proper-marketing-intake.onrender.com"));
    expect(url.origin + url.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri("https://proper-marketing-intake.onrender.com"));
    expect(url.searchParams.get("scope")).toBe(CANVA_SCOPES);
    const state = url.searchParams.get("state") ?? "";
    const verifier = await store.getValue(`canva:oauth:${state}`);
    expect(verifier).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier ?? "").digest("base64url"));

    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("grant_type=authorization_code")) {
        expect(String(init?.headers && (init.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
        expect(body).toContain("code_verifier=");
        expect(body).toContain("code=auth-code");
        return json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 14400, scope: CANVA_SCOPES });
      }
      expect(body).toContain("grant_type=refresh_token");
      expect(body).toContain("refresh_token=refresh-1");
      return json({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 14400, scope: CANVA_SCOPES });
    });

    await finishCanvaConnect({
      store,
      code: "auth-code",
      state,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: 1_000,
    });
    expect(await getCanvaAccessToken({
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: 1_000,
    })).toBe("access-1");
    expect(await getCanvaAccessToken({
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: 20_000_000,
    })).toBe("access-2");
    const saved = JSON.parse((await store.getValue("canva:tokens")) ?? "{}") as { refreshToken: string };
    expect(saved.refreshToken).toBe("refresh-2");
  });

  it("serves connect and callback without calling Canva until Elena approves", async () => {
    delete process.env.CANVA_CLIENT_ID;
    delete process.env.CANVA_CLIENT_SECRET;
    const store = new MemoryStore();
    const app = express();
    const fetchImpl = vi.fn(async () => json({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 14400,
      scope: CANVA_SCOPES,
    }));
    registerCanvaRoutes(app, store, fetchImpl as unknown as typeof fetch);
    const server = await listen(app);
    try {
      const blocked = await fetch(`${server.base}/canva/connect`);
      expect(blocked.status).toBe(503);
      expect(await blocked.text()).toMatch(/CANVA_CLIENT_ID/);

      process.env.CANVA_CLIENT_ID = "client-id";
      process.env.CANVA_CLIENT_SECRET = "client-secret";
      const started = await fetch(`${server.base}/canva/connect`, { redirect: "manual" });
      expect(started.status).toBe(302);
      const location = started.headers.get("location") ?? "";
      expect(location).toContain("https://www.canva.com/api/oauth/authorize");
      const state = new URL(location).searchParams.get("state") ?? "";
      const done = await fetch(`${server.base}/canva/callback?code=auth-code&state=${state}`);
      expect(done.status).toBe(200);
      expect(await done.text()).toMatch(/Canva is connected/);
      expect(await store.getValue("canva:tokens")).toContain("access-1");
    } finally {
      await server.close();
    }
  });

  it("documents Elena's setup steps and the files:read scope", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
      oauth_config: { scopes: { bot: string[] } };
    };
    expect(readme).toContain("https://www.canva.com/developers");
    expect(readme).toContain("https://proper-marketing-intake.onrender.com/canva/callback");
    expect(readme).toContain("https://proper-marketing-intake.onrender.com/canva/connect");
    expect(readme).toContain("CANVA_CLIENT_ID");
    expect(readme).toContain("CANVA_CLIENT_SECRET");
    for (const scope of CANVA_SCOPES.split(" ")) expect(readme).toContain(scope);
    expect(readme).toContain("files:read");
    expect(manifest.oauth_config.scopes.bot).toContain("files:read");
    const blueprint = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
    expect(blueprint).toContain("CANVA_CLIENT_ID");
    expect(blueprint).toContain("CANVA_CLIENT_SECRET");
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      });
    });
  });
}
