import { useDeferredValue, useMemo, useState } from "react";
import { computeLeague } from "../../engine/compute";
import { askConfirm } from "../lib/confirm";
import { money, shortTeam } from "../lib/format";
import { teamCap, teamPayroll, useSeason } from "../lib/SeasonContext";
import {
  applyDeal, dealKind, dealProblems, isWaiver, LEFT, POOL, realTeams, removeDeal, savedDeals, whereIs,
  type CapMove, type Deal, type Move, type SavedDeal,
} from "../lib/trades";

const placeLabel = (p: string) => (p === POOL ? "Sub pool" : p === LEFT ? "Out of the league" : p);

/**
 * Trades and waivers, as the league decided them: who moved where, from which week, at what salary
 * for a waiver move, and any cap space that changed hands. Rosters, salaries and caps follow.
 */
export function Trades() {
  const { input, result, update } = useSeason();
  const teams = realTeams(input);
  const weeks = [...input.schedule].sort((a, b) => a.week - b.week);
  const firstOpen = weeks.find((s) => s.week > input.throughWeek)?.week ?? weeks.at(-1)?.week ?? 1;
  const [fromWeek, setFromWeek] = useState(firstOpen);
  const [moves, setMoves] = useState<Move[]>([{ player: "", to: "" }]);
  const [cap, setCap] = useState<CapMove[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const afterWeek = fromWeek - 1;

  const deal: Deal = { afterWeek, moves: moves.filter((m) => m.player || m.to), cap };
  const problems = dealProblems(input, result, deal);
  const from = (player: string) => whereIs(input, result, player, afterWeek);
  const currentSalary = (player: string) => result.salary[player]?.[Math.min(afterWeek, result.horizon)] ?? 0;

  // What the deal does to payroll and caps, for the teams it touches.
  const deferred = useDeferredValue(deal);
  const preview = useMemo(() => {
    if (dealProblems(input, result, deferred).length) return null;
    const next = computeLeague(applyDeal(input, result, deferred));
    const touched = new Set<string>();
    for (const m of deferred.moves) { touched.add(from(m.player)); touched.add(m.to); }
    for (const c of deferred.cap) { touched.add(c.from); touched.add(c.to); }
    const w = Math.min(deferred.afterWeek, next.horizon);
    const before = teamPayroll(input, result, w), after = teamPayroll(input, next, w);
    return teams.filter((t) => touched.has(t)).map((t) => ({ team: t, before: before[t], after: after[t], cap: teamCap(next, t, w) }));
  }, [deferred, input, result]);

  const setMove = (i: number, m: Partial<Move>) => { setSaved(null); setMoves(moves.map((x, j) => (j === i ? { ...x, ...m } : x))); };
  const setCapMove = (i: number, c: Partial<CapMove>) => { setSaved(null); setCap(cap.map((x, j) => (j === i ? { ...x, ...c } : x))); };
  const reset = () => { setMoves([{ player: "", to: "" }]); setCap([]); };

  // Players grouped by where they are that week; plugs too, so one can be taken off a team.
  const byPlace = new Map<string, string[]>();
  for (const p of [...input.players].sort((a, b) => a.name.localeCompare(b.name))) {
    const at = from(p.name);
    if (!byPlace.has(at)) byPlace.set(at, []);
    byPlace.get(at)!.push(p.name);
  }
  const places = [...teams, POOL, LEFT].filter((p) => byPlace.has(p));

  const save = async () => {
    await update((inp) => applyDeal(inp, result, deal));
    setSaved(`Saved. ${dealSummary(deal)}`);
    reset();
  };

  return (
    <main className="page">
      <div className="two-col wide-left">
        <section className="card trade-form" aria-labelledby="trade-title">
          <h2 id="trade-title">Record a trade or waiver move</h2>
          <p className="muted small">
            Enter what the league decided. Players play for their new team from the week you pick, and salaries and caps are
            worked out from there. A pickup from the sub pool or a drop to it sets the player's salary.
          </p>
          <label className="field narrow-field"><span>Takes effect from</span>
            <select value={fromWeek} onChange={(e) => setFromWeek(+e.target.value)}>
              {weeks.map((s) => <option key={s.week} value={s.week}>Week {s.week} ({s.date})</option>)}
            </select>
          </label>
          {afterWeek < input.throughWeek && (
            <p className="attn small">Games from week {fromWeek} on are already counted. Saving changes who was on each roster for them, and every salary since.</p>
          )}

          <h3>Players</h3>
          <ol className="plain trade-moves">
            {moves.map((m, i) => {
              const at = m.player ? from(m.player) : "";
              const waiver = m.player && m.to && isWaiver(at, m.to);
              return (
                <li key={i} className="trade-move">
                  <select value={m.player} aria-label={`Player ${i + 1}`}
                    onChange={(e) => setMove(i, { player: e.target.value, to: "", salary: currentSalary(e.target.value) })}>
                    <option value="">Pick a player…</option>
                    {places.map((pl) => (
                      <optgroup key={pl} label={placeLabel(pl)}>{byPlace.get(pl)!.map((n) => <option key={n}>{n}</option>)}</optgroup>
                    ))}
                  </select>
                  <span className="muted small nowrap">{at ? `${placeLabel(at === POOL || at === LEFT ? at : shortTeam(at))} →` : "→"}</span>
                  <select value={m.to} aria-label={`Where player ${i + 1} goes`} disabled={!m.player} onChange={(e) => setMove(i, { to: e.target.value })}>
                    <option value="">Goes to…</option>
                    {[...teams, POOL, LEFT].filter((t) => t !== at).map((t) => <option key={t} value={t}>{placeLabel(t)}</option>)}
                  </select>
                  {waiver && (
                    <label className="trade-salary"><span className="small">Salary from then on</span>
                      <input type="number" step={50000} value={Number.isFinite(m.salary) ? m.salary : ""} aria-label={`${m.player}'s salary from week ${fromWeek}`}
                        onChange={(e) => setMove(i, { salary: e.target.value.trim() === "" ? NaN : Number(e.target.value) })} />
                      <small className="muted">Now {money(currentSalary(m.player))}</small>
                    </label>
                  )}
                  {moves.length > 1 && <button className="icon" aria-label={`Remove player ${i + 1}`} onClick={() => setMoves(moves.filter((_, j) => j !== i))}>×</button>}
                </li>
              );
            })}
          </ol>
          <div className="row gap-sm wrap">
            <button className="small-btn" onClick={() => setMoves([...moves, { player: "", to: "" }])}>+ Add a player</button>
            <button className="small-btn" onClick={() => setCap([...cap, { from: teams[0] ?? "", to: teams[1] ?? "", amount: NaN }])}>+ Add cap space</button>
          </div>

          {cap.length > 0 && <>
            <h3>Cap space</h3>
            <ol className="plain trade-moves">
              {cap.map((c, i) => (
                <li key={i} className="trade-move">
                  <select value={c.from} aria-label={`Cap space ${i + 1}: from`} onChange={(e) => setCapMove(i, { from: e.target.value })}>
                    {teams.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <span className="small">sends</span>
                  <input type="number" min={0} step={50000} placeholder="Amount" aria-label={`Cap space ${i + 1}: amount`}
                    value={Number.isFinite(c.amount) ? c.amount : ""} onChange={(e) => setCapMove(i, { amount: e.target.value.trim() === "" ? NaN : Number(e.target.value) })} />
                  <span className="small">to</span>
                  <select value={c.to} aria-label={`Cap space ${i + 1}: to`} onChange={(e) => setCapMove(i, { to: e.target.value })}>
                    {teams.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <button className="icon" aria-label={`Remove cap space ${i + 1}`} onClick={() => setCap(cap.filter((_, j) => j !== i))}>×</button>
                </li>
              ))}
            </ol>
          </>}

          {preview && preview.length > 0 && (
            <div className="trade-effect">
              <h3>Payroll going into week {fromWeek}</h3>
              <div className="scroll-x"><table className="data compact">
                <thead><tr><th>Team</th><th className="num">Now</th><th className="num">With this</th><th className="num">Cap</th><th className="num">Room</th></tr></thead>
                <tbody>{preview.map((r) => (
                  <tr key={r.team}>
                    <td>{shortTeam(r.team)}</td><td className="num">{money(r.before)}</td><td className="num">{money(r.after)}</td>
                    <td className="num">{money(r.cap)}</td><td className={"num" + (r.after > r.cap ? " over" : "")}>{money(r.cap - r.after)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              {preview.filter((r) => r.after > r.cap).map((r) => (
                <p key={r.team} className="attn small over-warning">{r.team} would be over the cap by {money(r.after - r.cap)}. You can still save it.</p>
              ))}
            </div>
          )}

          {problems.length > 0 && (deal.moves.length > 0 || deal.cap.length > 0) && <p className="attn small">{problems[0]}</p>}
          <div className="row gap-sm">
            <button className="primary" disabled={problems.length > 0} onClick={save}>Save</button>
            <button onClick={() => { reset(); setSaved(null); }}>Clear</button>
          </div>
          {saved && <p className="ok-text small" role="status">{saved}</p>}
        </section>

        <section className="card" aria-labelledby="deals-title">
          <h2 id="deals-title">This season</h2>
          {dealList()}
        </section>
      </div>
    </main>
  );

  function dealList() {
    const deals = savedDeals(input);
    if (!deals.length) return <p className="empty">No trades or waiver moves yet.</p>;
    return (
      <ul className="plain deal-list">
        {deals.map((d) => (
          <li key={d.key} className="deal">
            <div className="row gap-sm">
              <strong className="grow">{dealKind(input, d)} · from week {d.afterWeek + 1}</strong>
              <button className="small-btn danger" onClick={() => undo(d)} aria-label={`Undo the ${dealKind(input, d).toLowerCase()} from week ${d.afterWeek + 1}`}>Undo</button>
            </div>
            <ul className="plain small">
              {d.trades.map((t, i) => (
                <li key={i}>{t.player}: {before(t.player, d.afterWeek)} → {t.left ? "out of the league" : t.toTeam && teams.includes(t.toTeam) ? shortTeam(t.toTeam) : "sub pool"}
                  {t.setSalary !== undefined && <span className="muted">, salary {money(t.setSalary)}</span>}
                  {t.playerAdd ? <span className="muted">, salary adjusted {money(t.playerAdd)}</span> : null}</li>
              ))}
              {d.cap.map((c, i) => <li key={`c${i}`}>Cap space: {money(c.amount)} from {shortTeam(c.from)} to {shortTeam(c.to)}</li>)}
            </ul>
          </li>
        ))}
      </ul>
    );
  }

  function before(player: string, afterWeek: number) {
    const t = result.teamOf(player, Math.max(afterWeek, 0));
    return t && teams.includes(t) ? shortTeam(t) : "sub pool";
  }

  async function undo(d: SavedDeal) {
    const what = d.trades.map((t) => t.player).join(", ") || "this cap space";
    if (!(await askConfirm(`Undo this ${dealKind(input, d).toLowerCase()} (${what})? Rosters, salaries and caps go back to what they'd be without it.`, { ok: "Undo it", danger: true }))) return;
    await update((inp) => removeDeal(inp, d.key));
  }
}

function dealSummary(d: Deal) {
  const n = d.moves.length, c = d.cap.length;
  return [n ? `${n} player${n > 1 ? "s" : ""} moved` : "", c ? "cap space moved" : ""].filter(Boolean).join(", ") + ".";
}
