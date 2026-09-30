// The player-facing stats: what goes on the public page, and nothing else. A snapshot holds
// per-player totals only (no salaries, rules or recordings), so it can be shared with anyone.
import type { EngineResult, GameLine, LeagueInput } from "../../engine/types";
import { genderOf } from "../../engine/pairing";

export type ColumnKey =
  | "gp" | "wins" | "goals" | "assists" | "points" | "secondAssists" | "blocks" | "stats" | "touches"
  | "drops" | "throwaways" | "gso" | "pointsPg" | "statsPg" | "touchesPg";
export type BoardKey = "goalsPg" | "assistsPg" | "blocksPg" | "touchesPg" | "secondAssistsPg" | "statsPg" | "pointsPg";

export interface PublicSettings {
  columns: ColumnKey[];
  leaderboards: BoardKey[];
  topN: number;
  /** Count games a player subbed into for another team. Off matches the master sheet. */
  includeSubGames: boolean;
  /** Leave players with fewer games than this off the leaderboards (per-game stats swing on one game). */
  minGames: number;
}

export interface PublicRow {
  name: string; group: string; team: string | null;
  gp: number; wins: number;
  goals: number; assists: number; secondAssists: number; blocks: number; touches: number;
  drops: number; throwaways: number; gso: number;
}

export interface Snapshot {
  v: 1;
  season: string;
  throughWeek: number;
  generatedAt: string;
  settings: PublicSettings;
  rows: PublicRow[];
}

type Def = { key: string; label: string; short?: string; value: (r: PublicRow) => number | null; perGame?: boolean };
const per = (n: number, r: PublicRow) => (r.gp ? n / r.gp : null);
const statsOf = (r: PublicRow) => r.goals + r.assists + r.secondAssists + r.blocks;

/** Columns in the order the master sheet shows them. */
export const COLUMNS: (Def & { key: ColumnKey })[] = [
  { key: "gp", label: "Games Played", short: "GP", value: (r) => r.gp },
  { key: "wins", label: "Wins", value: (r) => r.wins },
  { key: "goals", label: "Goals", value: (r) => r.goals },
  { key: "assists", label: "Assists", value: (r) => r.assists },
  { key: "points", label: "Total Points", value: (r) => r.goals + r.assists },
  { key: "secondAssists", label: "2nd Assists", value: (r) => r.secondAssists },
  { key: "blocks", label: "Blocks", value: (r) => r.blocks },
  { key: "stats", label: "Total Stats", value: statsOf },
  { key: "touches", label: "Touches", value: (r) => r.touches },
  { key: "drops", label: "Drops", value: (r) => r.drops },
  { key: "throwaways", label: "Throwaways", value: (r) => r.throwaways },
  { key: "gso", label: "GSO", value: (r) => r.gso },
  { key: "pointsPg", label: "Points/Game", value: (r) => per(r.goals + r.assists, r), perGame: true },
  { key: "statsPg", label: "Stats/Game", value: (r) => per(statsOf(r), r), perGame: true },
  { key: "touchesPg", label: "Touches/Game", value: (r) => per(r.touches, r), perGame: true },
];

export const BOARDS: (Def & { key: BoardKey })[] = [
  { key: "goalsPg", label: "Goals/Game", value: (r) => per(r.goals, r), perGame: true },
  { key: "assistsPg", label: "Assists/Game", value: (r) => per(r.assists, r), perGame: true },
  { key: "blocksPg", label: "D-Plays/Game", value: (r) => per(r.blocks, r), perGame: true },
  { key: "touchesPg", label: "Touches/Game", value: (r) => per(r.touches, r), perGame: true },
  { key: "secondAssistsPg", label: "2nd Assists/Game", value: (r) => per(r.secondAssists, r), perGame: true },
  { key: "statsPg", label: "Stats/Game", short: "goals + assists + 2nd assists + blocks", value: (r) => per(statsOf(r), r), perGame: true },
  { key: "pointsPg", label: "Points/Game", short: "goals + assists", value: (r) => per(r.goals + r.assists, r), perGame: true },
];

/** The master sheet's player-stats page: positive stats only, plus the per-game columns. */
export const DEFAULT_PUBLIC: PublicSettings = {
  columns: ["gp", "wins", "goals", "assists", "points", "secondAssists", "blocks", "stats", "touches", "pointsPg", "statsPg", "touchesPg"],
  leaderboards: ["goalsPg", "assistsPg", "blocksPg", "touchesPg", "secondAssistsPg", "statsPg"],
  topN: 5,
  includeSubGames: false,
  minGames: 1,
};

/** "F" → "F+", as the league labels its divisions; an open league has one board. */
export const groupLabel = (g: string) => (g === "F" ? "F+" : g === "M" ? "M+" : g === "X" || g === "?" ? "Open" : g);

export function buildSnapshot(name: string, input: LeagueInput, result: EngineResult, settings: PublicSettings): Snapshot {
  const w = input.throughWeek;
  const counted = (l: GameLine) => l.week <= w && (l.role === "rostered" || (settings.includeSubGames && l.role === "sub"));
  const rows = new Map<string, PublicRow>();
  const row = (player: string) => {
    let r = rows.get(player);
    if (!r) {
      const p = input.players.find((x) => x.name === player);
      r = { name: player, group: genderOf(p?.gender), team: result.teamOf(player, w + 1) ?? result.teamOf(player, w),
        gp: 0, wins: 0, goals: 0, assists: 0, secondAssists: 0, blocks: 0, touches: 0, drops: 0, throwaways: 0, gso: 0 };
      rows.set(player, r);
    }
    return r;
  };
  // Everyone on a roster appears, even with no games yet.
  for (const p of input.players) if (!p.isSub && !p.isPlug && (result.teamOf(p.name, w) ?? result.teamOf(p.name, w + 1))) row(p.name);
  for (const l of result.lines) {
    if (!counted(l)) continue;
    const r = row(l.player);
    // A tie counts as half a win, as on the master sheet (whose display rounds 3.5 up to 4).
    r.gp++; r.wins += l.result ?? 0;
    r.goals += l.goals; r.assists += l.assists; r.secondAssists += l.secondAssists; r.blocks += l.blocks;
    r.touches += l.touches; r.drops += l.drops; r.throwaways += l.throwaways; r.gso += l.gso;
  }
  return {
    v: 1, season: name, throughWeek: w, generatedAt: new Date().toISOString(), settings,
    rows: [...rows.values()].filter((r) => !input.players.find((p) => p.name === r.name)?.isPlug).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export interface Board { key: BoardKey; label: string; note?: string; top: { name: string; value: number }[] }
export interface GroupBoards { group: string; label: string; boards: Board[] }

/** Top N per gender group for each chosen per-game stat. */
export function leaderboards(s: Snapshot): GroupBoards[] {
  const groups = [...new Set(s.rows.map((r) => r.group))].sort((a, b) => (a === "F" ? -1 : b === "F" ? 1 : a.localeCompare(b)));
  return groups.map((g) => ({
    group: g, label: groupLabel(g),
    boards: BOARDS.filter((b) => s.settings.leaderboards.includes(b.key)).map((b) => ({
      key: b.key, label: b.label, note: b.short,
      top: s.rows.filter((r) => r.group === g && r.gp >= Math.max(1, s.settings.minGames))
        .map((r) => ({ name: r.name, value: b.value(r) ?? 0 }))
        .sort((x, y) => y.value - x.value || x.name.localeCompare(y.name))
        .slice(0, s.settings.topN),
    })),
  }));
}

/** Checks pasted text is a snapshot before it replaces what the public page shows. */
export function parseSnapshot(text: string): Snapshot {
  let d: any;
  try { d = JSON.parse(text); } catch { throw new Error("That isn't the copied stats. Copy them again from the Stats tab and paste the whole thing."); }
  if (d?.v !== 1 || !Array.isArray(d.rows) || !d.settings || typeof d.season !== "string") {
    throw new Error("That isn't the copied stats. Copy them again from the Stats tab and paste the whole thing.");
  }
  return d as Snapshot;
}

/** Whole numbers plain, per-game stats and half wins to one decimal. */
export const fmtStat = (v: number | null, perGame?: boolean) =>
  v === null ? "–" : perGame || !Number.isInteger(v) ? v.toFixed(1) : String(v);
