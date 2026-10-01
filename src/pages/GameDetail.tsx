import { useMemo, useState } from "react";
import { askConfirm } from "../lib/confirm";
import { Link, useParams } from "react-router-dom";
import { crossCheck } from "../../engine/crosscheck";
import { PlayEditor } from "../components/PlayEditor";
import type { BoxScore, GameLine, StatLine } from "../../engine/types";
import { delta, money, resultLabel, shortTeam } from "../lib/format";
import { weekOfDate, type SavedFlag } from "../lib/season";
import { describe } from "../lib/recorder";
import { useSeason } from "../lib/SeasonContext";
import { clearOfficial, needsReconfirming, officialFor, setOfficial } from "../lib/official";
import { recommend, tabletsText } from "../lib/scoreDiff";
import { quietKey } from "../lib/review";

const STATS: [keyof StatLine, string][] = [
  ["goals", "G"], ["assists", "A"], ["secondAssists", "2A"], ["blocks", "D"],
  ["drops", "Drop"], ["throwaways", "TA"], ["gso", "GSO"], ["touches", "Tch"],
];

export function GameDetail() {
  const { canAdmin } = useSeason();
  return canAdmin ? <GameAdmin /> : <GameSummary />;
}

/** Stats entry's view of a game: each team's score and every player's line, nothing to change. */
function GameSummary() {
  const { week: wk = "", a = "", b = "" } = useParams();
  const week = Number(wk);
  const { input, result } = useSeason();
  const date = input.events.find((e) => [a, b].includes(e.statTeam) && [a, b].includes(e.otherTeam) && weekOfDate(input.schedule, e.date) === week)?.date
    ?? input.schedule.find((s) => s.week === week)?.date;
  const COLS: [keyof StatLine, string][] = [["goals", "Point"], ["assists", "Assist"], ["touches", "Touch"], ["blocks", "D-Play"], ["throwaways", "Throwaway"], ["drops", "Drop"], ["gso", "GSO"]];
  return (
    <main className="page">
      <p className="crumbs"><Link to="../games">Games</Link> / Week {week}</p>
      <h1>{a} v {b}</h1>
      {date && <p className="muted">{new Date(date + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>}
      <div className="two-col">
        {[[a, b], [b, a]].map(([team, opp]) => {
          const rec = result.recordings.find((r) => r.week === week && r.team === team && r.opp === opp);
          const lines = result.lines.filter((l) => l.week === week && l.team === team && l.opp === opp && l.role !== "absent")
            .sort((x, y) => Number(x.role === "sub") - Number(y.role === "sub") || x.player.localeCompare(y.player));
          return (
            <section key={team} className="card scroll-x game-summary">
              <div className="row">
                <h2 className="grow">{team}</h2>
                {rec && !Number.isNaN(rec.finalScore) && <span className="score">{rec.finalScore}–{rec.finalOppScore} {resultLabel(rec.result)}</span>}
              </div>
              {!rec ? <p className="muted small">No recording for this side yet.</p> : (
                <table className="data">
                  <thead><tr><th>Player</th>{COLS.map(([, l]) => <th key={l} className="num">{l}</th>)}</tr></thead>
                  <tbody>{lines.map((l) => (
                    <tr key={l.player}><td>{l.player}{l.role === "sub" && <span className="tag">sub</span>}</td>
                      {COLS.map(([k, l2]) => <td key={l2} className="num">{l[k]}</td>)}</tr>
                  ))}</tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}

function GameAdmin() {
  const { week: wk = "", a = "", b = "" } = useParams();
  const week = Number(wk);
  const { season, input, result } = useSeason();
  const official = officialFor(season.input, week, a, b);

  const eventsFor = (team: string, opp: string) =>
    input.events.filter((e) => e.statTeam === team && e.otherTeam === opp && weekOfDate(input.schedule, e.date) === week);
  const evA = useMemo(() => eventsFor(a, b), [input.events, a, b, week]);
  const evB = useMemo(() => eventsFor(b, a), [input.events, a, b, week]);
  const check = useMemo(() => (evA.length && evB.length ? crossCheck(evA, evB) : null), [evA, evB]);
  const date = evA[0]?.date ?? evB[0]?.date ?? input.schedule.find((s) => s.week === week)?.date;
  const [edit, setEdit] = useState<{ team: string; opp: string; date: string; focus?: number } | null>(null);
  const openEditor = (team: string, opp: string, d: string, focus?: number) => {
    setEdit({ team, opp, date: d, focus });
    setTimeout(() => document.querySelector(".editor-card")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <main className="page">
      <p className="crumbs"><Link to="../games">Games</Link> / Week {week}</p>
      <h1>{a} v {b}</h1>
      {date && <p className="muted">{new Date(date + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>}

      {check && !check.agree && <ScoreDifference week={week} a={a} b={b} proposed={[check.proposed.a, check.proposed.b]} />}
      {check && check.agree && (
        <section className="card">
          <h2>Tablet cross-check</h2>
          <p>Both tablets agree: <strong>{a} {check.finalA.replace("-", "–")} {b}</strong>.</p>
          {official && <OfficialScore week={week} a={a} b={b} proposed={[check.proposed.a, check.proposed.b]} />}
          {check.unmatched.length > 0 ? (
            <table className="data">
              <thead><tr><th>Time</th><th>Only on</th><th>What</th><th>Score after</th><th>Verdict</th><th>Why</th></tr></thead>
              <tbody>
                {check.unmatched.map((u, i) => (
                  <tr key={i}>
                    <td>{u.at}</td><td>{u.side === "A" ? a : b}</td>
                    <td>{u.kind === "goal" ? `Point ${u.player ?? "?"}` : `GSO${u.player ? ` ${u.player}` : ""}`}</td>
                    <td>{u.scoreAfter}</td>
                    <td><span className={`pill ${u.verdict === "conflict" ? "warn" : u.verdict === "review" ? "info" : "ok"}`}>{u.verdict}</span></td>
                    <td className="small">{u.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted small">Every Point on one tablet lines up with a GSO on the other.</p>}
        </section>
      )}

      {official && !check && (
        <section className="card">
          <h2>Official score</h2>
          <OfficialScore week={week} a={a} b={b} proposed={[official.a === a ? official.scoreA : official.scoreB, official.a === a ? official.scoreB : official.scoreA]} />
        </section>
      )}

      <Flags week={week} a={a} b={b} onEdit={openEditor} />
      {edit && <PlayEditor key={`${edit.team}|${edit.focus}`} {...edit} onClose={() => setEdit(null)} />}

      <div className="two-col">
        <Side team={a} opp={b} week={week} onEdit={evA.length ? () => openEditor(a, b, evA[0].date) : undefined} lines={result.lines.filter((l) => l.week === week && l.team === a && l.opp === b)} />
        <Side team={b} opp={a} week={week} onEdit={evB.length ? () => openEditor(b, a, evB[0].date) : undefined} lines={result.lines.filter((l) => l.week === week && l.team === b && l.opp === a)} />
      </div>
    </main>
  );
}

function Side({ team, opp, week, lines, onEdit }: { team: string; opp: string; week: number; lines: GameLine[]; onEdit?: () => void }) {
  const { season, input, result, update, updateSeason, resolveName } = useSeason();
  const rec = result.recordings.find((r) => r.week === week && r.team === team && r.opp === opp);
  const box = season.input.boxScores?.find((x) => x.week === week && x.team === team && x.opp === opp);
  const [editing, setEditing] = useState(false);
  const order = { rostered: 0, sub: 1, absent: 2 } as const;
  const sorted = [...lines].sort((x, y) => order[x.role] - order[y.role] || y.growth - x.growth || x.player.localeCompare(y.player));
  const isMarked = (x: { week: number; team: string; opp: string; player: string }, player: string) =>
    x.week === week && x.team === team && x.opp === opp && x.player.toLowerCase() === player.toLowerCase();
  const marked = (player: string) => (input.presentWithoutPlays ?? []).some((x) => isMarked(x, player));
  // Unticking also clears any "present with no stats" acknowledgement, so a later tick asks again.
  const setPresent = (player: string, on: boolean) => updateSeason((s) => ({
    ...s,
    acknowledgedQuiet: on ? s.acknowledgedQuiet : (s.acknowledgedQuiet ?? []).filter((k) => k !== quietKey(week, team, opp, player)),
    input: {
      ...s.input,
      presentWithoutPlays: [
        ...(s.input.presentWithoutPlays ?? []).filter((x) => !isMarked({ ...x, player: resolveName(x.player) }, player)),
        ...(on ? [{ week, team, opp, player }] : []),
      ],
    },
  }));

  return (
    <section className="card scroll-x">
      <div className="row">
        <h2 className="grow">{team}</h2>
        {rec && <span className="score">{Number.isNaN(rec.finalScore) ? resultLabel(rec.result) : `${rec.finalScore}–${rec.finalOppScore} ${resultLabel(rec.result)}`}</span>}
      </div>
      <p className="muted small">
        {!rec ? "No recording for this side." : box ? "From an admin box score." : `From ${rec.eventCount} tablet events.`}
        {rec?.official && " Result from the official score."}
      </p>
      {editing ? (
        <BoxEditor team={team} opp={opp} week={week} lines={lines} initial={box} onDone={() => setEditing(false)} />
      ) : (
        <>
          <table className="data">
            <thead><tr><th>Player</th>{STATS.slice(0, 6).map(([, l]) => <th key={l} className="num">{l}</th>)}<th className="num">Growth</th></tr></thead>
            <tbody>
              {sorted.map((l) => (
                <tr key={l.player} className={l.role === "absent" ? "dim" : ""}>
                  <td>
                    <Link to={`../players/${encodeURIComponent(l.player)}`}>{l.player}</Link>
                    {l.role !== "rostered" && <span className="tag">{l.role}</span>}
                    {l.role === "sub" && <div className="muted small">{l.subbedFor ? `subbed for ${l.subbedFor}` : "not paired"}</div>}
                    {l.role === "absent" && l.coveredBy && <div className="muted small">sub: {l.coveredBy}</div>}
                    {rec && (l.role === "absent" || marked(l.player)) && (
                      <label className="check small muted presence">
                        <input type="checkbox" checked={l.role !== "absent"} onChange={(e) => setPresent(l.player, e.target.checked)} />
                        {l.role === "absent" ? "Was here" : "Here, no plays"}
                      </label>
                    )}
                  </td>
                  {STATS.slice(0, 6).map(([k]) => <td key={k} className="num">{l.role === "absent" ? "" : l[k]}</td>)}
                  <td className="num">{l.role === "sub" ? <span className="muted" title="Worth this much; credited to the absent player">{money(l.subEarned ?? 0)}</span> : delta(l.growth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row gap">
            {onEdit && !box && <button onClick={onEdit}>Edit possessions</button>}
            <button onClick={() => setEditing(true)}>{box ? "Edit box score" : "Correct with a box score"}</button>
            {box && (
              <button className="danger" onClick={async () => {
                if (await askConfirm("Remove this box score? The side goes back to its tablet recording, if there is one.", { ok: "Remove", danger: true })) {
                  update((inp) => ({ ...inp, boxScores: (inp.boxScores ?? []).filter((x) => x !== box) }));
                }
              }}>Remove box score</button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

type Row = { player: string } & StatLine;

function BoxEditor({ team, opp, week, lines, initial, onDone }:
  { team: string; opp: string; week: number; lines: GameLine[]; initial?: BoxScore; onDone: () => void }) {
  const { season, update, result } = useSeason();
  const rec = result.recordings.find((r) => r.week === week && r.team === team && r.opp === opp);
  const [rows, setRows] = useState<Row[]>(() => initial?.lines.map((l) => ({ ...l })) ??
    lines.filter((l) => l.role !== "absent").map((l) => ({ player: l.player, ...Object.fromEntries(STATS.map(([k]) => [k, l[k]])) } as Row)));
  const [res, setRes] = useState<number>(initial?.result ?? rec?.result ?? 0);
  const [fs, setFs] = useState<string>(String(initial?.finalScore ?? (rec && !Number.isNaN(rec.finalScore) ? rec.finalScore : "")));
  const [fo, setFo] = useState<string>(String(initial?.finalOppScore ?? (rec && !Number.isNaN(rec.finalOppScore) ? rec.finalOppScore : "")));
  const [add, setAdd] = useState("");
  const candidates = season.input.players.map((p) => p.name).filter((n) => !rows.some((r) => r.player === n)).sort();

  const set = (i: number, k: keyof StatLine, v: number) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    const bs: BoxScore = {
      week, team, opp, result: res,
      finalScore: fs === "" ? undefined : Number(fs), finalOppScore: fo === "" ? undefined : Number(fo),
      lines: rows,
    };
    await update((inp) => ({ ...inp, boxScores: [...(inp.boxScores ?? []).filter((x) => !(x.week === week && x.team === team && x.opp === opp)), bs] }));
    onDone();
  };

  return (
    <div className="editor">
      <p className="muted small">A box score replaces this side's tablet recording in every calculation. Players left off count as absent.</p>
      <div className="row gap wrap">
        <label>Result <select value={res} onChange={(e) => setRes(+e.target.value)}>
          <option value={1}>Win</option><option value={0.5}>Tie</option><option value={0}>Loss</option></select></label>
        <label>Score <input className="num-in" inputMode="numeric" value={fs} onChange={(e) => setFs(e.target.value)} /></label>
        <label>Opp <input className="num-in" inputMode="numeric" value={fo} onChange={(e) => setFo(e.target.value)} /></label>
      </div>
      <table className="data compact">
        <thead><tr><th>Player</th>{STATS.map(([, l]) => <th key={l} className="num">{l}</th>)}<th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.player}>
              <td>{r.player}</td>
              {STATS.map(([k]) => (
                <td key={k}><input className="num-in" type="number" min={0} value={r[k]} aria-label={`${r.player} ${k}`}
                  onChange={(e) => set(i, k, Number(e.target.value) || 0)} /></td>
              ))}
              <td><button className="icon" aria-label={`Remove ${r.player}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row gap wrap">
        <select value={add} onChange={(e) => setAdd(e.target.value)}>
          <option value="">Add a player…</option>
          {candidates.map((n) => <option key={n}>{n}</option>)}
        </select>
        <button disabled={!add} onClick={() => { setRows([...rows, { player: add, goals: 0, assists: 0, secondAssists: 0, blocks: 0, drops: 0, throwaways: 0, gso: 0, touches: 0 }]); setAdd(""); }}>Add</button>
        <span className="grow" />
        <button onClick={onDone}>Cancel</button>
        <button className="primary" onClick={save}>Save box score</button>
      </div>
    </div>
  );
}

function Flags({ week, a, b, onEdit }: { week: number; a: string; b: string; onEdit: (team: string, opp: string, date: string, focus?: number) => void }) {
  const { season, input, updateSeason } = useSeason();
  const flags = (season.flags ?? []).filter((f) => (f.team === a || f.team === b) && (f.opp === a || f.opp === b) &&
    weekOfDate(input.schedule, f.date) === week);
  if (!flags.length) return null;
  const open = flags.filter((f) => !f.resolved).length;
  const setResolved = (f: SavedFlag, resolved: boolean) =>
    updateSeason((x) => ({ ...x, flags: (x.flags ?? []).map((g) => (g === f ? { ...g, resolved } : g)) }));
  return (
    <section className="card">
      <h2>Flagged by the stat-taker ({open} open)</h2>
      <p className="muted small">Possessions marked as wrong during the game. Fix them in the possession editor (or with a box score for that side), then mark them resolved.</p>
      {flags.map((f, i) => {
        const plays = input.events.filter((e) => e.date === f.date && e.statTeam === f.team && e.otherTeam === f.opp).slice(f.start, f.end + 1);
        return (
          <div key={i} className={"flag-item" + (f.resolved ? " resolved" : "")}>
            <div className="row">
              <strong className="grow">⚑ {f.team}'s tablet, {f.clock}</strong>
              {!f.resolved && <button className="small-btn" onClick={() => onEdit(f.team, f.opp, f.date, f.start)}>Edit this possession</button>}{" "}
              <button className="small-btn" onClick={() => setResolved(f, !f.resolved)}>{f.resolved ? "Reopen" : "Mark resolved"}</button>
            </div>
            {f.note && <p className="small">“{f.note}”</p>}
            <ol className="small plays">{plays.map((e, j) => <li key={j}><span className="muted">{(e.clock ?? "").slice(0, 8)}</span> {describe(e)} <span className="muted">{e.statScore}–{e.otherScore}</span></li>)}</ol>
          </div>
        );
      })}
    </section>
  );
}

/** The administrator's call on a disputed game: decides the result for both sides. */
/** The tablets' finals differ: recommend a score and explain it; an admin approves or changes it. */
function ScoreDifference({ week, a, b, proposed }: { week: number; a: string; b: string; proposed: [number, number] }) {
  const { season, input, update } = useSeason();
  const r = useMemo(() => recommend(input, week, a, b), [input, week, a, b]);
  const official = officialFor(season.input, week, a, b);
  const [changing, setChanging] = useState(false);
  if (!r) return null;
  return (
    <section className="card score-diff">
      <h2>Score difference</h2>
      <p className="muted">{tabletsText(r)}</p>
      {official ? <OfficialScore week={week} a={a} b={b} proposed={proposed} /> : (
        <>
          <p className="recommended">Recommended: <strong>{shortTeam(r.first)} {r.score[0]}–{r.score[1]}</strong>{r.score[0] === r.score[1] && <> (a tie with {shortTeam(r.second)})</>}</p>
          {r.goals.length > 0 && (
            <ul className="goal-reasons">{r.goals.map((g, i) => <li key={i} className={g.counted ? "" : "attn"}>{g.text}</li>)}</ul>
          )}
          {r.conflicts.map((c, i) => <p key={i} className="note attn-note">{c}</p>)}
          <div className="row gap-sm wrap">
            <button className="primary" onClick={() => update((inp) => setOfficial(inp, week, r.first, r.second, r.score[0], r.score[1]))}>Approve recommended score</button>
            <button onClick={() => setChanging((x) => !x)} aria-expanded={changing}>Change</button>
          </div>
          {changing && <OfficialScore week={week} a={a} b={b} proposed={proposed} />}
        </>
      )}
      {official && r.goals.length > 0 && (
        <details className="small"><summary>Why the tablets differ</summary>
          <ul className="goal-reasons">{r.goals.map((g, i) => <li key={i}>{g.text}</li>)}</ul>
        </details>
      )}
      <p className="muted small">Until a score is approved, each side's win or loss comes from its own tablet, so both teams can be credited the win. The week stays provisional until it's settled.</p>
    </section>
  );
}

function OfficialScore({ week, a, b, proposed }: { week: number; a: string; b: string; proposed: [number, number] }) {
  const { season, update } = useSeason();
  const current = officialFor(season.input, week, a, b);
  const cur: [number, number] | null = current ? (current.a === a ? [current.scoreA, current.scoreB] : [current.scoreB, current.scoreA]) : null;
  const stale = !!current && needsReconfirming(season.input, current);
  const [sa, setSa] = useState(String(cur?.[0] ?? proposed[0]));
  const [sb, setSb] = useState(String(cur?.[1] ?? proposed[1]));
  const ok = /^\d+$/.test(sa) && /^\d+$/.test(sb);
  const same = !!cur && Number(sa) === cur[0] && Number(sb) === cur[1];
  return (
    <div className={"official" + (cur ? " set" : "") + (stale ? " stale" : "")}>
      {cur ? <p><strong>Official score: {a} {cur[0]}–{cur[1]} {b}.</strong> Both teams' results follow it; each tablet's own stats still count.</p>
        : <p><strong>Settle it:</strong> set the official score. Both teams' results follow it; each tablet's own stats still count.</p>}
      {stale && <p className="attn">This game's recordings have changed since the official score was set. It still decides the result, but the week stays provisional until you confirm it, change it or clear it.</p>}
      <div className="row gap-sm wrap">
        <label className="field inline"><span>{shortTeam(a)}</span><input className="num-in" inputMode="numeric" value={sa} onChange={(e) => setSa(e.target.value)} aria-label={`${a} official score`} /></label>
        <span>–</span>
        <label className="field inline"><span>{shortTeam(b)}</span><input className="num-in" inputMode="numeric" value={sb} onChange={(e) => setSb(e.target.value)} aria-label={`${b} official score`} /></label>
        <button className="primary" disabled={!ok || (same && !stale)} onClick={() => update((inp) => setOfficial(inp, week, a, b, Number(sa), Number(sb)))}>
          {!cur ? "Set official score" : stale && same ? "Confirm official score" : "Update official score"}</button>
        {cur && <button onClick={() => update((inp) => clearOfficial(inp, week, a, b))}>Clear</button>}
      </div>
    </div>
  );
}
