// How a season is stored online: one season document (rules, players, schedule, overrides; no
// plays) and one document per recording (one team's side of one game: its plays, plus that game's
// check-in ticks, flags and first-time subs). Stat-takers write only recordings, so everything a
// tablet adds at the field travels with its recording. These functions turn the documents into the
// app's Season and back; they're pure, so they're tested without Firebase.
import type { PlayEvent, Player } from "../../engine/types";
import { nameKey } from "./names";
import { weekOfDate, type SavedFlag, type Season } from "./season";

export interface RecordingDoc {
  /** The device that recorded it (its anonymous Firebase id). */
  uid: string;
  date: string; team: string; opp: string;
  status: "live" | "finished";
  events: PlayEvent[];
  /** First-time subs this recording added; moved into the season's players on the admin's next save. */
  newPlayers: Player[];
  /** Checked-in players with no plays the stat-taker ticked as present at Finish. */
  present: string[];
  flags: SavedFlag[];
  /** Who the tablet checked in (rostered players who showed, plus subs), and which were subs. */
  checkIn?: string[];
  subs?: string[];
}

/** The parts of a recording the season decides (the rest, uid and status, stay with the document). */
export type RecordingBody = Pick<RecordingDoc, "date" | "team" | "opp" | "events" | "newPlayers" | "present" | "flags">;

export const recKey = (date: string, team: string, opp: string) => `${date}|${team}|${opp}`;
/** A Firestore document id for a recording: readable, and without the "/" ids can't hold. */
export const recId = (date: string, team: string, opp: string) => `${date}__${team}__${opp}`.replace(/\//g, "∕");

/** The app's Season from the season document and its recordings. */
export function assemble(seasonDoc: Season, recs: RecordingDoc[]): Season {
  const sorted = [...recs].sort((a, b) => recKey(a.date, a.team, a.opp).localeCompare(recKey(b.date, b.team, b.opp)));
  const known = new Set(seasonDoc.input.players.map((p) => nameKey(p.name)));
  const added: Player[] = [];
  for (const r of sorted) for (const p of r.newPlayers ?? []) if (!known.has(nameKey(p.name))) { known.add(nameKey(p.name)); added.push(p); }
  const schedule = seasonDoc.input.schedule;
  const weeks = sorted.map((r) => weekOfDate(schedule, r.date)).filter((w): w is number => w !== null);
  return {
    ...seasonDoc,
    flags: [...(seasonDoc.flags ?? []), ...sorted.flatMap((r) => r.flags ?? [])],
    input: {
      ...seasonDoc.input,
      players: [...seasonDoc.input.players, ...added],
      events: sorted.flatMap((r) => r.events ?? []),
      throughWeek: Math.max(seasonDoc.input.throughWeek, ...weeks),
      presentWithoutPlays: [
        ...(seasonDoc.input.presentWithoutPlays ?? []),
        ...sorted.flatMap((r) => {
          const week = weekOfDate(schedule, r.date);
          return week === null ? [] : (r.present ?? []).map((player) => ({ week, team: r.team, opp: r.opp, player }));
        }),
      ],
    },
  };
}

/** The season document and the recordings' bodies for a Season, keyed by recording id. */
export function split(season: Season): { seasonDoc: Season; recs: Map<string, RecordingBody> } {
  const recs = new Map<string, RecordingBody>();
  const byKey = new Map<string, RecordingBody>();
  for (const e of season.input.events) {
    const k = recKey(e.date, e.statTeam, e.otherTeam);
    let r = byKey.get(k);
    if (!r) {
      r = { date: e.date, team: e.statTeam, opp: e.otherTeam, events: [], newPlayers: [], present: [], flags: [] };
      byKey.set(k, r); recs.set(recId(e.date, e.statTeam, e.otherTeam), r);
    }
    r.events.push(e);
  }
  const schedule = season.input.schedule;
  const recFor = (week: number, team: string, opp: string) =>
    [...byKey.values()].find((r) => r.team === team && r.opp === opp && weekOfDate(schedule, r.date) === week);
  const restPresent = (season.input.presentWithoutPlays ?? []).filter((x) => {
    const r = recFor(x.week, x.team, x.opp);
    if (r) r.present.push(x.player);
    return !r;
  });
  const restFlags = (season.flags ?? []).filter((f) => {
    const r = byKey.get(recKey(f.date, f.team, f.opp));
    if (r) r.flags.push(f);
    return !r;
  });
  return {
    seasonDoc: { ...season, flags: restFlags, input: { ...season.input, events: [], presentWithoutPlays: restPresent } },
    recs,
  };
}

/** JSON with object keys sorted, so documents read back from Firestore compare equal. */
export function stable(v: unknown): string {
  return JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, x[k]])) : x));
}
