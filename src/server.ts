import { start } from "./bolt/app.js";

start().catch((error: unknown) => {
  console.error(JSON.stringify({ msg: "server_failed", error: error instanceof Error ? error.message : "unknown" }));
  process.exit(1);
});
