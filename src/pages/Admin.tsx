import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { adminCounts, describeItems, isDisputed } from "../lib/review";
import { setOfficial } from "../lib/official";
import { useSeason } from "../lib/SeasonContext";

/** The Admin tab's own tabs, shown above each admin screen. */
export function AdminFrame({ children }: { children: ReactNode }) {
  const { base: seasonBase, open, nameIssueCount, result } = useSeason();
  const counts = adminCounts(open, nameIssueCount, result.warnings.length);
  const base = `${seasonBase}/admin`;
  const tabs: [string, string, number][] = [
    ["", "Needs attention", counts.review], ["/names", "Names", counts.names], ["/subs", "Subs", counts.subs],
    ["/recordings", "Recordings", 0], ["/setup", "Setup", 0],
  ];
  return (
    <>
      <nav className="subtabs" aria-label="Admin">
        {tabs.map(([to, label, n]) => (
          <NavLink key={to} to={base + to} end={to === ""}>
            {label}{n > 0 && <span className="badge alert" aria-label={`${n} to review`}>{n}</span>}
          </NavLink>
        ))}
      </nav>
      {children}
    </>
  );
}

/** Everything that keeps a week provisional, plus the engine's own warnings. */
export function AdminReview() {
  const { season, input, result, games, computeMs, nameIssueCount, open, provisional, update, updateSeason } = useSeason();
  const quiet = open.filter((i) => i.kind === "quiet");
  const last = input.throughWeek;
  const disputed = games.filter((g) => g.week <= last && isDisputed(g)).length;
  const notes = sessionStorage.getItem(`notes:${season.id}`);
  const clear = !provisional.length && !nameIssueCount && !result.warnings.length && !quiet.length;

  return (
    <main className="page">
      <section className="facts muted small">
        <span>{games.filter((g) => g.week <= last).length} games counted through week {last}</span>
        <span>{disputed ? <Link to="../games?filter=disputed">{disputed} score difference{disputed > 1 ? "s" : ""}</Link> : "No score differences"}</span>
        <span>{result.warnings.length} engine warning{result.warnings.length === 1 ? "" : "s"}</span>
        <span>Engine ran in {Math.round(computeMs)} ms · {input.events.length.toLocaleString()} events</span>
      </section>

      {notes && <p className="note">{notes}</p>}
      {clear && <p className="empty">Nothing needs attention. Every week through week {last} is final.</p>}

      {provisional.length > 0 && (
        <section className="card open-items" aria-labelledby="open-title">
          <h2 id="open-title">Provisional: week{provisional.length > 1 ? "s" : ""} {provisional.join(", ")}</h2>
          <p className="muted small">These salaries and standings can still change. Settle each item below and the week becomes final.</p>
          {provisional.map((wk) => {
            const items = open.filter((i) => i.week === wk && i.kind !== "quiet");
            return (
              <details key={wk} open={provisional.length === 1}>
                <summary><strong>Week {wk}</strong>: {describeItems(items)}</summary>
                <ul className="plain small item-list">{items.map((i, n) => (
                  <li key={n}>
                    <Link to={`../${i.to}`}>{i.label}</Link>
                    {i.approve && (() => {
                      const { a, b, scoreA, scoreB, conflicts } = i.approve;
                      return (
                        <span className="approve-inline">
                          {conflicts > 0 && <span className="muted"> ({conflicts} goal{conflicts > 1 ? "s" : ""} left out for you to check)</span>}
                          <button className="small-btn primary" onClick={() => update((inp) => setOfficial(inp, wk, a, b, scoreA, scoreB))}>Approve {scoreA}–{scoreB}</button>
                        </span>
                      );
                    })()}
                  </li>
                ))}</ul>
              </details>
            );
          })}
        </section>
      )}

      {quiet.length > 0 && (
        <section className="card" aria-labelledby="quiet-title">
          <h2 id="quiet-title">Present with no stats</h2>
          <p className="muted small">These players were marked present but have no recorded plays. Their salary already counts them as present; check they really played, then acknowledge, or untick them on the game page.</p>
          <ul className="plain small item-list">{quiet.map((i) => (
            <li key={i.quietKey}>
              <Link to={`../${i.to}`}>{i.label}</Link>
              <span className="approve-inline">
                <button className="small-btn" onClick={() => updateSeason((s) => ({ ...s, acknowledgedQuiet: [...(s.acknowledgedQuiet ?? []), i.quietKey!] }))}>Acknowledge</button>
              </span>
            </li>
          ))}</ul>
        </section>
      )}

      {nameIssueCount > 0 && (
        <p className="note attn-note">
          {nameIssueCount} name issue(s) to review: spellings that don't match a player, or old “Name Sub” records.{" "}
          <Link to="names">Review names</Link>
        </p>
      )}

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
