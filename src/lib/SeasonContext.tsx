import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { computeLeague } from "../../engine/compute";
import type { EngineResult, LeagueInput, RecordingSummary } from "../../engine/types";
import { aliasMap, findNameIssues, resolveInput } from "./names";
import { openItems, provisionalWeeks, type OpenItem } from "./review";
import type { Season } from "./season";
import { downloadJson, loadSeason, saveSeason } from "./store";

export interface Game {
  week: number;
  /** Teams in a stable order (alphabetical). */
  a: string; b: string;
  recA?: RecordingSummary; recB?: RecordingSummary;
}

interface Ctx {
  season: Season;
  /** What the engine sees: the season's input with recorded names resolved through its aliases. */
  input: LeagueInput;
  result: EngineResult;
  /** Names that need a look (unknown spellings, old "Sub" records, likely duplicates). */
  nameIssueCount: number;
  /** What still needs an administrator, by week; a week with any is provisional. */
  open: OpenItem[];
  provisional: number[];
  /** Maps a stored spelling to the player it counts for. */
  resolveName: (n: string) => string;
  games: Game[];
  computeMs: number;
  /** Replace the season's inputs; the engine reruns and the change is saved. */
  update: (fn: (input: LeagueInput) => LeagueInput, patch?: Partial<Pick<Season, "name">>) => Promise<void>;
  updateSeason: (fn: (s: Season) => Season) => Promise<void>;
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

export function useComputed(season: Season | null | undefined) {
  return useMemo(() => {
    if (!season) return null;
    const t0 = performance.now();
    const input = resolveInput(season.input, season.aliases);
    let result;
    try { result = computeLeague(input); } catch (e) { return { error: (e as Error).message } as const; }
    const computeMs = performance.now() - t0;
    const issues = findNameIssues(season.input, season.aliases, season.ignoredNames);
    const nameIssueCount = issues.unknown.length + issues.subRecords.length + issues.dupes.length;
    const games = gamesOf(result.recordings);
    const open = openItems(season, input, result, games);
    return { input, result, games, computeMs, nameIssueCount, open, provisional: provisionalWeeks(open), resolveName: aliasMap(season.aliases) };
  }, [season]);
}

export function SeasonProvider({ id, children }: { id: string; children: ReactNode }) {
  const [season, setSeason] = useState<Season | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setSeason(undefined);
    loadSeason(id).then((s) => live && setSeason(s ?? null)).catch((e) => { if (live) { setLoadError((e as Error).message); setSeason(null); } });
    return () => { live = false; };
  }, [id]);

  const computed = useComputed(season);

  // A failed save must not lose the change on screen: keep it, and say it isn't stored yet.
  const [saveError, setSaveError] = useState<string | null>(null);
  const persist = useCallback(async (next: Season) => {
    setSeason(next);
    try { setSeason(await saveSeason(next)); setSaveError(null); }
    catch (e) { setSaveError((e as Error).message); }
  }, []);
  const update = useCallback<Ctx["update"]>(async (fn, patch) => {
    if (season) await persist({ ...season, ...patch, input: fn(season.input) });
  }, [season, persist]);
  const updateSeason = useCallback<Ctx["updateSeason"]>(async (fn) => {
    if (season) await persist(fn(season));
  }, [season, persist]);
  const [loadError, setLoadError] = useState<string | null>(null);

  if (season === undefined) return <p className="muted pad">Loading season…</p>;
  if (season === null) return <p className="pad">{loadError ?? "That season isn't in this browser."} <a href="#/">Back to seasons</a></p>;
  if (!computed) return null;
  if ("error" in computed) {
    return (
      <main className="page narrow"><section className="card crash" role="alert">
        <h1>This season's numbers can't be calculated</h1>
        <pre className="crash-msg">{computed.error}</pre>
        <p>Its data is still stored. Export it to keep a copy, then fix the rules or data it names.</p>
        <div className="row gap-sm"><button className="primary" onClick={() => downloadJson(`${season.name}.json`, season)}>Export this season</button><a href="#/">Back to seasons</a></div>
      </section></main>
    );
  }
  return (
    <SeasonCtx.Provider value={{ season, update, updateSeason, ...computed }}>
      {saveError && (
        <div className="save-error" role="alert">
          <strong>Not saved.</strong> {saveError.replace(/^Not saved: /, "")} Your changes are on this screen only: export the season now to keep them.
          <button className="small-btn" onClick={() => downloadJson(`${season.name}.json`, season)}>Export</button>
          <button className="small-btn" onClick={() => persist(season)}>Try again</button>
        </div>
      )}
      {children}
    </SeasonCtx.Provider>
  );
}
