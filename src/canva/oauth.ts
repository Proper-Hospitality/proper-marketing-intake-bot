import { createHash, randomBytes } from "node:crypto";
import type { Store } from "../store/types.js";

export const CANVA_SCOPES = [
  "brandtemplate:meta:read",
  "brandtemplate:content:read",
  "design:content:write",
  "design:meta:read",
  "asset:write",
  "asset:read",
].join(" ");

export const CANVA_AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
export const CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
export const CANVA_CONNECT_PATH = "/canva/connect";
export const CANVA_CALLBACK_PATH = "/canva/callback";
export const CANVA_PUBLIC_BASE = "https://proper-marketing-intake.onrender.com";

const TOKEN_KEY = "canva:tokens";
const STATE_PREFIX = "canva:oauth:";
const STATE_TTL_SECONDS = 600;
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 180;

export interface CanvaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export function canvaEnvConfigured(
  env: { clientId?: string; clientSecret?: string } = {
    clientId: process.env.CANVA_CLIENT_ID,
    clientSecret: process.env.CANVA_CLIENT_SECRET,
  },
): boolean {
  return Boolean(env.clientId && env.clientSecret);
}

export function publicBaseUrl(envBase = process.env.PUBLIC_BASE_URL): string {
  return (envBase || CANVA_PUBLIC_BASE).replace(/\/$/, "");
}

export function redirectUri(envBase = process.env.PUBLIC_BASE_URL): string {
  return `${publicBaseUrl(envBase)}${CANVA_CALLBACK_PATH}`;
}

export async function beginCanvaConnect(store: Store, envBase = process.env.PUBLIC_BASE_URL): Promise<string> {
  const clientId = process.env.CANVA_CLIENT_ID;
  if (!clientId || !process.env.CANVA_CLIENT_SECRET) {
    throw new Error("CANVA_CLIENT_ID and CANVA_CLIENT_SECRET must be set before connecting Canva.");
  }
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(32).toString("base64url");
  await store.setValue(`${STATE_PREFIX}${state}`, verifier, STATE_TTL_SECONDS);
  const url = new URL(CANVA_AUTHORIZE_URL);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", CANVA_SCOPES);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri(envBase));
  return url.toString();
}

export async function finishCanvaConnect(args: {
  store: Store;
  code: string;
  state: string;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<CanvaTokens> {
  const verifier = await args.store.getValue(`${STATE_PREFIX}${args.state}`);
  if (!verifier) throw new Error("This Canva connect link expired or did not match. Open /canva/connect again.");
  if (!args.code) throw new Error("Canva did not return an authorization code.");
  const tokens = await requestToken({
    body: {
      grant_type: "authorization_code",
      code: args.code,
      code_verifier: verifier,
      redirect_uri: redirectUri(),
    },
    fetchImpl: args.fetchImpl,
    now: args.now,
  });
  await args.store.setValue(TOKEN_KEY, JSON.stringify(tokens), TOKEN_TTL_SECONDS);
  return tokens;
}

export async function getCanvaAccessToken(args: {
  store: Store;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<string | null> {
  if (!canvaEnvConfigured()) return null;
  const raw = await args.store.getValue(TOKEN_KEY);
  if (!raw) return null;
  const saved = JSON.parse(raw) as CanvaTokens;
  const now = args.now ?? Date.now();
  if (saved.expiresAt > now + 60_000) return saved.accessToken;
  const tokens = await requestToken({
    body: { grant_type: "refresh_token", refresh_token: saved.refreshToken },
    fetchImpl: args.fetchImpl,
    now,
  });
  await args.store.setValue(TOKEN_KEY, JSON.stringify(tokens), TOKEN_TTL_SECONDS);
  return tokens.accessToken;
}

async function requestToken(args: {
  body: Record<string, string>;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<CanvaTokens> {
  const clientId = process.env.CANVA_CLIENT_ID ?? "";
  const clientSecret = process.env.CANVA_CLIENT_SECRET ?? "";
  const fetchImpl = args.fetchImpl ?? fetch;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetchImpl(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(args.body),
  });
  const payload = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    message?: string;
    error?: string;
  };
  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(payload.message || payload.error || "Canva did not return a token.");
  }
  const now = args.now ?? Date.now();
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: now + (payload.expires_in ?? 14400) * 1000,
    scope: payload.scope ?? CANVA_SCOPES,
  };
}
