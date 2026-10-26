/**
 * @mention helpers shared by every comment editor.
 *
 * A mention is stored in the comment body as plain `@Display Name` text (so
 * notifications and exports read naturally) and the mentioned user ids are
 * sent alongside it. These helpers are pure so they can be unit tested.
 */

export interface MentionUser {
  id: string;
  display_name: string;
  email?: string | null;
  avatar_url?: string | null;
}

export interface MentionQuery {
  /** Index of the `@` that opened the query. */
  start: number;
  /** Text typed after the `@` (up to the caret). */
  query: string;
}

const MAX_QUERY_LENGTH = 30;
export const MAX_SUGGESTIONS = 30; // the popup scrolls, so this is just a sanity cap

/**
 * The mention being typed at `caret`, or null. The `@` must start the text or
 * follow whitespace (so emails like a@b.com never trigger it) and the query
 * cannot span a line break.
 */
export function getMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY_LENGTH || /[\n\r@]/.test(query)) return null;
  return { start: at, query };
}

/** Case-insensitive match on name / email; prefix matches rank first. */
export function filterMentionUsers<T extends MentionUser>(
  users: T[],
  query: string,
  limit = MAX_SUGGESTIONS,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return users.slice(0, limit);
  const scored: Array<{ u: T; score: number }> = [];
  for (const u of users) {
    const name = (u.display_name ?? "").toLowerCase();
    // Local part only: every address shares the company domain, which would match everyone.
    const email = (u.email ?? "").toLowerCase().split("@")[0];
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 1;
    else if (email.startsWith(q)) score = 2;
    else if (name.includes(q) || email.includes(q)) score = 3;
    if (score >= 0) scored.push({ u, score });
  }
  scored.sort((a, b) => a.score - b.score || a.u.display_name.localeCompare(b.u.display_name));
  return scored.slice(0, limit).map((s) => s.u);
}

/** Replaces the `@query` run with `@Name ` and returns the new text + caret. */
export function insertMention(
  text: string,
  mention: MentionQuery,
  caret: number,
  user: MentionUser,
): { text: string; caret: number } {
  const insert = `@${user.display_name} `;
  const after = text.slice(caret);
  const next = text.slice(0, mention.start) + insert + after;
  return { text: next, caret: mention.start + insert.length };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regex matching `@Name` for any of the users (longest names first), not followed by a word char. */
function mentionRegex(users: MentionUser[]): RegExp | null {
  const names = Array.from(new Set(users.map((u) => u.display_name?.trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (names.length === 0) return null;
  return new RegExp(`(^|\\s)@(${names.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}

/**
 * Ids of every user whose `@Name` appears in `body`. Because it is derived
 * from the final text, deleting a mention from the draft also un-mentions
 * the person. `exceptId` drops the author (no self-notification).
 */
export function resolveMentionIds(body: string, users: MentionUser[], exceptId?: string): string[] {
  const re = mentionRegex(users);
  if (!re) return [];
  const found = new Set<string>();
  for (const m of body.matchAll(re)) found.add(m[2].toLowerCase());
  return users
    .filter((u) => u.id !== exceptId && found.has(u.display_name.trim().toLowerCase()))
    .map((u) => u.id)
    .filter((id, i, all) => all.indexOf(id) === i);
}

export type BodySegment = { type: "text"; text: string } | { type: "mention"; text: string };

/** Splits `body` into plain / mention segments for highlighted rendering. */
export function splitMentions(body: string, users: MentionUser[]): BodySegment[] {
  const re = mentionRegex(users);
  if (!re) return [{ type: "text", text: body }];
  const out: BodySegment[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const lead = m[1].length;
    const start = (m.index ?? 0) + lead;
    if (start > last) out.push({ type: "text", text: body.slice(last, start) });
    out.push({ type: "mention", text: `@${m[2]}` });
    last = start + 1 + m[2].length;
  }
  if (last < body.length) out.push({ type: "text", text: body.slice(last) });
  return out.length ? out : [{ type: "text", text: body }];
}
