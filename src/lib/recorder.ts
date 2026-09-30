// Live stat entry: the old tablet app's rules, reproduced so recordings come out in the exact
// shape the engine and the tablet cross-check already read. One device records ONE team's side.
//
// Offense: each catch is a Touch that remembers the last two throwers; a Point credits the
// holder with the goal and those two with the assist and second assist. A Drop is charged to
// the receiver (the thrower is remembered); a Throwaway to the holder. Either turns us over.
// Defense: a block (D-Play) or an opponent error (O-Error) wins the disc back; "They scored"
// (GSO) adds a point for the other team and optionally notes who was scored on.
import type { Player, PlayEvent } from "../../engine/types";

export type Phase = "offense" | "defense";

export interface Draft {
  seasonId: string;
  date: string;          // ISO date of the game night
  team: string;          // team this device is recording
  opp: string;
  startOn: Phase;
  gameLengthMin: number;
  present: string[];     // players available to tap: rostered players who showed up, plus subs
  subs: string[];        // which of `present` are subbing in
  newPlayers: Player[];  // first-time subs, added to the season when the game is saved
  events: PlayEvent[];
  /** Game clock at each event (parallel to `events`), for the CSV export. */
  gameTimes: string[];
  clock: { runningSince: number | null; elapsedMs: number };
}

export interface GameState {
  phase: Phase;
  /** Who has the disc (offense), then the previous two throwers. */
  chain: string[];
  us: number;
  them: number;
}

const ENDS_POSSESSION = new Set(["Point", "Drop", "T-Away", "D-Play", "O-Error", "GSO"]);

export function stateOf(d: Pick<Draft, "startOn" | "events">): GameState {
  const s: GameState = { phase: d.startOn, chain: [], us: 0, them: 0 };
  for (const e of d.events) {
    switch (e.action) {
      case "Touch": if (e.player) s.chain = [e.player, ...s.chain].slice(0, 3); break;
      case "Point": s.us++; s.phase = "defense"; s.chain = []; break;
      case "Drop": case "T-Away": s.phase = "defense"; s.chain = []; break;
      case "D-Play": case "O-Error": s.phase = "offense"; s.chain = []; break;
      case "GSO": s.them++; s.phase = "offense"; s.chain = []; break;
    }
  }
  return s;
}

export type Tap =
  | { action: "Touch"; player: string }
  | { action: "Point" }
  | { action: "Drop"; player: string }
  | { action: "T-Away" }
  | { action: "D-Play"; player: string }
  | { action: "O-Error" }
  | { action: "GSO"; player?: string | null };

export const elapsedMs = (c: Draft["clock"], now = Date.now()) => c.elapsedMs + (c.runningSince ? now - c.runningSince : 0);

/** "00:24:52": time left on the game clock, as the old app wrote it. */
export function gameTime(d: Draft, now = Date.now()) {
  const left = Math.max(0, Math.round((d.gameLengthMin * 60000 - elapsedMs(d.clock, now)) / 1000));
  return [Math.floor(left / 3600), Math.floor((left % 3600) / 60), left % 60].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Whether a tap is allowed right now, and why not. */
export function canTap(s: GameState, t: Tap): string | null {
  const holder = s.chain[0];
  if (s.phase === "offense") {
    if (t.action === "Touch") return t.player === holder ? `${t.player} already has the disc` : null;
    if (t.action === "Point" || t.action === "T-Away") return holder ? null : "Tap who has the disc first";
    if (t.action === "Drop") return !holder ? "Tap the thrower first" : t.player === holder ? "The thrower can't drop their own throw" : null;
    return "We're on offense";
  }
  return ["D-Play", "O-Error", "GSO"].includes(t.action) ? null : "We're on defense";
}

/** Builds the event for a tap. `clock` is the device time string the cross-check lines up on. */
export function eventFor(d: Draft, t: Tap, clock = new Date().toTimeString()): PlayEvent {
  const s = stateOf(d);
  const [holder, prev, prev2] = s.chain;
  let player: string | null = null, lastPlayer: string | null = null, secLastPlayer: string | null = null;
  let us = s.us, them = s.them;
  switch (t.action) {
    case "Touch": [player, lastPlayer, secLastPlayer] = [t.player, holder ?? null, prev ?? null]; break;
    case "Point": [player, lastPlayer, secLastPlayer] = [holder, prev ?? null, prev2 ?? null]; us++; break;
    case "Drop": [player, lastPlayer, secLastPlayer] = [t.player, holder ?? null, prev ?? null]; break;
    case "T-Away": player = holder; break;
    case "D-Play": player = t.player; break;
    case "GSO": player = t.player ?? null; them++; break;
  }
  return { date: d.date, clock, statTeam: d.team, otherTeam: d.opp, statScore: us, otherScore: them, action: t.action, player, lastPlayer, secLastPlayer };
}

/** One line of the play feed. */
export function describe(e: PlayEvent) {
  switch (e.action) {
    case "Touch": return e.lastPlayer ? `${e.lastPlayer} → ${e.player}` : `${e.player} picks up`;
    case "Point": return `GOAL ${e.player}${e.lastPlayer ? ` (from ${e.lastPlayer}${e.secLastPlayer ? `, ${e.secLastPlayer}` : ""})` : ""}`;
    case "Drop": return `Drop by ${e.player}${e.lastPlayer ? ` (from ${e.lastPlayer})` : ""}`;
    case "T-Away": return `Throwaway by ${e.player}`;
    case "D-Play": return `Block by ${e.player}`;
    case "O-Error": return "Their turnover";
    case "GSO": return `They scored${e.player ? ` (on ${e.player})` : ""}`;
    default: return e.action;
  }
}

/** The old tablet app's CSV format, so a recording can go to another device or the old tools. */
export function toTabletCsv(events: PlayEvent[], gameTimes?: string[]) {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["date", "time", "gameTime", "statTeam", "otherTeam", "statTeamScore", "otherTeamScore", "action", "player", "lastPlayer", "secLastPlayer", "turnover"];
  const rows = events.map((e, i) => [
    new Date(e.date + "T12:00:00").toDateString(), e.clock ?? "", gameTimes?.[i] ?? "", e.statTeam, e.otherTeam, e.statScore, e.otherScore,
    e.action, e.player ?? "", e.lastPlayer ?? "", e.secLastPlayer ?? "", ENDS_POSSESSION.has(e.action) ? "true" : "false",
  ]);
  return "﻿" + [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}
