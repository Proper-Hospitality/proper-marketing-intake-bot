import { getBrandTemplateDataset } from "../src/canva/api.js";
import { classifyDataset, formatDatasetReport, liveTemplates } from "../src/canva/dataset-report.js";
import { canvaEnvConfigured, getCanvaAccessToken } from "../src/canva/oauth.js";
import { createRedisStore } from "../src/store/redis.js";

const USAGE = `Lists autofill fields on every live Canva template.

Requires the Render Key Value connection and the Canva app credentials.
The access token is the one stored after opening /canva/connect. This script does not create that token.

  REDIS_URL=... CANVA_CLIENT_ID=... CANVA_CLIENT_SECRET=... npx tsx scripts/list-template-datasets.ts
`;

async function main(): Promise<void> {
  if (!canvaEnvConfigured() || !process.env.REDIS_URL) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const store = createRedisStore();
  const token = await getCanvaAccessToken({ store });
  if (!token) {
    console.error("Canva is not connected. Open /canva/connect on the Render service, then run this again.");
    process.exitCode = 1;
    return;
  }
  const templates = liveTemplates();
  const rows = [];
  for (const template of templates) {
    try {
      const dataset = await getBrandTemplateDataset({ token, templateId: template.id });
      rows.push(classifyDataset(template, dataset));
    } catch (error) {
      rows.push(classifyDataset(template, undefined, error instanceof Error ? error.message : "unknown"));
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  console.log(formatDatasetReport(rows));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
