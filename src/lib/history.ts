// League history: one record per season (imported from a master sheet, or kept current from a
// season in the app) holding each player's totals, and the careers built from those records.
// History carries salaries, so only a league's admins can read it (see firestore.rules).
import type { EngineResult, GameLine, LeagueInput } from "../../engine/types";
import { genderOf } from "../../engine/pairing";
import { gamesOf } from "./games";
import { aliasMap, likelySame, nameKey, stripSub } from "./names";
import { standings } from "./standings";

/** A player's counting stats over some games. A tie is half a win. */
export interface HistoryLine {
  gp: number; wins: number;
  goals: number; assists: number; secondAssists: number; blocks: number;
  drops: number; throwaways: number; gso: number; touches: number;
}
export const LINE_KEYS = ["gp", "wins", "goals", "assists", "secondAssists", "blocks", "drops", "throwaways", "gso", "touches"] as const;
export const emptyLine = (): HistoryLine => ({ gp: 0, wins: 0, goals: 0, assists: 0, secondAssists: 0, blocks: 0, drops: 0, throwaways: 0, gso: 0, touches: 0 });
export function addLine(to: HistoryLine, x: HistoryLine) {
  for (const k of LINE_KEYS) to[k] += x[k];
  return to;
}
export const sumLines = (...xs: HistoryLine[]) => xs.reduce((a, x) => addLine(a, x), emptyLine());

/** One player in one season. */
export interface HistoryPlayer {
  /** As the season spelled it ("Sub" suffix removed). */
  name: string;
  /** "F", "M", "X" (open), or "?" when the season didn't say. */
  group: string;
  /** Team at the end of the season; null for the sub pool. */
  team: string | null;
  startSalary: number | null;
  endSalary: number | null;
  /** Games for their own team. */
  own: HistoryLine;
  /** Games subbing for another team. */
  sub: HistoryLine;
}

export interface HistoryTeam { team: string; gm: string | null; wins: number; losses: number; ties: number; goalsFor: number; goalsAgainst: number }

export interface HistorySeason {
  v: 1;
  id: string;
  name: string;
  /** "sheet": imported from a master sheet. "app": kept current from the season in this app. */
  source: "sheet" | "app";
  /** The file it was imported from. */
  file?: string;
  /** First and last game nights counted, YYYY-MM-DD. */
  firstDate: string | null;
  lastDate: string | null;
  /** Weeks counted. */
  weeks: number;
  /** Standings, best first. */
  teams: HistoryTeam[];
  players: HistoryPlayer[];
  updatedAt: string;
}

/** The league's decisions about its history: spellings merged into one person, pairs that aren't, seasons left out. */
export interface HistoryMeta {
  aliases: { from: string; to: string }[];
  /** "a|b" name keys (sorted) an admin said are different people. */
  distinct: string[];
  /** Seasons in the app left out of the history (a test season, say). Their records stay, so they can come back. */
  hidden?: string[];
}
export const NO_META: HistoryMeta = { aliases: [], distinct: [], hidden: [] };
export const isHidden = (meta: HistoryMeta, id: string) => (meta.hidden ?? []).includes(id);
export const withHidden = (meta: HistoryMeta, id: string, hide: boolean): HistoryMeta =>
  ({ ...meta, hidden: hide ? [...new Set([...(meta.hidden ?? []), id])] : (meta.hidden ?? []).filter((x) => x !== id) });

/** A history id from a season's name: "2025 EUPA 4v4 S1" → "sheet-2025-eupa-4v4-s1". */
export const sheetSeasonId = (name: string) =>
  "sheet-" + (name.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 80) || "season");

/* ------------------------------------------------------------------ from an app season */

/** A season in the app, as a history record: games through the counted week. */
export function historyFromSeason(id: string, name: string, input: LeagueInput, result: EngineResult): HistorySeason {
  const w = input.throughWeek;
  const real = new Map(input.teams.filter((t) => !t.isSubTeam).map((t) => [t.name, t.gm]));
  const teamAt = (p: string) => {
    const t = result.teamOf(p, Math.max(1, w)) ?? result.teamOf(p, w + 1);
    return t && real.has(t) ? t : null;
  };
  const byName = new Map(input.players.map((p) => [p.name, p]));
  const rows = new Map<string, HistoryPlayer>();
  const row = (name: string) => {
    let r = rows.get(name);
    if (!r) {
      const p = byName.get(name);
      const team = teamAt(name);
      const sal = result.salary[name];
      r = {
        name, group: genderOf(p?.gender), team,
        startSalary: p && (p.team || !p.isSub) ? p.initialSalary : null,
        endSalary: team && sal ? Math.round(sal[Math.min(w, result.horizon)] ?? 0) : null,
        own: emptyLine(), sub: emptyLine(),
      };
      rows.set(name, r);
    }
    return r;
  };
  // Everyone on a roster, even with no games; anyone else who played.
  for (const p of input.players) if (!p.isPlug && teamAt(p.name)) row(p.name);
  const add = (l: GameLine, to: HistoryLine) => {
    to.gp++; to.wins += l.result ?? 0;
    to.goals += l.goals; to.assists += l.assists; to.secondAssists += l.secondAssists; to.blocks += l.blocks;
    to.drops += l.drops; to.throwaways += l.throwaways; to.gso += l.gso; to.touches += l.touches;
  };
  for (const l of result.lines) {
    if (l.week > w || l.role === "absent" || byName.get(l.player)?.isPlug) continue;
    add(l, l.role === "sub" ? row(l.player).sub : row(l.player).own);
  }
  const sched = [...input.schedule].sort((a, b) => a.week - b.week);
  const counted = sched.filter((s) => s.week <= w);
  return {
    v: 1, id, name, source: "app",
    firstDate: sched[0]?.date ?? null, lastDate: counted.at(-1)?.date ?? null, weeks: w,
    teams: standings([...real.keys()], gamesOf(result.recordings), w).map((s) => ({
      team: s.team, gm: real.get(s.team) || null, wins: s.wins, losses: s.losses, ties: s.ties, goalsFor: s.goalsFor, goalsAgainst: s.goalsAgainst,
    })),
    players: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)),
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ careers */

export interface CareerSeason {
  id: string; name: string; firstDate: string | null; lastDate: string | null; source: HistorySeason["source"];
  /** That season's line (two spellings merged into one person are added together). */
  player: HistoryPlayer;
}

export interface Career {
  /** Stable key for links: the name key of the person's current spelling. */
  key: string;
  name: string;
  group: string;
  /** Newest first. */
  seasons: CareerSeason[];
  own: HistoryLine;
  sub: HistoryLine;
  /** Spellings seen across seasons, when more than one. */
  spellings: string[];
  lastSalary: number | null;
  peakSalary: number | null;
}

/** Oldest first: by first game night, then name. */
export const seasonOrder = (a: Pick<HistorySeason, "firstDate" | "name">, b: Pick<HistorySeason, "firstDate" | "name">) =>
  (a.firstDate ?? "9999").localeCompare(b.firstDate ?? "9999") || a.name.localeCompare(b.name);

/** Resolves a spelling to the person's current name: "Sub" removed, then the merges. */
export function nameResolver(names: HistoryMeta = NO_META) {
  const r = aliasMap(names.aliases);
  return (n: string) => r(stripSub(n));
}

/** Every person across the league's history, with their seasons and totals. */
export function careers(seasons: HistorySeason[], names: HistoryMeta = NO_META): Career[] {
  const resolve = nameResolver(names);
  const merged = new Set(names.aliases.map((a) => nameKey(a.to)));
  const out = new Map<string, Career & { spelled: Set<string> }>();
  for (const s of [...seasons].sort(seasonOrder).reverse()) {   // newest first
    const inSeason = new Map<string, HistoryPlayer>();
    for (const p of s.players) {
      const name = resolve(p.name), key = nameKey(name);
      let c = out.get(key);
      if (!c) {
        // An admin's merge decides the spelling; otherwise the newest season's does.
        c = { key, name, group: "?", seasons: [], own: emptyLine(), sub: emptyLine(), spellings: [], lastSalary: null, peakSalary: null, spelled: new Set() };
        out.set(key, c);
      }
      if (merged.has(key)) c.name = name;
      c.spelled.add(p.name);
      if (c.group === "?" && p.group !== "?") c.group = p.group;
      addLine(c.own, p.own); addLine(c.sub, p.sub);
      const prev = inSeason.get(key);
      if (prev) {
        // Two spellings in one season, merged: one line for the season.
        addLine(prev.own, p.own); addLine(prev.sub, p.sub);
        prev.team ??= p.team; prev.startSalary ??= p.startSalary; prev.endSalary ??= p.endSalary;
      } else {
        const copy = { ...p, own: { ...p.own }, sub: { ...p.sub } };
        inSeason.set(key, copy);
        c.seasons.push({ id: s.id, name: s.name, firstDate: s.firstDate, lastDate: s.lastDate, source: s.source, player: copy });
      }
    }
  }
  return [...out.values()].map(({ spelled, ...c }) => {
    const salaries = c.seasons.map((x) => x.player.endSalary).filter((x): x is number => x !== null && x > 0);
    return {
      ...c,
      spellings: spelled.size > 1 ? [...spelled].sort() : [],
      lastSalary: c.seasons.find((x) => x.player.endSalary !== null && x.player.endSalary > 0)?.player.endSalary ?? null,
      peakSalary: salaries.length ? Math.max(...salaries) : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** A career's games, with or without the games they subbed for another team. */
export const careerLine = (c: Pick<Career, "own" | "sub">, withSubs: boolean) => (withSubs ? sumLines(c.own, c.sub) : c.own);
export const seasonLine = (p: Pick<HistoryPlayer, "own" | "sub">, withSubs: boolean) => (withSubs ? sumLines(p.own, p.sub) : p.own);

/* ------------------------------------------------------------------ merging names */

export interface MergeSuggestion { a: string; b: string; why: string }
export const pairKey = (a: string, b: string) => [nameKey(a), nameKey(b)].sort().join("|");

/** Why two names probably mean the same person, or null. */
export function samePerson(x: string, y: string): string | null {
  const why = likelySame(x, y);
  if (why) return why;
  // A last initial: "Austin B" / "Austin Brown".
  const a = nameKey(stripSub(x)).split(" "), b = nameKey(stripSub(y)).split(" ");
  if (a.length === 2 && b.length >= 2 && a[0] === b[0] && /^\p{L}\.?$/u.test(a[1]) && b[b.length - 1].startsWith(a[1][0])) return "last initial";
  if (b.length === 2 && a.length >= 2 && a[0] === b[0] && /^\p{L}\.?$/u.test(b[1]) && a[a.length - 1].startsWith(b[1][0])) return "last initial";
  return null;
}

/** Pairs of people in the history who are probably one person, leaving out pairs already ruled out. */
export function mergeSuggestions(people: Pick<Career, "name">[], names: HistoryMeta = NO_META): MergeSuggestion[] {
  const ruledOut = new Set(names.distinct);
  const out: MergeSuggestion[] = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const a = people[i].name, b = people[j].name;
    if (ruledOut.has(pairKey(a, b))) continue;
    const why = samePerson(a, b);
    if (why) out.push({ a, b, why });
  }
  return out;
}

/** Adds a merge (`from` becomes `to`), re-pointing earlier merges into `from` and dropping a loop. */
export function withMerge(names: HistoryMeta, from: string, to: string): HistoryMeta {
  const f = nameKey(from);
  if (f === nameKey(to)) return names;
  const aliases = names.aliases
    .filter((a) => nameKey(a.from) !== f && !(nameKey(a.from) === nameKey(to) && nameKey(a.to) === f))
    .map((a) => (nameKey(a.to) === f ? { ...a, to } : a));
  return { ...names, aliases: [...aliases, { from, to }] };
}

export const withoutMerge = (names: HistoryMeta, from: string): HistoryMeta =>
  ({ ...names, aliases: names.aliases.filter((a) => nameKey(a.from) !== nameKey(from)) });

export const withDistinct = (names: HistoryMeta, a: string, b: string): HistoryMeta =>
  ({ ...names, distinct: [...new Set([...names.distinct, pairKey(a, b)])] });

/* ------------------------------------------------------------------ checking stored records */

const isLine = (l: any) => l && typeof l === "object" && LINE_KEYS.every((k) => typeof l[k] === "number" && Number.isFinite(l[k]) && l[k] >= 0);
const isDate = (d: unknown) => d === null || (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));

/** What's wrong with a stored history season (empty when it's usable). */
export function historyProblems(d: any): string[] {
  if (!d || typeof d !== "object" || d.v !== 1) return ["Not a history season (or one from a newer version of the app)."];
  const out: string[] = [];
  if (typeof d.id !== "string" || !d.id) out.push("It has no id.");
  if (typeof d.name !== "string" || !d.name.trim()) out.push("It has no name.");
  if (d.source !== "sheet" && d.source !== "app") out.push("It doesn't say where it came from.");
  if (!isDate(d.firstDate) || !isDate(d.lastDate)) out.push("Its dates aren't dates.");
  if (!Number.isInteger(d.weeks) || d.weeks < 0) out.push("Its week count isn't a number.");
  if (!Array.isArray(d.teams) || d.teams.some((t: any) => !t || typeof t.team !== "string")) out.push("Its standings are damaged.");
  if (!Array.isArray(d.players)) return [...out, "It has no players."];
  d.players.forEach((p: any, i: number) => {
    if (!p || typeof p.name !== "string" || !p.name.trim()) { out.push(`Player ${i + 1} has no name.`); return; }
    if (!isLine(p.own) || !isLine(p.sub)) out.push(`${p.name}'s stats are damaged.`);
    if (typeof p.group !== "string") out.push(`${p.name} has no division.`);
  });
  return out;
}

/** Firestore keeps no `undefined`; this drops it (and anything else JSON can't hold). */
export const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Everything an admin can download from the history page, and import again. */
export interface HistoryExport { kind: "eupa-history"; v: 1; league: string; exportedAt: string; seasons: HistorySeason[]; names: HistoryMeta }

export function parseHistoryExport(text: string): HistoryExport {
  let d: any;
  try { d = JSON.parse(text); } catch { throw new Error("That file isn't a history export."); }
  if (d?.kind !== "eupa-history" || d.v !== 1 || !Array.isArray(d.seasons)) throw new Error("That file isn't a history export from this app.");
  const bad = d.seasons.map((s: any) => ({ s, p: historyProblems(s) })).filter((x: any) => x.p.length);
  if (bad.length) throw new Error(`${bad[0].s?.name ?? "A season"} in that file is damaged: ${bad[0].p.slice(0, 3).join(" ")}`);
  const names = d.names && Array.isArray(d.names.aliases) ? { aliases: d.names.aliases.filter((a: any) => typeof a?.from === "string" && typeof a?.to === "string"), distinct: Array.isArray(d.names.distinct) ? d.names.distinct.filter((x: unknown) => typeof x === "string") : [], hidden: Array.isArray(d.names.hidden) ? d.names.hidden.filter((x: unknown) => typeof x === "string") : [] } : NO_META;
  return { kind: "eupa-history", v: 1, league: String(d.league ?? ""), exportedAt: String(d.exportedAt ?? ""), seasons: d.seasons, names };
}
