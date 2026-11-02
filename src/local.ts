import { createServer } from "node:http";
import { getBoltApp } from "./bolt/app.js";
import { acceptSlackRequest } from "./http/handler.js";

const port = Number(process.env.PORT || 3000);

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(","));
  }
  try {
    const accepted = await acceptSlackRequest(rawBody, headers, getBoltApp());
    if (accepted.response) {
      res.writeHead(accepted.response.status, { "content-type": accepted.response.headers.get("content-type") ?? "text/plain" });
      res.end(Buffer.from(await accepted.response.arrayBuffer()));
      return;
    }
    res.writeHead(200);
    res.end("");
    await accepted.work?.();
  } catch (error) {
    console.error(JSON.stringify({ msg: "local_request_failed", error: error instanceof Error ? error.message : "unknown" }));
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Server error");
    }
  }
});

server.listen(port, () => {
  console.log(`Marketing intake bot listening on http://localhost:${port}/api/slack`);
});
