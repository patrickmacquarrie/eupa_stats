import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import type { RecordingSummary } from "../engine/types";
import { seasonFromFixture } from "../src/lib/season";
import { gamesOf } from "../src/lib/SeasonContext";
import { moneyShort } from "../src/lib/format";
import { recordText, standings } from "../src/lib/standings";

const rec = (week: number, team: string, opp: string, us: number, them: number, result = us > them ? 1 : us === them ? 0.5 : 0): RecordingSummary =>
  ({ week, team, opp, finalScore: us, finalOppScore: them, result, eventCount: 10 });

describe("standings", () => {
  it("counts records and goals, mirrors one-sided games, and skips unknown scores", () => {
    const games = gamesOf([
      rec(1, "A", "B", 13, 10), rec(1, "B", "A", 10, 13),
      rec(2, "A", "C", 9, 11),                               // only A's tablet
      rec(2, "B", "C", 12, 12), rec(2, "C", "B", 12, 12),
      { ...rec(3, "B", "A", NaN, NaN, 1), eventCount: 0 },   // box score with a result only
      rec(4, "A", "C", 15, 0),                               // after the cut-off
    ]);
    const s = standings(["A", "B", "C"], games, 3);
    expect(s.map((r) => [r.team, recordText(r, true), r.goalsFor, r.goalsAgainst, r.noScore])).toEqual([
      ["C", "1–0–1", 23, 21, 0],
      ["B", "1–1–1", 22, 25, 1],
      ["A", "1–2–0", 22, 21, 1],
    ]);
  });

  it("balances across a real season: every win is someone's loss", () => {
    const { season } = seasonFromFixture(JSON.parse(readFileSync("fixtures/fall-2026.json", "utf8")));
    const result = computeLeague(season.input);
    const games = gamesOf(result.recordings);
    const teams = season.input.teams.filter((t) => !t.isSubTeam).map((t) => t.name);
    const s = standings(teams, games, season.input.throughWeek);
    const sum = (k: "wins" | "losses" | "ties" | "played" | "goalsFor" | "goalsAgainst") => s.reduce((n, r) => n + r[k], 0);
    expect(sum("played")).toBe(games.length * 2);
    expect(sum("wins")).toBe(sum("losses"));
    expect(sum("goalsFor")).toBe(sum("goalsAgainst"));
  });
});

describe("short money labels", () => {
  it("keeps whole millions intact", () => {
    expect([200e6, 150e6, 100e6, 50e6, 1.5e6, 2.25e6, 1e6, 40e3, -3e6].map(moneyShort))
      .toEqual(["$200M", "$150M", "$100M", "$50M", "$1.5M", "$2.25M", "$1M", "$40K", "−$3M"]);
  });
});
