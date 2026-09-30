// What still needs an administrator before a week's numbers are final. A week with any open
// item is provisional: its salaries and stats can still change.
import type { EngineResult, LeagueInput } from "../../engine/types";
import { nameKey } from "./names";
import type { Season } from "./season";
import { weekOfDate } from "./season";
import type { Game } from "./SeasonContext";

export type OpenKind = "dispute" | "flag" | "name" | "sub";
export interface OpenItem { week: number; kind: OpenKind; label: string; /** Route relative to the season. */ to: string }

const gameLink = (week: number, a: string, b: string) => {
  const [x, y] = [a, b].sort();
  return `games/${week}/${encodeURIComponent(x)}/${encodeURIComponent(y)}`;
};

/** Both tablets recorded the game and their final scores differ, with no official score set. */
export const isDisputed = (g: Game) =>
  !!(g.recA && g.recB && g.recA.eventCount && g.recB.eventCount && !g.recA.official && !g.recB.official &&
    (g.recA.finalScore !== g.recB.finalOppScore || g.recA.finalOppScore !== g.recB.finalScore));

/** `input` is the alias-resolved input the engine ran on. */
export function openItems(season: Season, input: LeagueInput, result: EngineResult, games: Game[]): OpenItem[] {
  const w = input.throughWeek;
  const out: OpenItem[] = [];
  for (const g of games) {
    if (g.week <= w && isDisputed(g)) out.push({ week: g.week, kind: "dispute", label: `${g.a} v ${g.b}: the tablets disagree on the score`, to: gameLink(g.week, g.a, g.b) });
  }
  for (const f of season.flags ?? []) {
    const week = weekOfDate(input.schedule, f.date);
    if (!f.resolved && week !== null && week <= w) out.push({ week, kind: "flag", label: `${f.team}'s tablet flagged a possession at ${f.clock}`, to: gameLink(week, f.team, f.opp) });
  }
  const known = new Set(input.players.map((p) => nameKey(p.name)));
  const ignored = new Set((season.ignoredNames ?? []).map(nameKey));
  const unknown = new Map<string, Set<string>>();
  for (const e of input.events) {
    const week = weekOfDate(input.schedule, e.date);
    if (week === null || week > w) continue;
    for (const n of [e.player, e.lastPlayer, e.secLastPlayer]) {
      if (!n || known.has(nameKey(n)) || ignored.has(nameKey(n))) continue;
      (unknown.get(String(week)) ?? unknown.set(String(week), new Set()).get(String(week))!).add(n.trim());
    }
  }
  for (const [week, names] of unknown) for (const n of names) out.push({ week: Number(week), kind: "name", label: `“${n}” isn't in the player list`, to: "names" });
  const sides = new Map<string, typeof result.lines>();
  for (const l of result.lines) { const k = `${l.week}|${l.team}|${l.opp}`; (sides.get(k) ?? sides.set(k, []).get(k)!).push(l); }
  for (const lines of sides.values()) {
    const { week, team, opp } = lines[0];
    if (week > w || !lines.some((l) => l.role === "absent")) continue;
    for (const l of lines) if (l.role === "sub" && !l.subbedFor) out.push({ week, kind: "sub", label: `${l.player} subbed for ${team} v ${opp} but isn't paired with anyone`, to: "subs" });
  }
  return out.sort((a, b) => a.week - b.week || a.kind.localeCompare(b.kind));
}

export const provisionalWeeks = (items: OpenItem[]) => [...new Set(items.map((i) => i.week))].sort((a, b) => a - b);

const NOUN: Record<OpenKind, [string, string]> = {
  dispute: ["score dispute", "score disputes"], flag: ["flagged possession", "flagged possessions"],
  name: ["unknown name", "unknown names"], sub: ["unpaired sub", "unpaired subs"],
};
/** "1 score dispute, 2 unpaired subs" */
export function describeItems(items: OpenItem[]) {
  const counts = new Map<OpenKind, number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${n} ${NOUN[k][n === 1 ? 0 : 1]}`).join(", ");
}
