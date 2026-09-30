import type { LeagueRules } from "./types";

/**
 * What makes a rule set unusable, in plain words; empty when it's fine. The engine refuses to
 * compute with any of these (a zero divisor gives an infinite cap, NaN spreads everywhere),
 * and the app checks the same list before saving or importing rules.
 */
export function ruleProblems(r: LeagueRules): string[] {
  const out: string[] = [];
  const finite = (v: unknown, what: string) => { if (typeof v !== "number" || !Number.isFinite(v)) { out.push(`${what} must be a number.`); return false; } return true; };
  const wholeAtLeast = (v: unknown, min: number, what: string) => {
    if (finite(v, what) && (!Number.isInteger(v) || (v as number) < min)) out.push(`${what} must be a whole number of at least ${min}.`);
  };
  const between = (v: unknown, lo: number, hi: number, what: string) => {
    if (finite(v, what) && ((v as number) < lo || (v as number) > hi)) out.push(`${what} must be between ${lo} and ${hi}.`);
  };
  if (!r || typeof r !== "object") return ["Rules are missing."];
  const w = r.weights ?? ({} as LeagueRules["weights"]);
  const labels: Record<string, string> = { win: "Win", goal: "Goal", assist: "Assist", secondAssist: "2nd assist", block: "D-Play", drop: "Drop", throwaway: "Throwaway", gso: "GSO" };
  for (const k of Object.keys(labels)) finite((w as any)[k], `The ${labels[k]} value`);
  between(r.tieWeightFactor, 0, 1, "Tie pays (× win)");
  const a = r.absence ?? ({} as LeagueRules["absence"]);
  between(a.pctOfInitialPerWeek, 0, 1, "The early-season absence estimate");
  wholeAtLeast(a.pctRuleWeeks, 0, "Weeks using the early-season estimate");
  if (a.thereafter !== "seasonAvgRetroactive" && a.thereafter !== "avgToDate") out.push("Choose how absences are estimated after the early weeks.");
  if (typeof a.floorAtSubGrowth !== "boolean") out.push("The sub-growth floor must be on or off.");
  wholeAtLeast(r.matchesPerWeek, 1, "Games per team per week");
  finite(r.capBuffer, "The cap buffer");
  wholeAtLeast(r.teamsForCapAverage, 1, "Teams in the cap average");
  for (const [k, v] of Object.entries(r.capExtraByWeek ?? {})) {
    if (!/^\d+$/.test(k) || Number(k) < 1) out.push(`Cap bump week “${k}” must be a week number.`);
    finite(v, `The week ${k} cap bump`);
  }
  if (r.plugMode !== undefined && r.plugMode !== "asAbsentPlayer" && r.plugMode !== "leagueAverage") out.push("Choose how roster-filler players are priced.");
  if (r.payResultToAbsent !== undefined && typeof r.payResultToAbsent !== "boolean") out.push("“Pay the win bonus to absent players” must be on or off.");
  if (r.teamResultBonus) {
    finite(r.teamResultBonus.win, "The team win bonus");
    between(r.teamResultBonus.tieFactor, 0, 1, "The team tie bonus (× win)");
  }
  return out;
}
