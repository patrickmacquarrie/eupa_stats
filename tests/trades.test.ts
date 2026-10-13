import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import type { LeagueInput, PlayEvent } from "../engine/types";
import { EUPA_RULES, weeklySchedule } from "../src/lib/newSeason";
import { buildSnapshot, DEFAULT_PUBLIC } from "../src/lib/publicStats";
import { teamCap, teamPayroll } from "../src/lib/SeasonContext";
import { applyDeal, dealKind, dealProblems, LEFT, POOL, removeDeal, savedDeals, whereIs } from "../src/lib/trades";

/** Teams A and B of two, a sub pool with Sid, games in weeks 1–4 where Ann scores and A wins. */
function season(extra: Partial<LeagueInput> = {}): LeagueInput {
  const schedule = weeklySchedule("2027-01-04", 8);
  const ev = (date: string, team: string, opp: string, us: number, them: number, action: string, player: string | null): PlayEvent =>
    ({ date, clock: "19:00:00", statTeam: team, otherTeam: opp, statScore: us, otherScore: them, action, player, lastPlayer: null, secLastPlayer: null });
  const events = [1, 2, 3, 4].flatMap((w) => {
    const d = schedule[w - 1].date;
    return [ev(d, "A", "B", 0, 0, "Touch", "Ann"), ev(d, "A", "B", 1, 0, "Point", "Ann"), ev(d, "B", "A", 0, 0, "Touch", "Bea"), ev(d, "B", "A", 0, 1, "GSO", "Bea")];
  });
  return {
    rules: { ...EUPA_RULES, teamsForCapAverage: 2 },
    teams: [{ name: "A", gm: "" }, { name: "B", gm: "" }, { name: "Subs", gm: "", isSubTeam: true }],
    players: [
      { name: "Ann", gender: "F", initialSalary: 1_000_000, team: "A", isSub: false },
      { name: "Al", gender: "M", initialSalary: 1_000_000, team: "A", isSub: false },
      { name: "Bea", gender: "F", initialSalary: 1_000_000, team: "B", isSub: false },
      { name: "Bo", gender: "M", initialSalary: 1_000_000, team: "B", isSub: false },
      { name: "Sid", gender: "SubM", initialSalary: 0, team: "Subs", isSub: true },
    ],
    trades: [], schedule, events, boxScores: [], subAssignments: [], throughWeek: 4,
    ...extra,
  };
}

describe("trades and waivers in the engine", () => {
  it("a waiver pickup plays for the team from the next week at the salary the admin set", () => {
    const res = computeLeague(season({ trades: [
      { id: 1, afterWeek: 2, player: "Sid", toTeam: "A", setSalary: 750_000 },
      { id: 1, afterWeek: 2, player: "Al", toTeam: "Subs", setSalary: 400_000 },
    ] }));
    expect([res.teamOf("Sid", 2), res.teamOf("Sid", 3)]).toEqual(["Subs", "A"]);
    expect(res.salary.Sid.slice(0, 4)).toEqual([0, 0, 750_000, 750_000]);
    expect(res.salary.Al[2]).toBe(400_000);
    // Sid's week 3 and 4 games count for A: he's on the roster now, so he's absent, not a sub.
    expect(res.lines.filter((l) => l.player === "Sid" && l.week === 3).map((l) => l.role)).toEqual(["absent"]);
  });

  it("payroll, the plug average and the public page count a pickup from the sub pool", () => {
    const input = season({ trades: [{ id: 1, afterWeek: 2, player: "Sid", toTeam: "A", setSalary: 750_000 }] });
    const res = computeLeague(input);
    expect(teamPayroll(input, res, 2).A).toBe(res.salary.Ann[2] + res.salary.Al[2] + 750_000);
    const snap = buildSnapshot("S", input, res, DEFAULT_PUBLIC);
    expect(snap.rows.map((r) => r.name)).toContain("Sid");
  });

  it("cap space moves cap room between teams from that week on", () => {
    const res = computeLeague(season({ capTrades: [{ id: 1, afterWeek: 3, from: "B", to: "A", amount: 250_000 }] }));
    expect(teamCap(res, "A", 2)).toBe(res.capByWeek[2]);
    expect(teamCap(res, "A", 3) - res.capByWeek[3]).toBe(250_000);
    expect(teamCap(res, "B", 6) - res.capByWeek[6]).toBe(-250_000);
  });
});

describe("recording a deal", () => {
  const input = season();
  const res = computeLeague(input);

  it("knows where each player is, and which moves need a salary", () => {
    expect(whereIs(input, res, "Sid", 2)).toBe(POOL);
    expect(dealProblems(input, res, { afterWeek: 2, moves: [{ player: "Sid", to: "A" }], cap: [] })).toEqual(["Enter Sid's salary from then on."]);
    expect(dealProblems(input, res, { afterWeek: 2, moves: [{ player: "Al", to: "B" }], cap: [] })).toEqual([]);
    expect(dealProblems(input, res, { afterWeek: 2, moves: [{ player: "Al", to: "A" }], cap: [] })).toEqual(["Al is already on A then."]);
    expect(dealProblems(input, res, { afterWeek: 2, moves: [], cap: [{ from: "A", to: "A", amount: 5 }] })).toEqual(["Cap space has to go to a different team."]);
  });

  it("saves a trade with cap space as one deal, lists it, and removes it whole", () => {
    const next = applyDeal(input, res, { afterWeek: 3, moves: [{ player: "Al", to: "B" }, { player: "Bo", to: "A" }], cap: [{ from: "B", to: "A", amount: 100_000 }] });
    expect(next.trades).toEqual([{ id: 1, afterWeek: 3, player: "Al", toTeam: "B" }, { id: 1, afterWeek: 3, player: "Bo", toTeam: "A" }]);
    expect(next.capTrades).toEqual([{ id: 1, afterWeek: 3, from: "B", to: "A", amount: 100_000 }]);
    const deals = savedDeals(next);
    expect(deals).toHaveLength(1);
    expect(dealKind(next, deals[0])).toBe("Trade");
    expect(removeDeal(next, deals[0].key)).toMatchObject({ trades: [], capTrades: [] });
  });

  it("a waiver drop sets the salary; leaving the league doesn't", () => {
    const next = applyDeal(input, res, { afterWeek: 2, moves: [{ player: "Al", to: POOL, salary: 300_000 }, { player: "Bo", to: LEFT, salary: 999 }], cap: [] });
    expect(next.trades).toEqual([
      { id: 1, afterWeek: 2, player: "Al", toTeam: "Subs", setSalary: 300_000 },
      { id: 1, afterWeek: 2, player: "Bo", toTeam: null, left: true },
    ]);
    expect(dealKind(next, savedDeals(next)[0])).toBe("Waivers");
    const after = computeLeague(next);
    expect(whereIs(next, after, "Bo", 3)).toBe(LEFT);
    expect(whereIs(next, after, "Al", 3)).toBe(POOL);
  });
});
