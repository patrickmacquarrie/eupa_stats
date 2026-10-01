// Name hygiene: recorded names that don't match the player list, near-duplicate player
// records, and the old "Name Sub" convention (the engine now decides sub vs rostered from
// the week's roster, so a second record per person is no longer needed).
import type { LeagueInput, Player, PlayEvent } from "../../engine/types";

/** Same normalisation the engine uses to match names. */
export const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const SUB_SUFFIX = /\s+sub$/i;
export const stripSub = (s: string) => s.trim().replace(SUB_SUFFIX, "").trim();

/** A recorded spelling mapped to a player. Raw recordings are never rewritten; this is applied when computing. */
export interface Alias {
  from: string;
  to: string;
  /** Player record removed by the merge, kept so the merge can be undone. */
  removed?: Player;
  /** Player record renamed by the merge (from → to). */
  renamed?: boolean;
}

export function aliasMap(aliases: Alias[] = []) {
  const m = new Map<string, string>();
  for (const a of aliases) m.set(nameKey(a.from), a.to);
  // Follow chains (a → b → c), guarding against loops.
  const resolve = (n: string) => {
    let cur = n;
    for (let i = 0; i < 10; i++) { const nx = m.get(nameKey(cur)); if (!nx || nameKey(nx) === nameKey(cur)) break; cur = nx; }
    return cur;
  };
  return resolve;
}

/**
 * The engine's input with every name resolved through the aliases: the event log, and the
 * admin's sub picks, box scores and trades. Stored data keeps its original spelling, so
 * removing an alias restores exactly what was there before.
 */
export function resolveInput(input: LeagueInput, aliases: Alias[] = []): LeagueInput {
  if (!aliases.length) return input;
  const r = aliasMap(aliases);
  const fix = (n?: string | null) => (n ? r(n) : n);
  return {
    ...input,
    events: input.events.map((e): PlayEvent => ({ ...e, player: fix(e.player), lastPlayer: fix(e.lastPlayer), secLastPlayer: fix(e.secLastPlayer) })),
    subAssignments: input.subAssignments.map((a) => ({ ...a, sub: r(a.sub), subbedFor: r(a.subbedFor) })),
    boxScores: input.boxScores?.map((b) => ({ ...b, lines: b.lines.map((l) => ({ ...l, player: r(l.player) })) })),
    trades: input.trades.map((t) => ({ ...t, player: r(t.player) })),
    presentWithoutPlays: input.presentWithoutPlays?.map((x) => ({ ...x, player: r(x.player) })),
  };
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps). */
export function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

/** Why two spellings probably mean the same person, or null. */
export function likelySame(x: string, y: string): string | null {
  const a = nameKey(stripSub(x)), b = nameKey(stripSub(y));
  if (a === b) return nameKey(x) === nameKey(y) ? null : "same name apart from “Sub”";
  const d = editDistance(a, b);
  if (d <= (Math.min(a.length, b.length) >= 8 ? 2 : 1)) return `spelling differs by ${d} letter${d > 1 ? "s" : ""}`;
  // Short first name: "Jess Smith" / "Jessica Smith".
  const [fa, ...la] = a.split(" "), [fb, ...lb] = b.split(" ");
  if (la.length && la.join(" ") === lb.join(" ") && Math.min(fa.length, fb.length) >= 3 && (fa.startsWith(fb) || fb.startsWith(fa)))
    return "short form of the first name";
  return null;
}

export interface UnknownName { name: string; plays: number; recordings: string[]; suggestion?: string; why?: string }
export interface SubRecord { player: Player; base?: Player }
export interface DuplicatePair { a: Player; b: Player; why: string }

const isSubSuffixRecord = (p: Player) => p.isSub && !p.isPlug && SUB_SUFFIX.test(p.name);

/** Best player match for a spelling; real names win over "Sub" records. */
export function suggestPlayer(name: string, players: Player[]) {
  let best: { p: Player; why: string; score: number } | undefined;
  for (const p of players) {
    const why = likelySame(name, p.name);
    if (!why) continue;
    const score = editDistance(nameKey(stripSub(name)), nameKey(stripSub(p.name))) + (isSubSuffixRecord(p) ? 0.5 : 0);
    if (!best || score < best.score) best = { p, why, score };
  }
  return best && { name: best.p.name, why: best.why };
}

export function findNameIssues(input: LeagueInput, aliases: Alias[] = [], ignored: string[] = []) {
  const known = new Map(input.players.map((p) => [nameKey(p.name), p]));
  const r = aliasMap(aliases);
  const ign = new Set(ignored.map(nameKey));

  // 1. Recorded names nobody in the player list matches.
  const seen = new Map<string, UnknownName>();
  const note = (raw: string | null | undefined, rec: string, n = 1) => {
    if (!raw) return;
    const name = r(raw).trim();
    if (known.has(nameKey(name)) || ign.has(nameKey(name))) return;
    const u = seen.get(nameKey(name)) ?? { name, plays: 0, recordings: [] };
    u.plays += n;
    if (!u.recordings.includes(rec)) u.recordings.push(rec);
    seen.set(nameKey(name), u);
  };
  for (const e of input.events) {
    const rec = `${e.date} ${e.statTeam}`;
    note(e.player, rec); note(e.lastPlayer, rec); note(e.secLastPlayer, rec);
  }
  for (const b of input.boxScores ?? []) for (const l of b.lines) note(l.player, `week ${b.week} ${b.team} (box score)`, 0);
  const unknown = [...seen.values()].map((u) => ({ ...u, ...(() => { const s = suggestPlayer(u.name, input.players); return s ? { suggestion: s.name, why: s.why } : {}; })() }))
    .sort((a, b) => b.plays - a.plays);

  // 2. Old-style "Name Sub" records.
  const subRecords: SubRecord[] = input.players.filter(isSubSuffixRecord)
    .map((p) => ({ player: p, base: known.get(nameKey(stripSub(p.name))) }))
    .filter((s) => !s.base || !isSubSuffixRecord(s.base));

  // 3. Player records that look like the same person twice (excluding the Sub pairs above).
  const dupes: DuplicatePair[] = [];
  const ps = input.players.filter((p) => !p.isPlug);
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const [a, b] = [ps[i], ps[j]];
    if (nameKey(stripSub(a.name)) === nameKey(stripSub(b.name))) continue;
    if (ign.has(`${nameKey(a.name)}|${nameKey(b.name)}`)) continue;
    const why = likelySame(a.name, b.name);
    if (why) dupes.push({ a, b, why });
  }
  return { unknown, subRecords, dupes };
}

/**
 * Merge `from` into player `to` by adding an alias. When both are player records, the `from`
 * record is removed (and kept on the alias for undo); when `to` isn't a player yet, the `from`
 * record is renamed. Nothing else in the season is rewritten.
 */
export function mergeName(input: LeagueInput, aliases: Alias[], from: string, to: string): { input: LeagueInput; aliases: Alias[] } {
  const fk = nameKey(from);
  const fromRec = input.players.find((p) => nameKey(p.name) === fk);
  const toRec = input.players.find((p) => nameKey(p.name) === nameKey(to));
  const alias: Alias = { from, to: toRec?.name ?? to.trim() };
  let players = input.players;
  if (fromRec && toRec && fromRec !== toRec) { players = players.filter((p) => p !== fromRec); alias.removed = fromRec; }
  else if (fromRec && !toRec) { players = players.map((p) => (p === fromRec ? { ...p, name: alias.to } : p)); alias.renamed = true; }
  return { input: { ...input, players }, aliases: [...aliases.filter((a) => nameKey(a.from) !== fk), alias] };
}

/** Undo a merge: drop the alias and put back the player record it removed or renamed. */
export function unmergeName(input: LeagueInput, aliases: Alias[], a: Alias): { input: LeagueInput; aliases: Alias[] } {
  let players = input.players;
  if (a.removed) players = [...players, a.removed];
  if (a.renamed) players = players.map((p) => (nameKey(p.name) === nameKey(a.to) ? { ...p, name: a.from } : p));
  return { input: { ...input, players }, aliases: aliases.filter((x) => x !== a) };
}
