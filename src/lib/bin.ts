// Deleted recordings. A recording a tablet discards, or an admin deletes or replaces, is copied
// into the season's bin in the same write that removes it, so an admin can bring it back:
//   leagues/{league}/seasons/{season}/bin/{id}   one BinDoc per removed copy
// Nothing is ever lost by a tap: only an admin emptying the bin removes a recording for good.
import type { PlayEvent } from "../../engine/types";
import { recId, stable, type RecordingDoc } from "./onlineShape";

export type BinWhy = "discarded" | "deleted" | "replaced";

export interface BinDoc extends RecordingDoc {
  /** The recording's own id (date__team__opp), where Restore puts it back. */
  recId: string;
  /** When it went into the bin (this device's clock), ms since 1970. */
  binnedAtMs: number;
  /** The device that removed it. */
  binnedBy: string;
  why: BinWhy;
}

/** A bin id that sorts by time and never collides with another copy of the same game. */
export const binId = (rid: string, ms: number) => `${rid}__${ms}`;

/** The bin copy of a recording. */
export function toBin(rec: RecordingDoc, why: BinWhy, by: string, ms: number): BinDoc {
  return {
    uid: rec.uid, status: rec.status, date: rec.date, team: rec.team, opp: rec.opp,
    events: rec.events ?? [], newPlayers: rec.newPlayers ?? [], present: rec.present ?? [], flags: rec.flags ?? [],
    ...(rec.checkIn ? { checkIn: rec.checkIn } : {}), ...(rec.subs ? { subs: rec.subs } : {}),
    recId: recId(rec.date, rec.team, rec.opp), binnedAtMs: ms, binnedBy: by, why,
  };
}

/** The recording a bin copy restores to. */
export function fromBin(b: BinDoc): RecordingDoc {
  const { recId: _r, binnedAtMs: _t, binnedBy: _b, why: _w, ...rec } = b;
  return { ...rec, status: "finished" };
}

/** Whether replacing `before` with `after` drops any play (an edit or a re-upload, not just new plays). */
export function losesPlays(before: PlayEvent[] = [], after: PlayEvent[] = []) {
  if (!before.length) return false;
  const kept = new Map<string, number>();
  for (const e of after) { const k = stable(e); kept.set(k, (kept.get(k) ?? 0) + 1); }
  for (const e of before) {
    const k = stable(e), n = kept.get(k) ?? 0;
    if (!n) return true;
    kept.set(k, n - 1);
  }
  return false;
}

/** What's wrong with a stored bin copy (empty when it's usable). */
export function binProblems(d: any): string[] {
  if (!d || typeof d !== "object") return ["Not a deleted recording."];
  const out: string[] = [];
  if (typeof d.date !== "string" || typeof d.team !== "string" || typeof d.opp !== "string") out.push("It doesn't say which game it was.");
  if (!Array.isArray(d.events)) out.push("It has no plays.");
  if (typeof d.recId !== "string" || typeof d.binnedAtMs !== "number") out.push("It doesn't say where or when it came from.");
  if (!["discarded", "deleted", "replaced"].includes(d.why)) out.push("It doesn't say how it was removed.");
  return out;
}

export const WHY_LABEL: Record<BinWhy, string> = {
  discarded: "Discarded on a tablet",
  deleted: "Deleted by an admin",
  replaced: "Replaced (an older version)",
};
