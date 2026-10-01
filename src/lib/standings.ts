// Team standings from the games played so far. Each team's result comes from its own side's
// recording (or the official score, which the engine applies to both sides). When only one
// side was recorded, the other side's result is the mirror of it.
import type { RecordingSummary } from "../../engine/types";
import type { Game } from "./SeasonContext";

export interface Standing {
  team: string;
  played: number; wins: number; losses: number; ties: number;
  goalsFor: number; goalsAgainst: number;
  /** Games whose score isn't known (a box score with only a result), left out of GF/GA. */
  noScore: number;
}

/** One team's side of a game: its own recording, or the other side's flipped. */
function sideOf(own?: RecordingSummary, other?: RecordingSummary) {
  if (own) return { result: own.result, gf: own.finalScore, ga: own.finalOppScore };
  if (other) return { result: 1 - other.result, gf: other.finalOppScore, ga: other.finalScore };
  return null;
}

export function standings(teams: string[], games: Game[], throughWeek: number): Standing[] {
  const rows = new Map(teams.map((team) => [team, { team, played: 0, wins: 0, losses: 0, ties: 0, goalsFor: 0, goalsAgainst: 0, noScore: 0 }]));
  for (const g of games) {
    if (g.week > throughWeek) continue;
    for (const [team, own, other] of [[g.a, g.recA, g.recB], [g.b, g.recB, g.recA]] as const) {
      const row = rows.get(team), s = sideOf(own, other);
      if (!row || !s) continue;
      row.played++;
      if (s.result === 1) row.wins++; else if (s.result === 0) row.losses++; else row.ties++;
      if (Number.isFinite(s.gf) && Number.isFinite(s.ga)) { row.goalsFor += s.gf; row.goalsAgainst += s.ga; }
      else row.noScore++;
    }
  }
  const pct = (r: Standing) => (r.played ? (r.wins + r.ties / 2) / r.played : 0);
  return [...rows.values()].sort((x, y) =>
    pct(y) - pct(x) || (y.goalsFor - y.goalsAgainst) - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor || x.team.localeCompare(y.team));
}

/** "3–1" or "3–1–1" (ties only when there are any in the league). */
export const recordText = (r: Standing, showTies: boolean) => `${r.wins}–${r.losses}${showTies ? `–${r.ties}` : ""}`;
