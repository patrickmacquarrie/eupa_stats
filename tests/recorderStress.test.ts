// Stress tests for Track Stats: thousands of simulated games, tapped the way stat-takers really
// tap (wrong buttons, undos, flags, reloads, clock fiddling), with every invariant checked after
// every press. A seeded random generator makes any failure reproducible from its seed.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tallyRecording } from "../engine/compute";
import { crossCheck } from "../engine/crosscheck";
import type { PlayEvent } from "../engine/types";
import { tabletCsvToEvents } from "../src/lib/csv";
import {
  elapsedMs, gameTime, possessions, press, setClock, stateOf, toggleClock, toggleFlag, toTabletCsv, undoPress, type Draft, type Press,
} from "../src/lib/recorder";

/** mulberry32: small, fast, and the same sequence for the same seed everywhere. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)], chance: (p: number) => next() < p };
}

// Names that have broken CSV and storage code elsewhere: commas, quotes, apostrophes, accents.
const TEAM_A = ["Ann Arbour", "O'Neil Brady", "Smith, Jr.", 'Bo "Bullet" Birch', "Zoë Ångström", "Li Wei", "Mary-Kate Ó Briain"];
const TEAM_B = ["Cy Cole", "Dee Dunn", "Eve \"E\" Ellis", "Fay, Fern", "Gus Gómez", "Hal O'Hara", "Ivy Ito"];

const draft = (team: string, opp: string, present: string[], startOn: Draft["startOn"]): Draft => ({
  seasonId: `stress:${team}`, date: "2026-10-05", team, opp, startOn, gameLengthMin: 40,
  present, subs: [], newPlayers: [], events: [], gameTimes: [], clock: { runningSince: null, elapsedMs: 0 },
});

/** Fails with the label when an invariant breaks. Plain checks: this runs after every press. */
function must(ok: boolean, label: string, what: string) {
  if (!ok) throw new Error(`${label}: ${what}`);
}
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

/** Every invariant a recording must keep after any sequence of presses. */
function checkDraft(d: Draft, label: string) {
  const s = stateOf(d);
  // Every event carries the running score, never going backwards; the state agrees.
  let us = 0, them = 0, pointsBy = 0, gsosBy = 0;
  for (const [i, e] of d.events.entries()) {
    if (e.action === "Point") { us++; if (e.player) pointsBy++; }
    if (e.action === "GSO") { them++; if (e.player) gsosBy++; }
    must(e.statScore === us && e.otherScore === them, label, `score on event ${i}`);
    must(e.date === d.date && e.statTeam === d.team && e.otherTeam === d.opp, label, `teams and date on event ${i}`);
  }
  must(s.us === us && s.them === them, label, "score");
  must(d.gameTimes.length === d.events.length, label, "one game time per event");
  // Possessions cover every event exactly once, in order; only the last can still be open.
  const poss = possessions(d.events);
  let next = 0;
  for (const [i, p] of poss.entries()) {
    must(p.start === next && p.end >= p.start, label, "possessions contiguous");
    must(!p.open || i === poss.length - 1, label, "only the last possession open");
    next = p.end + 1;
  }
  must(next === d.events.length, label, "possessions cover every event");
  // Flags point at real possessions.
  for (const f of d.flags ?? []) must(poss.some((p) => p.start === f.start), label, "flag on a real possession");
  // The undo stack accounts for every event.
  must((d.undo ?? []).reduce((n, u) => n + u.added, 0) === d.events.length, label, "undo stack");
  // The individual stats add up to the score.
  if (d.events.length) {
    const t = tallyRecording(d.events, (n) => n);
    const lines = [...t.lines.values()];
    must(lines.reduce((n, l) => n + l.goals, 0) === pointsBy, label, "goals add up");
    must(lines.reduce((n, l) => n + l.gso, 0) === gsosBy, label, "GSOs add up");
    must(t.finalScore === us && t.finalOppScore === them, label, "final score");
  }
}

/** A random press, sometimes one that doesn't fit the moment (the app must refuse it, unchanged). */
function randomPress(r: ReturnType<typeof rng>, d: Draft): Press {
  const p = r.pick(d.present);
  return r.pick<Press>([
    { kind: "touch", player: p }, { kind: "goal", player: p }, { kind: "drop", player: p }, { kind: "throwaway" },
    { kind: "block", player: p }, { kind: "scoredOn", player: p }, { kind: "offensiveError" },
  ]);
}

describe("Track Stats under stress", () => {
  it("keeps every invariant through 300 games of random taps, wrong taps, undos, flags, reloads and clock changes", () => {
    let presses = 0, refused = 0, undos = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      let d = draft("Team A", "Team B", TEAM_A, r.chance(0.5) ? "offense" : "defense");
      const history: Draft[] = [];
      let now = 1_700_000_000_000 + seed * 1000;
      const steps = 60 + r.int(400);
      for (let step = 0; step < steps; step++) {
        now += 1000 + r.int(20_000);
        const roll = r.next();
        const label = `seed ${seed} step ${step}`;
        if (roll < 0.08 && d.events.length) {
          // Undo goes back exactly one press.
          const before = history.pop()!;
          d = undoPress(d);
          undos++;
          must(same(d.events, before.events) && same(d.gameTimes, before.gameTimes), label, "undo goes back exactly one press");
          must(same(stateOf(d), stateOf(before)), label, "undo restores the possession");
        } else if (roll < 0.11 && d.events.length) {
          d = toggleFlag(d, r.pick(possessions(d.events)));
        } else if (roll < 0.13) {
          d = toggleClock(d, now);
        } else if (roll < 0.14) {
          d = setClock(d, 20 + r.int(30), r.int(20 * 60_000), now);
        } else if (roll < 0.18) {
          // A reload: the game comes back from storage exactly as it was.
          d = JSON.parse(JSON.stringify(d));
        } else {
          const before = JSON.stringify(d);
          const clock = new Date(now).toTimeString();
          const out = press(d, randomPress(r, d), clock, now);
          presses++;
          if (typeof out === "string") {
            refused++;
            must(JSON.stringify(d) === before, label, "a refused tap changes nothing");
          } else {
            history.push(JSON.parse(before));
            d = out;
          }
        }
        checkDraft(d, label);
        must(elapsedMs(d.clock, now) >= 0 && /^\d\d:\d\d:\d\d$/.test(gameTime(d, now)), label, "clock");
      }
      // The finished game survives the CSV, cell for cell, with tricky names.
      if (d.events.length) {
        const back = tabletCsvToEvents(toTabletCsv(d.events));
        expect(back, `seed ${seed}: CSV round trip`).toEqual(d.events);
        expect(toTabletCsv(back)).toBe(toTabletCsv(d.events));
      }
    }
    // The run really exercised refusals and undos, not just happy paths.
    expect(presses).toBeGreaterThan(50_000);
    expect(refused).toBeGreaterThan(5_000);
    expect(undos).toBeGreaterThan(3_000);
  }, 120_000);

  it("two tablets recording the same 200 simulated games agree on every score and every player's line", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(10_000 + seed);
      const aStarts = r.chance(0.5);
      let a = draft("Team A", "Team B", TEAM_A, aStarts ? "offense" : "defense");
      let b = draft("Team B", "Team A", TEAM_B, aStarts ? "defense" : "offense");
      // What really happened, per player, to compare each tablet against.
      const truth = new Map<string, { goals: number; assists: number; blocks: number; drops: number; throwaways: number }>();
      const credit = (n: string, k: "goals" | "assists" | "blocks" | "drops" | "throwaways") => {
        const t = truth.get(n) ?? { goals: 0, assists: 0, blocks: 0, drops: 0, throwaways: 0 };
        t[k]++; truth.set(n, t);
      };
      let now = 1_700_000_000_000, aHas = aStarts;
      const tap = (d: Draft, p: Press) => {
        const out = press(d, p, new Date(now).toTimeString(), now);
        if (typeof out === "string") throw new Error(`seed ${seed}: a real play was refused: ${out} (${JSON.stringify(p)})`);
        return out;
      };
      let goalsA = 0, goalsB = 0;
      while (goalsA < 15 && goalsB < 15 && now < 1_700_000_000_000 + 3 * 3600_000) {
        // One possession: a few completed passes, then how it ended.
        const offense = aHas ? TEAM_A : TEAM_B;
        let off = aHas ? a : b, def = aHas ? b : a;
        const passes: string[] = [];
        let holder = "";
        const n = 1 + r.int(8);
        for (let i = 0; i < n; i++) {
          let next = r.pick(offense);
          while (next === holder) next = r.pick(offense);
          now += 2000 + r.int(8000);
          off = tap(off, { kind: "touch", player: next });
          passes.push(next); holder = next;
        }
        now += 3000 + r.int(9000);
        const end = r.next();
        if (end < 0.45) {
          // A goal: caught by a receiver (Point on their row), scored-on on the other tablet.
          let scorer = r.pick(offense);
          while (scorer === holder) scorer = r.pick(offense);
          off = tap(off, { kind: "goal", player: scorer });
          def = tap(def, { kind: "scoredOn", player: r.pick(aHas ? TEAM_B : TEAM_A) });
          credit(scorer, "goals"); credit(holder, "assists");
          if (aHas) goalsA++; else goalsB++;
        } else if (end < 0.6) {
          let dropper = r.pick(offense);
          while (dropper === holder) dropper = r.pick(offense);
          off = tap(off, { kind: "drop", player: dropper });
          def = tap(def, { kind: "offensiveError" });
          credit(dropper, "drops");
        } else if (end < 0.8) {
          off = tap(off, { kind: "throwaway" });
          def = tap(def, { kind: "offensiveError" });
          credit(holder, "throwaways");
        } else {
          // A block: the thrower's throwaway on one tablet, the defender's D-Play on the other.
          const defender = r.pick(aHas ? TEAM_B : TEAM_A);
          off = tap(off, { kind: "throwaway" });
          def = tap(def, { kind: "block", player: defender });
          credit(holder, "throwaways"); credit(defender, "blocks");
        }
        if (aHas) { a = off; b = def; } else { b = off; a = def; }
        aHas = !aHas;
        // Tablets get reloaded mid-game.
        if (r.chance(0.05)) a = JSON.parse(JSON.stringify(a));
        if (r.chance(0.05)) b = JSON.parse(JSON.stringify(b));
      }
      checkDraft(a, `seed ${seed} A`); checkDraft(b, `seed ${seed} B`);
      const cc = crossCheck(a.events, b.events);
      expect(cc.agree, `seed ${seed}: tablets agree`).toBe(true);
      expect(cc.finalA).toBe(`${goalsA}-${goalsB}`);
      expect(cc.unmatched, `seed ${seed}: every Point has its GSO`).toEqual([]);
      // Each tablet's lines match what happened, player by player.
      for (const [d, names] of [[a, TEAM_A], [b, TEAM_B]] as const) {
        const lines = tallyRecording(d.events, (x) => x).lines;
        for (const n of names) {
          const want = truth.get(n) ?? { goals: 0, assists: 0, blocks: 0, drops: 0, throwaways: 0 };
          const got = lines.get(n);
          expect({ goals: got?.goals ?? 0, assists: got?.assists ?? 0, blocks: got?.blocks ?? 0, drops: got?.drops ?? 0, throwaways: got?.throwaways ?? 0 },
            `seed ${seed}: ${n}`).toEqual(want);
        }
      }
      // And both survive the CSV byte for byte.
      for (const d of [a, b]) expect(toTabletCsv(tabletCsvToEvents(toTabletCsv(d.events)))).toBe(toTabletCsv(d.events));
    }
  }, 60_000);

  it("stays fast in a very long game: 3,000 presses", () => {
    const r = rng(99);
    let d = draft("Team A", "Team B", TEAM_A, "offense");
    const t0 = performance.now();
    let now = 1_700_000_000_000;
    while (d.events.length < 3000) {
      now += 1000;
      const out = press(d, randomPress(r, d), new Date(now).toTimeString(), now);
      if (typeof out !== "string") d = out;
    }
    const perPress = (performance.now() - t0) / 3000;
    // A tap on a tablet must feel instant; this is a laptop, so the bar is well below that.
    expect(perPress).toBeLessThan(5);
    checkDraft(d, "long game");
  });

  it("downloads the real tablet files byte for byte after they're in the season", () => {
    for (const f of readdirSync("fixtures/disputes").filter((x) => x.endsWith(".csv"))) {
      const text = readFileSync(`fixtures/disputes/${f}`, "utf8");
      const events: PlayEvent[] = tabletCsvToEvents(text);
      // Through storage (JSON) and back out as a CSV: identical to what the tablet wrote.
      expect(toTabletCsv(JSON.parse(JSON.stringify(events))), f).toBe(text);
    }
  });
});
