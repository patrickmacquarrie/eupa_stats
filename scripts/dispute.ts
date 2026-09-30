// Pinpoint where two tablets' recordings of one game disagree, straight from the app's CSVs.
import { readFileSync } from "node:fs";
import { crossCheck } from "../engine/crosscheck";
import type { PlayEvent } from "../engine/types";

function readCsv(path: string): PlayEvent[] {
  const [head, ...rows] = readFileSync(path, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(`[${l}]`) as string[]);
  return rows.map((r) => {
    const o = Object.fromEntries(head.map((h, i) => [h, r[i]]));
    return { date: o.date, clock: o.time, statTeam: o.statTeam, otherTeam: o.otherTeam, statScore: +o.statTeamScore,
      otherScore: +o.otherTeamScore, action: o.action, player: o.player || null, lastPlayer: o.lastPlayer || null, secLastPlayer: o.secLastPlayer || null };
  });
}
export { readCsv };
const [pa, pb] = process.argv.slice(2);
const a = pa ? readCsv(pa) : [], b = pb ? readCsv(pb) : [];
export function report(a: PlayEvent[], b: PlayEvent[]) {
const r = crossCheck(a, b);
console.log(`${a[0].statTeam} tablet says ${r.finalA} (${a[0].statTeam} first); ${b[0].statTeam} tablet says ${r.finalB}`);
console.log(`Proposed final: ${r.proposed.a}-${r.proposed.b}${r.proposed.needsAdmin ? " (plus items for the admin)" : " (no admin decision needed)"}`);
for (const u of r.unmatched) {
  const side = u.side === "A" ? a[0].statTeam : b[0].statTeam;
  const other = u.side === "A" ? b : a;
  const t = u.at;
  const near = other.filter((e) => (e.clock ?? "").slice(0, 8) >= addSec(t, -30) && (e.clock ?? "").slice(0, 8) <= addSec(t, 30));
  console.log(`\n${t}  only on the ${side} tablet: ${u.kind === "goal" ? "GOAL by" : "scored on (defender)"} ${u.player} → ${u.scoreAfter}   [${u.verdict}: ${u.why}]`);
  console.log(`  other tablet ±30s: ` + (near.map((e) => `${(e.clock ?? "").slice(0, 8)} ${e.action}${e.player ? " " + e.player : ""}`).join(", ") || "nothing recorded"));
}
}
if (process.argv[1]?.endsWith("dispute.ts")) report(a, b);
function addSec(t: string, d: number) {
  const [h, m, s] = t.split(":").map(Number); const x = h * 3600 + m * 60 + s + d;
  return [Math.floor(x / 3600), Math.floor((x % 3600) / 60), x % 60].map((n) => String(n).padStart(2, "0")).join(":");
}
