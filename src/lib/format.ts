const MINUS = "−";

/** $1,250,000 */
export const money = (n: number | null | undefined) =>
  n == null || Number.isNaN(n) ? "—" : (n < 0 ? MINUS : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-CA");

/** $1.25M / $450K */
export function moneyShort(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  const a = Math.abs(n), sign = n < 0 ? MINUS : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 2).replace(/\.?0+$/, "")}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}

/** +$100,000 / −$50,000 / $0 */
export const delta = (n: number) => (Math.abs(n) < 0.5 ? "$0" : (n > 0 ? "+" : "") + money(n));

/** Team names like "EUPA Fall - Team 1" read better as "Team 1" in tight spots. */
export const shortTeam = (t: string) => t.replace(/^.*\s-\s/, "");

export const resultLabel = (r: number | null) => (r === 1 ? "W" : r === 0.5 ? "T" : r === 0 ? "L" : "—");
