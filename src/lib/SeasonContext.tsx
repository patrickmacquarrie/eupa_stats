import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { computeLeague } from "../../engine/compute";
import { gamesOf } from "./games";
import type { EngineResult, LeagueInput, RecordingSummary } from "../../engine/types";
import { aliasMap, findNameIssues, resolveInput } from "./names";
import { openItems, provisionalWeeks, type OpenItem } from "./review";
import { computeWithAutoMatch } from "./autoMatch";
import type { Game } from "./games";
export { gamesOf, type Game } from "./games";
import type { PairingFlag } from "../../engine/pairing";
import type { SubAssignment } from "../../engine/types";
import { autoMatchOn, type SavedFlag, type Season } from "./season";
import type { Draft } from "./recorder";
import { downloadJson, loadSeason, saveSeason } from "./store";


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
  /** Subs (autoMatch.subKey) whose match auto-match made rather than the admin. */
  autoMatched: Set<string>;
  /** Subs auto-match couldn't place, with why (empty when auto-match is off). */
  unmatched: PairingFlag[];
  /** Maps a stored spelling to the player it counts for. */
  resolveName: (n: string) => string;
  games: Game[];
  computeMs: number;
  /** Replace the season's inputs; the engine reruns and the change is saved. */
  update: (fn: (input: LeagueInput) => LeagueInput, patch?: Partial<Pick<Season, "name">>) => Promise<void>;
  updateSeason: (fn: (s: Season) => Season) => Promise<void>;
  /** Route to this season: "/s/{id}" in this browser, "/l/{league}/s/{id}" online. */
  base: string;
  /** Where Track Stats keeps this device's draft. */
  draftKey: string;
  /** This device may change the season (always, for a season kept only in this browser). */
  canAdmin: boolean;
  /** This device may record games. */
  canRecord: boolean;
  /** Set for a season online. */
  online?: OnlineCtx;
}

/** What Track Stats and the Games page need from an online season (Firebase stays out of their chunks). */
export interface OnlineCtx {
  slug: string;
  role: "stat" | "admin" | null;
  /** Today's recordings still being recorded, by week|team|opp. */
  live: Set<string>;
  /** Recordings from an earlier day whose tablet never pressed Finish. Their plays are in. */
  unfinished: { date: string; team: string; opp: string }[];
  /** Admin: marks a recording finished when its tablet never did. */
  markFinished: (d: { date: string; team: string; opp: string }) => Promise<void>;
  /** The device that recorded each recording, by date|team|opp. */
  owners: Map<string, string>;
  uid: string;
  pushRecording: (d: Draft, status: "live" | "finished", extra?: { present?: string[]; flags?: SavedFlag[] }) => Promise<void>;
  deleteRecording: (d: Pick<Draft, "date" | "team" | "opp">) => Promise<void>;
  /** Calls back with true when this device's writes to the recording have reached the server. */
  watchSynced: (d: Pick<Draft, "date" | "team" | "opp">, onSynced: (synced: boolean) => void) => () => void;
}

const SeasonCtx = createContext<Ctx | null>(null);

export function useSeason() {
  const c = useContext(SeasonCtx);
  if (!c) throw new Error("useSeason outside SeasonProvider");
  return c;
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

/** Each season's latest auto-matches, to start the next calculation from. */
const lastAuto = new Map<string, SubAssignment[]>();

export function useComputed(season: Season | null | undefined) {
  return useMemo(() => {
    if (!season) return null;
    const t0 = performance.now();
    const resolved = resolveInput(season.input, season.aliases);
    let input = resolved, result, autoMatched = new Set<string>(), unmatched: PairingFlag[] = [];
    try {
      if (autoMatchOn(season)) {
        // Start from this season's last answer: usually that makes it one engine run.
        const r = computeWithAutoMatch(resolved, lastAuto.get(season.id));
        ({ input, result, unmatched } = r);
        autoMatched = r.auto;
        lastAuto.set(season.id, r.input.subAssignments.slice(resolved.subAssignments.length));
      } else result = computeLeague(resolved);
    } catch (e) { return { error: (e as Error).message } as const; }
    const computeMs = performance.now() - t0;
    const issues = findNameIssues(season.input, season.aliases, season.ignoredNames);
    const nameIssueCount = issues.unknown.length + issues.subRecords.length + issues.dupes.length;
    const games = gamesOf(result.recordings);
    const open = openItems(season, input, result, games);
    return { input, result, games, computeMs, nameIssueCount, open, provisional: provisionalWeeks(open), resolveName: aliasMap(season.aliases), autoMatched, unmatched };
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

  // A failed save must not lose the change on screen: keep it, and say it isn't stored yet.
  const [saveError, setSaveError] = useState<string | null>(null);
  const persist = useCallback(async (next: Season) => {
    setSeason(next);
    try { setSeason(await saveSeason(next)); setSaveError(null); }
    catch (e) { setSaveError((e as Error).message); }
  }, []);
  const [loadError, setLoadError] = useState<string | null>(null);

  if (season === undefined) return <p className="muted pad">Loading season…</p>;
  if (season === null) return <p className="pad">{loadError ?? "That season isn't in this browser."} <a href="#/">Back to seasons</a></p>;
  return (
    <SeasonView season={season} persist={persist} saveError={saveError} base={`/s/${season.id}`} draftKey={season.id} canAdmin canRecord>
      {children}
    </SeasonView>
  );
}

/**
 * Computes a season and provides it to every screen, whether it's kept in this browser or online.
 * `persist` stores a changed season; `saveError` says why the last store failed.
 */
export function SeasonView({ season, persist, saveError, base, draftKey, canAdmin, canRecord, online, children }: {
  season: Season; persist: (next: Season) => Promise<void>; saveError: string | null;
  base: string; draftKey: string; canAdmin: boolean; canRecord: boolean; online?: OnlineCtx; children: ReactNode;
}) {
  const computed = useComputed(season);
  const update = useCallback<Ctx["update"]>(async (fn, patch) => { await persist({ ...season, ...patch, input: fn(season.input) }); }, [season, persist]);
  const updateSeason = useCallback<Ctx["updateSeason"]>(async (fn) => { await persist(fn(season)); }, [season, persist]);

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
    <SeasonCtx.Provider value={{ season, update, updateSeason, base, draftKey, canAdmin, canRecord, online, ...computed }}>
      {saveError && (
        <div className="save-error" role="alert">
          <strong>Not saved.</strong> {saveError.replace(/^Not saved: /, "")} {online ? "" : "Your changes are on this screen only: export the season now to keep them."}
          <button className="small-btn" onClick={() => downloadJson(`${season.name}.json`, season)}>Export</button>
          <button className="small-btn" onClick={() => persist(season)}>Try again</button>
        </div>
      )}
      {!online && season.movedOnline && (
        <div className="moved-note" role="note">
          This is this browser's copy. The season was moved online to the league “{season.movedOnline.slug}”, and changes here don't reach it.{" "}
          <a href={`#/l/${season.movedOnline.slug}/s/${season.id}`}>Open the online season</a>
        </div>
      )}
      {children}
    </SeasonCtx.Provider>
  );
}
