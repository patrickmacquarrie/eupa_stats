import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tallyRecording } from "../engine/compute";
import type { PlayEvent } from "../engine/types";
import { tabletCsvToEvents } from "../src/lib/csv";
import { canTap, eventFor, possessions, press, stateOf, toggleFlag, toTabletCsv, undoPress, type Draft, type Tap } from "../src/lib/recorder";

const draft = (over: Partial<Draft> = {}): Draft => ({
  seasonId: "x", date: "2026-10-05", team: "A", opp: "B", startOn: "offense", gameLengthMin: 25,
  present: [], subs: [], newPlayers: [], events: [], gameTimes: [], clock: { runningSince: null, elapsedMs: 0 }, ...over,
});

const tapOf = (e: PlayEvent): Tap => {
  switch (e.action) {
    case "Touch": case "Drop": case "D-Play": return { action: e.action, player: e.player! };
    case "GSO": return { action: "GSO", player: e.player };
    default: return { action: e.action as "Point" | "T-Away" | "O-Error" };
  }
};

describe("recorder", () => {
  it("replays every sample tablet recording tap by tap with the same players, assists and scores", () => {
    for (const f of readdirSync("fixtures/disputes")) {
      const real = tabletCsvToEvents(readFileSync(`fixtures/disputes/${f}`, "utf8"));
      const first = real.find((e) => e.action !== "Touch")!;
      const d = draft({ date: real[0].date, team: real[0].statTeam, opp: real[0].otherTeam,
        startOn: ["D-Play", "O-Error", "GSO"].includes(first.action) && real[0].action !== "Touch" ? "defense" : "offense" });
      for (const e of real) {
        const t = tapOf(e);
        expect(canTap(stateOf(d), t), `${f} ${e.clock} ${e.action}`).toBeNull();
        const mine = eventFor(d, t, e.clock);
        expect([mine.player, mine.lastPlayer, mine.secLastPlayer], `${f} ${e.clock}`).toEqual([e.player, e.lastPlayer, e.secLastPlayer]);
        // The old app bumped the score on the scorer's Touch row already; every other row must match.
        if (e.action !== "Touch") expect([mine.statScore, mine.otherScore]).toEqual([e.statScore, e.otherScore]);
        d.events.push(mine);
      }
      const a = tallyRecording(real, (n) => n), b = tallyRecording(d.events, (n) => n);
      expect(b.lines).toEqual(a.lines);
      expect([b.finalScore, b.finalOppScore]).toEqual([a.finalScore, a.finalOppScore]);
    }
  });

  it("blocks taps that don't fit the possession", () => {
    const s = stateOf(draft());
    expect(canTap(s, { action: "Point" })).toMatch(/disc first/);
    expect(canTap(s, { action: "D-Play", player: "X" })).toMatch(/offense/);
    const d = draft(); d.events.push(eventFor(d, { action: "Touch", player: "X" }));
    expect(canTap(stateOf(d), { action: "Drop", player: "X" })).toMatch(/own throw/);
  });

  it("exports CSV the importer reads back unchanged", () => {
    const d = draft();
    for (const t of [{ action: "Touch", player: "Ann" }, { action: "Touch", player: "Bo" }, { action: "Touch", player: "Cy" }, { action: "Point" },
      { action: "GSO", player: null }, { action: "Touch", player: "Bo" }, { action: "T-Away" }, { action: "D-Play", player: "Ann" }] as Tap[])
      d.events.push(eventFor(d, t, "19:00:00 GMT-0600 (Mountain Daylight Time)"));
    expect(d.events[3]).toMatchObject({ action: "Point", player: "Cy", lastPlayer: "Bo", secLastPlayer: "Ann", statScore: 1 });
    expect(tabletCsvToEvents(toTabletCsv(d.events))).toEqual(d.events);
  });
});

describe("row buttons", () => {
  const d0 = () => draft({ present: ["Ann", "Bo", "Cy"] });
  const run = (d: Draft, ...ps: Parameters<typeof press>[1][]) => {
    for (const p of ps) { const r = press(d, p, "19:00:00"); if (typeof r === "string") throw new Error(r); d = r; }
    return d;
  };

  it("a goal on the receiver is one press and matches catch-then-goal", () => {
    const one = run(d0(), { kind: "touch", player: "Ann" }, { kind: "touch", player: "Bo" }, { kind: "goal", player: "Cy" });
    const two = run(d0(), { kind: "touch", player: "Ann" }, { kind: "touch", player: "Bo" }, { kind: "touch", player: "Cy" }, { kind: "goal", player: "Cy" });
    expect(one.events.map(({ clock, ...e }) => e)).toEqual(two.events.map(({ clock, ...e }) => e));
    expect(one.events.at(-1)).toMatchObject({ action: "Point", player: "Cy", lastPlayer: "Bo", secLastPlayer: "Ann", statScore: 1 });
  });

  it("drop is for receivers; the holder's third button is throwaway", () => {
    const d = run(d0(), { kind: "touch", player: "Ann" }, { kind: "touch", player: "Bo" });
    expect(press(d, { kind: "drop", player: "Bo" })).toMatch(/own throw/);
    expect(run(d, { kind: "drop", player: "Cy" }).events.at(-1)).toMatchObject({ action: "Drop", player: "Cy", lastPlayer: "Bo", secLastPlayer: "Ann" });
    expect(run(d, { kind: "throwaway" }).events.at(-1)).toMatchObject({ action: "T-Away", player: "Bo" });
  });

  it("undo reverts a whole press", () => {
    const before = run(d0(), { kind: "touch", player: "Ann" }, { kind: "touch", player: "Bo" });
    expect(undoPress(run(before, { kind: "goal", player: "Cy" })).events).toEqual(before.events);
    expect(undoPress(run(before, { kind: "drop", player: "Cy" })).events).toEqual(before.events);
  });

  it("groups possessions and keeps flags until their possession is undone", () => {
    let d = run(d0(), { kind: "touch", player: "Ann" }, { kind: "touch", player: "Bo" }, { kind: "goal", player: "Cy" },
      { kind: "scoredOn", player: "Ann" }, { kind: "touch", player: "Bo" });
    const ps = possessions(d.events);
    expect(ps.map((p) => [p.ours, p.open, p.summary])).toEqual([
      [true, false, "Ann → Bo → Cy · Point"], [false, false, "GSO Ann"], [true, true, "Bo"],
    ]);
    d = toggleFlag(d, ps[2]);
    d = run(d, { kind: "touch", player: "Cy" });
    expect(undoPress(d).flags).toHaveLength(1);          // possession still there
    expect(undoPress(undoPress(d)).flags).toHaveLength(0); // its only touch undone
    expect(toggleFlag(toggleFlag(d, ps[0]), ps[0]).flags).toEqual(d.flags);
  });

  it("defense rows: block, scored on, and their turnover", () => {
    const d = run(draft({ startOn: "defense" }), { kind: "scoredOn", player: "Ann" });
    expect(d.events[0]).toMatchObject({ action: "GSO", player: "Ann", otherScore: 1 });
    expect(stateOf(d).phase).toBe("offense");
    expect(press(d, { kind: "block", player: "Bo" })).toMatch(/offense/);
    const t = run(draft({ startOn: "defense" }), { kind: "offensiveError" });
    expect(t.events[0].action).toBe("O-Error");
  });
});
