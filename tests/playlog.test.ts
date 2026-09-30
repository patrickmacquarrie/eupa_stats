import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tallyRecording } from "../engine/compute";
import type { PlayEvent } from "../engine/types";
import { tabletCsvToEvents } from "../src/lib/csv";
import { changed, insertRow, problems, remapIndex, removeRow, rowsOf, setAction, setPlayer } from "../src/lib/playlog";
import { recordingsOf } from "../src/lib/season";

const sample = () => tabletCsvToEvents(readFileSync("fixtures/disputes/2026-08-31_T3vT2_team2.csv", "utf8"));
const at = (evs: PlayEvent[], pred: (e: PlayEvent, i: number) => boolean) => evs.findIndex(pred);

describe("play log editor", () => {
  it("changing who caught a pass fixes the next touch and the point's assists, nothing else", () => {
    const evs = sample();
    // Touch Masha / Touch James / Touch Aven / Point Aven (from James, Masha): change James to Mika.
    const j = at(evs, (e, i) => e.action === "Touch" && e.player === "James Cannon" && evs[i + 2]?.action === "Point");
    const rows = setPlayer(rowsOf(evs), j, "Mika Uusnakki");
    const point = rows[j + 2].e;
    expect(point).toMatchObject({ action: "Point", player: "Aven Unger", lastPlayer: "Mika Uusnakki", secLastPlayer: "Masha Parshykova" });
    expect(rows.filter((r) => changed(r, evs)).map((r) => r.orig)).toEqual([j, j + 1, j + 2]);
  });

  it("inserting a missed touch shifts the assists", () => {
    const evs = sample();
    const p = at(evs, (e) => e.action === "Point");
    const rows = insertRow(rowsOf(evs), p, "Touch", "Alex Wong");
    expect(rows[p].e).toMatchObject({ action: "Touch", player: "Alex Wong", lastPlayer: evs[p - 1].player });
    expect(rows[p + 1].e).toMatchObject({ action: "Point", player: "Alex Wong", lastPlayer: evs[p - 1].player, secLastPlayer: evs[p - 1].lastPlayer });
  });

  it("deleting a point lowers every later score by one", () => {
    const evs = sample();
    const p = at(evs, (e) => e.action === "Point");
    const rows = removeRow(rowsOf(evs), p);
    const last = rows[rows.length - 1].e, orig = evs[evs.length - 1];
    expect([last.statScore, last.otherScore]).toEqual([orig.statScore - 1, orig.otherScore]);
  });

  it("changing a drop to a point makes the thrower's pass an assist and adds a point", () => {
    const evs = sample();
    const d = at(evs, (e) => e.action === "Drop" && !!e.lastPlayer);
    const rows = setAction(rowsOf(evs), d, "Point");
    // A Point belongs to the holder; the dropper never caught it, so first insert their touch.
    expect(rows[d].e.player).toBe(evs[d].lastPlayer);
    const withTouch = setAction(insertRow(rowsOf(evs), d, "Touch", evs[d].player!), d + 1, "Point");
    expect(withTouch[d + 1].e).toMatchObject({ action: "Point", player: evs[d].player, lastPlayer: evs[d].lastPlayer });
    expect(withTouch[withTouch.length - 1].e.statScore).toBe(evs[evs.length - 1].statScore + 1);
  });

  it("a no-op edit changes nothing outside its possession on every real recording", () => {
    for (const f of ["fall-2026", "thursday-s1-2026", "pl-2025"]) {
      const fx = JSON.parse(readFileSync(`fixtures/${f}.json`, "utf8"));
      for (const [, evs] of recordingsOf(fx.events as PlayEvent[])) {
        // Re-set the first Touch's player to itself: repair runs over that possession and every score.
        const i = evs.findIndex((e) => e.action === "Touch" && e.player);
        const rows = setPlayer(rowsOf(evs), i, evs[i].player!);
        const moved = rows.filter((r) => r.orig !== null && r.orig > i && changed(r, evs));
        // Only plays inside the edited possession may change (the old app's chain quirks there).
        const endOfPossession = evs.findIndex((e, j) => j > i && e.action !== "Touch");
        for (const r of moved) expect(r.orig!).toBeLessThanOrEqual(endOfPossession);
        expect(tallyRecording(rows.map((r) => r.e), (n) => n).finalScore).toBe(tallyRecording(evs, (n) => n).finalScore);
      }
    }
  });

  it("flags problems and remaps saved indexes", () => {
    const evs = sample();
    const rows = removeRow(rowsOf(evs), 0);
    expect(remapIndex(rows, 0, "start")).toBe(0);
    expect(remapIndex(rows, 5, "end")).toBe(4);
    const bad = setAction(rowsOf(evs), 1, "D-Play"); // a D-Play while we have the disc
    expect(problems(rowsOf(evs)).size).toBe(0);
    expect(problems(bad).size).toBeGreaterThan(0);
  });
});
