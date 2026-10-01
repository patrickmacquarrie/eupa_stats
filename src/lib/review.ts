// What still needs an administrator before a week's numbers are final. A week with any open
// item is provisional: its salaries and stats can still change.
import type { EngineResult, LeagueInput } from "../../engine/types";
import { nameKey } from "./names";
import { needsReconfirming } from "./official";
import type { Season } from "./season";
import { weekOfDate } from "./season";
import type { Game } from "./SeasonContext";

export type OpenKind = "dispute" | "official" | "flag" | "name" | "sub";
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
  // Checked against the stored input: aliases don't change a score, so a merge doesn't unsettle one.
  for (const o of season.input.officialScores ?? []) {
    if (o.week <= w && needsReconfirming(season.input, o)) out.push({ week: o.week, kind: "official", label: `${o.a} v ${o.b}: the recordings changed after the official score was set`, to: gameLink(o.week, o.a, o.b) });
  }
  for (const f of season.flags ?? []) {
    const week = weekOfDate(input.schedule, f.date);
    if (!f.resolved && week !== null && week <= w) out.push({ week, kind: "flag", label: `${f.team}'s tablet flagged a possession at ${f.clock}`, to: gameLink(week, f.team, f.opp) });
  }
  const known = new Set(input.players.map((p) => nameKey(p.name)));
  const ignored = new Set((season.ignoredNames ?? []).map(nameKey));
  const unknown = new Map<number, Set<string>>();
  const note = (week: number | null, n: string | null | undefined) => {
    if (week === null || week > w || !n || known.has(nameKey(n)) || ignored.has(nameKey(n))) return;
    (unknown.get(week) ?? unknown.set(week, new Set()).get(week)!).add(n.trim());
  };
  for (const e of input.events) {
    const week = weekOfDate(input.schedule, e.date);
    for (const n of [e.player, e.lastPlayer, e.secLastPlayer]) note(week, n);
  }
  for (const b of input.boxScores ?? []) for (const l of b.lines) note(b.week, l.player);
  for (const [week, names] of unknown) for (const n of names) out.push({ week, kind: "name", label: `“${n}” isn't in the player list`, to: "admin/names" });
  // Every sub needs a match: who they covered, or "nobody" (an extra player). With auto-match on,
  // only the subs it couldn't place are left; with it off, every sub without a saved pick.
  const decided = new Set(input.subAssignments.map((a) => `${a.week}|${a.team}|${a.opp}|${nameKey(a.sub)}`));
  const auto = season.autoMatchSubs !== false;
  for (const l of result.lines) {
    if (l.week > w || l.role !== "sub" || l.subbedFor || decided.has(`${l.week}|${l.team}|${l.opp}|${nameKey(l.player)}`)) continue;
    const anyAbsent = result.lines.some((x) => x.week === l.week && x.team === l.team && x.opp === l.opp && x.role === "absent");
    const why = !anyAbsent ? "nobody on the roster is absent (an extra player, or a missed check-in?)"
      : auto ? "no absent player of the same gender is left to cover" : "isn't matched to an absent player yet";
    out.push({ week: l.week, kind: "sub", label: `${l.player} played for ${l.team} v ${l.opp}, but ${why}`.replace(", but isn't", " but isn't"), to: "admin/subs" });
  }
  return out.sort((a, b) => a.week - b.week || a.kind.localeCompare(b.kind));
}

export const provisionalWeeks = (items: OpenItem[]) => [...new Set(items.map((i) => i.week))].sort((a, b) => a - b);

const NOUN: Record<OpenKind, [string, string]> = {
  dispute: ["score dispute", "score disputes"], official: ["official score to reconfirm", "official scores to reconfirm"], flag: ["flagged possession", "flagged possessions"],
  name: ["unknown name", "unknown names"], sub: ["unmatched sub", "unmatched subs"],
};
/** "1 score dispute, 2 unmatched subs" */
export function describeItems(items: OpenItem[]) {
  const counts = new Map<OpenKind, number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${n} ${NOUN[k][n === 1 ? 0 : 1]}`).join(", ");
}

/**
 * What the Admin tab's red bubbles count. Unknown names are counted once, by the Names tab's
 * own list, rather than once per week here.
 */
export function adminCounts(items: OpenItem[], nameIssues: number, warnings: number) {
  const review = items.filter((i) => i.kind !== "name" && i.kind !== "sub").length + warnings;
  const subs = items.filter((i) => i.kind === "sub").length;
  return { review, names: nameIssues, subs, total: review + nameIssues + subs };
}
