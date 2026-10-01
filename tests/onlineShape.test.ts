import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import { assemble, recId, split, stable, type RecordingDoc } from "../src/lib/onlineShape";
import { seasonFromFixture, type Season } from "../src/lib/season";

const fall = () => seasonFromFixture(JSON.parse(readFileSync("fixtures/fall-2026.json", "utf8"))).season;
const docsOf = (s: Season, extra: Partial<RecordingDoc> = {}): RecordingDoc[] =>
  [...split(s).recs.values()].map((r) => ({ uid: "admin", status: "finished", ...r, ...extra }));
const sortedEvents = (s: Season) => s.input.events.map((e) => stable(e)).sort();

describe("a season stored online", () => {
  it("splits into a season document without plays and one document per recording, and back", () => {
    const s = fall();
    const first = s.input.events[0];
    const week1 = { week: 1, team: first.statTeam, opp: first.otherTeam, player: "Someone Present" };
    const flag = { date: first.date, team: first.statTeam, opp: first.otherTeam, start: 3, end: 5, clock: "19:30:00" };
    const season: Season = { ...s, flags: [flag], input: { ...s.input, presentWithoutPlays: [week1, { week: 9, team: "X", opp: "Y", player: "Box Score Only" }] } };

    const { seasonDoc, recs } = split(season);
    expect(seasonDoc.input.events).toEqual([]);
    expect(recs.size).toBe(24);
    const r = recs.get(recId(first.date, first.statTeam, first.otherTeam))!;
    expect(r.present).toEqual(["Someone Present"]);
    expect(r.flags).toEqual([flag]);
    // What no recording owns stays on the season document.
    expect(seasonDoc.input.presentWithoutPlays).toEqual([{ week: 9, team: "X", opp: "Y", player: "Box Score Only" }]);
    expect(seasonDoc.flags).toEqual([]);

    const back = assemble(seasonDoc, docsOf(season));
    expect(sortedEvents(back)).toEqual(sortedEvents(season));
    const rest = (x: Season) => stable({ ...x, input: { ...x.input, events: [], presentWithoutPlays: [] }, flags: [] });
    expect(rest(back)).toBe(rest(season));
    expect(back.flags).toEqual([flag]);
    expect(back.input.presentWithoutPlays?.map((x) => stable(x)).sort()).toEqual(season.input.presentWithoutPlays?.map((x) => stable(x)).sort());
    // The engine gives the same salaries from the reassembled season.
    expect(computeLeague(back.input).salary).toEqual(computeLeague(season.input).salary);
  });

  it("brings in a tablet's first-time subs, ticked players and later weeks", () => {
    const s = fall();
    const date = s.input.schedule.find((x) => x.week === 5)!.date;
    const team = s.input.teams[0].name, opp = s.input.teams[1].name;
    const tablet: RecordingDoc = {
      uid: "tablet", status: "live", date, team, opp, flags: [], present: ["Quiet One"],
      newPlayers: [{ name: "Brand New", gender: "F", initialSalary: 0, team: null, isSub: true }, { ...s.input.players[0] }],
      events: [{ date, clock: "19:00:00", statTeam: team, otherTeam: opp, statScore: 0, otherScore: 0, action: "Touch", player: "Brand New", lastPlayer: null, secLastPlayer: null }],
    };
    const { seasonDoc } = split(s);
    const back = assemble(seasonDoc, [...docsOf(s), tablet]);
    expect(back.input.players.filter((p) => p.name === "Brand New")).toHaveLength(1);
    expect(back.input.players.filter((p) => p.name === s.input.players[0].name)).toHaveLength(1);   // no duplicate
    expect(back.input.throughWeek).toBe(5);
    expect(back.input.presentWithoutPlays).toContainEqual({ week: 5, team, opp, player: "Quiet One" });
    // The admin's next save moves the new sub into the season document.
    expect(split(back).seasonDoc.input.players.some((p) => p.name === "Brand New")).toBe(true);
  });

  it("compares documents regardless of key order", () => {
    expect(stable({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(stable({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }));
  });
});
