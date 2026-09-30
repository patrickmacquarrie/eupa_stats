import { Link, useSearchParams } from "react-router-dom";
import type { RecordingSummary } from "../../engine/types";
import { shortTeam } from "../lib/format";
import { weekOfDate } from "../lib/season";
import { useSeason, type Game } from "../lib/SeasonContext";

const score = (r?: RecordingSummary, flip = false) =>
  !r || Number.isNaN(r.finalScore) ? "—" : flip ? `${r.finalOppScore}–${r.finalScore}` : `${r.finalScore}–${r.finalOppScore}`;

export function gameStatus(g: Game, openFlags = 0): { label: string; tone: "ok" | "warn" | "info" } {
  if (openFlags) return { label: `${openFlags} flagged`, tone: "warn" };
  if (!g.recA || !g.recB) return { label: "one side only", tone: "warn" };
  if (!g.recA.eventCount || !g.recB.eventCount) return { label: "box score", tone: "info" };
  const agree = g.recA.finalScore === g.recB.finalOppScore && g.recA.finalOppScore === g.recB.finalScore;
  return agree ? { label: "tablets agree", tone: "ok" } : { label: "tablets disagree", tone: "warn" };
}

export function Games() {
  const { games, season, input } = useSeason();
  const flagsFor = (g: Game) => (season.flags ?? []).filter((f) => !f.resolved && [g.a, g.b].includes(f.team) &&
    [g.a, g.b].includes(f.opp) && weekOfDate(input.schedule, f.date) === g.week).length;
  const [params, setParams] = useSearchParams();
  const filter = params.get("filter") ?? "all";
  const shown = games.filter((g) => filter === "all" || (filter === "disputed" && gameStatus(g, flagsFor(g)).tone === "warn"));
  const weeks = [...new Set(shown.map((g) => g.week))];

  return (
    <main className="page">
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter games">
          {[["all", "All games"], ["disputed", "Needs a look"]].map(([k, l]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => setParams(k === "all" ? {} : { filter: k })}>{l}</button>
          ))}
        </div>
        <span className="muted small">Scores are shown from the first-named team's side, as each tablet recorded them.</span>
      </div>
      {weeks.map((w) => (
        <section key={w} className="card">
          <h2>Week {w}</h2>
          <table className="data">
            <thead><tr><th>Game</th><th className="num">First team's tablet</th><th className="num">Second team's tablet</th><th>Status</th></tr></thead>
            <tbody>
              {shown.filter((g) => g.week === w).map((g) => {
                const s = gameStatus(g, flagsFor(g));
                return (
                  <tr key={`${g.a}|${g.b}`}>
                    <td><Link to={`${g.week}/${encodeURIComponent(g.a)}/${encodeURIComponent(g.b)}`}>{shortTeam(g.a)} v {shortTeam(g.b)}</Link></td>
                    <td className="num">{score(g.recA)}</td>
                    <td className="num">{score(g.recB, true)}</td>
                    <td><span className={`pill ${s.tone}`}>{s.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
      {shown.length === 0 && <p className="empty">{filter === "all" ? "No games recorded yet. Add tablet recordings on the Recordings tab." : "Nothing needs a look."}</p>}
    </main>
  );
}
