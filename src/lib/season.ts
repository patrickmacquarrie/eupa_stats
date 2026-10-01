// A season as the app stores it: the engine's raw inputs plus a little metadata.
// Nothing derived (salaries, cap, box scores) is stored; the engine rebuilds it on load.
import type { BoxScore, LeagueInput, PlayEvent } from "../../engine/types";
import type { Alias } from "./names";
import type { PublicSettings } from "./publicStats";
import { seasonInputProblems, summarize } from "./validate";

/** Bump when the stored shape changes, and add a step to `migrateSeason`. */
export const SEASON_SCHEMA = 1;

export interface Season {
  /** Shape version of this record (absent on exports made before versioning: treated as 0). */
  schemaVersion?: number;
  id: string;
  name: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  input: LeagueInput;
  /** Recorded spellings mapped to players (typos, old "Name Sub" records). */
  aliases?: Alias[];
  /** Name flags the admin dismissed: a spelling, or "a|b" for a pair of players that really are different people. */
  ignoredNames?: string[];
  /** Possessions a stat-taker flagged as wrong, for the admin to check. Indexes are within that recording. */
  flags?: SavedFlag[];
  /** What the player-facing stats page shows. */
  publicStats?: PublicSettings;
  /** Default game length for new recordings, in minutes. */
  gameLengthMin?: number;
  /** Fill in a match for every sub without a saved pick (see autoMatch.ts). Missing means on. */
  autoMatchSubs?: boolean;
}

export const autoMatchOn = (s: Pick<Season, "autoMatchSubs">) => s.autoMatchSubs !== false;

export interface SavedFlag {
  date: string; team: string; opp: string;
  start: number; end: number; clock: string;
  note?: string;
  resolved?: boolean;
}

/** Flags on a recording that's being replaced or deleted no longer point at the right plays. */
export const withoutFlagsFor = (flags: SavedFlag[] | undefined, keys: Set<string>) =>
  (flags ?? []).filter((f) => !keys.has(`${f.date}|${f.team}|${f.opp}`));

export interface SeasonMeta { id: string; name: string; source: string; updatedAt: string }

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Master-sheet rows for one team-side of a game, as an admin box score. */
function boxScoresFrom(entries: any[], only?: Set<string>): BoxScore[] {
  const groups = new Map<string, any[]>();
  for (const e of entries) {
    const g = `${e.week}|${e.team}|${e.opp}`;
    if (only && !only.has(g)) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(e);
  }
  return [...groups.values()].map((rows) => {
    const played = rows.filter((r) => r.played === 1);
    return {
      week: rows[0].week, team: rows[0].team, opp: rows[0].opp,
      result: played.find((r) => r.win !== null)?.win ?? 0,
      lines: played.map((r) => ({ player: r.player, goals: r.goals, assists: r.assists, secondAssists: r.secondAssists,
        blocks: r.blocks, drops: r.drops, throwaways: r.throwaways, gso: r.gso, touches: r.touches })),
    };
  });
}

export const weekOfDate = (schedule: { week: number; date: string }[], date: string) =>
  [...schedule].sort((a, b) => a.date.localeCompare(b.date)).filter((s) => s.date <= date).pop()?.week ?? null;

/**
 * Converts a master-sheet fixture (scripts/extract_fixture.py output) into a season, the same
 * way scripts/validate.ts does in "events" mode: the raw event log is the source of truth,
 * recordings with no events come in as box scores, and the sheet's sub picks become assignments.
 */
export function seasonFromFixture(fx: any, name?: string): { season: Season; notes: string[] } {
  const notes: string[] = [];
  const gmTeam: Record<string, string> = Object.fromEntries(fx.teams.map((t: any) => [t.gm, t.name]));
  const entries = (fx.sheetEntries ?? []) as any[];
  const throughWeek = entries.length ? Math.max(...entries.map((e) => e.week)) : fx.currentWeek ?? 1;
  const events: PlayEvent[] = fx.events ?? [];
  // The sheets' schedule block also holds time-slot rows ("19:20-19:45"); only dated rows are weeks.
  const schedule = (fx.schedule as { week: number; date: string }[]).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date));
  // Some sheets never filled in week 1's date; take it from the earliest recording before week 2.
  const first = [...schedule].sort((a, b) => a.week - b.week)[0];
  const earliest = events.map((e) => e.date).sort()[0];
  if (first && first.week > 1 && earliest && earliest < first.date) {
    schedule.push({ week: first.week - 1, date: earliest });
    notes.push(`Week ${first.week - 1} had no date in the sheet; using the earliest recording (${earliest}).`);
  }
  const have = new Set(events.map((e) => `${weekOfDate(schedule, e.date)}|${e.statTeam}|${e.otherTeam}`));
  const lost = new Set(entries.map((e) => `${e.week}|${e.team}|${e.opp}`).filter((g) => !have.has(g)));
  if (lost.size) notes.push(`${lost.size} recording(s) had no events and were loaded from the sheet as box scores.`);

  const input: LeagueInput = {
    rules: {
      ...fx.league,
      absence: { ...fx.league.absence, thereafter: "seasonAvgRetroactive" },
      plugMode: "asAbsentPlayer",
    },
    teams: fx.teams,
    players: fx.players.map((p: any) => ({ ...p, isPlug: p.isPlug ?? (/extra/i.test(p.name) && !p.isSub) })),
    // A trade takes effect the first week the sheet shows the player on the new team
    // (the logged "after week" is sometimes a week early), else the week after.
    trades: (fx.trades ?? []).map((t: any) => {
      const toTeam = t.toTeam !== undefined ? t.toTeam : gmTeam[t.toGm] ?? null;
      const seen = entries.filter((e) => e.player.toLowerCase() === t.player.toLowerCase() && e.team === toTeam && e.week > t.afterWeek)
        .map((e) => e.week);
      return { afterWeek: t.afterWeek, effectiveWeek: t.effectiveWeek ?? (seen.length ? Math.min(...seen) : t.afterWeek + 1),
        player: t.player, toTeam, playerAdd: t.playerAdd };
    }),
    schedule,
    events,
    boxScores: boxScoresFrom(entries, lost),
    subAssignments: entries.filter((e) => e.subbedFor).map((e) => ({
      week: e.week, team: e.team, opp: e.opp, sub: e.player, subbedFor: e.subbedFor })),
    throughWeek,
  };
  const now = new Date().toISOString();
  return {
    season: { schemaVersion: SEASON_SCHEMA, id: newId(), name: name ?? String(fx.source ?? "Imported season"), source: String(fx.source ?? ""), createdAt: now, updatedAt: now, input },
    notes,
  };
}

/** Accepts either an exported season or a raw master-sheet fixture. */
/**
 * Brings a stored or exported season up to the current shape, one version at a time.
 * v0 → v1: versioning added; optional fields get their defaults.
 */
export function migrateSeason(raw: any): Season {
  const v = raw?.schemaVersion ?? 0;
  if (typeof v !== "number" || v > SEASON_SCHEMA) {
    throw new Error("This season was saved by a newer version of the app. Update the app, then import it again.");
  }
  let s = { ...raw };
  if (v < 1) s = { ...s, aliases: s.aliases ?? [], ignoredNames: s.ignoredNames ?? [], flags: s.flags ?? [], schemaVersion: 1 };
  return s as Season;
}

/** Checks a season before it's stored; throws with the first problems in plain words. */
export function checkSeason(season: Season): string[] {
  if (typeof season.name !== "string" || !season.name.trim()) throw new Error("The season has no name.");
  if (season.autoMatchSubs !== undefined && typeof season.autoMatchSubs !== "boolean") throw new Error("The season's auto-match subs setting is damaged.");
  const problems = seasonInputProblems(season.input);
  const blocking = problems.filter((p) => p.blocking);
  if (blocking.length) throw new Error(`This season can't be used as it is:\n${summarize(blocking).join("\n")}`);
  const warnings = problems.filter((p) => !p.blocking);
  return warnings.length ? [`Imported with ${warnings.length} warning(s): ${summarize(warnings, 3).join(" ")}`] : [];
}

/** Accepts either an exported season or a raw master-sheet fixture. */
export function seasonFromJson(data: any, fallbackName: string): { season: Season; notes: string[] } {
  if (data?.input && typeof data.input === "object") {
    const now = new Date().toISOString();
    const season = migrateSeason({ ...data, id: newId(), name: typeof data.name === "string" && data.name.trim() ? data.name : fallbackName, updatedAt: now });
    return { season, notes: checkSeason(season) };
  }
  if (data?.league && Array.isArray(data?.players) && Array.isArray(data?.teams)) {
    const r = seasonFromFixture(data, fallbackName);
    return { season: r.season, notes: [...r.notes, ...checkSeason(r.season)] };
  }
  throw new Error("That file isn't a season exported from this app or a master-sheet fixture.");
}

/** Groups the event log into recordings: one per game night per tracked team. */
export function recordingsOf(events: PlayEvent[]) {
  const recs = new Map<string, PlayEvent[]>();
  for (const e of events) {
    const k = `${e.date}|${e.statTeam}|${e.otherTeam}`;
    if (!recs.has(k)) recs.set(k, []);
    recs.get(k)!.push(e);
  }
  return recs;
}
