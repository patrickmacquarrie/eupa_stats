import { describe, expect, it } from "vitest";
import { computeLeague } from "../engine/compute";
import type { LeagueInput, PlayEvent } from "../engine/types";
import { EUPA_RULES, weeklySchedule } from "../src/lib/newSeason";
import { clearOfficial, needsReconfirming, setOfficial } from "../src/lib/official";
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
