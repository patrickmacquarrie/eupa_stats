// Editing a saved recording play by play. Old recordings don't always follow the tablet app's
// own chain rules (Thursday S1 has touches with no thrower mid-possession, for one), and the
// engine counts assists from exactly what was recorded. So an edit recomputes only what it
// touches: the rest of that possession's assist chain, and the score from that play onward.
// Every other play keeps what the tablet recorded.
import type { PlayEvent } from "../../engine/types";
import { canTap, stateOf, type Phase, type Tap } from "./recorder";

export type Action = "Touch" | "Point" | "Drop" | "T-Away" | "D-Play" | "GSO" | "O-Error";
export const ACTIONS: { action: Action; label: string }[] = [
  { action: "Touch", label: "Touch" }, { action: "Point", label: "Point" }, { action: "Drop", label: "Drop" },
  { action: "T-Away", label: "Throwaway" }, { action: "D-Play", label: "D-Play" }, { action: "GSO", label: "GSO" },
  { action: "O-Error", label: "Offensive error" },
];
/** Actions whose player is picked; Point and Throwaway belong to whoever had the disc. */
export const PICKS_PLAYER = new Set<string>(["Touch", "Drop", "D-Play", "GSO"]);
const ENDS = new Set(["Point", "Drop", "T-Away", "D-Play", "O-Error", "GSO"]);

/** A play in the editor. `orig` is its index in the saved recording, or null if inserted. */
export interface Row { uid: number; orig: number | null; e: PlayEvent }

let nextUid = 1_000_000;
export const rowsOf = (events: PlayEvent[]): Row[] => events.map((e, i) => ({ uid: i, orig: i, e }));

/** Holder and the two previous throwers just before `i`, as recorded. */
function chainBefore(rows: Row[], i: number): (string | null)[] {
  const prev = rows[i - 1]?.e;
  return prev?.action === "Touch" ? [prev.player ?? null, prev.lastPlayer ?? null, prev.secLastPlayer ?? null] : [];
}

/** Running count of Points and GSOs up to and including each row. */
function counts(rows: Row[]) {
  const out = new Map<number, [number, number]>();
  let us = 0, them = 0;
  for (const r of rows) {
    if (r.e.action === "Point") us++;
    if (r.e.action === "GSO") them++;
    out.set(r.uid, [us, them]);
  }
  return out;
}

/**
 * After an edit at `from`: re-derive players/assists to the end of that possession (or of the
 * possession holding `through`, when several were replaced), and shift
 * each later play's recorded score by however many Points/GSOs the edit added or removed before
 * it. Scores are shifted, never recomputed, because old recordings carry quirks (the scorer's
 * Touch showing the new score a moment early, sometimes as the recording's last play) that
 * decide the final score.
 */
function repair(before: Row[], rows: Row[], from: number, through = from): Row[] {
  const out = rows.map((r) => ({ ...r, e: { ...r.e } }));
  let chain = chainBefore(out, from);
  for (let j = from; j < out.length; j++) {
    const e = out[j].e;
    if (e.action === "Touch") { e.lastPlayer = chain[0] ?? null; e.secLastPlayer = chain[1] ?? null; chain = [e.player ?? null, chain[0] ?? null, chain[1] ?? null]; continue; }
    if (e.action === "Point") { if (chain[0]) e.player = chain[0]; e.lastPlayer = chain[1] ?? null; e.secLastPlayer = chain[2] ?? null; }
    if (e.action === "Drop") { e.lastPlayer = chain[0] ?? null; e.secLastPlayer = chain[1] ?? null; }
    if (e.action === "T-Away" && chain[0]) e.player = chain[0];
    if (["D-Play", "GSO", "O-Error"].includes(e.action)) { e.lastPlayer = null; e.secLastPlayer = null; }
    if (e.action === "O-Error") e.player = null;
    if (ENDS.has(e.action)) { if (j >= through) break; chain = []; }
  }
  const was = counts(before), now = counts(out);
  for (let j = 0; j < out.length; j++) {
    const r = out[j];
    const [us, them] = now.get(r.uid)!;
    const old = was.get(r.uid);
    if (old) { r.e.statScore += us - old[0]; r.e.otherScore += them - old[1]; continue; }
    // An inserted play: the score after the last non-Touch play before it (a Touch may carry the
    // old app's early bump), plus the Points/GSOs from there up to and including this one.
    let b = j - 1;
    while (b >= 0 && out[b].e.action === "Touch") b--;
    let us2 = b >= 0 ? out[b].e.statScore : 0, them2 = b >= 0 ? out[b].e.otherScore : 0;
    for (let x = b + 1; x <= j; x++) { if (out[x].e.action === "Point") us2++; if (out[x].e.action === "GSO") them2++; }
    r.e.statScore = us2; r.e.otherScore = them2;
  }
  return out;
}

export function setPlayer(rows: Row[], i: number, player: string | null): Row[] {
  return repair(rows, rows.map((r, j) => (j === i ? { ...r, e: { ...r.e, player } } : r)), i);
}

export function setAction(rows: Row[], i: number, action: Action, player?: string | null): Row[] {
  return repair(rows, rows.map((r, j) => (j === i ? { ...r, e: { ...r.e, action, player: PICKS_PLAYER.has(action) ? (player ?? r.e.player ?? null) : r.e.player } } : r)), i);
}

export function removeRow(rows: Row[], i: number): Row[] {
  return repair(rows, rows.filter((_, j) => j !== i), i);
}

/** Inserts a play before index `i` (i = rows.length appends), timed like its neighbour. */
export function insertRow(rows: Row[], i: number, action: Action, player: string | null): Row[] {
  const near = rows[i]?.e ?? rows[i - 1]?.e;
  if (!near) throw new Error("Nothing to insert next to");
  const e: PlayEvent = { ...near, action, player: PICKS_PLAYER.has(action) ? player : null, lastPlayer: null, secLastPlayer: null };
  return repair(rows, [...rows.slice(0, i), { uid: nextUid++, orig: null, e }, ...rows.slice(i)], i);
}

/** Plays that don't fit the possession when the recording is replayed, with the reason. */
export function problems(rows: Row[]): Map<number, string> {
  const out = new Map<number, string>();
  if (!rows.length) return out;
  const startOn: Phase = ["D-Play", "O-Error", "GSO"].includes(rows[0].e.action) ? "defense" : "offense";
  const d = { startOn, events: [] as PlayEvent[] };
  rows.forEach((r, i) => {
    const e = r.e;
    if (PICKS_PLAYER.has(e.action) && e.action !== "GSO" && !e.player) out.set(i, "Pick who made this play");
    const t = (PICKS_PLAYER.has(e.action) ? { action: e.action, player: e.player ?? "" } : { action: e.action }) as Tap;
    const why = canTap(stateOf(d), t);
    if (why && !out.has(i)) out.set(i, why);
    d.events.push(e);
  });
  return out;
}

/** Where saved flag indexes land after editing: the nearest surviving original play. */
export function remapIndex(rows: Row[], origIndex: number, side: "start" | "end"): number {
  if (side === "start") {
    const i = rows.findIndex((r) => r.orig !== null && r.orig >= origIndex);
    return i < 0 ? Math.max(0, rows.length - 1) : i;
  }
  let best = -1;
  rows.forEach((r, i) => { if (r.orig !== null && r.orig <= origIndex) best = i; });
  return best < 0 ? 0 : best;
}

/** True when a row differs from what was saved. */
export const changed = (r: Row, original: PlayEvent[]) => {
  if (r.orig === null) return true;
  const o = original[r.orig];
  return o.action !== r.e.action || o.player !== r.e.player || o.lastPlayer !== r.e.lastPlayer ||
    o.secLastPlayer !== r.e.secLastPlayer || o.statScore !== r.e.statScore || o.otherScore !== r.e.otherScore;
};

/* ---------------------------------------------------------------- possessions */

/** Our possession: the catches in order, then how it ended. A Point is scored by the last catch. */
export interface OursSpec { side: "ours"; touches: string[]; outcome: "Point" | "Drop" | "T-Away" | "open"; droppedBy?: string }
/** Their possession, as our tablet sees it: how we got the disc back, or that they scored. */
export interface TheirsSpec { side: "theirs"; outcome: "D-Play" | "O-Error" | "GSO"; player?: string | null }
export type Spec = OursSpec | TheirsSpec;

export function specOf(events: PlayEvent[], ours: boolean): Spec {
  const last = events[events.length - 1];
  if (!ours) return { side: "theirs", outcome: last.action as TheirsSpec["outcome"], player: last.player ?? null };
  const touches = events.filter((e) => e.action === "Touch").map((e) => e.player ?? "");
  if (last.action === "Point" || last.action === "T-Away") return { side: "ours", touches, outcome: last.action };
  if (last.action === "Drop") return { side: "ours", touches, outcome: "Drop", droppedBy: last.player ?? "" };
  return { side: "ours", touches, outcome: "open" };
}

/** Why a possession can't be saved yet, or null. */
export function specProblem(s: Spec): string | null {
  if (s.side === "theirs") return s.outcome === "D-Play" && !s.player ? "Pick who got the D-Play" : null;
  if (s.touches.some((t) => !t)) return "Pick a player for every catch";
  if (s.outcome === "Point" && !s.touches.length) return "A Point needs at least the scorer's catch";
  if ((s.outcome === "Drop" || s.outcome === "T-Away") && !s.touches.length) return "Someone has to have the disc first";
  if (s.outcome === "Drop" && !s.droppedBy) return "Pick who dropped it";
  if (s.outcome === "Drop" && s.droppedBy === s.touches[s.touches.length - 1]) return "The thrower can't drop their own throw";
  if (s.outcome === "open" && !s.touches.length) return "Add at least one catch";
  return null;
}

/** Events for a possession; assists and scores are filled in by `repair`. */
function eventsOf(s: Spec, template: PlayEvent): PlayEvent[] {
  const ev = (action: string, player: string | null): PlayEvent => ({ ...template, action, player, lastPlayer: null, secLastPlayer: null });
  if (s.side === "theirs") return [ev(s.outcome, s.outcome === "O-Error" ? null : s.player ?? null)];
  const out = s.touches.map((t) => ev("Touch", t));
  if (s.outcome === "Point") out.push(ev("Point", s.touches[s.touches.length - 1]));
  if (s.outcome === "T-Away") out.push(ev("T-Away", s.touches[s.touches.length - 1]));
  if (s.outcome === "Drop") out.push(ev("Drop", s.droppedBy ?? null));
  return out;
}

/**
 * Replaces `count` plays starting at `start` with the given possessions (count 0 inserts,
 * no specs deletes). Where a rewritten play is the same kind of play as the one it replaces, the
 * original is kept (its time, which the tablet cross-check lines up on, and its recorded score);
 * only the players and assists change. Truly new plays take the nearest recorded time.
 */
export function replacePossessions(rows: Row[], start: number, count: number, specs: Spec[]): Row[] {
  const template = rows[start]?.e ?? rows[start - 1]?.e;
  if (!template) throw new Error("Nothing to edit");
  const old = rows.slice(start, start + count);
  const events = specs.flatMap((s) => eventsOf(s, template));
  const lastOld = old[old.length - 1];
  const fresh: Row[] = events.map((e, k) => {
    // Line the new plays up with the old ones: touches in order, and the last play with the last.
    const o = k === events.length - 1 && lastOld && e.action !== "Touch" ? lastOld : old[k];
    if (o && o.e.action === e.action) return { ...o, e: { ...o.e, player: e.player } };
    return { uid: nextUid++, orig: null, e: { ...e, clock: (o ?? lastOld)?.e.clock ?? e.clock } };
  });
  const next = [...rows.slice(0, start), ...fresh, ...rows.slice(start + count)];
  return repair(rows, next, start, start + Math.max(0, fresh.length - 1));
}

/** The pair to insert between two possessions so the teams keep alternating. */
export function pairAt(prevOurs: boolean | null, nextOurs: boolean | null): [boolean, boolean] {
  const first = prevOurs !== null ? !prevOurs : nextOurs !== null ? nextOurs : true;
  return [first, !first];
}

export const blankSpec = (ours: boolean): Spec => (ours ? { side: "ours", touches: [""], outcome: "Point" } : { side: "theirs", outcome: "GSO", player: null });
