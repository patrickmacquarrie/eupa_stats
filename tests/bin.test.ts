import { describe, expect, it } from "vitest";
import type { PlayEvent } from "../engine/types";
import { binId, binProblems, fromBin, losesPlays, toBin } from "../src/lib/bin";
import type { RecordingDoc } from "../src/lib/onlineShape";

const ev = (n: number, extra: Partial<PlayEvent> = {}) => ({ date: "2026-11-26", statTeam: "Team 1", otherTeam: "Team 2", action: "Touch", player: `P${n}`, statScore: 0, otherScore: 0, ...extra }) as unknown as PlayEvent;
const rec: RecordingDoc = {
  uid: "tablet", status: "live", date: "2026-11-26", team: "Team 1", opp: "Team 2",
  events: [ev(1), ev(2)], newPlayers: [], present: [], flags: [], checkIn: ["P1", "P2"], subs: [],
};

describe("the recordings bin", () => {
  it("keeps everything a recording had, and restores it as finished", () => {
    const b = toBin(rec, "discarded", "tablet", 1_700_000_000_000);
    expect(b).toMatchObject({ recId: "2026-11-26__Team 1__Team 2", why: "discarded", binnedBy: "tablet", binnedAtMs: 1_700_000_000_000 });
    expect(binProblems(b)).toEqual([]);
    expect(fromBin(b)).toEqual({ ...rec, status: "finished" });
  });

  it("gives every copy of a game its own id, in time order", () => {
    expect(binId("2026-11-26__Team 1__Team 2", 1)).not.toBe(binId("2026-11-26__Team 1__Team 2", 2));
    expect(binId("g", 1_700_000_000_000) < binId("g", 1_700_000_000_001)).toBe(true);
  });

  it("counts a change as losing plays only when a play goes missing", () => {
    expect(losesPlays([], [ev(1)])).toBe(false);                       // a new recording
    expect(losesPlays([ev(1)], [ev(1), ev(2)])).toBe(false);           // plays added
    expect(losesPlays([ev(1), ev(2)], [ev(1)])).toBe(true);            // a play removed
    expect(losesPlays([ev(1)], [ev(1, { player: "P9" })])).toBe(true); // a play changed
    expect(losesPlays([ev(1), ev(1)], [ev(1)])).toBe(true);            // one of two identical plays removed
    expect(losesPlays([ev(1), ev(2)], [ev(2), ev(1)])).toBe(false);    // the same plays
  });

  it("refuses a damaged copy", () => {
    expect(binProblems({ date: "x", team: "a", opp: "b", events: [], recId: "r", binnedAtMs: 1, why: "lost" })).toEqual(["It doesn't say how it was removed."]);
    expect(binProblems(null)).toHaveLength(1);
  });
});
