import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import { tabletCsvToEvents } from "../src/lib/csv";
import { DEFAULT_PUBLIC, buildSnapshot, parseSnapshot, snapshotProblems } from "../src/lib/publicStats";
import { SEASON_SCHEMA, migrateSeason, seasonFromFixture, seasonFromJson } from "../src/lib/season";
import { recordingProblems, seasonInputProblems } from "../src/lib/validate";

const csv = (rows: string[]) => ['"date","time","statTeam","otherTeam","statTeamScore","otherTeamScore","action","player","lastPlayer","secLastPlayer"', ...rows].join("\n");
const row = (score: string, them: string, action: string, player = "Ann", time = "19:00:00") => `"Mon Aug 31 2026","${time}","A","B","${score}","${them}","${action}","${player}","",""`;
const blocking = (ps: { blocking: boolean; message: string }[]) => ps.filter((p) => p.blocking).map((p) => p.message);
const fall = () => JSON.parse(readFileSync("fixtures/fall-2026.json", "utf8"));

describe("tablet CSV import", () => {
  it("accepts a real recording (with the old app's early score bump)", () => {
    const evs = tabletCsvToEvents(readFileSync("fixtures/disputes/2026-08-31_T3vT2_team2.csv", "utf8"));
    expect(blocking(recordingProblems(evs))).toEqual([]);
  });

  it("blocks scores that aren't whole numbers, unknown plays, missing players and impossible score changes", () => {
    const bad = (rows: string[]) => blocking(recordingProblems(tabletCsvToEvents(csv(rows)))).join(" | ");
    expect(bad([row("abc", "0", "Touch")])).toMatch(/isn't a pair of whole numbers/);
    expect(bad([row("1.5", "0", "Point")])).toMatch(/whole numbers/);
    expect(bad([row("-1", "0", "Point")])).toMatch(/whole numbers/);
    expect(bad([row("Infinity", "0", "Point")])).toMatch(/whole numbers/);
    expect(bad([row("0", "0", "Hammer")])).toMatch(/isn't a play/);
    expect(bad([row("0", "0", "Touch", "")])).toMatch(/needs a player/);
    expect(bad([row("1", "0", "Point"), row("0", "0", "GSO")])).toMatch(/goes back/);
    expect(bad([row("3", "0", "Point")])).toMatch(/jumps/);
  });

  it("blocks an empty recording and warns about missing times", () => {
    expect(blocking(recordingProblems([]))[0]).toMatch(/no plays/);
    const ps = recordingProblems(tabletCsvToEvents(csv([row("0", "0", "Touch", "Ann", "")])));
    expect(blocking(ps)).toEqual([]);
    expect(ps[0].message).toMatch(/no time/);
  });

  it("rejects a file that isn't a tablet export", () => {
    expect(() => tabletCsvToEvents("name,score\nx,1")).toThrow(/Missing column/);
    expect(() => tabletCsvToEvents(csv(['"not a date","19:00:00","A","B","0","0","Touch","Ann","",""']))).toThrow(/Unrecognised date/);
  });
});

describe("season files", () => {
  it("round-trips an export, stamped with the schema version", () => {
    const { season } = seasonFromFixture(fall());
    expect(season.schemaVersion).toBe(SEASON_SCHEMA);
    const back = seasonFromJson(JSON.parse(JSON.stringify(season)), "x").season;
    expect(back.input).toEqual(season.input);
    expect(back.id).not.toBe(season.id);
  });

  it("migrates an export made before versioning", () => {
    const { season } = seasonFromFixture(fall());
    const old: any = { ...season }; delete old.schemaVersion; delete old.aliases; delete old.flags;
    const m = migrateSeason(old);
    expect(m.schemaVersion).toBe(1);
    expect(m.aliases).toEqual([]);
    expect(m.flags).toEqual([]);
  });

  it("refuses a file from a newer version, and corrupted or hand-edited files", () => {
    const { season } = seasonFromFixture(fall());
    const edit = (f: (s: any) => void) => { const s = JSON.parse(JSON.stringify(season)); f(s); return () => seasonFromJson(s, "x"); };
    expect(edit((s) => { s.schemaVersion = 99; })).toThrow(/newer version/);
    expect(edit((s) => { s.input.rules.teamsForCapAverage = 0; })).toThrow(/cap average/);
    expect(edit((s) => { s.input.players[0].initialSalary = "lots"; })).toThrow(/starting salary isn't a number/);
    expect(edit((s) => { s.input.players.push({ ...s.input.players[0], name: " AUSTIN  cheng" }); })).toThrow(/listed twice/);
    expect(edit((s) => { s.input.players[0].team = "Nowhere FC"; })).toThrow(/isn't a team/);
    expect(edit((s) => { s.input.events[5].statScore = null; })).toThrow(/whole numbers/);
    expect(edit((s) => { s.input.schedule[1].date = s.input.schedule[0].date; })).toThrow(/doesn't come after/);
    expect(edit((s) => { delete s.input.events; })).toThrow(/no events list/);
    expect(() => seasonFromJson({ hello: 1 }, "x")).toThrow(/isn't a season/);
  });

  it("all three real seasons import with no blocking problems", () => {
    for (const f of ["fall-2026", "thursday-s1-2026", "pl-2025"]) {
      const { season } = seasonFromFixture(JSON.parse(readFileSync(`fixtures/${f}.json`, "utf8")));
      expect(blocking(seasonInputProblems(season.input))).toEqual([]);
    }
  });
});

describe("public stats snapshots", () => {
  it("accepts a real snapshot and rejects bad values", () => {
    const { season } = seasonFromFixture(fall());
    const s = buildSnapshot("Fall", season.input, computeLeague(season.input), DEFAULT_PUBLIC);
    expect(snapshotProblems(s)).toEqual([]);
    const bad = (f: (x: any) => void) => { const x = JSON.parse(JSON.stringify(s)); f(x); return () => parseSnapshot(JSON.stringify(x)); };
    expect(bad((x) => { x.rows[0].goals = -1; })).toThrow(/whole number/);
    expect(bad((x) => { x.rows[0].gp = 1.5; })).toThrow(/whole number/);
    expect(bad((x) => { x.rows[0].wins = 99; })).toThrow(/wins/);
    expect(bad((x) => { x.settings.topN = 0; })).toThrow(/1 to 50/);
    expect(bad((x) => { x.settings.columns.push("salary"); })).toThrow(/column/);
    expect(bad((x) => { x.rows.push({ ...x.rows[0] }); })).toThrow(/twice/);
  });
});
