import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import {
  careers, careerLine, emptyLine, historyFromSeason, historyProblems, mergeSuggestions, parseHistoryExport, samePerson,
  isHidden, sheetSeasonId, withDistinct, withHidden, withMerge, withoutMerge, type HistoryPlayer, type HistorySeason,
} from "../src/lib/history";
import { parseMasterSheet, seasonNameFromFile } from "../src/lib/masterSheet";
import { fakeMasterSheet as sheet, fakeMasterSheetXlsx } from "./masterSheetFixture";
import readXlsxFile from "read-excel-file/node";
import { buildSnapshot, DEFAULT_PUBLIC } from "../src/lib/publicStats";
import { seasonFromFixture } from "../src/lib/season";

const line = (gp: number, goals = 0, extra: Partial<HistoryPlayer["own"]> = {}) => ({ ...emptyLine(), gp, goals, ...extra });
const player = (name: string, own = line(0), sub = line(0), more: Partial<HistoryPlayer> = {}): HistoryPlayer =>
  ({ name, group: "F", team: "Team 1", startSalary: 1_000_000, endSalary: 2_000_000, own, sub, ...more });
const season = (id: string, firstDate: string, players: HistoryPlayer[]): HistorySeason =>
  ({ v: 1, id, name: id, source: "sheet", firstDate, lastDate: firstDate, weeks: 9, teams: [], players, updatedAt: "2026-01-01T00:00:00Z" });

describe("history from a season in the app", () => {
  const { season: s } = seasonFromFixture(JSON.parse(readFileSync("fixtures/fall-2026.json", "utf8")));
  const result = computeLeague(s.input);
  const h = historyFromSeason("fall", "Fall 2026", s.input, result);

  it("matches the public page's totals for games with their own team", () => {
    const snap = buildSnapshot("Fall", s.input, result, DEFAULT_PUBLIC);
    for (const r of snap.rows) {
      const p = h.players.find((x) => x.name === r.name)!;
      expect([p.own.gp, p.own.wins, p.own.goals, p.own.assists, p.own.blocks, p.own.touches], r.name)
        .toEqual([r.gp, r.wins, r.goals, r.assists, r.blocks, r.touches]);
    }
    expect(h.teams.map((t) => [t.team, t.wins, t.losses, t.ties])).toEqual(snap.standings!.map((t) => [t.team, t.wins, t.losses, t.ties]));
  });

  it("keeps sub games apart, end salaries for rostered players only, and no plugs", () => {
    const subs = h.players.filter((p) => p.sub.gp > 0);
    expect(subs.length).toBeGreaterThan(0);
    for (const p of h.players.filter((x) => x.team)) expect(p.endSalary).toBe(Math.round(result.salary[p.name][s.input.throughWeek]));
    expect(h.players.filter((p) => !p.team).every((p) => p.endSalary === null)).toBe(true);
    expect(h.players.some((p) => s.input.players.find((x) => x.name === p.name)?.isPlug)).toBe(false);
    expect([h.source, h.weeks, h.firstDate]).toEqual(["app", s.input.throughWeek, "2026-08-31"]);
    expect(historyProblems(h)).toEqual([]);
  });
});

describe("careers", () => {
  const a = season("2025 S1", "2025-01-02", [
    player("Robin Example", line(16, 40), line(2, 3), { endSalary: 9_000_000 }),
    player("Jess Sample", line(10, 5)),
    player("Kit Nobody Sub", line(0), line(4, 2), { team: null, group: "?", startSalary: null, endSalary: null }),
  ]);
  const b = season("2025 S2", "2025-03-01", [
    player("Robin Example", line(14, 30), line(0), { endSalary: 12_000_000 }),
    player("Jessica Sample", line(12, 7)),
    player("Kit Nobody", line(6, 1), line(0), { group: "M" }),
  ]);

  it("adds each person's seasons together, newest first", () => {
    const c = careers([a, b]).find((x) => x.name === "Robin Example")!;
    expect(c.seasons.map((x) => x.id)).toEqual(["2025 S2", "2025 S1"]);
    expect(careerLine(c, false)).toMatchObject({ gp: 30, goals: 70 });
    expect(careerLine(c, true)).toMatchObject({ gp: 32, goals: 73 });
    expect([c.lastSalary, c.peakSalary]).toEqual([12_000_000, 12_000_000]);
  });

  it("drops a “Sub” suffix and takes the division from a season that knew it", () => {
    const kit = careers([a, b]).find((x) => x.name === "Kit Nobody")!;
    expect(kit.seasons).toHaveLength(2);
    expect(kit.group).toBe("M");
    expect(kit.spellings).toEqual(["Kit Nobody", "Kit Nobody Sub"]);
  });

  it("merges spellings an admin says are one person, and suggests likely ones", () => {
    const people = careers([a, b]);
    expect(mergeSuggestions(people)).toEqual([{ a: "Jess Sample", b: "Jessica Sample", why: "short form of the first name" }]);
    const names = withMerge({ aliases: [], distinct: [] }, "Jess Sample", "Jessica Sample");
    const jess = careers([a, b], names).filter((x) => /Sample/.test(x.name));
    expect(jess).toHaveLength(1);
    expect([jess[0].name, careerLine(jess[0], false).gp]).toEqual(["Jessica Sample", 22]);
    expect(mergeSuggestions(careers([a, b], names), names)).toEqual([]);
    expect(careers([a, b], withoutMerge(names, "Jess Sample")).filter((x) => /Sample/.test(x.name))).toHaveLength(2);
  });

  it("adds two merged spellings in one season into one line", () => {
    const one = season("S", "2025-01-01", [player("Pat Q", line(3, 1)), player("Patricia Q", line(5, 2))]);
    const c = careers([one], withMerge({ aliases: [], distinct: [] }, "Pat Q", "Patricia Q"));
    expect(c).toHaveLength(1);
    expect(c[0].seasons).toHaveLength(1);
    expect(c[0].seasons[0].player.own).toMatchObject({ gp: 8, goals: 3 });
  });

  it("leaves out pairs ruled out, and re-points merges so there are no loops", () => {
    const people = careers([a, b]);
    expect(mergeSuggestions(people, withDistinct({ aliases: [], distinct: [] }, "Jessica Sample", "Jess Sample"))).toEqual([]);
    let n = withMerge({ aliases: [], distinct: [] }, "A B", "A Bee");
    n = withMerge(n, "A Bee", "Ay Bee");
    expect(n.aliases).toEqual([{ from: "A B", to: "Ay Bee" }, { from: "A Bee", to: "Ay Bee" }]);
    n = withMerge(n, "Ay Bee", "A Bee");   // reversing a merge replaces it
    expect(n.aliases.some((x) => x.from === "A Bee")).toBe(false);
  });

  it("leaves a season out and brings it back", () => {
    const meta = withHidden({ aliases: [], distinct: [] }, "test-season", true);
    expect(isHidden(meta, "test-season")).toBe(true);
    expect(withHidden(meta, "test-season", true).hidden).toEqual(["test-season"]);
    expect(isHidden(withHidden(meta, "test-season", false), "test-season")).toBe(false);
  });

  it("recognises a last initial", () => {
    expect(samePerson("Austin B", "Austin Brown")).toBe("last initial");
    expect(samePerson("Austin B", "Austin Clark")).toBeNull();
  });
});

/* ------------------------------------------------------------------ master sheets */

describe("importing a master sheet", () => {
  it("reads each player's own and sub games through the counted week", () => {
    const { season: s } = parseMasterSheet(sheet(), "2025_X_4v4_S1_-__Master_Sheet_-_Working.xlsx");
    const p = (n: string) => s.players.find((x) => x.name === n)!;
    expect(p("Ada Alpha").own).toMatchObject({ gp: 2, wins: 1.5, goals: 5, assists: 1, touches: 10 });
    expect(p("Ada Alpha").sub).toMatchObject({ gp: 1, goals: 1 });
    expect(p("Dee Delta")).toMatchObject({ team: null, group: "F", startSalary: null, endSalary: null });
    expect(p("Dee Delta").sub.gp).toBe(1);
    expect(s.players.map((x) => x.name)).toEqual(["Ada Alpha", "Ben Beta", "Cal Gamma", "Dee Delta", "Fay Walkon"]);  // no "Eli Never" (never played), no plug, no placeholder
  });

  it("takes salaries and teams from Setup and Rankings, standings and dates from Summary and Schedule", () => {
    const { season: s } = parseMasterSheet(sheet(), "2025_X_4v4_S1_-__Master_Sheet_-_Working.xlsx", new Date("2026-01-01T00:00:00Z"));
    const ben = s.players.find((x) => x.name === "Ben Beta")!;
    expect(ben).toMatchObject({ team: "Team 2 (X)", group: "M", startSalary: 2_500_000, endSalary: 2_600_000 });   // traded: Setup said GmA
    expect(s.teams.map((t) => [t.team, t.gm, t.wins, t.losses, t.ties, t.goalsFor])).toEqual([["Team 1 (X)", "GmA", 1, 0, 1, 20], ["Team 2 (X)", "GmB", 0, 1, 1, 15]]);
    expect([s.name, s.id, s.weeks, s.firstDate, s.lastDate, s.source]).toEqual(["2025 X 4v4 S1", "sheet-2025-x-4v4-s1", 2, "2025-01-02", "2025-01-09", "sheet"]);
    expect(historyProblems(s)).toEqual([]);
  });

  it("finds Rankings columns by their headers wherever they are", () => {
    const a = parseMasterSheet(sheet(), "a.xlsx").season, b = parseMasterSheet(sheet({ rankingsGmLast: true }), "a.xlsx").season;
    expect(b.players).toEqual(a.players);
  });

  it("explains what it couldn't match", () => {
    const { notes } = parseMasterSheet(sheet(), "a.xlsx");
    expect(notes.join("\n")).toMatch(/placeholder rows: Unknown_Stat/);
    expect(notes.join("\n")).toMatch(/1 player isn't on the Setup tab, so their division is unknown: Fay Walkon/);
    expect(notes.join("\n")).toMatch(/Ada Alpha Sub \(Rankings 9, game rows 1\)/);
  });

  it("reads the same from an .xlsx file as from the sheet's cells", async () => {
    const tabs = (await readXlsxFile(await fakeMasterSheetXlsx())).map((t) => ({ sheet: t.sheet, data: t.data }));
    const now = new Date("2026-01-01T00:00:00Z");
    expect(parseMasterSheet(tabs, "x.xlsx", now)).toEqual(parseMasterSheet(sheet(), "x.xlsx", now));
  });

  it("refuses a workbook that isn't a master sheet", () => {
    expect(() => parseMasterSheet([{ sheet: "Sheet1", data: [] }], "budget.xlsx")).toThrow(/doesn't look like a master sheet/);
  });

  it("names the season from the file", () => {
    expect(seasonNameFromFile("2025_EUPA_4v4_S2_-__Master_Sheet_-_Working.xlsx")).toBe("2025 EUPA 4v4 S2");
    expect(seasonNameFromFile("2025-PRG_Monday_4v4_Fall_-_Master_Sheet.xlsx")).toBe("2025 PRG Monday 4v4 Fall");
    expect(seasonNameFromFile("2026-PRG_Thursday_4v4_S1_-_Master_Sheet_1.xlsx")).toBe("2026 PRG Thursday 4v4 S1");
    expect(seasonNameFromFile("2025 EUPA 4v4 S1 - Master Sheet - Working.xlsx")).toBe("2025 EUPA 4v4 S1");
    expect(sheetSeasonId("2025 EUPA 4v4 S1")).toBe("sheet-2025-eupa-4v4-s1");
  });
});

describe("history export", () => {
  it("round-trips, and refuses a damaged season", () => {
    const s = season("S", "2025-01-01", [player("Ada Alpha", line(2, 1))]);
    const text = JSON.stringify({ kind: "eupa-history", v: 1, league: "eupa", exportedAt: "x", seasons: [s], names: { aliases: [{ from: "A", to: "B" }], distinct: [] } });
    expect(parseHistoryExport(text).seasons).toEqual([s]);
    expect(() => parseHistoryExport(JSON.stringify({ kind: "eupa-history", v: 1, seasons: [{ ...s, players: [{ name: "X" }] }] }))).toThrow(/damaged/);
    expect(() => parseHistoryExport("{}")).toThrow(/isn't a history export/);
  });
});
