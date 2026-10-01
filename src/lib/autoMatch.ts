// Auto-match subs: each sub covers an absent player of the same gender. The sub with the best
// night covers the highest-paid absent player, and so on down. Saved picks (the admin's
// overrides, including "Nobody (extra player)") always win; auto-matches are never stored, so a
// stat edit re-matches on its own.
//
// "Highest-paid" means salary before that week, and earlier matches change those salaries. So
// week w is matched from salaries computed with weeks 1..w-1 already matched. Rather than run the
// engine once per week, this runs it, matches every week from the result, and repeats until the
// matches stop changing. Week w's matches depend only on earlier weeks, so after k runs weeks
// 1..k are final and the loop ends at the same answer as a week-by-week pass, usually in one or
// two runs (one, when seeded with the previous answer).
import { computeLeague } from "../../engine/compute";
import { autoPairSubs, type PairingFlag } from "../../engine/pairing";
import type { EngineResult, GameLine, LeagueInput, SubAssignment } from "../../engine/types";
import { nameKey } from "./names";

export const subKey = (a: { week: number; team: string; opp: string }, sub: string) => `${a.week}|${a.team}|${a.opp}|${nameKey(sub)}`;

export interface AutoMatchResult {
  /** The input the engine ran on: saved picks plus auto-matches. */
  input: LeagueInput;
  result: EngineResult;
  /** Keys (subKey) of the subs whose match was made automatically. */
  auto: Set<string>;
  /** Subs auto-match couldn't place, with why. */
  unmatched: PairingFlag[];
  /** Engine runs it took (for tests and timing). */
  runs: number;
}

/** Auto-matches for every game, from one engine result, leaving saved picks alone. */
export function matchesFrom(input: LeagueInput, result: EngineResult) {
  const saved = new Set(input.subAssignments.map((a) => subKey(a, a.sub)));
  const games = new Map<string, GameLine[]>();
  for (const l of result.lines) {
    if (l.week > input.throughWeek) continue;
    const k = `${l.week}|${l.team}|${l.opp}`;
    (games.get(k) ?? games.set(k, []).get(k)!).push(l);
  }
  const assignments: SubAssignment[] = [];
  const unmatched: PairingFlag[] = [];
  for (const lines of games.values()) {
    if (!lines.some((l) => l.role === "sub")) continue;
    const { week, team, opp } = lines[0];
    // Absent players a saved pick already covers aren't available to anyone else.
    const taken = new Set(input.subAssignments.filter((a) => a.week === week && a.team === team && a.opp === opp && a.subbedFor).map((a) => nameKey(a.subbedFor)));
    const open = lines.filter((l) => (l.role === "sub" ? !saved.has(subKey(l, l.player)) : !(l.role === "absent" && taken.has(nameKey(l.player)))));
    if (!open.some((l) => l.role === "sub")) continue;
    const r = autoPairSubs(open, input.players, (p, w) => result.salary[p]?.[w - 1] ?? 0);
    assignments.push(...r.assignments);
    unmatched.push(...r.flags);
  }
  return { assignments, unmatched };
}

const same = (a: SubAssignment[], b: SubAssignment[]) => {
  const key = (x: SubAssignment) => `${subKey(x, x.sub)}>${nameKey(x.subbedFor)}`;
  const sa = new Set(a.map(key));
  return a.length === b.length && b.every((x) => sa.has(key(x)));
};

/** Runs the engine with auto-matched subs. `seed` is a previous answer to start from. */
export function computeWithAutoMatch(input: LeagueInput, seed: SubAssignment[] = []): AutoMatchResult {
  const savedKeys = new Set(input.subAssignments.map((a) => subKey(a, a.sub)));
  let auto = seed.filter((a) => !savedKeys.has(subKey(a, a.sub)));
  const maxRuns = input.throughWeek + 2;
  for (let runs = 1; ; runs++) {
    const run = { ...input, subAssignments: [...input.subAssignments, ...auto] };
    const result = computeLeague(run);
    const next = matchesFrom(input, result);
    if (same(auto, next.assignments) || runs >= maxRuns) {
      return { input: run, result, auto: new Set(auto.map((a) => subKey(a, a.sub))), unmatched: next.unmatched, runs };
    }
    auto = next.assignments;
  }
}
