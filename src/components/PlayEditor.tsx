import { Fragment, useDeferredValue, useMemo, useState } from "react";
import { computeLeague, tallyRecording } from "../../engine/compute";
import type { PlayEvent, StatLine } from "../../engine/types";
import { delta } from "../lib/format";
import { resolveInput } from "../lib/names";
import { ACTIONS, PICKS_PLAYER, changed, insertRow, problems, remapIndex, removeRow, rowsOf, setAction, setPlayer, type Action, type Row } from "../lib/playlog";
import { possessions } from "../lib/recorder";
import { weekOfDate } from "../lib/season";
import { useSeason } from "../lib/SeasonContext";

const key = (e: PlayEvent) => `${e.date}|${e.statTeam}|${e.otherTeam}`;
const STATS: [keyof StatLine, string][] = [["goals", "G"], ["assists", "A"], ["secondAssists", "2A"], ["blocks", "D"], ["drops", "Drop"], ["throwaways", "TA"], ["gso", "GSO"], ["touches", "Tch"]];

/**
 * Play-by-play editor for one team's recording. Edits are staged here; nothing changes in the
 * season until Save. `focus` is a saved play index to open at (e.g. a flagged possession).
 */
export function PlayEditor({ date, team, opp, focus, onClose }: { date: string; team: string; opp: string; focus?: number; onClose: () => void }) {
  const { season, input, result, updateSeason } = useSeason();
  const k = `${date}|${team}|${opp}`;
  const original = useMemo(() => season.input.events.filter((e) => key(e) === k), [season.input.events, k]);
  const [rows, setRows] = useState<Row[]>(() => rowsOf(original));
  const [history, setHistory] = useState<Row[][]>([]);
  const [showAll, setShowAll] = useState(focus === undefined);
  const [adding, setAdding] = useState<{ at: number; action: Action; player: string } | null>(null);

  const apply = (next: Row[]) => { setHistory([...history, rows]); setRows(next); setAdding(null); };
  const issues = useMemo(() => problems(rows), [rows]);
  const dirty = rows.length !== original.length || rows.some((r) => changed(r, original));
  const poss = useMemo(() => possessions(rows.map((r) => r.e)), [rows]);
  const flagged = (season.flags ?? []).filter((f) => `${f.date}|${f.team}|${f.opp}` === k && !f.resolved);
  const week = weekOfDate(season.input.schedule, date);
  const box = season.input.boxScores?.some((b) => b.week === week && b.team === team && b.opp === opp);

  // Which possessions to show: the focused one and its neighbours, or everything.
  const focusRow = focus === undefined ? 0 : remapIndex(rows, focus, "start");
  const focusPoss = poss.findIndex((p) => focusRow >= p.start && focusRow <= p.end);
  const shown = showAll ? poss : poss.slice(Math.max(0, focusPoss - 1), focusPoss + 2);

  // Who can be picked: this game's names first, then everyone else in the league.
  const inGame = [...new Set(rows.flatMap((r) => [r.e.player, r.e.lastPlayer, r.e.secLastPlayer]).filter((n): n is string => !!n))].sort();
  const others = input.players.map((p) => p.name).filter((n) => !inGame.includes(n)).sort();
  const PlayerSelect = ({ value, onChange, label, optional }: { value: string; onChange: (v: string) => void; label: string; optional?: boolean }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{optional ? "(nobody)" : "Pick a player…"}</option>
      <optgroup label="In this game">{inGame.map((n) => <option key={n}>{n}</option>)}</optgroup>
      <optgroup label="Everyone else">{others.map((n) => <option key={n}>{n}</option>)}</optgroup>
    </select>
  );

  // What the edit does to the box score and to salaries.
  const before = useMemo(() => tallyRecording(original, (n) => n), [original]);
  const deferred = useDeferredValue(rows);
  const after = useMemo(() => tallyRecording(deferred.map((r) => r.e), (n) => n), [deferred]);
  const statDiffs = [...new Set([...before.lines.keys(), ...after.lines.keys()])].map((n) => {
    const b = before.lines.get(n), a = after.lines.get(n);
    const d = STATS.map(([s, l]) => [l, (a?.[s] ?? 0) - (b?.[s] ?? 0)] as const).filter(([, v]) => v !== 0);
    return { n, d };
  }).filter((x) => x.d.length);
  const salary = useMemo(() => {
    if (!dirty) return [];
    const events = [...season.input.events.filter((e) => key(e) !== k), ...deferred.map((r) => r.e)];
    const res = computeLeague(resolveInput({ ...season.input, events }, season.aliases));
    const w = season.input.throughWeek;
    return Object.keys(res.salary).map((n) => ({ n, d: res.salary[n][w] - (result.salary[n]?.[w] ?? res.salary[n][w]) }))
      .filter((x) => Math.abs(x.d) > 0.5).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  }, [deferred, dirty]);

  const save = async () => {
    if (issues.size && !confirm(`${issues.size} play(s) don't fit the possession (marked in red). Save anyway?`)) return;
    await updateSeason((s) => ({
      ...s,
      input: { ...s.input, events: [...s.input.events.filter((e) => key(e) !== k), ...rows.map((r) => r.e)] },
      flags: (s.flags ?? []).map((f) => (`${f.date}|${f.team}|${f.opp}` !== k ? f
        : { ...f, start: remapIndex(rows, f.start, "start"), end: Math.max(remapIndex(rows, f.start, "start"), remapIndex(rows, f.end, "end")) })),
    }));
    onClose();
  };

  const last = rows[rows.length - 1]?.e, lastBefore = original[original.length - 1];
  return (
    <section className="card editor-card">
      <div className="row wrap gap-sm">
        <h2 className="grow">Edit plays: {team}'s tablet</h2>
        <label className="check small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show every play</label>
        <button disabled={!history.length} onClick={() => { setRows(history[history.length - 1]); setHistory(history.slice(0, -1)); }}>Undo</button>
        <button onClick={() => { if (!dirty || confirm("Discard these edits?")) onClose(); }}>Cancel</button>
        <button className="primary" disabled={!dirty} onClick={save}>Save</button>
      </div>
      <p className="muted small">
        Changing a play updates the assists after it in that possession, and the score from there on. Point and Throwaway belong to whoever
        had the disc: to change who scored, change or add the Touch before it.
      </p>
      {box && <p className="attn small">This side is being counted from a box score, so edits here won't count until the box score is removed.</p>}

      <div className="scroll-x">
        <table className="data compact plays-table">
          <thead><tr><th>#</th><th>Time</th><th>Play</th><th>Player</th><th>From</th><th className="num">Score</th><th /></tr></thead>
          {shown.map((p) => {
            const isFlagged = flagged.some((f) => remapIndex(rows, f.start, "start") === p.start);
            return (
              <tbody key={p.start} className={"poss-group" + (isFlagged ? " flagged" : "")}>
                <tr className="poss-head"><td colSpan={7}>
                  <span className={"side " + (p.ours ? "ours" : "theirs")}>{p.ours ? `${team} possession` : `${opp} possession`}</span>
                  {isFlagged && <span className="attn small"> ⚑ flagged</span>}
                </td></tr>
                {rows.slice(p.start, p.end + 1).map((r, off) => {
                  const i = p.start + off, e = r.e, why = issues.get(i);
                  return (
                    <Fragment key={r.uid}>
                      <tr className={(changed(r, original) ? "edited" : "") + (why ? " bad" : "")}>
                        <td className="muted">{i + 1}</td>
                        <td className="muted small">{(e.clock ?? "").slice(0, 8)}</td>
                        <td>
                          <select value={e.action} aria-label={`Play ${i + 1}`} onChange={(ev) => apply(setAction(rows, i, ev.target.value as Action))}>
                            {ACTIONS.map((a) => <option key={a.action} value={a.action}>{a.label}</option>)}
                          </select>
                        </td>
                        <td>
                          {PICKS_PLAYER.has(e.action)
                            ? <PlayerSelect value={e.player ?? ""} label={`Player for play ${i + 1}`} optional={e.action === "GSO"} onChange={(v) => apply(setPlayer(rows, i, v || null))} />
                            : <span className="muted">{e.player ?? "—"}</span>}
                          {why && <div className="error small">{why}</div>}
                        </td>
                        <td className="small muted">{[e.lastPlayer, e.secLastPlayer].filter(Boolean).join(", ")}</td>
                        <td className="num">{e.statScore}–{e.otherScore}</td>
                        <td className="nowrap">
                          <button className="icon" title="Insert a play before this one" aria-label={`Insert before play ${i + 1}`}
                            onClick={() => setAdding({ at: i, action: "Touch", player: "" })}>＋</button>
                          <button className="icon" title="Delete this play" aria-label={`Delete play ${i + 1}`} onClick={() => apply(removeRow(rows, i))}>×</button>
                        </td>
                      </tr>
                      {adding?.at === i && (
                        <tr className="adding"><td /><td className="small muted">new</td>
                          <td><select value={adding.action} onChange={(ev) => setAdding({ ...adding, action: ev.target.value as Action })} aria-label="New play">
                            {ACTIONS.map((a) => <option key={a.action} value={a.action}>{a.label}</option>)}
                          </select></td>
                          <td>{PICKS_PLAYER.has(adding.action)
                            ? <PlayerSelect value={adding.player} label="Player for the new play" optional={adding.action === "GSO"} onChange={(v) => setAdding({ ...adding, player: v })} />
                            : <span className="muted small">whoever had the disc</span>}</td>
                          <td colSpan={3} className="nowrap">
                            <button className="primary small-btn" disabled={PICKS_PLAYER.has(adding.action) && adding.action !== "GSO" && !adding.player}
                              onClick={() => apply(insertRow(rows, i, adding.action, adding.player || null))}>Insert</button>{" "}
                            <button className="small-btn" onClick={() => setAdding(null)}>Cancel</button>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      {!showAll && <p className="small"><button className="link" onClick={() => setShowAll(true)}>Show every play ({rows.length})</button></p>}

      {dirty && (
        <div className="edit-effect">
          <p><strong>Final score</strong> {lastBefore ? `${lastBefore.statScore}–${lastBefore.otherScore}` : "—"} → <strong>{last ? `${last.statScore}–${last.otherScore}` : "—"}</strong></p>
          {statDiffs.length > 0 && <p className="small">Stats: {statDiffs.map((x) => `${x.n} ${x.d.map(([l, v]) => `${v > 0 ? "+" : ""}${v} ${l}`).join(", ")}`).join(" · ")}</p>}
          <p className="small">{salary.length === 0 ? <span className="muted">No salary changes.</span> : <>Salary after week {season.input.throughWeek}:{" "}
            {salary.slice(0, 8).map((x, i) => <span key={x.n}>{i ? ", " : ""}{x.n} <span className={x.d > 0 ? "up" : "down"}>{delta(x.d)}</span></span>)}
            {salary.length > 8 && ` and ${salary.length - 8} more`}</>}</p>
        </div>
      )}
    </section>
  );
}
