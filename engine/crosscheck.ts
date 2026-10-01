import type { PlayEvent } from "./types";

/**
 * Each game has two recordings, one per team. Team A's goals should show up in Team B's
 * recording as "GSO" (B got scored on) at about the same moment, and vice versa. Pairing them
 * by timestamp pinpoints the exact goals the two stat-takers disagree about, and the other
 * tablet's taps around that moment say whether it's a missed tap or a probable misclick.
 */
// Stat-takers miss plays far more often than they invent them, so a one-sided goal counts
// unless the other tablet actively contradicts it.
export type Verdict =
  | "missed-tap"   // other tablet silent, stopped, or tapped the wrong button: counts
  | "review"       // counts, but shown to the admin (e.g. two quick goals the other tablet saw once)
  | "conflict";    // other tablet recorded a turnover at that moment: held for the admin

export interface Unmatched {
  side: "A" | "B";
  kind: "goal" | "scored-on";
  at: string;
  player?: string | null;
  scoreAfter: string;
  verdict: Verdict;
  why: string;
  /** The evidence behind the verdict, for plain-language explanations. */
  detail: Evidence;
}

export type Evidence =
  | { reason: "stopped"; seconds: number }                                    // other tablet had stopped recording
  | { reason: "twice"; at: string; action: string; player?: string | null }   // two quick scores on this tablet
  | { reason: "o-error"; at: string }                                         // other tablet tapped O-Error instead of scored-on
  | { reason: "turnover"; at: string; action: string; player?: string | null } // other tablet has a turnover then
  | { reason: "silent"; seconds: number }                                     // other tablet quiet around it
  | { reason: "unexplained" };                                                // nothing either way

const secs = (clock?: string) => {
  const m = /(\d{1,2}):(\d{2}):(\d{2})/.exec(clock ?? "");
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN;
};
const TURNOVERS = new Set(["T-Away", "Drop", "D-Play", "O-Error"]);

function pair(goals: PlayEvent[], gsos: PlayEvent[], toleranceSec: number) {
  // Closest pairs first across the whole game, so a goal isn't stolen by an earlier neighbour.
  const cands: [number, number, number][] = [];
  goals.forEach((g, i) => gsos.forEach((s, j) => {
    const d = Math.abs(secs(s.clock) - secs(g.clock));
    if (d <= toleranceSec) cands.push([d, i, j]);
  }));
  cands.sort((x, y) => x[0] - y[0]);
  const gUsed = new Set<number>(), sUsed = new Set<number>();
  for (const [, i, j] of cands) if (!gUsed.has(i) && !sUsed.has(j)) { gUsed.add(i); sUsed.add(j); }
  return {
    unmatchedGoals: goals.filter((_, i) => !gUsed.has(i)),
    unmatchedGsos: gsos.filter((_, j) => !sUsed.has(j)),
  };
}

function judge(e: PlayEvent, same: PlayEvent[], other: PlayEvent[], gapSec: number): { verdict: Verdict; why: string; detail: Evidence } {
  const t = secs(e.clock);
  const times = other.map((o) => secs(o.clock));
  const last = Math.max(...times);
  const at = (o: PlayEvent) => (o.clock ?? "").slice(0, 8);
  if (t > last) return { verdict: "missed-tap", why: `other tablet stopped recording ${t - last}s earlier`, detail: { reason: "stopped", seconds: t - last } };
  // Same tablet logged the same kind of scoring event seconds apart: likely entered twice.
  const twin = same.find((o) => o !== e && o.action === e.action && Math.abs(secs(o.clock) - t) <= 15);
  if (twin) return { verdict: "review", why: `two quick scores on this tablet (also ${twin.action}${twin.player ? " " + twin.player : ""} at ${at(twin)}), other tablet caught one; counted, check if it was entered twice`,
    detail: { reason: "twice", at: at(twin), action: twin.action, player: twin.player } };
  // Other tablet started a possession with "O-Error" instead of "scored on".
  const next = other.find((o) => secs(o.clock) > t);
  if (next?.action === "O-Error" && secs(next.clock) - t <= 15 && e.action === "Point")
    return { verdict: "missed-tap", why: `other tablet tapped O-Error at ${at(next)}, probably meant "scored on"`, detail: { reason: "o-error", at: at(next) } };
  const turnover = other.find((o) => TURNOVERS.has(o.action) && Math.abs(secs(o.clock) - t) <= 5);
  if (turnover) return { verdict: "conflict", why: `other tablet has ${turnover.action}${turnover.player ? " " + turnover.player : ""} at ${at(turnover)}`,
    detail: { reason: "turnover", at: at(turnover), action: turnover.action, player: turnover.player } };
  const before = times.filter((x) => x <= t).pop() ?? -Infinity;
  const after = times.find((x) => x > t) ?? Infinity;
  if (t - before >= gapSec || after - t >= gapSec) {
    const seconds = Math.round(Math.min(after, last + 999) - before);
    return { verdict: "missed-tap", why: `other tablet silent for ${seconds}s around it`, detail: { reason: "silent", seconds } };
  }
  return { verdict: "review", why: "other tablet was recording but nothing contradicts it; counted", detail: { reason: "unexplained" } };
}

export function crossCheck(a: PlayEvent[], b: PlayEvent[], toleranceSec = 20, gapSec = 20) {
  const pts = (r: PlayEvent[]) => r.filter((e) => e.action === "Point");
  const gso = (r: PlayEvent[]) => r.filter((e) => e.action === "GSO");
  const ab = pair(pts(a), gso(b), toleranceSec); // A scores ↔ B scored on
  const ba = pair(pts(b), gso(a), toleranceSec);
  const fmt = (side: "A" | "B", kind: Unmatched["kind"]) => (e: PlayEvent): Unmatched => ({
    side, kind, at: (e.clock ?? "").slice(0, 8), player: e.player, scoreAfter: `${e.statScore}-${e.otherScore}`,
    ...judge(e, side === "A" ? a : b, side === "A" ? b : a, gapSec),
  });
  const lastA = a[a.length - 1], lastB = b[b.length - 1];
  const unmatched = [
    ...ab.unmatchedGoals.map(fmt("A", "goal")), ...ab.unmatchedGsos.map(fmt("B", "scored-on")),
    ...ba.unmatchedGoals.map(fmt("B", "goal")), ...ba.unmatchedGsos.map(fmt("A", "scored-on")),
  ].sort((x, y) => x.at.localeCompare(y.at));

  // Proposed score: every matched goal, plus one-sided goals judged as missed taps.
  // A-team goals are A's Points or B's GSOs; B-team goals the reverse.
  const matchedA = pts(a).length - ab.unmatchedGoals.length;
  const matchedB = pts(b).length - ba.unmatchedGoals.length;
  const accepted = (team: "A" | "B") => unmatched.filter((u) => u.verdict !== "conflict" &&
    ((team === "A") === ((u.side === "A") === (u.kind === "goal")))).length;
  const open = unmatched.filter((u) => u.verdict === "conflict");
  return {
    finalA: `${lastA.statScore}-${lastA.otherScore}`,
    finalB: `${lastB.otherScore}-${lastB.statScore}`, // B's final, flipped to A's point of view
    agree: lastA.statScore === lastB.otherScore && lastA.otherScore === lastB.statScore,
    proposed: { a: matchedA + accepted("A"), b: matchedB + accepted("B"), needsAdmin: open.length > 0 },
    unmatched,
  };
}
