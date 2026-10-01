// An official score is the admin's decision about one game, made against that game's
// recordings as they were at the time. It stores a fingerprint of them (`basis`); when the
// recordings or box scores change afterwards, the score still applies but needs reconfirming.
import type { LeagueInput } from "../../engine/types";
import { weekOfDate } from "./season";

export type OfficialScore = NonNullable<LeagueInput["officialScores"]>[number];

const sameGame = (o: { week: number; a: string; b: string }, week: number, a: string, b: string) =>
  o.week === week && ((o.a === a && o.b === b) || (o.a === b && o.b === a));

export const officialFor = (input: LeagueInput, week: number, a: string, b: string) =>
  (input.officialScores ?? []).find((o) => sameGame(o, week, a, b));

/** FNV-1a, 32-bit: enough to notice a change, not a security measure. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Fingerprint of everything the game's score is decided from: both tablets' plays and any box scores. */
export function gameBasis(input: LeagueInput, week: number, a: string, b: string) {
  const pair = (x: string, y: string) => (x === a && y === b) || (x === b && y === a);
  const side = (team: string) => ({
    events: input.events.filter((e) => e.statTeam === team && pair(e.statTeam, e.otherTeam) && weekOfDate(input.schedule, e.date) === week)
      .map((e) => [e.date, e.clock, e.statScore, e.otherScore, e.action, e.player, e.lastPlayer, e.secLastPlayer]),
    box: (input.boxScores ?? []).find((x) => x.week === week && x.team === team && pair(x.team, x.opp)) ?? null,
  });
  const json = JSON.stringify([side(a < b ? a : b), side(a < b ? b : a)]);
  return `${json.length.toString(36)}.${hash(json)}`;
}

/** The recordings changed since the official score was set (or it predates fingerprints). */
export const needsReconfirming = (input: LeagueInput, o: OfficialScore) => o.basis !== gameBasis(input, o.week, o.a, o.b);

/** Set, update or reconfirm a game's official score against its current recordings. */
export function setOfficial(input: LeagueInput, week: number, a: string, b: string, scoreA: number, scoreB: number): LeagueInput {
  return {
    ...input,
    officialScores: [
      ...(input.officialScores ?? []).filter((o) => !sameGame(o, week, a, b)),
      { week, a, b, scoreA, scoreB, basis: gameBasis(input, week, a, b) },
    ],
  };
}

export const clearOfficial = (input: LeagueInput, week: number, a: string, b: string): LeagueInput =>
  ({ ...input, officialScores: (input.officialScores ?? []).filter((o) => !sameGame(o, week, a, b)) });
