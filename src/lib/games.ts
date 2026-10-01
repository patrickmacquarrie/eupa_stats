// Games from recordings: both teams' sides of one game, paired. Pure, so the standalone stats
// page can use it without the rest of the app.
import type { RecordingSummary } from "../../engine/types";

export interface Game {
  week: number;
  /** Teams in a stable order (alphabetical). */
  a: string; b: string;
  recA?: RecordingSummary; recB?: RecordingSummary;
}

export function gamesOf(recordings: RecordingSummary[]): Game[] {
  const m = new Map<string, Game>();
  for (const r of recordings) {
    const [a, b] = [r.team, r.opp].sort();
    const k = `${r.week}|${a}|${b}`;
    const g = m.get(k) ?? { week: r.week, a, b };
    if (r.team === a) g.recA = r; else g.recB = r;
    m.set(k, g);
  }
  return [...m.values()].sort((x, y) => x.week - y.week || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}
