// When the two tablets' final scores differ, the app recommends a score and explains it; an admin
// approves it or changes it. Nothing settles on its own.
import { crossCheck, type Unmatched } from "../../engine/crosscheck";
import type { LeagueInput } from "../../engine/types";
import { shortTeam as short } from "./format";
import { weekOfDate } from "./season";

export interface Recommendation {
  week: number;
  /** Teams in display order: the recommended winner first (on a tie, the first team given). */
  first: string; second: string;
  /** Each tablet's final, from `first`'s side. */
  firstTablet: [number, number]; secondTablet: [number, number];
  /** Recommended score, `first`'s goals first. */
  score: [number, number];
  /** One-sided goals, each with a plain-language reason. */
  goals: { text: string; counted: boolean }[];
  /** Goals the other tablet contradicts: left out of the recommendation for the admin to decide. */
  conflicts: string[];
}

/** Plain-language account of one goal only one tablet has. */
function explain(u: Unmatched, a: string, b: string) {
  const own = u.side === "A" ? a : b, other = u.side === "A" ? b : a;
  const scorer = u.kind === "goal" ? own : other;
  const who = u.kind === "goal" && u.player ? ` (${u.player})` : "";
  const what = `${short(scorer)} goal at ${u.at}${who}, only on ${short(own)}'s tablet`;
  const d = u.detail;
  switch (d.reason) {
    case "stopped": return `${what}: ${short(other)}'s tablet had stopped recording ${d.seconds}s earlier. Counted.`;
    case "o-error": return `${what}: ${short(other)}'s tablet tapped O-Error at ${d.at} instead of scored-on. Counted.`;
    case "twice": return `${what}: two quick scores on ${short(own)}'s tablet (also ${d.at}) where ${short(other)}'s tablet has one. Counted; check it wasn't tapped twice.`;
    case "silent": return `${what}: ${short(other)}'s tablet has nothing for ${d.seconds}s around it, so it's probably a missed tap. Counted.`;
    case "turnover": return `${what}: ${short(other)}'s tablet shows a turnover (${d.action}${d.player ? ` ${d.player}` : ""}) at ${d.at}. Left out.`;
    default: return `${what}: ${short(other)}'s tablet was recording and has nothing that contradicts it. Counted.`;
  }
}

/** The recommendation for one game, or null unless both tablets recorded it. `a`/`b` in any order. */
export function recommend(input: LeagueInput, week: number, a: string, b: string): Recommendation | null {
  const side = (team: string, opp: string) => input.events.filter((e) => e.statTeam === team && e.otherTeam === opp && weekOfDate(input.schedule, e.date) === week);
  const evA = side(a, b), evB = side(b, a);
  if (!evA.length || !evB.length) return null;
  const c = crossCheck(evA, evB);
  const lastA = evA[evA.length - 1], lastB = evB[evB.length - 1];
  const tabA: [number, number] = [lastA.statScore, lastA.otherScore];   // a's tablet, a's side
  const tabB: [number, number] = [lastB.otherScore, lastB.statScore];   // b's tablet, a's side
  const rec: [number, number] = [c.proposed.a, c.proposed.b];
  const goals = c.unmatched.map((u) => ({ text: explain(u, a, b), counted: u.verdict !== "conflict" }));
  const conflicts = c.unmatched.filter((u) => u.verdict === "conflict").map((u) => {
    const other = u.side === "A" ? b : a;
    const d = u.detail as Extract<Unmatched["detail"], { reason: "turnover" }>;
    return `${short(other)}'s tablet shows a turnover at ${d.at}. The recommendation leaves this goal out; change it if it counted.`;
  });
  const flip = rec[1] > rec[0];
  const sw = (x: [number, number]): [number, number] => (flip ? [x[1], x[0]] : x);
  return {
    week, first: flip ? b : a, second: flip ? a : b,
    firstTablet: sw(flip ? tabB : tabA), secondTablet: sw(flip ? tabA : tabB), score: sw(rec), goals, conflicts,
  };
}

/** "Team 3's tablet 16–13 · Team 1's tablet 14–12" */
export const tabletsText = (r: Recommendation) =>
  `${short(r.first)}'s tablet ${r.firstTablet[0]}–${r.firstTablet[1]} · ${short(r.second)}'s tablet ${r.secondTablet[0]}–${r.secondTablet[1]}`;

/** "Team 3 v Team 1, week 3: the tablets disagree (16–13 vs 14–12). Recommended 16–13" */
export const differenceLabel = (r: Recommendation) =>
  `${short(r.first)} v ${short(r.second)}, week ${r.week}: the tablets disagree (${r.firstTablet.join("–")} vs ${r.secondTablet.join("–")}). Recommended ${r.score.join("–")}`;
