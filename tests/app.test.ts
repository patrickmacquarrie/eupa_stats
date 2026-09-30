import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import { crossCheck } from "../engine/crosscheck";
import { isoDate, parseCsv, tabletCsvToEvents } from "../src/lib/csv";
import { seasonFromFixture } from "../src/lib/season";

const fixture = (name: string) => JSON.parse(readFileSync(`fixtures/${name}.json`, "utf8"));

/** Weekly salaries that match the master sheet's own numbers (the README's validation table). */
function salaryMatches(fx: any) {
  const { season } = seasonFromFixture(fx);
  const res = computeLeague(season.input);
  let checked = 0, exact = 0;
  for (const [name, exp] of Object.entries<any>(fx.expected.salaries)) {
    const row = Object.entries(res.salary).find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1];
    for (let w = 1; w <= season.input.throughWeek; w++) {
      if (typeof exp.weeks[w - 1] !== "number") continue;
      checked++;
      if (row && Math.abs(row[w] - exp.weeks[w - 1]) <= 0.5) exact++;
    }
  }
  return { checked, exact, res, season };
}

describe("season import", () => {
  it("rebuilds Fall 2026 from the raw event log to the sheet's exact salaries and cap", () => {
    const fx = fixture("fall-2026");
    const { checked, exact, res } = salaryMatches(fx);
    expect(checked).toBe(180);
    expect(exact).toBe(180);
    for (let w = 1; w <= 4; w++) expect(res.capByWeek[w]).toBeCloseTo(fx.expected.capByWeek[w - 1], 0);
  });

  it("brings in trades and sub assignments for Thursday S1", () => {
    const { season } = seasonFromFixture(fixture("thursday-s1-2026"));
    expect(season.input.trades.length).toBeGreaterThan(0);
    expect(season.input.subAssignments.length).toBeGreaterThan(0);
    expect(season.input.rules.absence.thereafter).toBe("seasonAvgRetroactive");
  });
});

describe("tablet CSV", () => {
  it("parses quoted fields, BOM and CRLF", () => {
    expect(parseCsv('﻿"a","b ""c"""\r\n"1",""\r\n')).toEqual([["a", 'b "c"'], ["1", ""]]);
  });

  it("converts the tablet date format", () => {
    expect(isoDate("Mon Aug 31 2026")).toBe("2026-08-31");
    expect(isoDate("2026-09-21")).toBe("2026-09-21");
  });

  it("reads a dispute pair and pinpoints the disagreement", () => {
    const a = tabletCsvToEvents(readFileSync("fixtures/disputes/2026-08-31_T3vT2_team2.csv", "utf8"));
    const b = tabletCsvToEvents(readFileSync("fixtures/disputes/2026-08-31_T3vT2_team3.csv", "utf8"));
    expect(a[0].date).toBe("2026-08-31");
    expect(a[0].statTeam).toBe("EUPA Fall - Team 2");
    const r = crossCheck(a, b);
    expect(r.agree).toBe(false);
    expect(r.unmatched.length).toBeGreaterThan(0);
  });
});

describe("present without plays", () => {
  it("turns an absence into a zero line that earns only the result", () => {
    const { season } = seasonFromFixture(JSON.parse(readFileSync("fixtures/fall-2026.json", "utf8")));
    const base = computeLeague(season.input);
    const abs = base.lines.find((l) => l.role === "absent" && !l.coveredBy && l.week >= 3)!;
    const rec = base.recordings.find((r) => r.week === abs.week && r.team === abs.team && r.opp === abs.opp)!;
    const res = computeLeague({ ...season.input, presentWithoutPlays: [{ week: abs.week, team: abs.team, opp: abs.opp, player: abs.player }] });
    const line = res.lines.find((l) => l.week === abs.week && l.team === abs.team && l.opp === abs.opp && l.player === abs.player)!;
    expect(line.role).toBe("rostered");
    expect(line.growth).toBe(rec.result === 1 ? 100000 : rec.result === 0.5 ? 50000 : 0);
  });
});
