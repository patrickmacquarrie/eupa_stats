// Starting a season from a roster pasted out of a spreadsheet (or a CSV file), a weekly schedule,
// and a rule set. Everything is checked before the season is created.
import { shortTeam } from "./format";
import type { LeagueInput, LeagueRules, Player } from "../../engine/types";
import { parseCsv } from "./csv";
import { likelySame, nameKey } from "./names";
import { SEASON_SCHEMA, newId, type Season } from "./season";

export interface RosterRow { line: number; name: string; gender: string; team: string | null; salary: number }
export interface RosterIssue { line: number | null; message: string; blocking: boolean }
export interface ParsedRoster { rows: RosterRow[]; issues: RosterIssue[]; teams: string[] }

/**
 * Defaults for a new season. Existing seasons keep the rules stored with them: absences after the
 * early weeks use the player's average to date, no cap bumps, and plugs priced at the average
 * salary of rostered players of their gender.
 */
export const EUPA_RULES: LeagueRules = {
  weights: { win: 100000, goal: 100000, assist: 100000, secondAssist: 0, block: 100000, drop: -100000, throwaway: -100000, gso: 0 },
  tieWeightFactor: 0.5,
  absence: { pctOfInitialPerWeek: 0.1, pctRuleWeeks: 2, thereafter: "avgToDate", floorAtSubGrowth: true },
  matchesPerWeek: 2,
  capBuffer: 200000,
  capExtraByWeek: {},
  teamsForCapAverage: 3,
  plugMode: "leagueAverage",
};

const SUB_TEAM = /^(sub|subs|sub pool|substitutes?|ze sub team|none|-|–)$/i;

/** "F", "Female", "W", "F+" → "F"; "M", "Male", "Open", "M+" → "M"; "X" → "X". */
export function normGender(s: string): string | null {
  const t = s.trim().toLowerCase().replace(/^sub\s*/, "");
  if (/^(f|w|female|woman|women|womxn|f\+|fmp)$/.test(t)) return "F";
  if (/^(m|male|man|men|m\+|mmp|o|open)$/.test(t)) return "M";
  if (/^x$/.test(t)) return "X";
  return null;
}

/** "$1,250,000", "1.25M", "750k", "(250,000)", "-250000" → number; null if it isn't one. */
export function parseMoney(s: string): number | null {
  let t = s.trim().replace(/[$,\s]/g, "");
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.startsWith("-") || t.startsWith("−")) { neg = true; t = t.slice(1); }
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]) * (m[2].toLowerCase() === "m" ? 1e6 : m[2].toLowerCase() === "k" ? 1e3 : 1);
  return Math.round(neg ? -v : v);
}

/** Reads a roster pasted from a spreadsheet (tab-separated) or a CSV file. */
export function parseRoster(text: string): ParsedRoster {
  const clean = text.replace(/^﻿/, "").trim();
  const issues: RosterIssue[] = [];
  if (!clean) return { rows: [], issues, teams: [] };
  const table = clean.includes("\t")
    ? clean.split(/\r?\n/).map((l) => l.split("\t").map((c) => c.trim())).filter((r) => r.some((c) => c))
    : parseCsv(clean).map((r) => r.map((c) => c.trim()));

  // Columns: by header when there is one, else Name, Gender, Team, Salary.
  let col = { name: 0, gender: 1, team: 2, salary: 3 };
  let start = 0;
  const head = table[0].map((h) => h.toLowerCase());
  if (head.some((h) => /name|player/.test(h))) {
    const find = (re: RegExp) => head.findIndex((h) => re.test(h));
    col = { name: find(/name|player/), gender: find(/gender|sex|division|^g$|m\/f/), team: find(/team|gm|roster/), salary: find(/salary|\$|sal\b|value/) };
    start = 1;
    if (col.gender < 0) issues.push({ line: null, message: "No gender column found. Add one headed “Gender” (M or F).", blocking: true });
    if (col.team < 0) issues.push({ line: null, message: "No team column found. Add one headed “Team” (leave it blank or write “Sub” for subs).", blocking: true });
    if (col.salary < 0) issues.push({ line: null, message: "No salary column found. Add one headed “Starting salary”.", blocking: true });
    if (issues.length) return { rows: [], issues, teams: [] };
  }

  const rows: RosterRow[] = [];
  const seen = new Map<string, number>();
  table.slice(start).forEach((r, i) => {
    const line = i + start + 1;
    const name = (r[col.name] ?? "").replace(/\s+/g, " ").trim();
    if (!name) return;
    const g = normGender(r[col.gender] ?? "");
    const teamCell = (r[col.team] ?? "").trim();
    const team = !teamCell || SUB_TEAM.test(teamCell) ? null : teamCell;
    const salaryCell = r[col.salary] ?? "";
    const salary = parseMoney(salaryCell);
    if (!g) issues.push({ line, message: `${name}: gender “${r[col.gender] ?? ""}” isn't M, F or X.`, blocking: true });
    if (salary === null && (team || salaryCell.trim())) issues.push({ line, message: `${name}: starting salary “${salaryCell}” isn't a number.`, blocking: true });
    const k = nameKey(name);
    if (seen.has(k)) issues.push({ line, message: `${name} is listed twice (also line ${seen.get(k)}).`, blocking: true });
    seen.set(k, line);
    rows.push({ line, name, gender: g ?? "?", team, salary: salary ?? 0 });
  });
  // Spellings that look like the same person twice: worth a look, but not an error.
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const why = likelySame(rows[i].name, rows[j].name);
    if (why && nameKey(rows[i].name) !== nameKey(rows[j].name)) issues.push({ line: rows[j].line, message: `${rows[j].name} and ${rows[i].name} might be the same person (${why}).`, blocking: false });
  }
  const teams = [...new Set(rows.map((r) => r.team).filter((t): t is string => !!t))];
  if (rows.length && teams.length < 2) issues.push({ line: null, message: "Only one team found. Check the team column.", blocking: true });
  return { rows, issues, teams };
}

/** Weekly dates from the first game night, e.g. 12 Mondays. */
export function weeklySchedule(firstDate: string, weeks: number) {
  const out: { week: number; date: string }[] = [];
  const d = new Date(firstDate + "T12:00:00");
  for (let w = 1; w <= weeks; w++) {
    out.push({ week: w, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` });
    d.setDate(d.getDate() + 7);
  }
  return out;
}

export interface NewSeasonSpec {
  name: string;
  roster: RosterRow[];
  /** Roster fillers for short teams: one plug player per entry. */
  plugs?: { team: string; gender: string }[];
  gms: Record<string, string>;
  schedule: { week: number; date: string }[];
  rules: LeagueRules;
  gameLengthMin: number;
}

export function buildNewSeason(spec: NewSeasonSpec): Season {
  const teamNames = [...new Set(spec.roster.map((r) => r.team).filter((t): t is string => !!t))];
  const players: Player[] = spec.roster.map((r) => ({
    name: r.name, gender: r.team ? r.gender : `Sub${r.gender}`, initialSalary: r.salary, team: r.team, isSub: !r.team,
  }));
  for (const p of spec.plugs ?? []) players.push(newPlug(players, p.team, p.gender));
  const input: LeagueInput = {
    rules: { ...spec.rules, teamsForCapAverage: teamNames.length },
    teams: teamNames.map((t) => ({ name: t, gm: spec.gms[t]?.trim() ?? "", isSubTeam: false })),
    players,
    trades: [],
    schedule: [...spec.schedule].sort((a, b) => a.week - b.week),
    events: [],
    boxScores: [],
    subAssignments: [],
    throughWeek: 1,
  };
  const now = new Date().toISOString();
  return { schemaVersion: SEASON_SCHEMA, id: newId(), name: spec.name.trim(), source: "New season", createdAt: now, updatedAt: now, input, gameLengthMin: spec.gameLengthMin };
}

/** Why a schedule can't be used, or null: every week needs a date, each later than the last. */
export function scheduleProblem(schedule: { week: number; date: string }[]): string | null {
  if (!schedule.length) return "Add at least one week to the schedule.";
  for (let i = 0; i < schedule.length; i++) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule[i].date)) return `Week ${schedule[i].week} needs a date.`;
    if (i && schedule[i].date <= schedule[i - 1].date) return `Week ${schedule[i].week} (${schedule[i].date}) has to come after week ${schedule[i - 1].week} (${schedule[i - 1].date}).`;
  }
  return null;
}

/** Push week `i` and every later week back seven days (a holiday or a field closure). */
export function skipWeek(schedule: { week: number; date: string }[], i: number) {
  return schedule.map((w, j) => (j < i ? w : { ...w, date: weeklySchedule(w.date, 2)[1].date }));
}

/** "Team 2 plug (F)", or "Team 2 plug (F) 2" when the team already has one of those. */
export function newPlug(players: Player[], team: string, gender: string): Player {
  const base = `${shortTeam(team)} plug (${gender})`;
  const taken = new Set(players.map((p) => p.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return { name, gender, initialSalary: 0, team, isSub: false, isPlug: true };
}

/** Teams with fewer players than the largest team, counting plugs already added. */
export function shortTeams(rows: { team: string | null }[], plugs: { team: string }[] = []) {
  const count = new Map<string, number>();
  for (const r of [...rows, ...plugs]) if (r.team) count.set(r.team, (count.get(r.team) ?? 0) + 1);
  const largest = Math.max(0, ...count.values());
  return [...count].filter(([, n]) => n < largest).map(([team, players]) => ({ team, players, largest }));
}
