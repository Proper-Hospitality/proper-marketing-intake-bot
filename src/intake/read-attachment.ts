import { inflateRawSync, inflateSync } from "node:zlib";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function readSlackAttachment(args: {
  name: string;
  mimetype?: string;
  bytes: Uint8Array;
  describe?: (input: { name: string; mimetype: string; bytes: Uint8Array }) => Promise<string>;
}): Promise<string> {
  const type = mediaType(args.name, args.mimetype);
  if (type.startsWith("text/") || type === "application/json") {
    return clamp(new TextDecoder().decode(args.bytes));
  }
  if (type === "application/pdf") {
    const local = extractPdfText(args.bytes);
    if (local) return local;
    if (!args.describe) return "";
    return clamp(await safeDescribe(args.describe, { name: args.name, mimetype: type, bytes: args.bytes }));
  }
  if (IMAGE_TYPES.has(type) && args.describe) {
    return clamp(await safeDescribe(args.describe, { name: args.name, mimetype: type, bytes: args.bytes }));
  }
  return "";
}

export function extractPdfText(bytes: Uint8Array): string {
  const file = Buffer.from(bytes);
  const chunks = [...inflateStreams(file), file];
  const pieces: string[] = [];
  for (const chunk of chunks) {
    pieces.push(...pullPdfStrings(chunk.toString("latin1")));
  }
  return clamp(pieces.join(" ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim());
}

export function mediaType(name: string, mimetype?: string): string {
  const declared = mimetype?.split(";")[0]?.trim().toLowerCase();
  if (declared && declared !== "application/octet-stream") return declared;
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  return declared || "application/octet-stream";
}

function inflateStreams(file: Buffer): Buffer[] {
  const source = file.toString("latin1");
  const out: Buffer[] = [];
  const marker = /stream\r?\n/g;
  for (const match of source.matchAll(marker)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = source.indexOf("endstream", start);
    if (end < 0) break;
    let data = Buffer.from(source.slice(start, end), "latin1");
    if (data[data.length - 1] === 0x0a) data = data.subarray(0, data.length - 1);
    if (data[data.length - 1] === 0x0d) data = data.subarray(0, data.length - 1);
    try {
      out.push(inflateSync(data));
    } catch {
      try {
        out.push(inflateRawSync(data));
      } catch {
        // Uncompressed stream. The raw file is scanned separately.
      }
    }
  }
  return out;
}

function pullPdfStrings(source: string): string[] {
  const out: string[] = [];
  const tj = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  for (const match of source.matchAll(tj)) out.push(unescapePdf(match[1]));
  const arrays = /\[([\s\S]*?)\]\s*TJ/g;
  for (const match of source.matchAll(arrays)) {
    const inner = /\(((?:\\.|[^\\)])*)\)/g;
    for (const part of match[1].matchAll(inner)) out.push(unescapePdf(part[1]));
  }
  return out.map((item) => item.trim()).filter(Boolean);
}

function unescapePdf(value: string): string {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, seq: string) => {
    if (seq === "n") return "\n";
    if (seq === "r") return "\r";
    if (seq === "t") return "\t";
    if (seq === "b") return "\b";
    if (seq === "f") return "\f";
    if (seq === "(" || seq === ")" || seq === "\\") return seq;
    return String.fromCharCode(Number.parseInt(seq, 8));
  });
}

async function safeDescribe(
  describe: (input: { name: string; mimetype: string; bytes: Uint8Array }) => Promise<string>,
  input: { name: string; mimetype: string; bytes: Uint8Array },
): Promise<string> {
  try {
    return (await describe(input)) ?? "";
  } catch (error) {
    console.error(JSON.stringify({
      msg: "attachment_read_failed",
      name: input.name,
      error: error instanceof Error ? error.message : "unknown",
    }));
    return "";
  }
}

function clamp(value: string): string {
  return value.trim().slice(0, 1500);
}
