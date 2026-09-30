import { useState } from "react";
import { Link } from "react-router-dom";
import { LineChart } from "../components/LineChart";
import { money, moneyShort, shortTeam } from "../lib/format";
import { teamPayroll, useSeason } from "../lib/SeasonContext";

export function Overview() {
  const { season, input, result, games, computeMs, nameIssueCount } = useSeason();
  const last = input.throughWeek;
  const [week, setWeek] = useState(last);
  const w = Math.min(week, last);
  const teams = input.teams.filter((t) => !t.isSubTeam).map((t) => t.name);
  const weeks = Array.from({ length: last + 1 }, (_, i) => i);
  const payrollByWeek = weeks.map((wk) => teamPayroll(input, result, wk));
  const payroll = payrollByWeek[w];
  const cap = result.capByWeek[w];
  const disagree = games.filter((g) => g.recA && g.recB && g.recA.eventCount && g.recB.eventCount &&
    (g.recA.finalScore !== g.recB.finalOppScore || g.recA.finalOppScore !== g.recB.finalScore));
  const notes = sessionStorage.getItem(`notes:${season.id}`);

  return (
    <main className="page">
      <div className="toolbar">
        <label>Salaries after
          <select value={w} onChange={(e) => setWeek(+e.target.value)}>
            {weeks.map((wk) => <option key={wk} value={wk}>{wk === 0 ? "start of season" : `week ${wk}`}</option>)}
          </select>
        </label>
        <span className="muted small">Engine ran in {Math.round(computeMs)} ms · {input.events.length.toLocaleString()} events</span>
      </div>

      {notes && <p className="note">{notes}</p>}
      {nameIssueCount > 0 && (
        <p className="note attn-note">
          {nameIssueCount} name issue(s) to review: spellings that don't match a player, or old “Name Sub” records.{" "}
          <Link to="names">Review names</Link>
        </p>
      )}

      <section className="tiles">
        <div className="tile"><span className="tile-label">Salary cap</span><span className="tile-value">{money(cap)}</span></div>
        <div className="tile"><span className="tile-label">Games counted</span><span className="tile-value">{games.filter((g) => g.week <= w).length}</span></div>
        <div className="tile"><span className="tile-label">Score disputes</span>
          <span className="tile-value">{disagree.length ? <Link to="../games?filter=disputed">{disagree.length}</Link> : 0}</span></div>
        <div className="tile"><span className="tile-label">Warnings</span><span className="tile-value">{result.warnings.length}</span></div>
      </section>

      <section className="card scroll-x">
        <h2>Payroll vs cap</h2>
        <table className="data">
          <thead><tr><th>Team</th><th>GM</th><th className="num">Payroll</th><th className="num">Cap space</th></tr></thead>
          <tbody>
            {teams.map((t) => {
              const room = cap - payroll[t];
              return (
                <tr key={t}>
                  <td><Link to={`../players?team=${encodeURIComponent(t)}`}>{t}</Link></td>
                  <td className="muted">{input.teams.find((x) => x.name === t)?.gm}</td>
                  <td className="num">{money(payroll[t])}</td>
                  <td className={"num" + (room < 0 ? " over" : "")}>{room < 0 ? <span title="Over the cap">▲ over by {money(-room)}</span> : money(room)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {input.rules.teamResultBonus && <p className="muted small">Payroll includes the team result bonus ({money(input.rules.teamResultBonus.win)} per win), which counts against the cap.</p>}
      </section>

      <section className="card">
        <h2>Payroll by week</h2>
        <LineChart xLabels={weeks.map((wk) => (wk === 0 ? "Start" : `W${wk}`))} format={moneyShort} marker={w}
          series={teams.map((t) => ({ name: shortTeam(t), values: payrollByWeek.map((p) => p[t]) }))}
          reference={{ name: "Cap", values: weeks.map((wk) => result.capByWeek[wk]) }} />
      </section>

      {result.warnings.length > 0 && (
        <section className="card">
          <h2>Engine warnings</h2>
          <p className="muted small">Names the engine couldn't match, sub assignments that don't line up, recordings outside the schedule.</p>
          <ul className="warnings">{result.warnings.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </section>
      )}
    </main>
  );
}
