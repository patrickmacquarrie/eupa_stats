import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import { seasonFromFixture } from "../src/lib/season";
import { RANK_COLUMNS, rankings, rankingsCsv } from "../src/lib/rankings";

const fall = () => seasonFromFixture(JSON.parse(readFileSync("fixtures/fall-2026.json", "utf8"))).season;
const col = (k: string) => RANK_COLUMNS.find((c) => c.key === k)!;

describe("rankings, as the master sheet's Rankings tab", () => {
  const s = fall();
  const res = computeLeague(s.input);
  const w = s.input.throughWeek;
  const { rows, avgGso } = rankings(s.input, res, w);

  it("has every rostered player, then the subs, with the sheet's columns in its order", () => {
    expect(RANK_COLUMNS.map((c) => c.label).slice(0, 8)).toEqual(["Player", "Salary", "Player Growth", "Sub Growth", "Total Growth", "Games Played", "Wins", "Points"]);
    const rostered = s.input.players.filter((p) => !p.isPlug && !p.isSub);
    expect(rows.filter((r) => !r.sub).map((r) => r.name).sort()).toEqual(rostered.map((p) => p.name).sort());
    const firstSub = rows.findIndex((r) => r.sub);
    expect(rows.slice(firstSub).every((r) => r.sub && r.gm === "Sub")).toBe(true);
  });

  it("splits each salary's growth into games played and games missed, matching the engine", () => {
    for (const r of rows.filter((x) => !x.sub)) {
      expect(r.salary).toBeCloseTo(res.salary[r.player][w], 0);
      expect(r.totalGrowth).toBeCloseTo(res.salary[r.player][w] - res.salary[r.player][0], 0);
      expect(r.playerGrowth! + r.subGrowth!).toBeCloseTo(r.totalGrowth!, 0);
    }
  });

  it("counts games and stats from the player's own games, and works out the rates", () => {
    const r = rows.find((x) => !x.sub && x.gp > 0 && x.touches > 0)!;
    const own = res.lines.filter((l) => l.player === r.player && l.role === "rostered" && l.week <= w);
    expect(r.gp).toBe(own.length);
    expect(r.goals).toBe(own.reduce((a, l) => a + l.goals, 0));
    const stats = r.goals + r.assists + r.blocks;
    expect(col("stats").value(r, avgGso)).toBe(stats);
    expect(col("pm").value(r, avgGso)).toBe(stats - r.drops - r.throwaways);
    expect(col("retention").value(r, avgGso)).toBeCloseTo((r.touches - r.drops - r.throwaways) / r.touches, 6);
    expect(col("pmPg").value(r, avgGso)).toBeCloseTo((stats - r.drops - r.throwaways) / r.gp, 6);
  });

  it("downloads as CSV with the same header", () => {
    const csv = rankingsCsv(rows, avgGso).split("\n");
    expect(csv[0].split(",")[0]).toBe("Player");
    expect(csv).toHaveLength(rows.length + 1);
  });
});
