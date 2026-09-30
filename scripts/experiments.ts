// What-ifs on real data: (1) auto sub-pairing vs the admin's manual picks,
// (2) plug priced at league average vs the sheet's frozen plug, (3) retroactive vs to-date absence average.
import { computeLeague } from "../engine/compute";
import { autoPairSubs } from "../engine/pairing";
import type { EngineResult, GameLine, LeagueInput } from "../engine/types";
import { loadFixture } from "./validate";

const money = (n: number) => (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-CA");
const teamTotals = (input: LeagueInput, res: EngineResult, week: number) => {
  const out: Record<string, number> = {};
  for (const p of input.players) {
    const t = res.teamOf(p.name, week + 1);
    if (!t || p.isSub) continue;
    out[t] = (out[t] ?? 0) + res.salary[p.name][week];
  }
  return out;
};

for (const path of ["fixtures/fall-2026.json", "fixtures/thursday-s1-2026.json"]) {
  const { fx, input, throughWeek } = loadFixture(path, {}, "boxscore");
  const base = computeLeague(input);
  console.log(`\n=== ${fx.source} ===`);

  // (1) auto pairing
  const groups = new Map<string, GameLine[]>();
  for (const l of base.lines) {
    const k = `${l.week}|${l.team}|${l.opp}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(l);
  }
  const auto = [...groups.values()].map((g) =>
    autoPairSubs(g, input.players, (p, w) => base.salary[p]?.[w - 1] ?? 0));
  const autoAssign = auto.flatMap((a) => a.assignments);
  const manual = new Map(input.subAssignments.map((a) => [`${a.week}|${a.team}|${a.opp}|${a.sub.toLowerCase()}`, a.subbedFor]));
  let same = 0, diff = 0;
  const diffs: string[] = [];
  for (const a of autoAssign) {
    const m = manual.get(`${a.week}|${a.team}|${a.opp}|${a.sub.toLowerCase()}`);
    if (m && m.toLowerCase() === a.subbedFor.toLowerCase()) same++;
    else { diff++; diffs.push(`W${a.week} ${a.team.slice(-6)} v ${a.opp.slice(-6)}: ${a.sub} → rule says ${a.subbedFor}, admin chose ${m ?? "(nobody)"}`); }
  }
  const withAuto = computeLeague({ ...input, subAssignments: autoAssign });
  const moved = input.players.filter((p) => !p.isSub)
    .map((p) => ({ p: p.name, d: withAuto.salary[p.name][throughWeek] - base.salary[p.name][throughWeek] }))
    .filter((x) => Math.abs(x.d) > 0.5).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  console.log(`Sub pairing: rule agrees with the admin on ${same} of ${same + diff} sub appearances.`);
  console.log(`  Salary effect by week ${throughWeek}: ${moved.length} players change` +
    (moved.length ? `; biggest: ${moved.slice(0, 6).map((x) => `${x.p} ${x.d > 0 ? "+" : ""}${money(x.d)}`).join(", ")}` : ""));
  for (const d of diffs.slice(0, 12)) console.log("  " + d);
  for (const f of auto.flatMap((a) => a.flags)) console.log(`  FLAG W${f.week} ${f.team.slice(-6)} v ${f.opp.slice(-6)}: ${f.message}`);

  // (2) plug
  const plugs = input.players.filter((p) => p.isPlug);
  if (plugs.length) {
    const fixed = computeLeague({ ...input, rules: { ...input.rules, plugMode: "leagueAverage" } });
    console.log(`Plug salary by week (sheet → league-average):`);
    for (const p of plugs) console.log(`  ${p.name}: ` + Array.from({ length: throughWeek + 1 }, (_, w) =>
      `W${w} ${money(base.salary[p.name][w])}→${money(fixed.salary[p.name][w])}`).join(" | "));
    const a = teamTotals(input, base, throughWeek), b = teamTotals(input, fixed, throughWeek);
    console.log(`Team salary after W${throughWeek} vs cap:`);
    for (const t of Object.keys(a)) console.log(`  ${t}: sheet ${money(a[t])} (room ${money(base.capByWeek[throughWeek] - a[t])}) → fixed ${money(b[t])} (room ${money(fixed.capByWeek[throughWeek] - b[t])})`);
  }

  // (3) retroactive vs to-date absence average
  const toDate = computeLeague({ ...input, rules: { ...input.rules, absence: { ...input.rules.absence, thereafter: "avgToDate" } } });
  const shifts = input.players.filter((p) => !p.isSub)
    .map((p) => ({ p: p.name, d: toDate.salary[p.name][throughWeek] - base.salary[p.name][throughWeek] }))
    .filter((x) => Math.abs(x.d) > 0.5).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  console.log(`Absence average "to date" instead of retroactive: ${shifts.length} players change by W${throughWeek}` +
    (shifts.length ? `; biggest: ${shifts.slice(0, 5).map((x) => `${x.p} ${x.d > 0 ? "+" : ""}${money(x.d)}`).join(", ")}` : ""));
}
