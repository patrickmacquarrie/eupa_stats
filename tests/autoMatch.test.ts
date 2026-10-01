import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import type { LeagueInput, PlayEvent, SubAssignment } from "../engine/types";
import { computeWithAutoMatch, matchesFrom, subKey } from "../src/lib/autoMatch";
import { EUPA_RULES, weeklySchedule } from "../src/lib/newSeason";
import { openItems } from "../src/lib/review";
import { seasonFromFixture, type Season } from "../src/lib/season";
import { gamesOf } from "../src/lib/SeasonContext";

const schedule = weeklySchedule("2027-01-04", 4);
const D = schedule[0].date;
const ev = (action: string, player: string, us = 0, lastPlayer: string | null = null): PlayEvent =>
  ({ date: D, clock: "19:00:00", statTeam: "A", otherTeam: "B", statScore: us, otherScore: 0, action, player, lastPlayer, secLastPlayer: null });

/** Week 1, team A: Ann ($2M) and Amy ($1M) are absent; subs Sue and Sal (both F) play, and Sid (M), with no absent M. */
function league(events: PlayEvent[], extra: Partial<LeagueInput> = {}): LeagueInput {
  return {
    rules: { ...EUPA_RULES, teamsForCapAverage: 2 },
    teams: [{ name: "A", gm: "" }, { name: "B", gm: "" }],
    players: [
      { name: "Ann", gender: "F", initialSalary: 2_000_000, team: "A", isSub: false },
      { name: "Amy", gender: "F", initialSalary: 1_000_000, team: "A", isSub: false },
      { name: "Al", gender: "M", initialSalary: 1_000_000, team: "A", isSub: false },
      { name: "Bea", gender: "F", initialSalary: 1_000_000, team: "B", isSub: false },
      { name: "Sue", gender: "SubF", initialSalary: 500_000, team: null, isSub: true },
      { name: "Sal", gender: "SubF", initialSalary: 500_000, team: null, isSub: true },
      { name: "Sid", gender: "SubM", initialSalary: 500_000, team: null, isSub: true },
    ],
    trades: [], schedule, events, boxScores: [], subAssignments: [], throughWeek: 1, ...extra,
  };
}
// Sue scores, so she has the better night; Sal and Sid only touch the disc.
const sueBest = [ev("Touch", "Al"), ev("Touch", "Sue"), ev("Point", "Sue", 1, "Al"), ev("Touch", "Sal", 1), ev("Touch", "Sid", 1)];
// The same game with Sal scoring instead.
const salBest = [ev("Touch", "Al"), ev("Touch", "Sal"), ev("Point", "Sal", 1, "Al"), ev("Touch", "Sue", 1), ev("Touch", "Sid", 1)];

const covers = (assignments: SubAssignment[]) => Object.fromEntries(assignments.map((a) => [a.sub, a.subbedFor]));
function review(input: LeagueInput, autoMatchSubs?: boolean) {
  const season = { input, flags: [], ignoredNames: [], autoMatchSubs } as unknown as Season;
  const r = autoMatchSubs === false ? { input, result: computeLeague(input) } : computeWithAutoMatch(input);
  return { ...r, items: openItems(season, r.input, r.result, gamesOf(r.result.recordings)) };
}

describe("auto-match subs", () => {
  it("matches the best night to the highest-paid absent player of the same gender", () => {
    const r = computeWithAutoMatch(league(sueBest));
    expect(covers(r.input.subAssignments)).toEqual({ Sue: "Ann", Sal: "Amy" });
    expect([...r.auto].sort()).toEqual([subKey({ week: 1, team: "A", opp: "B" }, "Sal"), subKey({ week: 1, team: "A", opp: "B" }, "Sue")].sort());
    expect(r.unmatched.map((f) => f.message)).toEqual([expect.stringContaining("Sid (M) has no absent M player left")]);
  });

  it("leaves only subs it can't match as open items; switched off, every unpicked sub is open", () => {
    const on = review(league(sueBest));
    expect(on.items.filter((i) => i.kind === "sub").map((i) => i.label)).toEqual([
      "Sid played for A v B, but no absent player of the same gender is left to cover",
    ]);
    const off = review(league(sueBest), false);
    expect(off.items.filter((i) => i.kind === "sub")).toHaveLength(3);
  });

  it("keeps saved picks, including Nobody, and re-matches the rest after a stat edit", () => {
    const saved: SubAssignment[] = [{ week: 1, team: "A", opp: "B", sub: "Sid", subbedFor: "" }];
    const before = review(league(sueBest, { subAssignments: saved }));
    expect(covers(before.input.subAssignments)).toEqual({ Sid: "", Sue: "Ann", Sal: "Amy" });
    expect(before.items.filter((i) => i.kind === "sub")).toEqual([]);

    // Sal now has the better night: the auto-matches swap, the saved pick stays.
    const after = review(league(salBest, { subAssignments: saved }));
    expect(covers(after.input.subAssignments)).toEqual({ Sid: "", Sal: "Ann", Sue: "Amy" });

    // An override (Sue covers Amy) survives the same edit, and Sal takes the player left.
    const override: SubAssignment[] = [...saved, { week: 1, team: "A", opp: "B", sub: "Sue", subbedFor: "Amy" }];
    expect(covers(review(league(sueBest, { subAssignments: override })).input.subAssignments)).toEqual({ Sid: "", Sue: "Amy", Sal: "Ann" });
    expect(covers(review(league(salBest, { subAssignments: override })).input.subAssignments)).toEqual({ Sid: "", Sue: "Amy", Sal: "Ann" });
  });

  it("gives the same matches as a week-by-week pass on a real season", () => {
    const { season } = seasonFromFixture(JSON.parse(readFileSync("fixtures/thursday-s1-2026.json", "utf8")));
    const input = { ...season.input, subAssignments: [] };

    // Reference: match week w from salaries computed with weeks 1..w-1 already matched.
    let matched: SubAssignment[] = [];
    for (let w = 1; w <= input.throughWeek; w++) {
      const res = computeLeague({ ...input, subAssignments: matched });
      matched = [...matched, ...matchesFrom(input, res).assignments.filter((a) => a.week === w)];
    }
    const fast = computeWithAutoMatch(input);
    const key = (a: SubAssignment) => `${subKey(a, a.sub)}>${a.subbedFor}`;
    expect(fast.input.subAssignments.map(key).sort()).toEqual(matched.map(key).sort());
    expect(matched.length).toBeGreaterThan(10);
    // Seeded with its own answer, it takes one engine run.
    expect(computeWithAutoMatch(input, fast.input.subAssignments).runs).toBe(1);
  });
});
