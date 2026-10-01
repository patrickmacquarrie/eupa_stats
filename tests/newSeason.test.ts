import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import { EUPA_RULES, buildNewSeason, newPlug, normGender, parseMoney, parseRoster, scheduleProblem, shortTeams, skipWeek, weeklySchedule } from "../src/lib/newSeason";
import { DEFAULT_PUBLIC, buildSnapshot, leaderboards } from "../src/lib/publicStats";

const pasted = [
  "Player\tGender\tTeam\tStarting Salary",
  "Bettany Ashgrove\tM\tTeam 1\t$7,500,000",
  "Peregrine Ashgrove\tF\tTeam 1\t4.05M",
  "Alder Rookwood\tF\tTeam 2\t3500000",
  "Quillon Ashgrove\tM\tTeam 2\t(250,000)",
  "Leopold Rookwood\tF\tSub\t",
].join("\n");

describe("new season from a pasted roster", () => {
  it("reads a spreadsheet paste with a header, money formats and subs", () => {
    const r = parseRoster(pasted);
    expect(r.issues.filter((i) => i.blocking)).toEqual([]);
    expect(r.teams).toEqual(["Team 1", "Team 2"]);
    expect(r.rows.map((x) => [x.name, x.gender, x.team, x.salary])).toEqual([
      ["Bettany Ashgrove", "M", "Team 1", 7500000], ["Peregrine Ashgrove", "F", "Team 1", 4050000],
      ["Alder Rookwood", "F", "Team 2", 3500000], ["Quillon Ashgrove", "M", "Team 2", -250000], ["Leopold Rookwood", "F", null, 0],
    ]);
  });

  it("reads a CSV with no header in Name, Gender, Team, Salary order", () => {
    const r = parseRoster('Bettany Ashgrove,M,Team 1,"7,500,000"\nCorwin Ashgrove,F,Team 2,3500000\n');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].salary).toBe(7500000);
  });

  it("flags what would break the season, and near-duplicate names", () => {
    const r = parseRoster("Name,Gender,Team,Salary\nGreg,Q,Team 1,100\nAnn,F,Team 2,lots\nann,F,Team 2,5\nMarisol Dunmore,F,Team 1,0\nMarisoll Dunmore,F,Team 2,0");
    const msgs = r.issues.map((i) => i.message);
    expect(msgs.some((m) => /gender “Q”/.test(m))).toBe(true);
    expect(msgs.some((m) => /“lots” isn't a number/.test(m))).toBe(true);
    expect(msgs.some((m) => /listed twice/.test(m))).toBe(true);
    expect(r.issues.find((i) => /same person/.test(i.message))?.blocking).toBe(false);
    expect(parseRoster("Name,Salary\nGreg,1").issues[0].message).toMatch(/gender column/);
  });

  it("normalises values the way spreadsheets write them", () => {
    expect(["F+", "female", "W", "SubF"].map(normGender)).toEqual(["F", "F", "F", "F"]);
    expect(["M+", "Male", "open"].map(normGender)).toEqual(["M", "M", "M"]);
    expect(["1.25M", "750k", "$ 2,000", "-5", "abc"].map(parseMoney)).toEqual([1250000, 750000, 2000, -5, null]);
    expect(weeklySchedule("2026-12-28", 3).map((w) => w.date)).toEqual(["2026-12-28", "2027-01-04", "2027-01-11"]);
  });

  it("builds a season the engine runs, with the starting cap from total salary", () => {
    const r = parseRoster(pasted);
    const s = buildNewSeason({ name: "Winter 2027", roster: r.rows, gms: { "Team 1": "GregW" }, schedule: weeklySchedule("2027-01-04", 10), rules: EUPA_RULES, gameLengthMin: 25 });
    expect(s.input.teams.map((t) => [t.name, t.gm])).toEqual([["Team 1", "GregW"], ["Team 2", ""]]);
    expect(s.input.rules.teamsForCapAverage).toBe(2);
    expect(s.input.players.find((p) => p.name === "Leopold Rookwood")).toMatchObject({ isSub: true, team: null, gender: "SubF" });
    const res = computeLeague(s.input);
    expect(res.capByWeek[0]).toBe((7500000 + 4050000 + 3500000 - 250000) / 2 + 200000);
    expect(res.warnings).toEqual([]);
  });
});

it("keeps the schedule in order, and skips a week by pushing the rest back", () => {
  const s = weeklySchedule("2027-01-04", 4);
  expect(scheduleProblem(s)).toBeNull();
  expect(scheduleProblem(s.map((w, i) => (i === 2 ? { ...w, date: "2027-01-25" } : w)))).toMatch(/Week 4 .* has to come after week 3/);
  expect(skipWeek(s, 2).map((w) => w.date)).toEqual(["2027-01-04", "2027-01-11", "2027-01-25", "2027-02-01"]);
});

describe("plugs and new-season defaults", () => {
  it("new seasons use avg-to-date absences, no cap bumps and plugs priced by gender", () => {
    expect(EUPA_RULES.absence.thereafter).toBe("avgToDate");
    expect(EUPA_RULES.capExtraByWeek).toEqual({});
    expect(EUPA_RULES.plugMode).toBe("leagueAverage");
  });

  it("offers a plug to each short team and names it after the team and gender", () => {
    const r = parseRoster(pasted + "\nCorwin Kilbride\tM\tTeam 1\t$1,000,000");
    expect(shortTeams(r.rows)).toEqual([{ team: "Team 2", players: 2, largest: 3 }]);
    expect(shortTeams(r.rows, [{ team: "Team 2" }])).toEqual([]);
    const season = buildNewSeason({ name: "Plugs", roster: r.rows, plugs: [{ team: "Team 2", gender: "F" }], gms: {},
      schedule: weeklySchedule("2027-01-04", 4), rules: EUPA_RULES, gameLengthMin: 25 });
    expect(season.input.players.find((p) => p.isPlug)).toMatchObject({ name: "Team 2 plug (F)", gender: "F", team: "Team 2", isSub: false, isPlug: true });
    expect(newPlug(season.input.players, "Team 2", "F").name).toBe("Team 2 plug (F) 2");
  });

  it("keeps plugs off the player stats and public pages", () => {
    const r = parseRoster(pasted);
    const season = buildNewSeason({ name: "Plugs", roster: r.rows, plugs: [{ team: "Team 2", gender: "F" }], gms: {},
      schedule: weeklySchedule("2027-01-04", 4), rules: EUPA_RULES, gameLengthMin: 25 });
    const result = computeLeague(season.input);
    const snap = buildSnapshot("Plugs", season.input, result, DEFAULT_PUBLIC);
    expect(snap.rows.map((x) => x.name)).not.toContain("Team 2 plug (F)");
    expect(snap.rows.length).toBe(4);
    expect(JSON.stringify(leaderboards(snap))).not.toContain("plug");
  });
});
