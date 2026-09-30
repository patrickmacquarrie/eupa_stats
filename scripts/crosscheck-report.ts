import { readFileSync } from "node:fs";
import { crossCheck } from "../engine/crosscheck";
for (const path of ["fixtures/fall-2026.json", "fixtures/thursday-s1-2026.json"]) {
  const fx = JSON.parse(readFileSync(path, "utf8"));
  const recs = new Map<string, any[]>();
  for (const e of fx.events) { const k = `${e.date}|${e.statTeam}|${e.otherTeam}`; (recs.get(k) ?? recs.set(k, []).get(k)!).push(e); }
  let games = 0, disagree = 0, pinpointed = 0, cleanButUnmatched = 0;
  const examples: string[] = [];
  for (const [k, a] of recs) {
    const [d, t1, t2] = k.split("|");
    if (t1 > t2) continue;
    const b = recs.get(`${d}|${t2}|${t1}`); if (!b) continue;
    games++;
    const r = crossCheck(a, b);
    if (!r.agree) {
      disagree++;
      if (r.unmatched.length) pinpointed++;
      if (examples.length < 6) examples.push(`${d} ${t1.slice(-6)} v ${t2.slice(-6)}: tablets say ${r.finalA} vs ${r.finalB} → ` +
        (r.unmatched.map((u) => `${u.side === "A" ? t1.slice(-6) : t2.slice(-6)} tablet has an unmatched ${u.kind}${u.player ? " (" + u.player + ")" : ""} at ${u.at}`).join("; ") || "no single unmatched goal"));
    } else if (r.unmatched.length) cleanButUnmatched++;
  }
  console.log(`\n${fx.source}: ${games} games, ${disagree} with tablets disagreeing on the final score, ${pinpointed} of those pinpointed to specific goals; ${cleanButUnmatched} agreeing games still had a goal/scored-on pair that didn't line up in time`);
  for (const e of examples) console.log("  " + e);
}
