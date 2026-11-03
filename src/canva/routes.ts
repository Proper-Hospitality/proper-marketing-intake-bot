import type { Application, Request, Response } from "express";
import { beginCanvaConnect, canvaEnvConfigured, finishCanvaConnect } from "./oauth.js";
import type { Store } from "../store/types.js";

export function registerCanvaRoutes(app: Application, store: Store, fetchImpl?: typeof fetch): void {
  app.get("/canva/connect", async (_req: Request, res: Response) => {
    if (!canvaEnvConfigured()) {
      res.status(503).type("text/plain").send("Canva is not configured. Set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET, then open this page again.");
      return;
    }
    try {
      const url = await beginCanvaConnect(store);
      res.redirect(url);
    } catch (error) {
      res.status(500).type("text/plain").send(error instanceof Error ? error.message : "Could not start Canva connect.");
    }
  });

  app.get("/canva/callback", async (req: Request, res: Response) => {
    const error = firstQuery(req.query.error);
    if (error) {
      res.status(400).type("text/plain").send(`Canva did not connect: ${error}. Open /canva/connect and try again.`);
      return;
    }
    try {
      await finishCanvaConnect({
        store,
        code: firstQuery(req.query.code),
        state: firstQuery(req.query.state),
        fetchImpl,
      });
      res.status(200).type("text/plain").send("Canva is connected. You can close this page. The bot can now build designs from brand templates.");
    } catch (callbackError) {
      res.status(400).type("text/plain").send(callbackError instanceof Error ? callbackError.message : "Could not finish Canva connect.");
    }
  });
}

function firstQuery(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}
