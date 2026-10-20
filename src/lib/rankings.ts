// The master sheet's "Rankings" tab: one row per player with salary, where their growth came from,
// every counting stat and the per-game and per-touch rates the league compares players on.
// As on the sheet, a player's sub appearances for other teams are a separate "(sub)" row, so their
// own row is only games for their own team.
import type { EngineResult, GameLine, LeagueInput } from "../../engine/types";

export interface RankRow {
  /** As shown: the player's name, or "Name (sub)" for a rostered player's sub appearances. */
  name: string;
  player: string;
  sub: boolean;
  team: string | null;
  gm: string;
  /** Salary and growth; null on a sub row (a sub's games don't move their own salary). */
  salary: number | null; playerGrowth: number | null; subGrowth: number | null; totalGrowth: number | null;
  gp: number; wins: number;
  goals: number; assists: number; secondAssists: number; blocks: number; drops: number; throwaways: number;
  gso: number; touches: number;
}

/** The sheet's "GSO Adj." factor: each GSO per game away from the league average moves the adjusted +/- by this much. */
export const GSO_ADJUST = 0.3;

export type Kind = "text" | "money" | "int" | "pct" | "dec";
export interface RankColumn { key: string; label: string; title?: string; kind: Kind; value: (r: RankRow, avgGso: number) => number | string | null }

const per = (n: number, d: number) => (d ? n / d : null);
const stats = (r: RankRow) => r.goals + r.assists + r.blocks;
const pm = (r: RankRow) => stats(r) - r.drops - r.throwaways;
export const gsoPerGame = (r: RankRow) => (r.gp ? Math.round((r.gso / r.gp) * 10) / 10 : null);

/** The sheet's columns, in its order, with its names. */
export const RANK_COLUMNS: RankColumn[] = [
  { key: "name", label: "Player", kind: "text", value: (r) => r.name },
  { key: "salary", label: "Salary", kind: "money", value: (r) => r.salary },
  { key: "playerGrowth", label: "Player Growth", title: "Salary earned in games played", kind: "money", value: (r) => r.playerGrowth },
  { key: "subGrowth", label: "Sub Growth", title: "Salary earned in games missed (absence estimate or the sub's game)", kind: "money", value: (r) => r.subGrowth },
  { key: "totalGrowth", label: "Total Growth", kind: "money", value: (r) => r.totalGrowth },
  { key: "gp", label: "Games Played", kind: "int", value: (r) => r.gp },
  { key: "wins", label: "Wins", title: "A tie counts as half", kind: "dec", value: (r) => r.wins },
  { key: "goals", label: "Points", title: "Goals", kind: "int", value: (r) => r.goals },
  { key: "assists", label: "Assists", kind: "int", value: (r) => r.assists },
  { key: "secondAssists", label: "2nd Assists", kind: "int", value: (r) => r.secondAssists },
  { key: "blocks", label: "Blocks", kind: "int", value: (r) => r.blocks },
  { key: "drops", label: "Drops", kind: "int", value: (r) => r.drops },
  { key: "throwaways", label: "Throw-aways", kind: "int", value: (r) => r.throwaways },
  { key: "stats", label: "Stats (P+A+D)", title: "Points + assists + blocks", kind: "int", value: (r) => stats(r) },
  { key: "gso", label: "Scored On", title: "GSO", kind: "int", value: (r) => r.gso },
  { key: "touches", label: "Touches", kind: "int", value: (r) => r.touches },
  { key: "retention", label: "Retention", title: "Touches without a drop or throwaway", kind: "pct", value: (r) => per(r.touches - r.drops - r.throwaways, r.touches) },
  { key: "pm", label: "+/-", title: "Stats − drops − throwaways", kind: "int", value: (r) => (r.gp ? pm(r) : null) },
  { key: "pmGso", label: "+/- (w/ GSO)", title: "+/- − scored on", kind: "int", value: (r) => (r.gp ? pm(r) - r.gso : null) },
  { key: "goalsPg", label: "Points / GP", kind: "dec", value: (r) => per(r.goals, r.gp) },
  { key: "statsPg", label: "Stats / GP", kind: "dec", value: (r) => per(stats(r), r.gp) },
  { key: "pmGsoPg", label: "+/- Stat / GP", title: "+/- with GSO, per game", kind: "dec", value: (r) => per(pm(r) - r.gso, r.gp) },
  { key: "pmPg", label: "+/- / GP (ex-GSO)", kind: "dec", value: (r) => per(pm(r), r.gp) },
  { key: "pmGsoPt", label: "+/- Stat / Touch", title: "+/- with GSO, per touch", kind: "dec", value: (r) => per(pm(r) - r.gso, r.touches) },
  { key: "pmPt", label: "+/- Stat / T (ex-GSO)", kind: "dec", value: (r) => per(pm(r), r.touches) },
  { key: "gsoPg", label: "GSO / GP", kind: "dec", value: (r) => gsoPerGame(r) },
  { key: "pmAdj", label: "+/- / GP w/ Adj. GSO", title: `+/- per game (ex-GSO), plus ${GSO_ADJUST} for each GSO per game below the league average`,
    kind: "dec", value: (r, avg) => (r.gp ? pm(r) / r.gp + (avg - gsoPerGame(r)!) * GSO_ADJUST : null) },
  { key: "gm", label: "GM", kind: "text", value: (r) => r.gm },
];

/** Rankings after `week`: every player on a team, every sub who played, games through that week. */
export function rankings(input: LeagueInput, result: EngineResult, week: number): { rows: RankRow[]; avgGso: number } {
  const real = new Map(input.teams.filter((t) => !t.isSubTeam).map((t) => [t.name, t.gm]));
  const teamOrder = [...real.keys()];
  const lines = result.lines.filter((l) => l.week <= week);
  const by = (player: string, role: GameLine["role"]) => lines.filter((l) => l.player === player && l.role === role);
  const tally = (ls: GameLine[]) => {
    const t = { gp: ls.length, wins: 0, goals: 0, assists: 0, secondAssists: 0, blocks: 0, drops: 0, throwaways: 0, gso: 0, touches: 0 };
    for (const l of ls) {
      t.wins += l.result ?? 0; t.goals += l.goals; t.assists += l.assists; t.secondAssists += l.secondAssists; t.blocks += l.blocks;
      t.drops += l.drops; t.throwaways += l.throwaways; t.gso += l.gso; t.touches += l.touches;
    }
    return t;
  };
  const rows: RankRow[] = [];
  for (const p of input.players) {
    if (p.isPlug) continue;
    const played = by(p.name, "rostered"), missed = by(p.name, "absent"), subbed = by(p.name, "sub");
    const at = result.teamOf(p.name, Math.max(1, week)) ?? result.teamOf(p.name, week + 1);
    const team = at && real.has(at) ? at : null;
    const own = team !== null || played.length > 0 || missed.length > 0;
    if (own) {
      const playerGrowth = played.reduce((a, l) => a + l.growth, 0), subGrowth = missed.reduce((a, l) => a + l.growth, 0);
      rows.push({
        name: p.name, player: p.name, sub: false, team, gm: team ? real.get(team) || team : "—",
        salary: result.salary[p.name]?.[Math.min(week, result.horizon)] ?? null, playerGrowth, subGrowth, totalGrowth: playerGrowth + subGrowth,
        ...tally(played),
      });
    }
    if (subbed.length) {
      rows.push({
        name: own ? `${p.name} (sub)` : p.name, player: p.name, sub: true, team: null, gm: "Sub",
        salary: null, playerGrowth: null, subGrowth: null, totalGrowth: null, ...tally(subbed),
      });
    }
  }
  // The sheet's order: by team (its GM), names A–Z, then the subs.
  const rank = (r: RankRow) => (r.sub ? teamOrder.length + 1 : r.team ? teamOrder.indexOf(r.team) : teamOrder.length);
  rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  // League average GSO per game, over everyone who played (the sheet's average of its GSO/GP column).
  const g = rows.map(gsoPerGame).filter((x): x is number => x !== null);
  return { rows, avgGso: g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0 };
}

/** One cell as the spreadsheet would show it, for CSV. */
export function cellText(c: RankColumn, r: RankRow, avgGso: number): string {
  const v = c.value(r, avgGso);
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (c.kind === "pct") return (v * 100).toFixed(1) + "%";
  if (c.kind === "dec") return String(Math.round(v * 100) / 100);
  return String(Math.round(v));
}

export function rankingsCsv(rows: RankRow[], avgGso: number) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [RANK_COLUMNS.map((c) => esc(c.label)).join(","), ...rows.map((r) => RANK_COLUMNS.map((c) => esc(cellText(c, r, avgGso))).join(","))].join("\n");
}
