export const CANVA_API = "https://api.canva.com/rest/v1";

export class CanvaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CanvaApiError";
  }
}

export interface DatasetField {
  type: string;
}

export interface CanvaJob {
  id: string;
  status: "in_progress" | "success" | "failed";
  error?: { code?: string; message?: string };
  asset?: { id?: string; name?: string };
  result?: {
    design?: {
      id?: string;
      url?: string;
      urls?: { edit_url?: string; view_url?: string };
    };
  };
}

export function autofillUnavailable(error: unknown): boolean {
  if (!(error instanceof CanvaApiError)) return false;
  if (error.status === 400 && error.code === "design_not_fillable") return true;
  if (error.status === 403 && /autofill|plan|upgrad|enterprise/i.test(`${error.code} ${error.message}`)) return true;
  return false;
}

export async function getBrandTemplateDataset(args: {
  token: string;
  templateId: string;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, DatasetField>> {
  const payload = await canvaJson({
    token: args.token,
    url: `${CANVA_API}/brand-templates/${encodeURIComponent(args.templateId)}/dataset`,
    fetchImpl: args.fetchImpl,
  });
  const dataset = payload.dataset;
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) return {};
  return dataset as Record<string, DatasetField>;
}

export async function uploadAsset(args: {
  token: string;
  name: string;
  bytes: Uint8Array;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<string> {
  const nameSafe = args.name.replace(/[^\w. -]+/g, "").trim().slice(0, 50) || "photo";
  const started = await canvaJson({
    token: args.token,
    url: `${CANVA_API}/asset-uploads`,
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Asset-Upload-Metadata": JSON.stringify({ name_base64: Buffer.from(nameSafe).toString("base64") }),
    },
    body: Buffer.from(args.bytes),
    fetchImpl: args.fetchImpl,
  });
  const job = await pollJob({
    token: args.token,
    job: jobFrom(started),
    url: (id) => `${CANVA_API}/asset-uploads/${encodeURIComponent(id)}`,
    fetchImpl: args.fetchImpl,
    sleep: args.sleep,
  });
  const assetId = job.asset?.id;
  if (!assetId) throw new CanvaApiError(502, "import_failed", "Canva uploaded the photo but did not return an asset id.");
  return assetId;
}

export async function createAutofill(args: {
  token: string;
  templateId: string;
  title: string;
  data: Record<string, { type: "text"; text: string } | { type: "image"; asset_id: string }>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ editUrl: string; viewUrl: string }> {
  const started = await canvaJson({
    token: args.token,
    url: `${CANVA_API}/autofills`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "create_from_brand_template",
      brand_template_id: args.templateId,
      title: args.title.slice(0, 255),
      data: args.data,
    }),
    fetchImpl: args.fetchImpl,
  });
  const job = await pollJob({
    token: args.token,
    job: jobFrom(started),
    url: (id) => `${CANVA_API}/autofills/${encodeURIComponent(id)}`,
    fetchImpl: args.fetchImpl,
    sleep: args.sleep,
  });
  const design = job.result?.design;
  const editUrl = design?.urls?.edit_url || design?.url;
  const viewUrl = design?.urls?.view_url || editUrl;
  if (!editUrl) throw new CanvaApiError(502, "create_design_error", "Canva finished the design but did not return a link.");
  return { editUrl, viewUrl: viewUrl || editUrl };
}

async function pollJob(args: {
  token: string;
  job: CanvaJob;
  url: (id: string) => string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<CanvaJob> {
  let job = args.job;
  const sleep = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 15 && job.status === "in_progress"; attempt += 1) {
    await sleep(1000);
    const payload = await canvaJson({
      token: args.token,
      url: args.url(job.id),
      fetchImpl: args.fetchImpl,
    });
    job = jobFrom(payload);
  }
  if (job.status === "failed") {
    throw new CanvaApiError(422, job.error?.code || "failed", job.error?.message || "Canva could not finish that job.");
  }
  if (job.status !== "success") {
    throw new CanvaApiError(504, "in_progress", "Canva is still working on that upload. Reply in this thread and I'll try again.");
  }
  return job;
}

function jobFrom(payload: { job?: CanvaJob }): CanvaJob {
  if (!payload.job?.id || !payload.job.status) {
    throw new CanvaApiError(502, "bad_response", "Canva returned an unexpected job.");
  }
  return payload.job;
}

async function canvaJson(args: {
  token: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  fetchImpl?: typeof fetch;
}): Promise<{ job?: CanvaJob; dataset?: unknown; code?: string; message?: string }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(args.url, {
    method: args.method ?? "GET",
    headers: { Authorization: `Bearer ${args.token}`, ...args.headers },
    body: args.body,
  });
  const text = await response.text();
  let payload: { job?: CanvaJob; dataset?: unknown; code?: string; message?: string } = {};
  if (text) {
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    throw new CanvaApiError(response.status, payload.code || "canva_error", payload.message || `Canva returned ${response.status}.`);
  }
  return payload;
}
