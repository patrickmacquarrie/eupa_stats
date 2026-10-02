import { useEffect, useMemo, useRef, useState } from "react";
import { askConfirm } from "../lib/confirm";
import { Link } from "react-router-dom";
import { tallyRecording } from "../../engine/compute";
import { genderOf } from "../../engine/pairing";
import type { Player } from "../../engine/types";
import { shortTeam, todayIso as today } from "../lib/format";
import { nameKey, suggestPlayer } from "../lib/names";
import { elapsedMs, gameTime, parseClock, possessions, press, setClock, stateOf, toggleClock, toggleFlag, toTabletCsv, undoPress, csvName, type Draft, type Phase, type Press } from "../lib/recorder";
import { weekOfDate, withoutFlagsFor, type SavedFlag } from "../lib/season";
import { quietKey } from "../lib/review";
import { useSeason } from "../lib/SeasonContext";
import { clearDraft, downloadText, loadDraft, saveDraft } from "../lib/store";

/** The game's flags as the season keeps them, each with its possession's current end and its note. */
function savedFlags(d: Draft, notes?: Record<number, string>): SavedFlag[] {
  const poss = possessions(d.events);
  return (d.flags ?? []).map((f) => ({
    date: d.date, team: d.team, opp: d.opp, start: f.start,
    end: poss.find((p) => p.start === f.start)?.end ?? f.end, clock: f.clock, note: (notes?.[f.start] ?? f.note)?.trim() || undefined,
  }));
}

export function Record() {
  const { draftKey, canRecord, online } = useSeason();
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);

  // Every tap is saved on this device first (localStorage and IndexedDB); if both fail, the
  // stat-taker is told. For an online season the recording is also sent to the league a few
  // seconds after a tap, at once when the tablet sleeps or closes, and again when Track Stats
  // reopens. Firestore keeps each send on the device until it has a signal.
  const [unsafe, setUnsafe] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const latest = useRef<Draft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const send = () => {
    timer.current = null;
    setWaiting(false);
    const d = latest.current, o = onlineRef.current;
    if (d && o) o.pushRecording(d, "live", { flags: savedFlags(d) }).then(() => setSyncError(null)).catch((e) => setSyncError(syncProblem(e)));
  };
  const flush = () => { if (timer.current) { clearTimeout(timer.current); send(); } };
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", flush); flush(); };
  }, []);
  useEffect(() => {
    loadDraft(draftKey).then((d) => {
      setDraft(d ?? null);
      latest.current = d ?? null;
      // A game left open (the tablet closed or crashed): send it again in case the last taps didn't go.
      if (d?.events?.length && d.present !== undefined) send();
    });
  }, [draftKey]);
  // Finish and Discard send their own final write; a "live" send still waiting would land after it.
  const cancelSend = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setWaiting(false); };
  const change = (d: Draft | null, sendNow = false) => {
    setDraft(d);
    latest.current = d;
    if (d) saveDraft(d).then((r) => setUnsafe(!r.local && !r.db)); else clearDraft(draftKey).catch(() => {});
    if (!online || !d) { cancelSend(); return; }
    if (sendNow) { if (timer.current) clearTimeout(timer.current); send(); }
    else if (!timer.current) { timer.current = setTimeout(send, 3000); setWaiting(true); }
  };
  // Saved: off this tablet at once, so reopening Track Stats can't bring the game back as live.
  const saved = () => { cancelSend(); latest.current = null; clearDraft(draftKey).catch(() => {}); };

  if (!canRecord) {
    return (
      <main className="page narrow">
        <h1>Track Stats</h1>
        <p>Recording games needs the league's stats-entry password.</p>
        {online && <Link to={`/l/${online.slug}`} className="button-link">Unlock this device</Link>}
      </main>
    );
  }
  if (draft === undefined) return <main className="page"><p className="muted">Loading…</p></main>;
  if (!draft || !draft.events || draft.present === undefined) return <GameSetup onStart={(d) => change(d, true)} />;
  // The Finish screen is part of the saved game, so closing the browser there comes back to it.
  if (draft.finishing) return <Review draft={draft} onChange={change} cancelSend={cancelSend} onSaved={saved} onBack={() => change({ ...draft, finishing: undefined })} onDone={() => change(null)} />;
  return <Live draft={draft} onChange={change} onFinish={() => change({ ...draft, finishing: { here: [] } })} unsafe={unsafe} syncError={syncError} waiting={waiting} />;
}

const syncProblem = (e: unknown) => ((e as { code?: string }).code === "permission-denied"
  ? "The league isn't accepting this tablet's recording: its stats-entry password may have changed. Enter the new one on the league page; everything is still saved on this tablet."
  : `Couldn't send the recording: ${(e as Error).message}. It's still saved on this tablet.`);

/** "Saved on this tablet · Synced", or "… · will sync when online" while the league hasn't got the latest. */
function SyncStatus({ draft, waiting }: { draft: Draft; waiting: boolean }) {
  const { online } = useSeason();
  const [synced, setSynced] = useState(false);
  const [onLine, setOnLine] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnLine(true), down = () => setOnLine(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  useEffect(() => (online ? online.watchSynced(draft, setSynced) : undefined), [online?.slug, draft.date, draft.team, draft.opp]);
  if (!online) return <>, saved on this device</>;
  // A tap waiting a few seconds to be sent isn't synced yet, whatever the server has.
  const ok = synced && !waiting;
  return <> · Saved on this tablet · <span className={ok ? "ok-text" : "attn"} data-sync={ok ? "synced" : "pending"}>{ok ? "Synced" : onLine ? "syncing…" : "will sync when online"}</span></>;
}

/* ------------------------------------------------------------------ setup */

function GameSetup({ onStart }: { onStart: (d: Draft) => void }) {
  const { season, input, result, draftKey } = useSeason();
  const teams = input.teams.filter((t) => !t.isSubTeam).map((t) => t.name);
  const [date, setDate] = useState(today());
  const [team, setTeam] = useState(teams[0] ?? "");
  const [opp, setOpp] = useState(teams[1] ?? "");
  const [startOn, setStartOn] = useState<Phase>("offense");
  const [len, setLen] = useState(season.gameLengthMin ?? 25);
  const [jersey, setJersey] = useState<"light" | "dark">("light");
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
          <div className="field"><span>{shortTeam(team)} is wearing</span>
            <div className="seg jersey-pick" role="group" aria-label={`${team} jersey colour`}>
              <button aria-pressed={jersey === "light"} onClick={() => setJersey("light")}><span className="swatch light" />Light</button>
              <button aria-pressed={jersey === "dark"} onClick={() => setJersey("dark")}><span className="swatch dark" />Dark</button>
            </div>
            <small className="muted">{shortTeam(opp)} wears {jersey === "light" ? "dark" : "light"}</small>
          </div>
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
        seasonId: draftKey, date, team, opp, startOn, gameLengthMin: len, jersey, present, subs, newPlayers,
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

function Live({ draft, onChange, onFinish, unsafe, syncError, waiting }: { draft: Draft; onChange: (d: Draft) => void; onFinish: () => void; unsafe?: boolean; syncError?: string | null; waiting?: boolean }) {
  const { online } = useSeason();
  const [msg, setMsg] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showLog, setShowLog] = useState(false);
  // While recording, the screen is a fixed panel: no page scroll, pull-to-refresh or zoom to
  // set off by accident, and the roster sized to fit (see "recording" in styles.css).
  useEffect(() => {
    document.documentElement.classList.add("recording");
    return () => document.documentElement.classList.remove("recording");
  }, []);
  const [, tick] = useState(0);
  const s = stateOf(draft);
  const [holder, thrower] = s.chain;
  const running = !!draft.clock.runningSince;

  useEffect(() => { if (!running) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [running]);
  // Keep the tablet's screen on while recording.
  // The tablet drops the request whenever its screen locks or the browser goes to the background,
  // so it's asked again on the way back, and on any tap if a request didn't take.
  useEffect(() => {
    let lock: any = null, asking = false, live = true;
    const ask = () => {
      if (lock || asking || document.visibilityState !== "visible") return;
      const wl = (navigator as any).wakeLock;
      if (!wl) return;
      asking = true;
      wl.request("screen").then((l: any) => {
        asking = false;
        if (!live) { l.release?.().catch?.(() => {}); return; }
        lock = l;
        l.addEventListener?.("release", () => { lock = null; });
      }).catch(() => { asking = false; });
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    document.addEventListener("pointerdown", ask);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", ask);
      document.removeEventListener("pointerdown", ask);
      lock?.release?.().catch?.(() => {});
    };
  }, []);

  const go = (p: Press) => {
    const r = press(draft, p);
    if (typeof r === "string") { setMsg(r); return; }
    setMsg(null);
    onChange(r);
  };
  const clock = () => onChange(toggleClock(draft));
  const [adjusting, setAdjusting] = useState(false);

  const offense = s.phase === "offense";
  const poss = possessions(draft.events);
  const prompt = offense
    ? (holder ? `${holder} has the disc` : "Who picks up the disc?")
    : "On defense";

  return (
    <main className="live">
      <div className={"scorebar" + (draft.jersey ? ` split ours-${draft.jersey}` : "")}>
        <div className="score-team"><span>{shortTeam(draft.team)}</span><strong>{s.us}</strong></div>
        <div className="score-mid">
          <span className={`poss ${s.phase}`}>{offense ? "Offense" : "Defense"}</span>
          <button className={"clock" + (running ? " on" : "")} onClick={clock} aria-label={running ? "Pause clock" : "Start clock"}>
            {gameTime(draft)} {running ? "❚❚" : "▶"}
          </button>
          <button className="link small clock-adjust" onClick={() => setAdjusting(!adjusting)} aria-expanded={adjusting}>Adjust clock</button>
        </div>
        <div className="score-team right"><strong>{s.them}</strong><span>{shortTeam(draft.opp)}</span></div>
      </div>

      {draft.date < today() && (
        <div className="note attn-note unfinished-note" role="status">
          <span>This game from {new Date(draft.date + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })} was never finished on this tablet.{online ? " Its plays already reached the league." : " Its plays are only on this tablet until it's finished."}</span>
          <button className="primary small-btn" disabled={!draft.events.length} onClick={onFinish}>Finish it now</button>
        </div>
      )}

      {adjusting && <ClockAdjust draft={draft} onApply={(d) => { onChange(d); setAdjusting(false); }} onCancel={() => setAdjusting(false)} />}

      <div className="live-top">
        <span className={`poss ${s.phase} poss-narrow`}>{offense ? "Offense" : "Defense"}</span>
        <p className={"prompt " + s.phase} aria-live="polite">{prompt}</p>
        {!offense && <button className="rbtn turnover" onClick={() => go({ kind: "offensiveError" })}>Offensive error</button>}
        <button className="rbtn quiet" disabled={!draft.events.length} onClick={() => { setMsg(null); onChange(undoPress(draft)); }}>Undo</button>
        <button className="rbtn quiet log-toggle" aria-expanded={showLog} onClick={() => setShowLog(!showLog)}>
          Log{draft.flags?.length ? ` ⚑${draft.flags.length}` : ""}</button>
      </div>
      {msg && <p className="error small center">{msg}</p>}

      <div className="live-body">
        <div className="roster-col">
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
        </div>
          <div className="roster-actions">
            <button className="prow add" onClick={() => setShowAdd(!showAdd)}>+ Add a sub</button>
            <button className="primary finish-btn" disabled={!draft.events.length} onClick={onFinish}>Finish game</button>
          </div>
        </div>

        <aside className={"log" + (showLog ? " open" : "")} aria-label="Recent possessions">
          <div className="log-head"><strong>Possessions</strong><span className="muted small">⚑ flag one to fix later</span>
            <button className="small-btn log-close" onClick={() => setShowLog(false)}>Close</button></div>
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
                  {flagged && (
                    <input className="flag-note" placeholder="Note (optional): what went wrong?" aria-label={`Note for the flagged possession at ${(end.clock ?? "").slice(0, 5)}`}
                      value={draft.flags!.find((f) => f.start === p.start)!.note ?? ""}
                      onChange={(e) => onChange({ ...draft, flags: draft.flags!.map((f) => (f.start === p.start ? { ...f, note: e.target.value } : f)) })} />
                  )}
                </li>
              );
            })}
          </ol>
        </aside>
      </div>

      {showAdd && (
        <section className="card sheet">
          <AddSub exclude={draft.present} pending={draft.newPlayers} onAdd={(name, np) => {
            onChange({ ...draft, present: [...draft.present, name], subs: [...draft.subs, name], newPlayers: np ? [...draft.newPlayers, np] : draft.newPlayers });
            setShowAdd(false);
          }} />
          <div className="row"><span className="grow" /><button onClick={() => setShowAdd(false)}>Cancel</button></div>
        </section>
      )}

      <div className="row gap live-foot">
        <span className="muted small">{shortTeam(draft.team)} v {shortTeam(draft.opp)} · {draft.date} · {draft.events.length} plays{draft.flags?.length ? ` · ${draft.flags.length} flagged` : ""}{unsafe ? "" : <SyncStatus draft={draft} waiting={!!waiting} />}</span>
        {syncError && <span className="error small" role="alert">{syncError}</span>}
        {unsafe && <span className="error small" role="alert">This device isn't saving the game (storage blocked or full). Don't close or refresh: finish and save, or download the CSV.</span>}
      </div>
    </main>
  );
}

/** Set the time left (to match the field's clock) or change the game length mid-game. */
function ClockAdjust({ draft, onApply, onCancel }: { draft: Draft; onApply: (d: Draft) => void; onCancel: () => void }) {
  const leftNow = Math.max(0, draft.gameLengthMin * 60000 - elapsedMs(draft.clock));
  const fmt = (ms: number) => { const t = Math.round(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
  const [left, setLeft] = useState(fmt(leftNow));
  const [len, setLen] = useState(String(draft.gameLengthMin));
  const leftMs = parseClock(left), lenMin = Number(len);
  const nudge = (s: number) => setLeft(fmt(Math.max(0, (leftMs ?? leftNow) + s * 1000)));
  const ok = leftMs !== null && lenMin > 0 && leftMs <= lenMin * 60000;
  return (
    <section className="card clock-panel sheet" aria-label="Adjust clock">
      <div className="row wrap gap-sm">
        <label className="field"><span>Time left (min:sec)</span>
          <input id="clock-left" inputMode="numeric" value={left} onChange={(e) => setLeft(e.target.value)} /></label>
        <div className="row gap-sm nudges">
          {[-60, -10, 10, 60].map((s) => <button key={s} className="small-btn" onClick={() => nudge(s)}>{s > 0 ? "+" : "−"}{Math.abs(s) >= 60 ? `${Math.abs(s) / 60}:00` : `0:${Math.abs(s)}`}</button>)}
        </div>
        <label className="field"><span>Game length (minutes)</span>
          <input id="clock-length" type="number" min={1} value={len} onChange={(e) => setLen(e.target.value)} /></label>
      </div>
      {!ok && <p className="attn small">{leftMs === null ? "Enter the time left as minutes:seconds, e.g. 18:30." : "Time left can't be more than the game length."}</p>}
      <div className="row gap-sm">
        <span className="muted small grow">{draft.clock.runningSince ? "The clock keeps running from the new time." : draft.clock.started ? "The clock stays paused." : "The clock still starts with the first play."}</span>
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!ok} onClick={() => onApply(setClock(draft, lenMin, leftMs!))}>Set clock</button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ review */

function Review({ draft, onChange, cancelSend, onSaved, onBack, onDone }: { draft: Draft; onChange: (d: Draft) => void; cancelSend: () => void; onSaved: () => void; onBack: () => void; onDone: () => void }) {
  const { season, updateSeason, online } = useSeason();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ week: number } | null>(null);
  // Ticks and notes are saved with the game as they're made.
  const here = new Set(draft.finishing?.here ?? []);
  const setHere = (x: Set<string>) => onChange({ ...draft, finishing: { here: [...x] } });
  const notes: Record<number, string> = Object.fromEntries((draft.flags ?? []).map((f) => [f.start, f.note ?? ""]));
  const setNotes = (n: Record<number, string>) => onChange({ ...draft, flags: (draft.flags ?? []).map((f) => ({ ...f, note: n[f.start] })) });
  const poss = possessions(draft.events);
  const tally = useMemo(() => tallyRecording(draft.events, (n) => n), [draft.events]);
  const s = stateOf(draft);
  const key = `${draft.date}|${draft.team}|${draft.opp}`;
  // Online, this tablet's own live recording is already in the season; only another device's counts.
  const owner = online?.owners.get(key);
  const exists = online ? !!owner && owner !== online.uid : season.input.events.some((e) => `${e.date}|${e.statTeam}|${e.otherTeam}` === key);
  const week = weekOfDate(season.input.schedule, draft.date) ?? 0;
  const download = () => downloadText(csvName(draft.date, draft.team, draft.opp, shortTeam), toTabletCsv(draft.events, draft.gameTimes));

  const save = async () => {
    if (online) {
      if (exists) { setError(`Another tablet already sent ${draft.team}'s recording for ${draft.date}. Ask a league admin to remove it first, or download this game's CSV.`); return; }
      const flags = savedFlags(draft, notes);
      // Not awaited: with no signal Firestore keeps it on this tablet and sends it later.
      cancelSend();
      online.pushRecording(draft, "finished", { present: [...here], flags }).catch((e) => setError((e as Error).message));
      onSaved();
      setSaved({ week });
      return;
    }
    if (exists && !(await askConfirm(`${draft.team} already has a recording for ${draft.date}. Replace it with this one?`, { ok: "Replace" }))) return;
    await updateSeason((x) => {
      const have = new Set(x.input.players.map((p) => nameKey(p.name)));
      const flags = savedFlags(draft, notes);
      // A player no longer ticked loses any "present with no stats" acknowledgement for this game.
      const ticked = new Set([...here].map((p) => quietKey(week, draft.team, draft.opp, p)));
      const gamePrefix = `${week}|${draft.team}|${draft.opp}|`;
      const acknowledgedQuiet = (x.acknowledgedQuiet ?? []).filter((k) => !k.startsWith(gamePrefix) || ticked.has(k));
      return { ...x, acknowledgedQuiet, flags: [...withoutFlagsFor(x.flags, new Set([key])), ...flags], input: {
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
    onSaved();
    setSaved({ week });
  };

  if (saved) {
    const [a, b] = [draft.team, draft.opp].sort();
    return (
      <main className="page narrow">
        <h1>Saved</h1>
        <p>{draft.team}'s recording ({s.us}–{s.them}) is in the season{draft.newPlayers.length ? `, with ${draft.newPlayers.length} new sub(s) added to the player list` : ""}.</p>
        {online && <p className="muted small">It reaches the league as soon as this tablet has a signal; the admin sees it on the Games page.</p>}
        {error && <p className="error">{error}</p>}
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
      {exists && <p className="attn">{online ? `Another tablet already sent ${draft.team}'s recording for ${draft.date}.` : `This replaces the recording already saved for ${draft.team} on ${draft.date}.`}</p>}
      <div className="row gap wrap">
        <button className="primary big" onClick={save}>Save to season</button>
        <button onClick={download}>Download CSV</button>
        <span className="grow" />
        <button className="danger" onClick={async () => {
          if (!(await askConfirm("Throw this recording away? It can't be recovered.", { ok: "Discard", danger: true }))) return;
          cancelSend();
          if (online && owner === online.uid) online.deleteRecording(draft).catch(() => {});
          onDone();
        }}>Discard</button>
      </div>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
