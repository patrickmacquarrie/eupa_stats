import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { tallyRecording } from "../../engine/compute";
import { genderOf } from "../../engine/pairing";
import type { Player } from "../../engine/types";
import { shortTeam } from "../lib/format";
import { nameKey, suggestPlayer } from "../lib/names";
import { elapsedMs, gameTime, possessions, press, stateOf, toggleFlag, toTabletCsv, undoPress, type Draft, type Phase, type Press } from "../lib/recorder";
import { weekOfDate, withoutFlagsFor } from "../lib/season";
import { useSeason } from "../lib/SeasonContext";
import { clearDraft, downloadText, loadDraft, saveDraft } from "../lib/store";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function Record() {
  const { season } = useSeason();
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { loadDraft(season.id).then((d) => setDraft(d ?? null)); }, [season.id]);

  const change = (d: Draft | null) => {
    setDraft(d);
    if (d) saveDraft(d); else clearDraft(season.id);
  };

  if (draft === undefined) return <main className="page"><p className="muted">Loading…</p></main>;
  if (!draft || !draft.events || draft.present === undefined) return <GameSetup onStart={(d) => change(d)} />;
  if (reviewing) return <Review draft={draft} onBack={() => setReviewing(false)} onDone={() => { change(null); setReviewing(false); }} />;
  return <Live draft={draft} onChange={change} onFinish={() => setReviewing(true)} />;
}

/* ------------------------------------------------------------------ setup */

function GameSetup({ onStart }: { onStart: (d: Draft) => void }) {
  const { season, input, result } = useSeason();
  const teams = input.teams.filter((t) => !t.isSubTeam).map((t) => t.name);
  const [date, setDate] = useState(today());
  const [team, setTeam] = useState(teams[0] ?? "");
  const [opp, setOpp] = useState(teams[1] ?? "");
  const [startOn, setStartOn] = useState<Phase>("offense");
  const [len, setLen] = useState(25);
  const week = weekOfDate(input.schedule, date);
  const roster = useMemo(() => (week === null ? [] : input.players.filter((p) => result.teamOf(p.name, week) === team && !p.isPlug))
    .sort((a, b) => a.name.localeCompare(b.name)), [input, result, team, week]);
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [subs, setSubs] = useState<string[]>([]);
  const [newPlayers, setNewPlayers] = useState<Player[]>([]);
  useEffect(() => { setAbsent(new Set()); }, [team]);

  const present = [...roster.filter((p) => !absent.has(p.name)).map((p) => p.name), ...subs];
  const problem = !team || !opp ? "Pick both teams." : team === opp ? "Pick two different teams." :
    week === null ? `${date} is before the first scheduled week. Add the week on the Setup tab first.` :
    present.length < 2 ? "Check in at least two players." : null;

  return (
    <main className="page narrow">
      <h1>Record a game</h1>
      <p className="muted">This device records one team's side. The other team's tablet records theirs, and the two are cross-checked when both are in.</p>

      <section className="card">
        <div className="fields">
          <label className="field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <small className="muted">{week === null ? "No scheduled week yet" : `Week ${week}`}</small></label>
          <label className="field"><span>Recording for</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)}>{teams.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="field"><span>Against</span>
            <select value={opp} onChange={(e) => setOpp(e.target.value)}>{teams.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="field"><span>{shortTeam(team)} starts on</span>
            <select value={startOn} onChange={(e) => setStartOn(e.target.value as Phase)}>
              <option value="offense">Offense (receiving the pull)</option><option value="defense">Defense (pulling)</option></select></label>
          <label className="field"><span>Game length (minutes)</span><input type="number" min={1} value={len} onChange={(e) => setLen(Number(e.target.value) || 25)} /></label>
        </div>
      </section>

      <section className="card">
        <h2>Who's here</h2>
        <p className="muted small">Untick anyone who didn't show. Add subs below; they can also be added mid-game.</p>
        <div className="checkin">
          {roster.map((p) => (
            <label key={p.name} className={"chip" + (absent.has(p.name) ? " off" : "")}>
              <input type="checkbox" checked={!absent.has(p.name)} onChange={() => {
                const n = new Set(absent); if (n.has(p.name)) n.delete(p.name); else n.add(p.name); setAbsent(n);
              }} />
              {p.name} <span className="muted small">{genderOf(p.gender)}</span>
            </label>
          ))}
          {subs.map((n) => (
            <span key={n} className="chip sub">{n} <span className="tag">sub{newPlayers.some((p) => p.name === n) ? ", new" : ""}</span>
              <button className="icon" aria-label={`Remove ${n}`} onClick={() => { setSubs(subs.filter((x) => x !== n)); setNewPlayers(newPlayers.filter((p) => p.name !== n)); }}>×</button>
            </span>
          ))}
          {roster.length === 0 && week !== null && <p className="muted small">Nobody is rostered on {team} in week {week}.</p>}
        </div>
        <AddSub exclude={[...roster.map((p) => p.name), ...subs]} pending={newPlayers}
          onAdd={(name, np) => { setSubs([...subs, name]); if (np) setNewPlayers([...newPlayers, np]); }} />
      </section>

      {problem && <p className="attn">{problem}</p>}
      <button className="primary big" disabled={!!problem} onClick={() => onStart({
        seasonId: season.id, date, team, opp, startOn, gameLengthMin: len, present, subs, newPlayers,
        events: [], gameTimes: [], clock: { runningSince: null, elapsedMs: 0 },
      })}>Start recording</button>
    </main>
  );
}

/**
 * Pick a sub from anyone in the league, or add someone who has never played. A new name that
 * looks like an existing player is questioned first, so typos don't create a second person.
 */
function AddSub({ exclude, pending, onAdd }: { exclude: string[]; pending: Player[]; onAdd: (name: string, newPlayer?: Player) => void }) {
  const { input, result } = useSeason();
  const [q, setQ] = useState("");
  const [gender, setGender] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  const genders = [...new Set(input.players.map((p) => genderOf(p.gender)).filter((g) => g !== "?"))];
  const ex = new Set(exclude.map(nameKey));
  const everyone = [...input.players, ...pending];
  const matches = q.trim().length < 2 ? [] : everyone
    .filter((p) => !ex.has(nameKey(p.name)) && !p.isPlug && nameKey(p.name).includes(nameKey(q)))
    .sort((a, b) => Number(b.isSub) - Number(a.isSub) || a.name.localeCompare(b.name)).slice(0, 8);
  const exact = everyone.find((p) => nameKey(p.name) === nameKey(q));
  const lookalike = q.trim().length >= 3 && !exact ? suggestPlayer(q, everyone) : undefined;
  const reset = () => { setQ(""); setConfirmNew(false); setGender(""); };
  const where = (p: Player) => result.teamOf(p.name, input.throughWeek + 1) ?? (pending.includes(p) ? "new" : "sub pool");

  return (
    <div className="addsub">
      <label className="field"><span>Add a sub</span>
        <input type="search" placeholder="Start typing a name" value={q} onChange={(e) => { setQ(e.target.value); setConfirmNew(false); }} /></label>
      {matches.length > 0 && (
        <div className="row wrap gap-sm">
          {matches.map((p) => <button key={p.name} onClick={() => { onAdd(p.name); reset(); }}>{p.name} <span className="muted small">{where(p)}</span></button>)}
        </div>
      )}
      {q.trim().length >= 2 && !exact && (
        <div className="newsub">
          {lookalike && !confirmNew ? (
            <p className="small">
              Did you mean <strong>{lookalike.name}</strong>? ({lookalike.why}){" "}
              {!ex.has(nameKey(lookalike.name)) && <button onClick={() => { onAdd(lookalike.name); reset(); }}>Use {lookalike.name}</button>}{" "}
              <button onClick={() => setConfirmNew(true)}>No, “{q.trim()}” is someone new</button>
            </p>
          ) : (
            <div className="row wrap gap-sm">
              <span className="small">New player <strong>{q.trim()}</strong>, first time playing:</span>
              <select value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Gender group">
                <option value="">Gender group…</option>
                {genders.map((g) => <option key={g}>{g}</option>)}
              </select>
              <button className="primary" disabled={!gender} onClick={() => {
                const name = q.trim().replace(/\s+/g, " ");
                onAdd(name, { name, gender, initialSalary: 0, team: null, isSub: true });
                reset();
              }}>Add new sub</button>
            </div>
          )}
        </div>
      )}
      {exact && ex.has(nameKey(exact.name)) && <p className="muted small">{exact.name} is already in this game.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ live */

function Live({ draft, onChange, onFinish }: { draft: Draft; onChange: (d: Draft) => void; onFinish: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [, tick] = useState(0);
  const s = stateOf(draft);
  const [holder, thrower] = s.chain;
  const running = !!draft.clock.runningSince;

  useEffect(() => { if (!running) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [running]);
  // Keep the tablet's screen on while recording.
  const lock = useRef<any>(null);
  useEffect(() => {
    (navigator as any).wakeLock?.request("screen").then((l: any) => { lock.current = l; }).catch(() => {});
    return () => { lock.current?.release?.().catch?.(() => {}); };
  }, []);

  const go = (p: Press) => {
    const r = press(draft, p);
    if (typeof r === "string") { setMsg(r); return; }
    setMsg(null);
    onChange(r);
  };
  const clock = () => onChange({ ...draft, clock: running
    ? { runningSince: null, elapsedMs: elapsedMs(draft.clock) }
    : { runningSince: Date.now(), elapsedMs: draft.clock.elapsedMs } });

  const offense = s.phase === "offense";
  const poss = possessions(draft.events);
  const prompt = offense
    ? (holder ? `${holder} has the disc` : "Who picks up the disc?")
    : "On defense";

  return (
    <main className="live">
      <div className="scorebar">
        <div className="score-team"><span>{shortTeam(draft.team)}</span><strong>{s.us}</strong></div>
        <div className="score-mid">
          <span className={`poss ${s.phase}`}>{offense ? "Offense" : "Defense"}</span>
          <button className={"clock" + (running ? " on" : "")} onClick={clock} aria-label={running ? "Pause clock" : "Start clock"}>
            {gameTime(draft)} {running ? "❚❚" : "▶"}
          </button>
        </div>
        <div className="score-team right"><strong>{s.them}</strong><span>{shortTeam(draft.opp)}</span></div>
      </div>

      <div className="live-top">
        <p className="prompt" aria-live="polite">{prompt}</p>
        {!offense && <button className="rbtn turnover" onClick={() => go({ kind: "offensiveError" })}>Offensive error</button>}
        <button className="rbtn quiet" disabled={!draft.events.length} onClick={() => { setMsg(null); onChange(undoPress(draft)); }}>Undo</button>
      </div>
      {msg && <p className="error small center">{msg}</p>}

      <div className="live-body">
        <div className={"roster " + s.phase}>
          {draft.present.map((n) => {
            const isHolder = offense && n === holder;
            return (
              <div key={n} className={"prow" + (isHolder ? " holder" : offense && n === thrower ? " thrower" : "")}>
                <span className="pname">{n}{draft.subs.includes(n) && <span className="tag">sub</span>}{isHolder && <span className="disc" aria-label="has the disc">●</span>}</span>
                {offense ? (
                  <>
                    <button className="rbtn" disabled={isHolder} onClick={() => go({ kind: "touch", player: n })}>Touch</button>
                    <button className="rbtn goal" onClick={() => go({ kind: "goal", player: n })}>Point</button>
                    {isHolder
                      ? <button className="rbtn ta" onClick={() => go({ kind: "throwaway" })}>Throwaway</button>
                      : <button className="rbtn drop" disabled={!holder} onClick={() => go({ kind: "drop", player: n })}>Drop</button>}
                  </>
                ) : (
                  <>
                    <button className="rbtn block" onClick={() => go({ kind: "block", player: n })}>D-Play</button>
                    <button className="rbtn gso" onClick={() => go({ kind: "scoredOn", player: n })}>GSO</button>
                  </>
                )}
              </div>
            );
          })}
          <button className="prow add" onClick={() => setShowAdd(!showAdd)}>+ Add a sub</button>
        </div>

        <aside className="log" aria-label="Recent possessions">
          <div className="log-head"><strong>Possessions</strong><span className="muted small">⚑ flag one to fix later</span></div>
          {poss.length === 0 && <p className="muted small">Nothing recorded yet.</p>}
          <ol>
            {poss.slice(-8).reverse().map((p) => {
              const flagged = draft.flags?.some((f) => f.start === p.start);
              const end = draft.events[p.end];
              return (
                <li key={p.start} className={(p.ours ? "ours" : "theirs") + (flagged ? " flagged" : "") + (p.open ? " open" : "")}>
                  <div className="log-meta">
                    <span className={"side " + (p.ours ? "ours" : "theirs")}>{p.ours ? shortTeam(draft.team) : shortTeam(draft.opp)}</span>
                    <span className="muted small">{(end.clock ?? "").slice(0, 5)} · {end.statScore}–{end.otherScore}</span>
                    <button className={"flag" + (flagged ? " on" : "")} aria-pressed={!!flagged} aria-label={flagged ? "Remove flag" : "Flag this possession"}
                      onClick={() => onChange(toggleFlag(draft, p))}>⚑</button>
                  </div>
                  <div className="log-text">{p.summary}{p.open && <span className="muted"> …</span>}</div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>

      {showAdd && (
        <section className="card">
          <AddSub exclude={draft.present} pending={draft.newPlayers} onAdd={(name, np) => {
            onChange({ ...draft, present: [...draft.present, name], subs: [...draft.subs, name], newPlayers: np ? [...draft.newPlayers, np] : draft.newPlayers });
            setShowAdd(false);
          }} />
        </section>
      )}

      <div className="row gap live-foot">
        <span className="muted small">{shortTeam(draft.team)} v {shortTeam(draft.opp)} · {draft.date} · {draft.events.length} plays{draft.flags?.length ? ` · ${draft.flags.length} flagged` : ""}, saved on this device</span>
        <span className="grow" />
        <button className="primary" disabled={!draft.events.length} onClick={onFinish}>Finish game</button>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ review */

function Review({ draft, onBack, onDone }: { draft: Draft; onBack: () => void; onDone: () => void }) {
  const { season, updateSeason } = useSeason();
  const [saved, setSaved] = useState<{ week: number } | null>(null);
  const [here, setHere] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<number, string>>(() => Object.fromEntries((draft.flags ?? []).map((f) => [f.start, f.note ?? ""])));
  const poss = possessions(draft.events);
  const tally = useMemo(() => tallyRecording(draft.events, (n) => n), [draft.events]);
  const s = stateOf(draft);
  const key = `${draft.date}|${draft.team}|${draft.opp}`;
  const exists = season.input.events.some((e) => `${e.date}|${e.statTeam}|${e.otherTeam}` === key);
  const week = weekOfDate(season.input.schedule, draft.date) ?? 0;
  const csvName = `${draft.date}_${shortTeam(draft.team)}_v_${shortTeam(draft.opp)}.csv`.replace(/\s+/g, "");
  const download = () => downloadText(csvName, toTabletCsv(draft.events, draft.gameTimes));

  const save = async () => {
    if (exists && !confirm(`${draft.team} already has a recording for ${draft.date}. Replace it with this one?`)) return;
    await updateSeason((x) => {
      const have = new Set(x.input.players.map((p) => nameKey(p.name)));
      const flags = (draft.flags ?? []).map((f) => ({
        date: draft.date, team: draft.team, opp: draft.opp, start: f.start,
        end: poss.find((p) => p.start === f.start)?.end ?? f.end, clock: f.clock, note: notes[f.start]?.trim() || undefined,
      }));
      return { ...x, flags: [...withoutFlagsFor(x.flags, new Set([key])), ...flags], input: {
        ...x.input,
        players: [...x.input.players, ...draft.newPlayers.filter((p) => !have.has(nameKey(p.name)))],
        events: [...x.input.events.filter((e) => `${e.date}|${e.statTeam}|${e.otherTeam}` !== key), ...draft.events],
        throughWeek: Math.max(x.input.throughWeek, week),
        presentWithoutPlays: [
          ...(x.input.presentWithoutPlays ?? []).filter((p) => !(p.week === week && p.team === draft.team && p.opp === draft.opp)),
          ...[...here].map((player) => ({ week, team: draft.team, opp: draft.opp, player })),
        ],
      } };
    });
    setSaved({ week });
  };

  if (saved) {
    const [a, b] = [draft.team, draft.opp].sort();
    return (
      <main className="page narrow">
        <h1>Saved</h1>
        <p>{draft.team}'s recording ({s.us}–{s.them}) is in the season{draft.newPlayers.length ? `, with ${draft.newPlayers.length} new sub(s) added to the player list` : ""}.</p>
        <p className="muted small">If the other team's tablet is a different device, download this game's CSV there and upload it on the Recordings tab here (or the reverse).</p>
        <div className="row gap wrap">
          <Link to={`../games/${saved.week}/${encodeURIComponent(a)}/${encodeURIComponent(b)}`}>Open the game</Link>
          <button onClick={download}>Download CSV</button>
          <button className="primary" onClick={onDone}>Record another game</button>
        </div>
      </main>
    );
  }

  const lines = [...tally.lines.entries()].sort(([x], [y]) => x.localeCompare(y));
  // Subs with no plays don't affect anyone's salary, so only rostered players are asked about.
  const quiet = draft.present.filter((n) => !tally.lines.has(n) && !draft.subs.includes(n));
  return (
    <main className="page narrow">
      <p className="crumbs"><button className="link" onClick={onBack}>← Back to recording</button></p>
      <h1>{shortTeam(draft.team)} {s.us}–{s.them} {shortTeam(draft.opp)}</h1>
      <p className="muted">{draft.date} · week {week || "?"} · {draft.events.length} plays</p>
      <section className="card scroll-x">
        <table className="data">
          <thead><tr><th>Player</th><th className="num">G</th><th className="num">A</th><th className="num">2A</th><th className="num">D</th><th className="num">Drop</th><th className="num">TA</th><th className="num">Tch</th></tr></thead>
          <tbody>
            {lines.map(([n, l]) => (
              <tr key={n}><td>{n}{draft.subs.includes(n) && <span className="tag">sub</span>}</td>
                <td className="num">{l.goals}</td><td className="num">{l.assists}</td><td className="num">{l.secondAssists}</td><td className="num">{l.blocks}</td>
                <td className="num">{l.drops}</td><td className="num">{l.throwaways}</td><td className="num">{l.touches}</td></tr>
            ))}
          </tbody>
        </table>
        {quiet.length > 0 && (
          <div className="noplays">
            <p className="small"><strong>No plays recorded</strong> for these checked-in players, so they count as absent. Tick anyone who played anyway.</p>
            <div className="checkin">
              {quiet.map((n) => (
                <label key={n} className="chip">
                  <input type="checkbox" checked={here.has(n)} onChange={() => { const x = new Set(here); if (x.has(n)) x.delete(n); else x.add(n); setHere(x); }} />
                  {n}
                </label>
              ))}
            </div>
          </div>
        )}
      </section>
      {(draft.flags?.length ?? 0) > 0 && (
        <section className="card">
          <h2>Flagged possessions ({draft.flags!.length})</h2>
          <p className="muted small">These go to the game page for the admin to check. A note helps: what went wrong?</p>
          {draft.flags!.map((f) => {
            const p = poss.find((x) => x.start === f.start);
            return (
              <div key={f.start} className="flag-review">
                <div><span className="muted small">{f.clock}</span> {p?.summary ?? "(possession removed)"}</div>
                <input placeholder="Note (optional), e.g. missed a touch before the point" value={notes[f.start] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [f.start]: e.target.value })} aria-label={`Note for the possession at ${f.clock}`} />
              </div>
            );
          })}
        </section>
      )}
      {exists && <p className="attn">This replaces the recording already saved for {draft.team} on {draft.date}.</p>}
      <div className="row gap wrap">
        <button className="primary big" onClick={save}>Save to season</button>
        <button onClick={download}>Download CSV</button>
        <span className="grow" />
        <button className="danger" onClick={() => { if (confirm("Throw this recording away? It can't be recovered.")) onDone(); }}>Discard</button>
      </div>
    </main>
  );
}
