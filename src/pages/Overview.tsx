import { useState } from "react";
import { Link } from "react-router-dom";
import { LineChart } from "../components/LineChart";
import { money, moneyShort, shortTeam } from "../lib/format";
import { teamPayroll, useSeason } from "../lib/SeasonContext";
import { recordText, standings } from "../lib/standings";

export function Overview() {
  const { input, result, games, provisional } = useSeason();
  const last = input.throughWeek;
  const [week, setWeek] = useState(last);
  const w = Math.min(week, last);
  const teams = input.teams.filter((t) => !t.isSubTeam).map((t) => t.name);
  const weeks = Array.from({ length: last + 1 }, (_, i) => i);
  const payrollByWeek = weeks.map((wk) => teamPayroll(input, result, wk));
  const payroll = payrollByWeek[w];
  const cap = result.capByWeek[w];
  const table = standings(teams, games, w);
  const ties = table.some((r) => r.ties > 0);
  const anyNoScore = table.some((r) => r.noScore > 0);
  const unsettled = provisional.filter((wk) => wk <= w);

  return (
    <main className="page">
      <div className="toolbar">
        <label>Standings after
          <select value={w} onChange={(e) => setWeek(+e.target.value)}>
            {weeks.map((wk) => <option key={wk} value={wk}>{wk === 0 ? "start of season" : `week ${wk}${provisional.includes(wk) ? " (provisional)" : ""}`}</option>)}
          </select>
        </label>
      </div>

      <section className="card scroll-x">
        <h2>Standings{unsettled.length > 0 && <span className="pill warn heading-pill">provisional</span>}</h2>
        <table className="data standings">
          <thead>
            <tr>
              <th className="num hide-narrow">#</th><th>Team</th><th className="hide-narrow">GM</th>
              <th className="num" title={ties ? "Wins–losses–ties" : "Wins–losses"}>{ties ? "W–L–T" : "W–L"}</th>
              <th className="num" title="Goals for">GF</th><th className="num" title="Goals against">GA</th><th className="num hide-narrow" title="Goal difference">+/−</th>
              <th className="num">Salary</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r, i) => {
              const diff = r.goalsFor - r.goalsAgainst;
              const over = payroll[r.team] > cap;
              return (
                <tr key={r.team}>
                  <td className="num muted hide-narrow">{i + 1}</td>
                  <td><Link to={`players?team=${encodeURIComponent(r.team)}`}>{r.team}</Link></td>
                  <td className="muted hide-narrow">{input.teams.find((x) => x.name === r.team)?.gm}</td>
                  <td className="num strong">{recordText(r, ties)}</td>
                  <td className="num">{r.goalsFor}{r.noScore > 0 && <sup title={`${r.noScore} game(s) with no score recorded`}>*</sup>}</td>
                  <td className="num">{r.goalsAgainst}</td>
                  <td className="num hide-narrow">{diff > 0 ? `+${diff}` : diff < 0 ? `−${-diff}` : "0"}</td>
                  <td className={"num" + (over ? " over" : "")} title={over ? `Over the cap by ${money(payroll[r.team] - cap)}` : `${money(cap - payroll[r.team])} under the cap`}>
                    <span className="hide-narrow">{money(payroll[r.team])}</span>
                    <span className="show-narrow">${(payroll[r.team] / 1e6).toFixed(1)}M</span>{over && " ▲"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">
          Salary cap after {w === 0 ? "the start of the season" : `week ${w}`}: {money(cap)}{table.some((r) => payroll[r.team] > cap) && " (▲ over the cap)"}.
          {input.rules.teamResultBonus && <> Salary includes the team result bonus ({money(input.rules.teamResultBonus.win)} per win), which counts against the cap.</>}
          {anyNoScore && <> * Some games have a result but no score, so they aren't in GF/GA.</>}
          {unsettled.length > 0 && <> {unsettled.length === 1 ? `Week ${unsettled[0]} has` : `${unsettled.length} weeks have`} open items, so these can still change: see <Link to="admin">Admin</Link>.</>}
        </p>
      </section>

      <section className="card">
        <h2>Salary by week</h2>
        <LineChart xLabels={weeks.map((wk) => (wk === 0 ? "Start" : `W${wk}`))} format={moneyShort} marker={w}
          series={teams.map((t) => ({ name: shortTeam(t), values: payrollByWeek.map((p) => p[t]) }))}
          reference={{ name: "Cap", values: weeks.map((wk) => result.capByWeek[wk]) }} />
      </section>
    </main>
  );
}
