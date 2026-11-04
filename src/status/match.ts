import { PROPERTIES } from "../intake/catalog.js";
import type { ListedTask } from "../store/types.js";

const TASK_GID = /(?:app\.asana\.com\/0\/\d+\/(\d+)|app\.asana\.com\/1\/\d+\/project\/\d+\/task\/(\d+)|\/task\/(\d+))/gi;

export function asanaTaskGids(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(TASK_GID)) {
    const gid = match[1] || match[2] || match[3];
    if (gid && !ids.includes(gid)) ids.push(gid);
  }
  return ids;
}

export function propertyHints(text: string): string[] {
  const found: string[] = [];
  const haystack = text.toLowerCase();
  const codes = Object.keys(PROPERTIES).sort((a, b) => b.length - a.length);
  for (const code of codes) {
    const pattern = new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text) && !found.includes(code)) found.push(code);
  }
  const nicknames: Array<[string, string]> = [
    ["santa monica", "SMP"],
    ["san francisco", "SFP"],
    ["shelborne", "SMB"],
    ["austin proper", "AUP"],
    ["downtown la", "DTLA"],
  ];
  for (const [nick, code] of nicknames) {
    if (haystack.includes(nick) && !found.includes(code)) found.push(code);
  }
  return found;
}

export function selectStatusTasks(input: {
  linked: ListedTask[];
  searched: ListedTask[];
  query: string;
  properties: string[];
  assigneeGid?: string;
}): { mode: "one" | "choice" | "none"; tasks: ListedTask[] } {
  const openLinked = input.linked.filter((task) => task.gid);
  if (openLinked.length === 1) return { mode: "one", tasks: openLinked };
  if (openLinked.length > 1) return { mode: "choice", tasks: openLinked.slice(0, 3) };
  const ranked = [...input.searched].sort((a, b) => score(b, input) - score(a, input) || a.name.localeCompare(b.name));
  const top = ranked.filter((task) => score(task, input) > 0).slice(0, 3);
  if (top.length === 0) return { mode: "none", tasks: [] };
  if (top.length === 1) return { mode: "one", tasks: top };
  const best = score(top[0], input);
  const second = score(top[1], input);
  if (best >= second + 20) return { mode: "one", tasks: top };
  return { mode: "choice", tasks: top };
}

function score(task: ListedTask, input: { query: string; properties: string[]; assigneeGid?: string }): number {
  const name = task.name.toLowerCase();
  let value = 0;
  let specific = false;
  if (input.assigneeGid && task.assigneeGid === input.assigneeGid) {
    value += 50;
    specific = true;
  }
  for (const property of input.properties) {
    if (name.includes(property.toLowerCase())) {
      value += 30;
      specific = true;
    }
  }
  for (const word of input.query.toLowerCase().split(/\s+/).filter((part) => part.length > 2)) {
    if (name.includes(word)) {
      value += 10;
      specific = true;
    }
  }
  if (!specific) return 0;
  if (/marketing|intake|creative/i.test(task.projectNames.join(" "))) value += 15;
  return value;
}
