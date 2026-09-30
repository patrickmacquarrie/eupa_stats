import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import type { LeagueInput, PlayEvent } from "../engine/types";
import { EUPA_RULES, weeklySchedule } from "../src/lib/newSeason";

/** Two teams of two, a 30-week schedule, games in the given weeks. */
function longSeason(gameWeeks: number[], extra: Partial<LeagueInput> = {}): LeagueInput {
  const schedule = weeklySchedule("2027-01-04", 30);
  const ev = (date: string, team: string, opp: string, us: number, them: number, action: string, player: string | null): PlayEvent =>
    ({ date, clock: "19:00:00", statTeam: team, otherTeam: opp, statScore: us, otherScore: them, action, player, lastPlayer: null, secLastPlayer: null });
  const events = gameWeeks.flatMap((w) => {
    const d = schedule[w - 1].date;
    return [ev(d, "A", "B", 0, 0, "Touch", "Ann"), ev(d, "A", "B", 1, 0, "Point", "Ann"), ev(d, "B", "A", 0, 0, "Touch", "Bea"), ev(d, "B", "A", 0, 1, "GSO", "Bea")];
  });
  return {
    rules: { ...EUPA_RULES, teamsForCapAverage: 2 },
    teams: [{ name: "A", gm: "" }, { name: "B", gm: "" }],
    players: [
      { name: "Ann", gender: "F", initialSalary: 1_000_000, team: "A", isSub: false },
      { name: "Al", gender: "M", initialSalary: 1_000_000, team: "A", isSub: false },
      { name: "Bea", gender: "F", initialSalary: 1_000_000, team: "B", isSub: false },
      { name: "Bo", gender: "M", initialSalary: 1_000_000, team: "B", isSub: false },
    ],
    trades: [], schedule, events, boxScores: [], subAssignments: [], throughWeek: Math.max(...gameWeeks),
    ...extra,
  };
}

describe("seasons longer than 16 weeks", () => {
  it("computes salaries and cap through week 30", () => {
    const res = computeLeague(longSeason([1, 17, 30]));
    expect(res.horizon).toBe(30);
    expect(res.salary.Ann).toHaveLength(31);
    for (let w = 0; w <= 30; w++) {
      expect(Number.isFinite(res.salary.Ann[w])).toBe(true);
      expect(Number.isFinite(res.capByWeek[w])).toBe(true);
    }
    // Ann scores and wins in weeks 1, 17 and 30: +200,000 each time.
    expect(res.salary.Ann[17] - res.salary.Ann[16]).toBe(200_000);
    expect(res.salary.Ann[30] - res.salary.Ann[29]).toBe(200_000);
  });

  it("covers trades and cap bumps past week 16", () => {
    const res = computeLeague(longSeason([1, 26], {
      trades: [{ afterWeek: 25, player: "Al", toTeam: "B" }],
      rules: { ...EUPA_RULES, teamsForCapAverage: 2, capExtraByWeek: { "28": 500_000 } },
    }));
    expect(res.teamOf("Al", 26)).toBe("B");
    expect(res.capByWeek[28] - res.capByWeek[27]).toBeCloseTo(500_000, 0);
  });

  it("a short season stops at its own schedule, unless a cap bump is later", () => {
    const short = { ...longSeason([1]), schedule: weeklySchedule("2027-01-04", 8) };
    expect(computeLeague({ ...short, rules: { ...short.rules, capExtraByWeek: {} } }).horizon).toBe(8);
    expect(computeLeague(short).horizon).toBe(14); // the EUPA standard bumps the cap in weeks 11-14
  });
});

describe("rule constraints", () => {
  it("refuses divisors of zero and other unusable rules, in plain words", async () => {
    const { ruleProblems } = await import("../engine/rules");
    expect(ruleProblems(EUPA_RULES)).toEqual([]);
    expect(ruleProblems({ ...EUPA_RULES, teamsForCapAverage: 0 })).toEqual(["Teams in the cap average must be a whole number of at least 1."]);
    expect(ruleProblems({ ...EUPA_RULES, matchesPerWeek: 0 })[0]).toMatch(/Games per team per week/);
    expect(ruleProblems({ ...EUPA_RULES, tieWeightFactor: 2 })[0]).toMatch(/between 0 and 1/);
    expect(ruleProblems({ ...EUPA_RULES, weights: { ...EUPA_RULES.weights, goal: NaN } })[0]).toMatch(/Goal value must be a number/);
    expect(ruleProblems({ ...EUPA_RULES, capExtraByWeek: { x: 5 } })[0]).toMatch(/week number/);
    expect(() => computeLeague({ ...longSeason([1]), rules: { ...EUPA_RULES, teamsForCapAverage: 0 } })).toThrow(/cap average/);
  });
});
