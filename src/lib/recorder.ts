// Live stat entry: the old tablet app's rules, reproduced so recordings come out in the exact
// shape the engine and the tablet cross-check already read. One device records ONE team's side.
//
// Offense: each catch is a Touch that remembers the last two throwers; a Point credits the
// holder with the goal and those two with the assist and second assist. A Drop is charged to
// the receiver (the thrower is remembered); a Throwaway to the holder. Either turns us over.
// Defense: a D-Play or an offensive error by the other team (O-Error) wins the disc back; GSO
// (GSO) adds a point for the other team and notes who was scored on.
import type { Player, PlayEvent } from "../../engine/types";

export type Phase = "offense" | "defense";

export interface Draft {
  seasonId: string;
  date: string;          // ISO date of the game night
  team: string;          // team this device is recording
  opp: string;
  startOn: Phase;
  gameLengthMin: number;
  /** What this device's team is wearing; the other team wears the opposite. */
  jersey?: "light" | "dark";
  present: string[];     // players available to tap: rostered players who showed up, plus subs
  subs: string[];        // which of `present` are subbing in
  newPlayers: Player[];  // first-time subs, added to the season when the game is saved
  events: PlayEvent[];
  /** Game clock at each event (parallel to `events`), for the CSV export. */
  gameTimes: string[];
  /** One entry per button press, so Undo reverts a whole press (see `press`). */
  undo?: { added: number }[];
  /** Possessions flagged as wrong during the game. */
  flags?: Flag[];
  /** `started`: the clock has run at least once (it starts itself on the first play; pausing keeps this true). */
  clock: { runningSince: number | null; elapsedMs: number; started?: boolean };
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
    case "Touch": return `Touch ${e.player}${e.lastPlayer ? ` (from ${e.lastPlayer})` : ""}`;
    case "Point": return `Point ${e.player}${e.lastPlayer ? ` (from ${e.lastPlayer}${e.secLastPlayer ? `, ${e.secLastPlayer}` : ""})` : ""}`;
    case "Drop": return `Drop ${e.player}${e.lastPlayer ? ` (from ${e.lastPlayer})` : ""}`;
    case "T-Away": return `Throwaway ${e.player}`;
    case "D-Play": return `D-Play ${e.player}`;
    case "O-Error": return "Offensive error";
    case "GSO": return `GSO${e.player ? ` ${e.player}` : ""}`;
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

/** A button on a player's row, or the team-level "Offensive error" (O-Error). */
export type Press =
  | { kind: "touch" | "goal" | "drop" | "block" | "scoredOn"; player: string }
  | { kind: "throwaway" | "offensiveError" };

/**
 * What a row button does, given who has the disc. On offense each row shows Touch, Point and a
 * third button that is Throwaway on the holder's row and Drop on everyone else's:
 *  point on a receiver    → their catch (Touch) and the Point, in one press
 *  point on the holder    → the Point
 *  drop on a receiver     → their drop of the holder's throw
 *  throwaway (holder)     → the holder's throwaway
 * Returns the updated draft, or the reason the press doesn't fit the possession.
 */
export function press(d: Draft, p: Press, clock = new Date().toTimeString(), now = Date.now()): Draft | string {
  const s = stateOf(d);
  const gt = gameTime(d, now);
  const taps: Tap[] = [];
  switch (p.kind) {
    case "touch": taps.push({ action: "Touch", player: p.player }); break;
    case "goal":
      if (s.phase === "offense" && p.player !== s.chain[0]) taps.push({ action: "Touch", player: p.player });
      taps.push({ action: "Point" });
      break;
    case "drop": taps.push({ action: "Drop", player: p.player }); break;
    case "throwaway": taps.push({ action: "T-Away" }); break;
    case "block": taps.push({ action: "D-Play", player: p.player }); break;
    case "scoredOn": taps.push({ action: "GSO", player: p.player }); break;
    case "offensiveError": taps.push({ action: "O-Error" }); break;
  }
  let next = d;
  for (const t of taps) {
    const why = canTap(stateOf(next), t);
    if (why) return why;
    next = { ...next, events: [...next.events, eventFor(next, t, clock)], gameTimes: [...next.gameTimes, gt] };
  }
  // The game clock starts itself with the first recorded play.
  const neverRun = !d.clock.runningSince && !(d.clock.started ?? d.clock.elapsedMs > 0);
  const gameClock = neverRun ? { runningSince: now, elapsedMs: d.clock.elapsedMs, started: true } : next.clock;
  return { ...next, clock: gameClock, undo: [...(d.undo ?? []), { added: taps.length }] };
}

/** Reverts the last press (or the last event, for drafts saved before presses were tracked). */
export function undoPress(d: Draft): Draft {
  const stack = d.undo ?? [];
  const n = stack[stack.length - 1]?.added ?? 1;
  const keep = Math.max(0, d.events.length - n);
  return {
    ...d,
    events: d.events.slice(0, keep),
    gameTimes: d.gameTimes.slice(0, keep),
    undo: stack.slice(0, -1),
    // A flag on a possession that no longer exists goes with it.
    flags: d.flags?.filter((f) => f.start < keep),
    // Undoing every play puts the game back before kickoff, clock included.
    ...(keep === 0 ? { clock: { runningSince: null, elapsedMs: 0, started: false } } : {}),
  };
}

export interface Possession {
  /** Event indexes, inclusive. */
  start: number; end: number;
  ours: boolean;
  /** Still going: we have the disc and nothing has ended the possession yet. */
  open: boolean;
  summary: string;
}

/** Groups a recording into possessions: ours (touches up to a Point or turnover) and theirs. */
export function possessions(events: PlayEvent[]): Possession[] {
  const out: Possession[] = [];
  let start = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!ENDS_POSSESSION.has(e.action)) continue;
    const ours = ["Point", "Drop", "T-Away"].includes(e.action);
    const evs = events.slice(start, i + 1);
    out.push({ start, end: i, ours, open: false, summary: summarize(evs) });
    start = i + 1;
  }
  if (start < events.length) out.push({ start, end: events.length - 1, ours: true, open: true, summary: summarize(events.slice(start)) });
  return out;
}

function summarize(evs: PlayEvent[]) {
  const touches = evs.filter((e) => e.action === "Touch").map((e) => e.player);
  const last = evs[evs.length - 1];
  const chain = touches.join(" → ");
  switch (last.action) {
    case "Touch": return chain;
    case "Point": return `${chain} · Point`;
    case "Drop": return `${chain}${chain ? " → " : ""}Drop ${last.player}`;
    case "T-Away": return `${chain} · Throwaway`;
    default: return describe(last);
  }
}

/**
 * A possession the stat-taker marked as wrong, to fix after the game. Keyed by the possession's
 * first event; `end` is refreshed when the game is saved, since an open possession keeps growing.
 */
export interface Flag { start: number; end: number; clock: string; note?: string }

export function toggleFlag(d: Draft, p: Possession): Draft {
  const on = d.flags?.some((f) => f.start === p.start);
  return {
    ...d,
    flags: on ? d.flags!.filter((f) => f.start !== p.start)
      : [...(d.flags ?? []), { start: p.start, end: p.end, clock: (d.events[p.end]?.clock ?? "").slice(0, 8) }],
  };
}

/** Start or pause the game clock by hand. */
export function toggleClock(d: Draft, now = Date.now()): Draft {
  return { ...d, clock: d.clock.runningSince
    ? { runningSince: null, elapsedMs: elapsedMs(d.clock, now), started: true }
    : { runningSince: now, elapsedMs: d.clock.elapsedMs, started: true } };
}

/**
 * Change the game length and/or the time left (to match the field's clock). A running clock keeps
 * running from the new time; one that hasn't started yet still starts itself on the first play.
 */
export function setClock(d: Draft, lengthMin: number, leftMs: number, now = Date.now()): Draft {
  const length = Math.max(1, lengthMin);
  const elapsed = Math.min(length * 60000, Math.max(0, length * 60000 - leftMs));
  const running = d.clock.runningSince !== null;
  const started = running || (d.clock.started ?? d.clock.elapsedMs > 0);
  return { ...d, gameLengthMin: length, clock: { elapsedMs: elapsed, runningSince: running ? now : null, started } };
}

/** "24:30" or "1:05:00" → milliseconds; null if it isn't a time. */
export function parseClock(s: string): number | null {
  const parts = s.trim().split(":").map((x) => x.trim());
  if (!parts.length || parts.length > 3 || parts.some((x) => !/^\d+$/.test(x))) return null;
  const n = parts.map(Number);
  const secs = n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n.length === 2 ? n[0] * 60 + n[1] : n[0] * 60;
  return secs * 1000;
}
