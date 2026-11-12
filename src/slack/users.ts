export interface SlackMember {
  id?: string;
  deleted?: boolean;
  is_bot?: boolean;
  real_name?: string;
  name?: string;
  profile?: { real_name?: string; display_name?: string };
}

/** Exact name match only. More than one person with that name is not a guess. */
export function matchSlackMember(name: string, members: SlackMember[]): { id: string; name?: string } | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  const hits: Array<{ id: string; name?: string }> = [];
  for (const member of members) {
    if (!member.id || member.deleted || member.is_bot) continue;
    const names = [member.real_name, member.profile?.real_name, member.profile?.display_name, member.name]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
    if (!names.includes(wanted)) continue;
    hits.push({
      id: member.id,
      name: member.real_name || member.profile?.real_name || member.profile?.display_name || member.name,
    });
  }
  return hits.length === 1 ? hits[0] : undefined;
}
