import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import { BOARDS, COLUMNS, DEFAULT_PUBLIC, buildSnapshot, leaderboards, parseSnapshot } from "../src/lib/publicStats";
import { seasonFromFixture } from "../src/lib/season";

const fall = () => {
  const { season } = seasonFromFixture(JSON.parse(readFileSync("fixtures/fall-2026.json", "utf8")));
  return { season, result: computeLeague(season.input) };
};

describe("public stats", () => {
  it("matches the master sheet's player stats page for Fall 2026", () => {
    const { season, result } = fall();
    const s = buildSnapshot("Fall", season.input, result, DEFAULT_PUBLIC);
    const get = (n: string) => s.rows.find((r) => r.name === n)!;
    const col = (k: string, n: string) => COLUMNS.find((c) => c.key === k)!.value(get(n));
    // Rows from the league's own sheet (screenshot): GP, wins, G, A, 2A, blocks, touches, stats/game.
    expect([get("Alex Wong").gp, get("Alex Wong").wins, get("Alex Wong").goals, get("Alex Wong").assists, get("Alex Wong").secondAssists, get("Alex Wong").blocks, get("Alex Wong").touches])
      .toEqual([8, 5, 12, 4, 2, 3, 48]);
    expect(get("Calvin Li").wins).toBe(3.5); // the sheet shows 4: it rounds the tie's half win
    expect([get("Greg Wentworth").gp, get("Greg Wentworth").goals, get("Greg Wentworth").assists, get("Greg Wentworth").touches]).toEqual([4, 17, 13, 96]);
    expect(col("statsPg", "Greg Wentworth")!.toFixed(1)).toBe("10.5");
    expect(col("points", "Quin Greenaway")).toBe(45);
    // Sub-only players (e.g. "Vanessa Chow Sub") are not on the page; rostered players are.
    expect(s.rows.some((r) => /sub$/i.test(r.name))).toBe(false);
    expect(s.rows).toHaveLength(30); // the same 30 names as the sheet, Alex Wong to Stephen Chin
  });

  it("leaderboards: top 5 per gender, matching the sheet's M+ goals board", () => {
    const { season, result } = fall();
    const boards = leaderboards(buildSnapshot("Fall", season.input, result, DEFAULT_PUBLIC));
    expect(boards.map((b) => b.label)).toEqual(["F+", "M+"]);
    const m = boards[1].boards.find((b) => b.key === "statsPg")!;
    expect(m.top.map((t) => t.name).slice(0, 3)).toEqual(["Greg Wentworth", "Quin Greenaway", "Patrick MacQuarrie"]);
    expect(boards[0].boards).toHaveLength(6);
    expect(boards[0].boards[0].top).toHaveLength(5);
    expect(BOARDS.find((b) => b.key === "blocksPg")!.label).toBe("D-Plays/Game");
  });

  it("round-trips through copy and paste, and rejects anything else", () => {
    const { season, result } = fall();
    const s = buildSnapshot("Fall", season.input, result, DEFAULT_PUBLIC);
    expect(parseSnapshot(JSON.stringify(s))).toEqual(s);
    expect(() => parseSnapshot("hello")).toThrow(/copied stats/);
    expect(() => parseSnapshot('{"v":2}')).toThrow(/copied stats/);
  });
});
