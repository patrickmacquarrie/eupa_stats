import { useEffect, useMemo, useState } from "react";
import { askConfirm } from "../lib/confirm";
import { Link } from "react-router-dom";
import { crossCheck } from "../../engine/crosscheck";
import type { PlayEvent } from "../../engine/types";
import { tabletCsvToEvents } from "../lib/csv";
import { recordingProblems, summarize } from "../lib/validate";
import { nameKey, suggestPlayer } from "../lib/names";
import { shortTeam } from "../lib/format";
import { recordingsOf, weekOfDate, withoutFlagsFor } from "../lib/season";
import { useSeason } from "../lib/SeasonContext";

interface Pending { file: string; events: PlayEvent[]; error?: string; warnings?: string[] }

type Sample = { label: string; files: [string, string][] };
/** Sample tablet pairs exist only in demo builds, like the demo seasons. */
const loadSamples = (): Promise<Sample[]> => (import.meta.env.VITE_DEMOS === "true" ? import("../lib/demos").then((m) => m.SAMPLES) : Promise.resolve([]));

const recKey = (e: PlayEvent) => `${e.date}|${e.statTeam}|${e.otherTeam}`;

export function Recordings() {
  const { season, updateSeason } = useSeason();
  const { input } = season;
  const [pending, setPending] = useState<Pending[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  useEffect(() => { loadSamples().then(setSamples); }, []);

  const existing = useMemo(() => recordingsOf(input.events), [input.events]);
  const teams = new Set(input.teams.map((t) => t.name));
  const known = new Set([...input.players.map((p) => nameKey(p.name)), ...(season.aliases ?? []).map((a) => nameKey(a.from))]);

  const addFiles = (files: [string, string][]) => {
    setMsg(null);
    setPending((prev) => [...prev, ...files.map(([file, text]) => {
      try {
        const events = tabletCsvToEvents(text);
        if (!events.length) return { file, events, error: "No plays in this file." };
        if (new Set(events.map(recKey)).size > 1) return { file, events, error: "This file mixes more than one game; export one game per file." };
        const found = recordingProblems(events, "This file");
        const blocking = found.filter((x) => x.blocking);
        if (blocking.length) return { file, events, error: summarize(blocking, 4).join(" ") };
        return { file, events, warnings: found.map((x) => x.message) };
      } catch (e) { return { file, events: [], error: (e as Error).message }; }
    })]);
  };

  const problems = (p: Pending) => {
    if (p.error) return [p.error];
    const e = p.events[0], out: string[] = [];
    for (const t of [e.statTeam, e.otherTeam]) if (!teams.has(t)) out.push(`“${t}” isn't a team in this season.`);
    if (weekOfDate(input.schedule, e.date) === null) out.push(`${e.date} is before the first scheduled week.`);
    return out;
  };
  const unknownNames = (p: Pending) => [...new Set(p.events.flatMap((e) => [e.player, e.lastPlayer, e.secLastPlayer])
    .filter((n): n is string => !!n && !known.has(nameKey(n))))];

  const ok = pending.filter((p) => problems(p).length === 0);
  // Two pending files for the same game: show the cross-check before anything is saved.
  const pairs = ok.flatMap((p, i) => ok.slice(i + 1).filter((q) => q.events[0].date === p.events[0].date &&
    q.events[0].statTeam === p.events[0].otherTeam && q.events[0].otherTeam === p.events[0].statTeam).map((q) => [p, q] as const));

  const save = async () => {
    const keys = new Set(ok.map((p) => recKey(p.events[0])));
    const weeks = ok.map((p) => weekOfDate(input.schedule, p.events[0].date) ?? 0);
    await updateSeason((x) => ({
      ...x,
      flags: withoutFlagsFor(x.flags, keys),
      input: {
        ...x.input,
        events: [...x.input.events.filter((e) => !keys.has(recKey(e))), ...ok.flatMap((p) => p.events)],
        throughWeek: Math.max(x.input.throughWeek, ...weeks),
      },
    }));
    setMsg(`Added ${ok.length} recording(s). Salaries, cap and box scores are recalculated.`);
    setPending(pending.filter((p) => problems(p).length > 0));
  };

  const byDate = [...existing.entries()].sort(([a], [b]) => b.localeCompare(a));

  return (
    <main className="page">
      <section className="card">
        <h2>Add tablet recordings</h2>
        <p className="muted small">One CSV per team per game, exported from the stat-taking app. A file for a game that's already in the season replaces it.</p>
        <label className="file-drop">
          <input type="file" accept=".csv,text/csv" multiple onChange={async (e) => {
            const fs = [...(e.target.files ?? [])];
            addFiles(await Promise.all(fs.map(async (f) => [f.name, await f.text()] as [string, string])));
            e.target.value = "";
          }} />
          <strong>Choose CSV files</strong>
          {samples.length > 0 && <span className="muted small">or try a sample pair: {samples.map((s, i) => (
            <button key={i} type="button" className="link" onClick={(ev) => { ev.preventDefault(); addFiles(s.files); }}>{s.label}</button>
          ))}</span>}
        </label>

        {pending.length > 0 && (
          <>
            <table className="data">
              <thead><tr><th>File</th><th>Game</th><th>Week</th><th className="num">Plays</th><th className="num">Final</th><th>Check</th><th /></tr></thead>
              <tbody>
                {pending.map((p, i) => {
                  const e = p.events[0], last = p.events[p.events.length - 1], probs = problems(p), unk = p.error ? [] : unknownNames(p);
                  return (
                    <tr key={i}>
                      <td>{p.file}</td>
                      <td>{e ? `${shortTeam(e.statTeam)} v ${shortTeam(e.otherTeam)}, ${e.date}` : "—"}</td>
                      <td>{e ? weekOfDate(input.schedule, e.date) ?? "—" : "—"}</td>
                      <td className="num">{p.events.length}</td>
                      <td className="num">{last ? `${last.statScore}–${last.otherScore}` : "—"}</td>
                      <td className="small">
                        {probs.map((x, j) => <div key={j} className="error">{x}</div>)}
                        {!probs.length && (existing.has(recKey(e)) ? <span className="attn">replaces the saved recording</span> : <span className="muted">new</span>)}
                        {p.warnings?.map((w, j) => <div key={j} className="muted">{w}</div>)}
                        {unk.length > 0 && <div className="attn">Not in the player list: {unk.map((n) => {
                          const sg = suggestPlayer(n, input.players);
                          return sg ? `${n} (probably ${sg.name})` : n;
                        }).join(", ")}. Sort these out on the <Link to="../names">Names</Link> tab after adding.</div>}
                      </td>
                      <td><button className="icon" aria-label={`Remove ${p.file}`} onClick={() => setPending(pending.filter((_, j) => j !== i))}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pairs.map(([p, q], i) => {
              const r = crossCheck(p.events, q.events);
              const a = p.events[0].statTeam, b = q.events[0].statTeam;
              return (
                <div key={i} className="note">
                  <strong>{shortTeam(a)} v {shortTeam(b)}:</strong> tablets say {r.finalA} and {r.finalB}.{" "}
                  {r.agree ? "They agree." : `Proposed final ${r.proposed.a}–${r.proposed.b}${r.proposed.needsAdmin ? ", with conflicts to decide" : ""}. ${r.unmatched.length} goal(s) don't line up; see the game page after adding.`}
                </div>
              );
            })}
            <div className="row gap">
              <button className="primary" disabled={!ok.length} onClick={save}>Add {ok.length} recording(s) to the season</button>
              <button onClick={() => setPending([])}>Clear</button>
            </div>
          </>
        )}
        {msg && <p className="note">{msg}</p>}
      </section>

      <section className="card scroll-x">
        <h2>Recordings in this season</h2>
        <table className="data">
          <thead><tr><th>Date</th><th>Week</th><th>Tablet</th><th className="num">Plays</th><th className="num">Final</th><th /></tr></thead>
          <tbody>
            {byDate.map(([k, evs]) => {
              const [date, team, opp] = k.split("|"), last = evs[evs.length - 1], week = weekOfDate(input.schedule, date);
              const [a, b] = [team, opp].sort();
              return (
                <tr key={k}>
                  <td>{date}</td><td>{week ?? "—"}</td>
                  <td>{week ? <Link to={`../games/${week}/${encodeURIComponent(a)}/${encodeURIComponent(b)}`}>{shortTeam(team)}</Link> : shortTeam(team)} <span className="muted">v {shortTeam(opp)}</span></td>
                  <td className="num">{evs.length}</td>
                  <td className="num">{last.statScore}–{last.otherScore}</td>
                  <td><button className="danger small-btn" onClick={async () => {
                    if (await askConfirm(`Delete ${team}'s recording of ${date}? This can't be undone unless you have an export.`, { ok: "Delete", danger: true }))
                      updateSeason((x) => ({ ...x, flags: withoutFlagsFor(x.flags, new Set([k])), input: { ...x.input, events: x.input.events.filter((e) => recKey(e) !== k) } }));
                  }}>Delete</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {byDate.length === 0 && <p className="empty">No tablet recordings yet.</p>}
      </section>
    </main>
  );
}
