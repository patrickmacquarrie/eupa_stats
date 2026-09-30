import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { computeLeague } from "../../engine/compute";
import type { EngineResult, LeagueInput, RecordingSummary } from "../../engine/types";
import type { Season } from "./season";
import { loadSeason, saveSeason } from "./store";

export interface Game {
  week: number;
  /** Teams in a stable order (alphabetical). */
  a: string; b: string;
  recA?: RecordingSummary; recB?: RecordingSummary;
}

interface Ctx {
  season: Season;
  result: EngineResult;
  games: Game[];
  computeMs: number;
  /** Replace the season's inputs; the engine reruns and the change is saved. */
  update: (fn: (input: LeagueInput) => LeagueInput, patch?: Partial<Pick<Season, "name">>) => Promise<void>;
}

const SeasonCtx = createContext<Ctx | null>(null);

export function useSeason() {
  const c = useContext(SeasonCtx);
  if (!c) throw new Error("useSeason outside SeasonProvider");
  return c;
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

/**
 * Team payroll after `week`: every rostered (non-sub) player on the team for the next week's
 * games, plus any team result bonus that counts against the cap.
 */
export function teamPayroll(input: LeagueInput, res: EngineResult, week: number) {
  const out: Record<string, number> = {};
  for (const t of input.teams) if (!t.isSubTeam) out[t.name] = res.teamBonus[t.name]?.[week] ?? 0;
  for (const p of input.players) {
    const t = res.teamOf(p.name, week + 1);
    if (!t || p.isSub || !(t in out)) continue;
    out[t] += res.salary[p.name][week];
  }
  return out;
}

export function useComputed(input: LeagueInput | undefined) {
  return useMemo(() => {
    if (!input) return null;
    const t0 = performance.now();
    const result = computeLeague(input);
    return { result, games: gamesOf(result.recordings), computeMs: performance.now() - t0 };
  }, [input]);
}

export function SeasonProvider({ id, children }: { id: string; children: ReactNode }) {
  const [season, setSeason] = useState<Season | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setSeason(undefined);
    loadSeason(id).then((s) => live && setSeason(s ?? null));
    return () => { live = false; };
  }, [id]);

  const computed = useComputed(season?.input);

  const update = useCallback<Ctx["update"]>(async (fn, patch) => {
    if (!season) return;
    const next = await saveSeason({ ...season, ...patch, input: fn(season.input) });
    setSeason(next);
  }, [season]);

  if (season === undefined) return <p className="muted pad">Loading season…</p>;
  if (season === null || !computed) return <p className="pad">That season isn't in this browser. <a href="#/">Back to seasons</a></p>;
  return (
    <SeasonCtx.Provider value={{ season, update, ...computed }}>
      {children}
    </SeasonCtx.Provider>
  );
}
