// Checks at every import boundary: tablet CSVs, season files, master-sheet fixtures and public
// stats snapshots. Blocking problems would corrupt salaries (NaN, Infinity, a wrong result) or
// crash the engine; warnings are oddities real recordings contain and are safe to import.
import { ruleProblems } from "../../engine/rules";
import type { LeagueInput, PlayEvent } from "../../engine/types";
import { nameKey } from "./names";

export interface Problem { message: string; blocking: boolean }

const ACTIONS = new Set(["Touch", "Point", "Drop", "T-Away", "D-Play", "GSO", "O-Error"]);
const NEEDS_PLAYER = new Set(["Touch", "Drop", "D-Play"]);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T12:00:00").getTime());
const isScore = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isName = (v: unknown) => typeof v === "string" && v.trim().length > 0;

/**
 * One tablet recording (one team's side of one game). Scores are judged on non-Touch plays:
 * the old app showed the new score on the scorer's Touch a moment early, and sometimes back.
 */
export function recordingProblems(events: PlayEvent[], label = "This recording"): Problem[] {
  const out: Problem[] = [];
  const block = (m: string) => out.push({ message: m, blocking: true });
  const warn = (m: string) => out.push({ message: m, blocking: false });
  if (!events.length) { block(`${label} has no plays.`); return out; }
  const first = events[0];
  if (!isName(first.statTeam) || !isName(first.otherTeam)) block(`${label} is missing a team name.`);
  else if (first.statTeam === first.otherTeam) block(`${label} has ${first.statTeam} playing itself.`);
  let us = 0, them = 0, noTime = 0;
  events.forEach((e, i) => {
    const row = `Play ${i + 1}`;
    if (!isDate(e.date)) block(`${row}: “${e.date}” isn't a date.`);
    if (e.date !== first.date || e.statTeam !== first.statTeam || e.otherTeam !== first.otherTeam) block(`${row} belongs to a different game.`);
    if (!ACTIONS.has(e.action)) block(`${row}: “${e.action}” isn't a play the app records.`);
    if (NEEDS_PLAYER.has(e.action) && !isName(e.player)) block(`${row}: a ${e.action} needs a player.`);
    if (!isScore(e.statScore) || !isScore(e.otherScore)) { block(`${row}: the score “${e.statScore}–${e.otherScore}” isn't a pair of whole numbers.`); return; }
    if (!/\d{1,2}:\d{2}:\d{2}/.test(e.clock ?? "")) noTime++;
    if (e.action === "Touch") return;
    const du = e.statScore - us, dt = e.otherScore - them;
    if (du < 0 || dt < 0) block(`${row}: the score goes back from ${us}–${them} to ${e.statScore}–${e.otherScore}.`);
    else if (du > 1 || dt > 1) block(`${row}: the score jumps from ${us}–${them} to ${e.statScore}–${e.otherScore}.`);
    else {
      if (e.action === "Point" && du !== 1) warn(`${row}: a Point that doesn't add to the score (${e.statScore}–${e.otherScore}).`);
      if (e.action === "GSO" && dt !== 1) warn(`${row}: a GSO that doesn't add to their score (${e.statScore}–${e.otherScore}).`);
      if (dt === 1 && e.action !== "GSO") warn(`${row}: their score rises on a ${e.action}.`);
    }
    us = e.statScore; them = e.otherScore;
  });
  if (noTime) warn(`${noTime} play(s) have no time, so the tablet cross-check can't line them up.`);
  return out;
}

/** A whole season's inputs: structure first, then the rules, then every recording. */
export function seasonInputProblems(input: LeagueInput): Problem[] {
  const out: Problem[] = [];
  const block = (m: string) => out.push({ message: m, blocking: true });
  if (!input || typeof input !== "object") return [{ message: "The file has no season data.", blocking: true }];
  for (const k of ["teams", "players", "trades", "schedule", "events", "subAssignments"] as const) {
    if (!Array.isArray((input as any)[k])) block(`The season has no ${k} list.`);
  }
  if (out.length) return out;
  for (const m of ruleProblems(input.rules)) block(`Rules: ${m}`);
  if (!Number.isInteger(input.throughWeek) || input.throughWeek < 0) block("The counted-through week isn't a week number.");

  const teams = new Set<string>();
  input.teams.forEach((t, i) => {
    if (!isName(t?.name)) block(`Team ${i + 1} has no name.`);
    else if (teams.has(t.name)) block(`Team “${t.name}” is listed twice.`);
    else teams.add(t.name);
  });
  const players = new Set<string>();
  input.players.forEach((p, i) => {
    if (!isName(p?.name)) { block(`Player ${i + 1} has no name.`); return; }
    const k = nameKey(p.name);
    if (players.has(k)) block(`${p.name} is listed twice.`);
    players.add(k);
    if (typeof p.initialSalary !== "number" || !Number.isFinite(p.initialSalary)) block(`${p.name}'s starting salary isn't a number.`);
    if (typeof p.gender !== "string") block(`${p.name} has no gender.`);
    if (p.team !== null && p.team !== undefined && !teams.has(p.team)) block(`${p.name} is on “${p.team}”, which isn't a team in this season.`);
  });
  const weeks = new Set<number>();
  let lastDate = "";
  [...input.schedule].sort((a, b) => a.week - b.week).forEach((s) => {
    if (!Number.isInteger(s.week) || s.week < 1) block(`Schedule week “${s.week}” isn't a week number.`);
    else if (weeks.has(s.week)) block(`Week ${s.week} is in the schedule twice.`);
    weeks.add(s.week);
    if (!isDate(s.date)) block(`Week ${s.week}'s date “${s.date}” isn't a date.`);
    else if (s.date <= lastDate) block(`Week ${s.week} (${s.date}) doesn't come after the week before it.`);
    else lastDate = s.date;
  });
  input.trades.forEach((t) => {
    if (!isName(t.player) || !Number.isInteger(t.afterWeek) || t.afterWeek < 0) block(`A trade${t.player ? ` of ${t.player}` : ""} is missing its player or week.`);
    if (t.toTeam !== null && !teams.has(t.toTeam)) block(`${t.player} is traded to “${t.toTeam}”, which isn't a team in this season.`);
    if (t.playerAdd !== undefined && !Number.isFinite(t.playerAdd)) block(`${t.player}'s trade salary adjustment isn't a number.`);
  });
  for (const b of input.boxScores ?? []) {
    const where = `The week ${b.week} box score for ${b.team}`;
    if (!teams.has(b.team) || !teams.has(b.opp)) block(`${where} names a team that isn't in this season.`);
    if (![0, 0.5, 1].includes(b.result)) block(`${where} has a result other than win, tie or loss.`);
    for (const l of b.lines ?? []) {
      for (const k of ["goals", "assists", "secondAssists", "blocks", "drops", "throwaways", "gso", "touches"] as const) {
        if (!isScore(l[k])) { block(`${where}: ${l.player}'s ${k} isn't a whole number.`); break; }
      }
    }
  }
  for (const o of input.officialScores ?? []) {
    if (!teams.has(o.a) || !teams.has(o.b) || o.a === o.b) block(`An official score for week ${o.week} names a team that isn't in this season.`);
    if (!isScore(o.scoreA) || !isScore(o.scoreB)) block(`The official score for ${o.a} v ${o.b}, week ${o.week}, isn't a pair of whole numbers.`);
  }
  // Every recording, grouped the way the engine groups them.
  const recs = new Map<string, PlayEvent[]>();
  for (const e of input.events) { const k = `${e?.date}|${e?.statTeam}|${e?.otherTeam}`; (recs.get(k) ?? recs.set(k, []).get(k)!).push(e); }
  for (const [k, evs] of recs) {
    const [date, team, opp] = k.split("|");
    for (const p of recordingProblems(evs, `${team}'s recording of ${date}`)) {
      out.push({ ...p, message: `${team} v ${opp}, ${date}: ${p.message}` });
    }
  }
  return out;
}

/** Up to `n` messages, most important first, with a count of the rest. */
export function summarize(problems: Problem[], n = 8): string[] {
  const sorted = [...problems].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  const shown = sorted.slice(0, n).map((p) => p.message);
  if (sorted.length > n) shown.push(`…and ${sorted.length - n} more.`);
  return shown;
}
