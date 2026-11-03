export async function downloadSlackFile(args: {
  token: string;
  fileId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ name: string; bytes: Uint8Array }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const infoResponse = await fetchImpl(`https://slack.com/api/files.info?file=${encodeURIComponent(args.fileId)}`, {
    headers: { Authorization: `Bearer ${args.token}` },
  });
  const info = await infoResponse.json() as {
    ok?: boolean;
    error?: string;
    file?: { name?: string; url_private?: string; url_private_download?: string };
  };
  if (!info.ok || !info.file) throw new Error(info.error || "Slack could not find that file. The bot needs the files:read scope.");
  const url = info.file.url_private_download || info.file.url_private;
  if (!url) throw new Error("Slack did not include a download link for that file.");
  return readBytes({
    url,
    name: info.file.name || "photo",
    token: args.token,
    fetchImpl,
  });
}

export async function downloadRemoteFile(args: {
  url: string;
  name?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ name: string; bytes: Uint8Array }> {
  const slackFile = /slack\.com|slack-files\.com/.test(args.url);
  return readBytes({
    url: args.url,
    name: args.name || "photo",
    token: slackFile ? args.token : undefined,
    fetchImpl: args.fetchImpl,
  });
}

async function readBytes(args: {
  url: string;
  name: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ name: string; bytes: Uint8Array }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(args.url, {
    headers: args.token ? { Authorization: `Bearer ${args.token}` } : {},
  });
  if (!response.ok) throw new Error(`Could not download ${args.name}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error(`${args.name} is over 20 MB. Send a smaller photo.`);
  if (bytes.byteLength === 0) throw new Error(`${args.name} was empty.`);
  return { name: args.name, bytes };
}
