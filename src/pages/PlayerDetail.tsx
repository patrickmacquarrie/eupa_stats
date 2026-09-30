import { Link, useParams } from "react-router-dom";
import { LineChart } from "../components/LineChart";
import { delta, money, moneyShort, resultLabel, shortTeam } from "../lib/format";
import { useSeason } from "../lib/SeasonContext";

export function PlayerDetail() {
  const { name = "" } = useParams();
  const { input, result } = useSeason();
  const p = input.players.find((x) => x.name === name);
  if (!p) return <main className="page"><p>No player called “{name}”. <Link to="../players">All players</Link></p></main>;

  const weeks = Array.from({ length: input.throughWeek + 1 }, (_, i) => i);
  const sal = result.salary[p.name];
  const log = result.lines.filter((l) => l.player === p.name).sort((a, b) => a.week - b.week || a.team.localeCompare(b.team));
  const trades = input.trades.filter((t) => t.player.toLowerCase() === p.name.toLowerCase());

  return (
    <main className="page">
      <p className="crumbs"><Link to="../players">Players</Link> /</p>
      <h1>{p.name}</h1>
      <p className="muted">
        {result.teamOf(p.name, input.throughWeek + 1) ?? (p.isSub ? "Sub pool" : "No team")} · {p.gender}
        {p.isPlug && " · roster filler (plug)"} · started at {money(sal[0])}
      </p>

      <section className="tiles">
        <div className="tile"><span className="tile-label">Salary after week {input.throughWeek}</span><span className="tile-value">{money(sal[input.throughWeek])}</span></div>
        <div className="tile"><span className="tile-label">Season change</span><span className="tile-value">{delta(sal[input.throughWeek] - sal[0])}</span></div>
        <div className="tile"><span className="tile-label">Games played</span><span className="tile-value">{log.filter((l) => l.role !== "absent").length}</span></div>
        <div className="tile"><span className="tile-label">Games missed</span><span className="tile-value">{log.filter((l) => l.role === "absent").length}</span></div>
      </section>

      <section className="card">
        <h2>Salary by week</h2>
        <LineChart xLabels={weeks.map((w) => (w === 0 ? "Start" : `W${w}`))} format={moneyShort}
          series={[{ name: p.name, values: weeks.map((w) => sal[w]) }]} height={220} />
      </section>

      {trades.length > 0 && (
        <section className="card">
          <h2>Moves</h2>
          <ul>{trades.map((t, i) => <li key={i}>After week {t.afterWeek}: to {t.toTeam ?? "out of the league"}
            {t.effectiveWeek && t.effectiveWeek !== t.afterWeek + 1 ? ` (plays for them from week ${t.effectiveWeek})` : ""}
            {t.playerAdd ? `, salary adjusted ${delta(t.playerAdd)}` : ""}</li>)}</ul>
        </section>
      )}

      <section className="card scroll-x">
        <h2>Game log</h2>
        <table className="data">
          <thead><tr><th>Wk</th><th>Game</th><th>Role</th><th>Res</th><th className="num">G</th><th className="num">A</th>
            <th className="num">D</th><th className="num">Drop</th><th className="num">TA</th><th className="num">Growth</th><th>Note</th></tr></thead>
          <tbody>
            {log.map((l, i) => (
              <tr key={i} className={l.role === "absent" ? "dim" : ""}>
                <td>{l.week}</td>
                <td><Link to={`../games/${l.week}/${encodeURIComponent(l.team)}/${encodeURIComponent(l.opp)}`}>{shortTeam(l.team)} v {shortTeam(l.opp)}</Link></td>
                <td>{l.role}</td><td>{resultLabel(l.result)}</td>
                <td className="num">{l.goals}</td><td className="num">{l.assists}</td><td className="num">{l.blocks}</td>
                <td className="num">{l.drops}</td><td className="num">{l.throwaways}</td>
                <td className="num">{l.role === "sub" ? <span className="muted" title="Credited to the player covered">{money(l.subEarned ?? 0)}</span> : delta(l.growth)}</td>
                <td className="muted small">{l.role === "sub" ? (l.subbedFor ? `covering ${l.subbedFor}` : "not paired") : l.coveredBy ? `covered by ${l.coveredBy}` : l.role === "absent" ? "estimated" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {log.length === 0 && <p className="empty">No games yet.</p>}
      </section>
    </main>
  );
}
