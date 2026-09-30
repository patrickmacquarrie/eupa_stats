// Runs the engine in "spreadsheet-compatible" mode on a fixture and diffs it against the
// sheet's own numbers: per-game stat lines, per-game salary growth, weekly salaries, cap.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { computeLeague } from "../engine/compute";
import type { LeagueInput, LeagueRules } from "../engine/types";

/** Sheet rows for one team-side of a game, as an admin box score. */
function boxScoresFrom(entries: any[], only?: Set<string>) {
  const groups = new Map<string, any[]>();
  for (const e of entries) {
    const g = `${e.week}|${e.team}|${e.opp}`;
    if (only && !only.has(g)) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(e);
  }
  return [...groups.values()].map((rows) => {
    const played = rows.filter((r) => r.played === 1);
    return {
      week: rows[0].week, team: rows[0].team, opp: rows[0].opp,
      result: played.find((r) => r.win !== null)?.win ?? 0,
      lines: played.map((r) => ({ player: r.player, goals: r.goals, assists: r.assists, secondAssists: r.secondAssists,
        blocks: r.blocks, drops: r.drops, throwaways: r.throwaways, gso: r.gso, touches: r.touches })),
    };
  });
}

/**
 * mode "events":   rebuild everything from the raw event log; recordings with no events at
 *                  all (lost games the admin typed in by hand) come in as box scores.
 * mode "boxscore": feed the sheet's own per-game stat lines as box scores, to test the salary
 *                  math on its own, independent of the event data.
 */
export function loadFixture(path: string, overrides: Partial<LeagueRules> = {}, mode: "events" | "boxscore" = "events") {
  const fx = JSON.parse(readFileSync(path, "utf8"));
  const gmTeam: Record<string, string> = Object.fromEntries(fx.teams.map((t: any) => [t.gm, t.name]));
  const entries = fx.sheetEntries as any[];
  const throughWeek = Math.max(...entries.map((e) => e.week));
  const input: LeagueInput = {
    rules: { ...fx.league, absence: { ...fx.league.absence, thereafter: "seasonAvgRetroactive" }, plugMode: "asAbsentPlayer", ...overrides },
    teams: fx.teams,
    players: fx.players.map((p: any) => ({ ...p, isPlug: /extra/i.test(p.name) && !p.isSub })),
    // A trade's roster move takes effect the first week the sheet shows the player on the new
    // team (the logged "after week" is sometimes a week early), else the week after.
    trades: fx.trades.map((t: any) => {
      const toTeam = gmTeam[t.toGm] ?? null;
      const seen = entries.filter((e) => e.player.toLowerCase() === t.player.toLowerCase() && e.team === toTeam && e.week > t.afterWeek)
        .map((e) => e.week);
      return { afterWeek: t.afterWeek, effectiveWeek: seen.length ? Math.min(...seen) : t.afterWeek + 1,
        player: t.player, toTeam, playerAdd: t.playerAdd };
    }),
    schedule: fx.schedule,
    events: mode === "events" ? fx.events : [],
    boxScores: [],
    subAssignments: entries.filter((e) => e.subbedFor).map((e) => ({
      week: e.week, team: e.team, opp: e.opp, sub: e.player, subbedFor: e.subbedFor })),
    throughWeek,
  };
  if (mode === "boxscore") input.boxScores = boxScoresFrom(entries);
  else {
    const sched = [...fx.schedule].sort((a: any, b: any) => a.date.localeCompare(b.date));
    const weekOf = (d: string) => sched.filter((s: any) => s.date <= d).pop()?.week;
    const have = new Set(fx.events.map((e: any) => `${weekOf(e.date)}|${e.statTeam}|${e.otherTeam}`));
    const lost = new Set(entries.map((e) => `${e.week}|${e.team}|${e.opp}`).filter((g) => !have.has(g)));
    input.boxScores = boxScoresFrom(entries, lost);
    if (lost.size) console.log(`(${lost.size} recording(s) have no events and were loaded as box scores: ${[...lost].join(", ")})`);
  }
  return { fx, input, entries, throughWeek };
}

export interface Summary {
  rows: { sheet: number; engine: number; statMismatches: number; growthMismatches: number; sheetOnly: number; engineOnly: number };
  salaries: { checked: number; differ: number };
  capDiffers: number;
  /** Every mismatch line, sorted: the regression check compares these exactly. */
  details: string[];
}

function main(path: string, mode: "events" | "boxscore", quiet = false): Summary {
  const log = quiet ? () => {} : console.log;
  const { fx, input, entries, throughWeek } = loadFixture(path, {}, mode);
  const res = computeLeague(input);
  const k = (s: string) => s.trim().toLowerCase();
  const money = (n: number) => Math.round(n).toLocaleString("en-CA");
  log(`\n=== ${fx.source} [${mode} mode] (weeks 1–${throughWeek}, ${input.events.length} events) ===`);

  // 1. per-game lines
  const mine = new Map(res.lines.map((l) => [`${l.week}|${l.team}|${l.opp}|${k(l.player)}`, l]));
  const statKeys = ["goals", "assists", "secondAssists", "blocks", "drops", "throwaways", "gso", "touches"] as const;
  let statDiff = 0, growthDiff = 0, missing = 0;
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const id = `${e.week}|${e.team}|${e.opp}|${k(e.player)}`;
    seen.add(id);
    const l = mine.get(id);
    if (!l) { missing++; issues.push(`sheet row not produced by engine: W${e.week} ${e.team}→${e.opp} ${e.player} (played=${e.played}, growth ${money(e.growth)})`); continue; }
    if (e.played && statKeys.some((s) => (l as any)[s] !== e[s])) {
      statDiff++; issues.push(`stat mismatch W${e.week} ${e.player}: ` + statKeys.filter((s) => (l as any)[s] !== e[s]).map((s) => `${s} ${e[s]}→${(l as any)[s]}`).join(", "));
    }
    const myGrowth = l.role === "sub" ? 0 : l.growth;
    if (Math.abs(myGrowth - e.growth) > 0.5) {
      growthDiff++; issues.push(`growth mismatch W${e.week} ${e.team.slice(-6)} v ${e.opp.slice(-6)} ${e.player} [${l.role}${l.coveredBy ? " covered by " + l.coveredBy : ""}]: sheet ${money(e.growth)} vs engine ${money(myGrowth)}`);
    }
  }
  const extra = res.lines.filter((l) => !seen.has(`${l.week}|${l.team}|${l.opp}|${k(l.player)}`));
  for (const l of extra) issues.push(`engine row missing from sheet: W${l.week} ${l.team}→${l.opp} ${l.player} [${l.role}] growth ${money(l.growth)}`);
  log(`Per-game rows: sheet ${entries.length}, engine ${res.lines.length}; stat mismatches ${statDiff}, growth mismatches ${growthDiff}, sheet-only ${missing}, engine-only ${extra.length}`);

  // 2. weekly salaries
  let salDiff = 0, salChecked = 0;
  for (const [name, exp] of Object.entries<any>(fx.expected.salaries)) {
    const row = Object.entries(res.salary).find(([n]) => k(n) === k(name))?.[1];
    if (!row) { issues.push(`no engine salary for ${name}`); continue; }
    for (let w = 1; w <= throughWeek; w++) {
      const e = exp.weeks[w - 1];
      if (typeof e !== "number") continue;
      salChecked++;
      if (Math.abs(row[w] - e) > 0.5) { salDiff++; issues.push(`salary W${w} ${name}: sheet ${money(e)} vs engine ${money(row[w])}`); }
    }
  }
  log(`Weekly salaries: ${salChecked} checked, ${salDiff} differ`);

  // 3. cap
  const capDiffs: string[] = [];
  for (let w = 1; w <= throughWeek; w++) {
    const e = fx.expected.capByWeek[w - 1];
    if (Math.abs(res.capByWeek[w] - e) > 0.5) capDiffs.push(`W${w}: sheet ${money(e)} vs engine ${money(res.capByWeek[w])}`);
  }
  log(`Cap by week: ${capDiffs.length ? capDiffs.join("; ") : "all match"}`);
  if (res.warnings.length) log("Engine warnings:\n  " + res.warnings.join("\n  "));
  if (issues.length) log(`Details (${issues.length}):\n  ` + issues.slice(0, Number(process.env.DETAILS ?? 60)).join("\n  "));
  return {
    rows: { sheet: entries.length, engine: res.lines.length, statMismatches: statDiff, growthMismatches: growthDiff, sheetOnly: missing, engineOnly: extra.length },
    salaries: { checked: salChecked, differ: salDiff },
    capDiffers: capDiffs.length,
    details: [...issues, ...capDiffs.map((c) => `cap ${c}`)].sort(),
  };
}

/**
 * CLI. With files: print the comparison for each (as before). With --check (the default when no
 * files are given): run every fixture in both modes against scripts/validate-baseline.json and
 * exit 1 if any count or mismatch line changed. --update rewrites the baseline after an intended
 * change; review the diff before committing it.
 */
if (process.argv[1]?.endsWith("validate.ts")) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length && !args.includes("--check") && !args.includes("--update")) {
    const mode = args.includes("--boxscore") ? "boxscore" : "events";
    for (const p of files) main(p, mode);
  } else {
    const BASELINE = "scripts/validate-baseline.json";
    const targets = files.length ? files : ["fixtures/fall-2026.json", "fixtures/thursday-s1-2026.json", "fixtures/pl-2025.json"];
    const now: Record<string, Summary> = {};
    for (const f of targets) for (const mode of ["events", "boxscore"] as const) now[`${f} [${mode}]`] = main(f, mode, true);
    if (args.includes("--update")) {
      writeFileSync(BASELINE, JSON.stringify(now, null, 1) + "\n");
      for (const [k, v] of Object.entries(now)) console.log(`${k}: salaries ${v.salaries.checked - v.salaries.differ}/${v.salaries.checked} exact, ${v.details.length} mismatch lines`);
      console.log(`Wrote ${BASELINE}.`);
    } else {
      const base: Record<string, Summary> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
      let failed = false;
      for (const [k, v] of Object.entries(now)) {
        const b = base[k];
        if (!b) { failed = true; console.log(`✗ ${k}: no baseline (run with --update)`); continue; }
        const was = new Set(b.details), is = new Set(v.details);
        const added = v.details.filter((d) => !was.has(d)), removed = b.details.filter((d) => !is.has(d));
        const countsSame = JSON.stringify({ ...v, details: 0 }) === JSON.stringify({ ...b, details: 0 });
        if (!added.length && !removed.length && countsSame) {
          console.log(`✓ ${k}: salaries ${v.salaries.checked - v.salaries.differ}/${v.salaries.checked} exact, ${v.details.length} known mismatch lines unchanged`);
          continue;
        }
        failed = true;
        console.log(`✗ ${k}: salaries ${b.salaries.checked - b.salaries.differ}/${b.salaries.checked} → ${v.salaries.checked - v.salaries.differ}/${v.salaries.checked} exact`);
        for (const d of added.slice(0, 20)) console.log(`   + ${d}`);
        for (const d of removed.slice(0, 20)) console.log(`   - ${d}`);
        if (added.length + removed.length > 40) console.log(`   (${added.length} new, ${removed.length} gone in all)`);
      }
      if (failed) { console.log("\nValidation changed. If the change is intended, run `npm run validate -- --update` and commit the baseline."); process.exit(1); }
    }
  }
}
