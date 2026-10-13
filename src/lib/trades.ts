// Trades and waivers, as the league decided them: the admin records the outcome (who moved where,
// from which week) and the engine works out rosters, salaries and caps from it. A deal is one
// entry on the Trades & waivers screen: a trade between teams, a waiver pickup or drop, or a
// player leaving the league, with any cap space that changed hands.
import type { CapTrade, EngineResult, LeagueInput, Trade } from "../../engine/types";

/** Where a player goes: a team, the sub pool (waivers) or out of the league. */
export const POOL = "__pool", LEFT = "__left";
export interface Move { player: string; to: string; /** Waiver moves: the player's salary from then on. */ salary?: number }
export interface CapMove { from: string; to: string; amount: number }
/** Takes effect after `afterWeek`: the players play for their new teams from the next week. */
export interface Deal { afterWeek: number; moves: Move[]; cap: CapMove[] }

export const realTeams = (input: LeagueInput) => input.teams.filter((t) => !t.isSubTeam).map((t) => t.name);
/** The sub pool's team, or null in a season whose subs have no team. */
export const subPool = (input: LeagueInput) => input.teams.find((t) => t.isSubTeam)?.name ?? null;

/** Where a player is for the week after `afterWeek`: a team name, POOL or LEFT. */
export function whereIs(input: LeagueInput, result: EngineResult, player: string, afterWeek: number): string {
  const t = result.teamOf(player, afterWeek + 1);
  if (t && realTeams(input).includes(t)) return t;
  const lastMove = [...input.trades].filter((x) => x.player.toLowerCase() === player.toLowerCase() && x.afterWeek <= afterWeek)
    .sort((a, b) => a.afterWeek - b.afterWeek).at(-1);
  return lastMove?.left ? LEFT : POOL;
}

export const placeName = (p: string) => (p === POOL ? "the sub pool" : p === LEFT ? "out of the league" : p);

/** A move onto a team from the sub pool (or back into the league), or down to the sub pool, is a
 * waiver move: it sets the player's salary. Team to team is a trade; leaving needs no salary. */
export const isWaiver = (from: string, to: string) => from !== to && to !== LEFT && (from === POOL || from === LEFT || to === POOL);

/** Why a deal can't be saved yet, or an empty list. (Going over the cap is a warning, not a problem.) */
export function dealProblems(input: LeagueInput, result: EngineResult, d: Deal): string[] {
  const out: string[] = [];
  const teams = realTeams(input);
  if (!d.moves.length && !d.cap.length) out.push("Add a player or some cap space.");
  if (!Number.isInteger(d.afterWeek) || d.afterWeek < 0) out.push("Pick the week it takes effect.");
  const seen = new Set<string>();
  for (const m of d.moves) {
    if (!m.player) { out.push("Pick a player for every move."); continue; }
    if (!input.players.some((p) => p.name === m.player)) out.push(`${m.player} isn't in the player list.`);
    if (seen.has(m.player)) out.push(`${m.player} is in this deal twice.`);
    seen.add(m.player);
    const from = whereIs(input, result, m.player, d.afterWeek);
    if (!m.to) out.push(`Pick where ${m.player} goes.`);
    else if (m.to === from) out.push(`${m.player} is already ${from === POOL || from === LEFT ? placeName(from) : `on ${from}`} then.`);
    else if (m.to !== POOL && m.to !== LEFT && !teams.includes(m.to)) out.push(`“${m.to}” isn't a team in this season.`);
    if (m.to && isWaiver(from, m.to) && !Number.isFinite(m.salary)) out.push(`Enter ${m.player}'s salary from then on.`);
  }
  for (const c of d.cap) {
    if (!teams.includes(c.from) || !teams.includes(c.to)) out.push("Pick both teams for the cap space.");
    else if (c.from === c.to) out.push("Cap space has to go to a different team.");
    if (!(Number.isFinite(c.amount) && c.amount > 0)) out.push("Enter the cap space as an amount over $0.");
  }
  return [...new Set(out)];
}

const nextId = (input: LeagueInput) => Math.max(0, ...input.trades.map((t) => t.id ?? 0), ...(input.capTrades ?? []).map((c) => c.id ?? 0)) + 1;

/** The season with the deal added. */
export function applyDeal(input: LeagueInput, result: EngineResult, d: Deal): LeagueInput {
  const id = nextId(input);
  const pool = subPool(input);
  const trades: Trade[] = d.moves.map((m) => {
    const from = whereIs(input, result, m.player, d.afterWeek);
    return {
      id, afterWeek: d.afterWeek, player: m.player,
      toTeam: m.to === POOL ? pool : m.to === LEFT ? null : m.to,
      ...(m.to === LEFT ? { left: true } : {}),
      ...(isWaiver(from, m.to) ? { setSalary: m.salary } : {}),
    };
  });
  const cap: CapTrade[] = d.cap.map((c) => ({ id, afterWeek: d.afterWeek, ...c }));
  return { ...input, trades: [...input.trades, ...trades], capTrades: [...(input.capTrades ?? []), ...cap] };
}

/** A recorded deal, for the list: trades from before deals had ids are grouped by week. */
export interface SavedDeal { key: string; afterWeek: number; trades: Trade[]; cap: CapTrade[] }

const keyOf = (x: { id?: number; afterWeek: number }) => (x.id !== undefined ? `id${x.id}` : `week${x.afterWeek}`);

export function savedDeals(input: LeagueInput): SavedDeal[] {
  const m = new Map<string, SavedDeal>();
  const get = (x: { id?: number; afterWeek: number }) => {
    const k = keyOf(x);
    if (!m.has(k)) m.set(k, { key: k, afterWeek: x.afterWeek, trades: [], cap: [] });
    return m.get(k)!;
  };
  for (const t of input.trades) get(t).trades.push(t);
  for (const c of input.capTrades ?? []) get(c).cap.push(c);
  return [...m.values()].sort((a, b) => b.afterWeek - a.afterWeek || b.key.localeCompare(a.key, undefined, { numeric: true }));
}

/** The season without one recorded deal. */
export function removeDeal(input: LeagueInput, key: string): LeagueInput {
  return { ...input, trades: input.trades.filter((t) => keyOf(t) !== key), capTrades: (input.capTrades ?? []).filter((c) => keyOf(c) !== key) };
}

/** "Trade", "Waivers" or "Left the league", from what the deal moved. */
export function dealKind(input: LeagueInput, d: Pick<SavedDeal, "trades" | "cap">) {
  const teams = realTeams(input);
  if (d.trades.some((t) => t.setSalary !== undefined || (t.toTeam !== null && !teams.includes(t.toTeam)) || (t.toTeam === null && !t.left))) return "Waivers";
  if (d.trades.length && d.trades.every((t) => t.left)) return "Left the league";
  return "Trade";
}
