import type { GameLine, Player, SubAssignment } from "./types";

export const genderOf = (g: string | undefined) => {
  // Any non-empty group label works ("M", "F", or "X" for an open league with no gender split).
  const s = (g ?? "").trim().toUpperCase().replace(/^SUB/, "");
  return s || "?";
};

export interface PairingFlag { week: number; team: string; opp: string; message: string }

/**
 * Patrick's rule: within each gender, the sub who earned the most in this game covers the
 * absent player with the highest salary, and so on down. Anything the rule can't settle
 * cleanly is flagged for the admin rather than guessed silently.
 */
export function autoPairSubs(
  gameLines: GameLine[],
  players: Player[],
  salaryBeforeWeek: (player: string, week: number) => number,
): { assignments: SubAssignment[]; flags: PairingFlag[] } {
  const byName = new Map(players.map((p) => [p.name.toLowerCase(), p]));
  const { week, team, opp } = gameLines[0];
  const flags: PairingFlag[] = [];
  const flag = (message: string) => flags.push({ week, team, opp, message });

  const subs = gameLines.filter((l) => l.role === "sub")
    .map((l) => ({ name: l.player, earned: l.subEarned ?? 0, g: genderOf(byName.get(l.player.toLowerCase())?.gender) }))
    .sort((a, b) => b.earned - a.earned);
  const absent = gameLines.filter((l) => l.role === "absent" && !byName.get(l.player.toLowerCase())?.isPlug)
    .map((l) => ({ name: l.player, sal: salaryBeforeWeek(l.player, week), g: genderOf(byName.get(l.player.toLowerCase())?.gender) }))
    .sort((a, b) => b.sal - a.sal);

  const assignments: SubAssignment[] = [];
  const take = (s: (typeof subs)[number], a: (typeof absent)[number]) => {
    assignments.push({ week, team, opp, sub: s.name, subbedFor: a.name });
    subs.splice(subs.indexOf(s), 1);
    absent.splice(absent.indexOf(a), 1);
  };
  for (const g of [...new Set(subs.map((x) => x.g))].filter((g) => g !== "?")) {
    for (const s of subs.filter((x) => x.g === g)) {
      const a = absent.find((x) => x.g === g);
      if (a) take(s, a);
    }
  }
  // Never pair across genders. Leftover subs stay unpaired and go to the override screen.
  for (const s of subs) {
    if (s.g === "?") flag(`${s.name} has no gender in the player list, so can't be paired`);
    else if (absent.length) flag(`${s.name} (${s.g}) has no absent ${s.g} player to cover; absent: ${absent.map((a) => `${a.name} (${a.g})`).join(", ")}`);
    else flag(`${s.name} played but nobody on the roster is absent (extra player, or a missed check-in?)`);
  }
  return { assignments, flags };
}
