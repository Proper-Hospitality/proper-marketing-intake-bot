import { waitUntil } from "@vercel/functions";
import { getBoltApp } from "../src/bolt/app.js";
import { acceptSlackRequest } from "../src/http/handler.js";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const accepted = await acceptSlackRequest(rawBody, request.headers, getBoltApp());
  if (accepted.response) return accepted.response;
  const work = accepted.work?.() ?? Promise.resolve();
  waitUntil(work);
  return new Response("", { status: 200 });
}
