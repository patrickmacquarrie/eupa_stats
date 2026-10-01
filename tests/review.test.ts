import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import type { LeagueInput, PlayEvent } from "../engine/types";
import { EUPA_RULES, weeklySchedule } from "../src/lib/newSeason";
import { clearOfficial, needsReconfirming, setOfficial } from "../src/lib/official";
import { mergeName, resolveInput } from "../src/lib/names";
import { isDisputed, openItems } from "../src/lib/review";
import type { Season } from "../src/lib/season";
import { gamesOf } from "../src/lib/SeasonContext";

const schedule = weeklySchedule("2027-01-04", 4);
const D = schedule[0].date;
const ev = (team: string, opp: string, us: number, them: number, action: string, player: string | null, lastPlayer: string | null = null): PlayEvent =>
  ({ date: D, clock: "19:00:00", statTeam: team, otherTeam: opp, statScore: us, otherScore: them, action, player, lastPlayer, secLastPlayer: null });

// A's tablet: A 1–0. Sid, a sub, plays for A although nobody on A is absent.
const tabletA = [ev("A", "B", 0, 0, "Touch", "Ann"), ev("A", "B", 1, 0, "Point", "Al", "Ann"), ev("A", "B", 1, 0, "D-Play", "Sid")];
// B's tablet disagrees (B 1–0) ...
const tabletB = [ev("B", "A", 0, 0, "Touch", "Bea"), ev("B", "A", 1, 0, "Point", "Bo", "Bea")];
// ... and B's re-uploaded tablet agrees with A's (A 1–0).
const tabletB2 = [ev("B", "A", 0, 0, "Touch", "Bea"), ev("B", "A", 0, 0, "Touch", "Bo"), ev("B", "A", 0, 1, "GSO", "Bo")];

const base = (events: PlayEvent[], extra: Partial<LeagueInput> = {}): LeagueInput => ({
  rules: { ...EUPA_RULES, teamsForCapAverage: 2 },
  teams: [{ name: "A", gm: "" }, { name: "B", gm: "" }],
  players: [
    { name: "Ann", gender: "F", initialSalary: 1_000_000, team: "A", isSub: false },
    { name: "Al", gender: "M", initialSalary: 1_000_000, team: "A", isSub: false },
    { name: "Bea", gender: "F", initialSalary: 1_000_000, team: "B", isSub: false },
    { name: "Bo", gender: "M", initialSalary: 1_000_000, team: "B", isSub: false },
    { name: "Sid", gender: "M", initialSalary: 500_000, team: null, isSub: true },
  ],
  trades: [], schedule, events, boxScores: [], subAssignments: [], throughWeek: 1, ...extra,
});

function review(input: LeagueInput) {
  const result = computeLeague(input);
  const games = gamesOf(result.recordings);
  const season = { input, flags: [], ignoredNames: [] } as unknown as Season;
  return { result, games, items: openItems(season, input, result, games) };
}
const kinds = (items: { kind: string }[]) => items.map((i) => i.kind);
const recA = (r: ReturnType<typeof computeLeague>) => r.recordings.find((x) => x.team === "A")!;

describe("official scores stay tied to the recordings they settled", () => {
  it("asks for reconfirmation after a re-upload or a removed recording, and clears it on confirm or undo", () => {
    const disputed = base([...tabletA, ...tabletB], { subAssignments: [{ week: 1, team: "A", opp: "B", sub: "Sid", subbedFor: "" }] });
    let r = review(disputed);
    expect(isDisputed(r.games[0])).toBe(true);
    expect(kinds(r.items)).toEqual(["dispute"]);

    // Settle it: A won 1–0.
    const settled = setOfficial(disputed, 1, "A", "B", 1, 0);
    r = review(settled);
    expect(r.items).toEqual([]);
    expect(recA(r.result)).toMatchObject({ official: true, result: 1 });

    // B's tablet is re-uploaded and now agrees. The official score still applies, visibly,
    // and the week is provisional until it's confirmed.
    const reuploaded = { ...settled, events: [...tabletA, ...tabletB2] };
    r = review(reuploaded);
    expect(isDisputed(r.games[0])).toBe(false);
    expect(recA(r.result).official).toBe(true);
    expect(kinds(r.items)).toEqual(["official"]);
    expect(needsReconfirming(reuploaded, reuploaded.officialScores![0])).toBe(true);

    // Confirming against the new recordings settles it again.
    const confirmed = setOfficial(reuploaded, 1, "A", "B", 1, 0);
    expect(review(confirmed).items).toEqual([]);

    // Removing B's recording unsettles it; restoring it (an undo) settles it again.
    const removed = { ...confirmed, events: tabletA };
    expect(kinds(review(removed).items)).toEqual(["official"]);
    expect(review({ ...removed, events: [...tabletA, ...tabletB2] }).items).toEqual([]);

    // A box score for a side changes the game too.
    const boxed = { ...confirmed, boxScores: [{ week: 1, team: "B", opp: "A", result: 0, finalScore: 0, finalOppScore: 1, lines: [] }] };
    expect(kinds(review(boxed).items)).toEqual(["official"]);

    // Clearing it hands the result back to the tablets.
    r = review(clearOfficial(reuploaded, 1, "A", "B"));
    expect(r.items).toEqual([]);
    expect(recA(r.result).official).toBeUndefined();
  });

  it("treats an official score saved before fingerprints as needing confirmation", () => {
    const old = base([...tabletA, ...tabletB], { officialScores: [{ week: 1, a: "A", b: "B", scoreA: 1, scoreB: 0 }] });
    expect(kinds(review(old).items)).toContain("official");
  });
});

describe("provisional weeks catch every open sub and name", () => {
  it("flags a sub who played when nobody was absent, until the admin calls them an extra player", () => {
    const input = base([...tabletA, ...tabletB2]);
    const r = review(input);
    expect(r.result.lines.some((l) => l.role === "absent")).toBe(false);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ kind: "sub", week: 1 });
    expect(r.items[0].label).toContain("nobody on the roster is absent");

    const decided = review({ ...input, subAssignments: [{ week: 1, team: "A", opp: "B", sub: "Sid", subbedFor: "" }] });
    expect(decided.items).toEqual([]);
    expect(decided.result.warnings.filter((w) => w.includes("Sid"))).toEqual([]);
  });

  it("finds unknown names in box scores, not only tablet plays", () => {
    const zero = { goals: 0, assists: 0, secondAssists: 0, blocks: 0, drops: 0, throwaways: 0, gso: 0, touches: 0 };
    const input = base(tabletA, {
      subAssignments: [{ week: 1, team: "A", opp: "B", sub: "Sid", subbedFor: "" }],
      boxScores: [{ week: 1, team: "B", opp: "A", result: 0, finalScore: 0, finalOppScore: 1, lines: [{ player: "Bea", ...zero }, { player: "Zed Newcomer", ...zero, touches: 2 }] }],
    });
    const r = review(input);
    expect(r.items.filter((i) => i.kind === "name").map((i) => i.label)).toEqual(["“Zed Newcomer” isn't in the player list"]);
  });
});

describe("score differences: recommend, then the admin approves", () => {
  it("recommends 16–13 and 16–16 for the two recorded disputes, and Approve settles each", async () => {
    const { readFileSync } = await import("node:fs");
    const { tabletCsvToEvents } = await import("../src/lib/csv");
    const { seasonFromFixture, weekOfDate } = await import("../src/lib/season");
    const { recommend } = await import("../src/lib/scoreDiff");
    const { provisionalWeeks } = await import("../src/lib/review");
    const { season } = seasonFromFixture(JSON.parse(readFileSync("fixtures/fall-2026.json", "utf8")));
    let input = season.input;
    for (const pair of [["2026-08-31_T3vT2_team2", "2026-08-31_T3vT2_team3"], ["2026-09-21_T3vT1_team1", "2026-09-21_T3vT1_team3"]]) {
      const [x, y] = pair.map((f) => tabletCsvToEvents(readFileSync(`fixtures/disputes/${f}.csv`, "utf8")));
      const keys = new Set([x[0], y[0]].map((e) => `${e.date}|${e.statTeam}|${e.otherTeam}`));
      input = { ...input, events: [...input.events.filter((e) => !keys.has(`${e.date}|${e.statTeam}|${e.otherTeam}`)), ...x, ...y] };
    }
    // As in the app: the season holds the stored input; the engine runs on the resolved one.
    const scored = (inp: LeagueInput, stored = inp) => {
      const result = computeLeague(inp);
      const items = openItems({ ...season, input: stored, flags: [] }, inp, result, gamesOf(result.recordings));
      return { items, provisional: provisionalWeeks(items) };
    };
    const before = scored(input);
    const diffs = before.items.filter((i) => i.kind === "dispute");
    expect(diffs.map((i) => [i.week, i.approve?.scoreA, i.approve?.scoreB])).toEqual([[1, 16, 16], [3, 16, 13]]);
    expect(diffs[1].label).toBe("Team 3 v Team 1, week 3: the tablets disagree (16–13 vs 14–12). Recommended 16–13");
    expect(before.provisional).toEqual(expect.arrayContaining([1, 3]));

    // One click each: Approve stores the recommended score as the official one.
    const r3 = recommend(input, 3, "EUPA Fall - Team 1", "EUPA Fall - Team 3")!;
    expect([r3.first, r3.score]).toEqual(["EUPA Fall - Team 3", [16, 13]]);
    for (const d of diffs) input = setOfficial(input, d.week, d.approve!.a, d.approve!.b, d.approve!.scoreA, d.approve!.scoreB);
    const after = scored(input);
    expect(after.items.filter((i) => i.kind === "dispute" || i.kind === "official")).toEqual([]);
    // Week 3 is still provisional for another reason: an unknown name on Team 3's tablet (the
    // sub record's name without "Sub"), and that sub's match. Settle those as an admin would.
    expect(after.items.filter((i) => i.week === 3).map((i) => i.kind).sort()).toEqual(["name", "sub"]);
    const unknown = /“(.+)”/.exec(after.items.find((i) => i.week === 3 && i.kind === "name")!.label)![1];
    const merged = mergeName(input, [], unknown, `${unknown} Sub`);
    const stored = { ...merged.input, subAssignments: [...merged.input.subAssignments,
      { week: 3, team: "EUPA Fall - Team 3", opp: "EUPA Fall - Team 1", sub: `${unknown} Sub`, subbedFor: "" }] };
    expect(scored(resolveInput(stored, merged.aliases), stored).provisional).not.toContain(3);
    const res = computeLeague(input);
    const t3 = res.recordings.find((r) => r.week === 3 && r.team === "EUPA Fall - Team 3" && r.opp === "EUPA Fall - Team 1")!;
    expect([t3.finalScore, t3.finalOppScore, t3.result, t3.official]).toEqual([16, 13, 1, true]);
  });
});

describe("a goal the other tablet contradicts", () => {
  it("is left out of the recommendation, with a note above the buttons", async () => {
    const { recommend } = await import("../src/lib/scoreDiff");
    const at = (t: string, team: string, opp: string, us: number, them: number, action: string, player: string | null): PlayEvent =>
      ({ date: D, clock: t, statTeam: team, otherTeam: opp, statScore: us, otherScore: them, action, player, lastPlayer: null, secLastPlayer: null });
    const a = [at("19:38:00", "A", "B", 0, 0, "Touch", "Ann"), at("19:38:05", "A", "B", 1, 0, "Point", "Al"),
      at("19:39:20", "A", "B", 1, 0, "Touch", "Ann"), at("19:39:28", "A", "B", 2, 0, "Point", "Al")];
    const b = [at("19:38:06", "B", "A", 0, 1, "GSO", "Bea"), at("19:39:30", "B", "A", 0, 1, "D-Play", "Bo"), at("19:40:00", "B", "A", 0, 1, "Touch", "Bea")];
    const r = recommend(base([...a, ...b]), 1, "A", "B")!;
    expect(r.score).toEqual([1, 0]);
    expect(r.conflicts).toEqual(["B's tablet shows a turnover at 19:39:30. The recommendation leaves this goal out; change it if it counted."]);
    expect(r.goals).toEqual([{ text: "A goal at 19:39:28 (Al), only on A's tablet: B's tablet shows a turnover (D-Play Bo) at 19:39:30. Left out.", counted: false }]);
  });
});

describe("players marked present with no stats", () => {
  it("are an admin item that counts in the bubble, never makes a week provisional, and can be acknowledged", async () => {
    const { adminCounts, provisionalWeeks, quietKey } = await import("../src/lib/review");
    const withAmy = (input: LeagueInput): LeagueInput => ({ ...input, players: [...input.players, { name: "Amy Ash", gender: "F", initialSalary: 1_000_000, team: "A", isSub: false }] });
    const stored = withAmy(base([...tabletA, ...tabletB2], {
      subAssignments: [{ week: 1, team: "A", opp: "B", sub: "Sid", subbedFor: "" }],
      presentWithoutPlays: [{ week: 1, team: "A", opp: "B", player: "Amy Ash" }],
    }));
    const run = (acknowledgedQuiet: string[] = []) => {
      const result = computeLeague(stored);
      const season = { input: stored, flags: [], ignoredNames: [], acknowledgedQuiet } as unknown as Season;
      return openItems(season, stored, result, gamesOf(result.recordings));
    };
    const items = run();
    expect(items.map((i) => [i.kind, i.label, i.to])).toEqual([
      ["quiet", "Amy Ash was marked present for A v B (week 1) but has no stats", "games/1/A/B"],
    ]);
    expect(provisionalWeeks(items)).toEqual([]);
    expect(adminCounts(items, 0, 0)).toMatchObject({ review: 1, total: 1 });
    // A game a tablet never finished needs the admin too.
    expect(adminCounts(items, 0, 0, 2)).toMatchObject({ review: 3, total: 3 });
    expect(run([quietKey(1, "A", "B", "amy ash")])).toEqual([]);
  });
});
