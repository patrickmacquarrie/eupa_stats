import { Fragment, useDeferredValue, useMemo, useState } from "react";
import { askConfirm } from "../lib/confirm";
import { computeLeague, tallyRecording } from "../../engine/compute";
import type { PlayEvent, StatLine } from "../../engine/types";
import { delta, shortTeam } from "../lib/format";
import { resolveInput } from "../lib/names";
import {
  blankSpec, changed, pairAt, problems, remapIndex, replacePossessions, rowsOf, specOf, specProblem,
  type OursSpec, type Row, type Spec, type TheirsSpec,
} from "../lib/playlog";
import { possessions, type Possession } from "../lib/recorder";
import { weekOfDate } from "../lib/season";
import { useSeason } from "../lib/SeasonContext";

const key = (e: PlayEvent) => `${e.date}|${e.statTeam}|${e.otherTeam}`;
const STATS: [keyof StatLine, string][] = [["goals", "G"], ["assists", "A"], ["secondAssists", "2A"], ["blocks", "D"], ["drops", "Drop"], ["throwaways", "TA"], ["gso", "GSO"], ["touches", "Tch"]];

/** What's open for editing: existing possessions (start/count in plays), or an insertion point. */
type Editing = { start: number; count: number; specs: Spec[]; inserting: boolean; allowOpen: boolean };

/**
 * Possession-by-possession editor for one team's recording. Edits are staged; nothing changes in
 * the season until Save. `focus` is a saved play index to open at (e.g. a flagged possession).
 */
export function PlayEditor({ date, team, opp, focus, onClose }: { date: string; team: string; opp: string; focus?: number; onClose: () => void }) {
  const { season, input, result, updateSeason } = useSeason();
  const k = `${date}|${team}|${opp}`;
  const original = useMemo(() => season.input.events.filter((e) => key(e) === k), [season.input.events, k]);
  const [rows, setRows] = useState<Row[]>(() => rowsOf(original));
  const [history, setHistory] = useState<Row[][]>([]);
  const [showAll, setShowAll] = useState(focus === undefined);
  const [editing, setEditing] = useState<Editing | null>(null);

  const apply = (next: Row[]) => { setHistory([...history, rows]); setRows(next); setEditing(null); };
  const issues = useMemo(() => problems(rows), [rows]);
  const dirty = rows.length !== original.length || rows.some((r) => changed(r, original));
  const poss = useMemo(() => possessions(rows.map((r) => r.e)), [rows]);
  const flagged = (season.flags ?? []).filter((f) => `${f.date}|${f.team}|${f.opp}` === k && !f.resolved);
  const week = weekOfDate(season.input.schedule, date);
  const box = season.input.boxScores?.some((b) => b.week === week && b.team === team && b.opp === opp);

  // Which possessions to show: the focused one and its neighbours, or everything.
  const focusRow = focus === undefined ? 0 : remapIndex(rows, focus, "start");
  const focusPoss = Math.max(0, poss.findIndex((p) => focusRow >= p.start && focusRow <= p.end));
  const from = showAll ? 0 : Math.max(0, focusPoss - 2), to = showAll ? poss.length : focusPoss + 3;

  // Who can be picked: this game's names first, then everyone else in the league.
  const inGame = [...new Set(rows.flatMap((r) => [r.e.player, r.e.lastPlayer, r.e.secLastPlayer]).filter((n): n is string => !!n))].sort();
  const others = input.players.map((p) => p.name).filter((n) => !inGame.includes(n)).sort();
  const pick = { inGame, others };

  // What the edit does to the box score and to salaries.
  const before = useMemo(() => tallyRecording(original, (n) => n), [original]);
  const deferred = useDeferredValue(rows);
  const after = useMemo(() => tallyRecording(deferred.map((r) => r.e), (n) => n), [deferred]);
  const statDiffs = [...new Set([...before.lines.keys(), ...after.lines.keys()])].map((n) => {
    const b = before.lines.get(n), a = after.lines.get(n);
    return { n, d: STATS.map(([s, l]) => [l, (a?.[s] ?? 0) - (b?.[s] ?? 0)] as const).filter(([, v]) => v !== 0) };
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
    if (issues.size && !(await askConfirm(`${issues.size} play(s) don't fit the flow of possessions (marked in red). Save anyway?`, { ok: "Save anyway" }))) return;
    await updateSeason((s) => ({
      ...s,
      input: { ...s.input, events: [...s.input.events.filter((e) => key(e) !== k), ...rows.map((r) => r.e)] },
      flags: (s.flags ?? []).map((f) => (`${f.date}|${f.team}|${f.opp}` !== k ? f
        : { ...f, start: remapIndex(rows, f.start, "start"), end: Math.max(remapIndex(rows, f.start, "start"), remapIndex(rows, f.end, "end")) })),
    }));
    onClose();
  };

  const events = rows.map((r) => r.e);
  const editPossession = (i: number) => {
    const p = poss[i];
    setEditing({ start: p.start, count: p.end - p.start + 1, specs: [specOf(events.slice(p.start, p.end + 1), p.ours)], inserting: false, allowOpen: i === poss.length - 1 });
  };
  const insertAt = (i: number) => {
    // Between possession i-1 and i: a pair, ordered so the teams keep alternating.
    const [a, b] = pairAt(i > 0 ? poss[i - 1].ours : null, i < poss.length ? poss[i].ours : null);
    const at = i < poss.length ? poss[i].start : rows.length;
    setEditing({ start: at, count: 0, specs: [blankSpec(a), blankSpec(b)], inserting: true, allowOpen: false });
  };
  const deletePair = async (i: number) => {
    const p = poss[i], q = poss[i + 1];
    const pair = q && q.ours !== p.ours;
    const end = pair ? q.end : p.end;
    const what = pair ? `this ${p.ours ? team : opp} possession and the ${q.ours ? team : opp} possession after it` : "this possession";
    if (await askConfirm(`Delete ${what}? Teams alternate, so possessions are removed in pairs.`, { ok: "Delete", danger: true })) apply(replacePossessions(rows, p.start, end - p.start + 1, []));
  };
  const sideName = (ours: boolean) => shortTeam(ours ? team : opp);

  const last = rows[rows.length - 1]?.e, lastBefore = original[original.length - 1];
  const badIn = (p: Possession) => [...issues.keys()].filter((i) => i >= p.start && i <= p.end).map((i) => issues.get(i)!);

  return (
    <section className="card editor-card">
      <div className="row wrap gap-sm">
        <h2 className="grow">Edit possessions: {team}'s tablet</h2>
        <label className="check small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all {poss.length}</label>
        <button disabled={!history.length} onClick={() => { setRows(history[history.length - 1]); setHistory(history.slice(0, -1)); setEditing(null); }}>Undo</button>
        <button onClick={async () => { if (!dirty || await askConfirm("Discard these edits?", { ok: "Discard", danger: true })) onClose(); }}>Cancel</button>
        <button className="primary" disabled={!dirty} onClick={save}>Save</button>
      </div>
      <p className="muted small">
        Edit a possession's catches and how it ended, or insert possessions between two others. Teams alternate, so possessions are inserted
        and deleted in pairs. Plays you don't change keep what the tablet recorded.
      </p>
      {box && <p className="attn small">This side is being counted from a box score, so edits here won't count until the box score is removed.</p>}

      <ol className="poss-list">
        {poss.slice(from, to).map((p, off) => {
          const i = from + off;
          const isFlagged = flagged.some((f) => remapIndex(rows, f.start, "start") === p.start);
          const isEdited = rows.slice(p.start, p.end + 1).some((r) => changed(r, original));
          const end = events[p.end], bad = badIn(p);
          const open = editing && !editing.inserting && editing.start === p.start;
          return (
            <Fragment key={p.start}>
              <li className="gap-row"><InsertButton onClick={() => insertAt(i)} disabled={!!editing} /></li>
              {editing?.inserting && editing.start === p.start && (
                <li><SpecForms editing={editing} setEditing={setEditing} pick={pick} sideName={sideName}
                  onApply={() => apply(replacePossessions(rows, editing.start, 0, editing.specs))} /></li>
              )}
              <li className={"poss-item " + (p.ours ? "ours" : "theirs") + (isFlagged ? " flagged" : "") + (isEdited ? " edited" : "") + (bad.length ? " bad" : "")}>
                {open ? (
                  <SpecForms editing={editing!} setEditing={setEditing} pick={pick} sideName={sideName}
                    onApply={() => apply(replacePossessions(rows, editing!.start, editing!.count, editing!.specs))} />
                ) : (
                  <div className="poss-view">
                    <span className={"side " + (p.ours ? "ours" : "theirs")}>{sideName(p.ours)}</span>
                    <span className="poss-sum">{p.summary}{p.open && <span className="muted"> …</span>}
                      {isFlagged && <span className="attn small"> ⚑ flagged</span>}
                      {bad.length > 0 && <span className="error small"> · {bad[0]}</span>}
                    </span>
                    <span className="muted small nowrap">{(end.clock ?? "").slice(0, 5)} · {end.statScore}–{end.otherScore}</span>
                    <span className="nowrap">
                      <button className="small-btn" disabled={!!editing} onClick={() => editPossession(i)}>Edit</button>{" "}
                      <button className="small-btn danger" disabled={!!editing} onClick={() => deletePair(i)} aria-label="Delete possession">Delete</button>
                    </span>
                  </div>
                )}
              </li>
            </Fragment>
          );
        })}
        {to >= poss.length && (
          <>
            <li className="gap-row"><InsertButton onClick={() => insertAt(poss.length)} disabled={!!editing} label="Add possessions at the end" /></li>
            {editing?.inserting && editing.start === rows.length && (
              <li><SpecForms editing={editing} setEditing={setEditing} pick={pick} sideName={sideName}
                onApply={() => apply(replacePossessions(rows, rows.length, 0, editing.specs))} /></li>
            )}
          </>
        )}
      </ol>
      {!showAll && <p className="small"><button className="link" onClick={() => setShowAll(true)}>Show all {poss.length} possessions</button></p>}

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

function InsertButton({ onClick, disabled, label = "Insert possessions here" }: { onClick: () => void; disabled: boolean; label?: string }) {
  return <button className="insert-gap" onClick={onClick} disabled={disabled}>＋ {label}</button>;
}

type Pick = { inGame: string[]; others: string[] };

function PlayerSelect({ value, onChange, label, pick, optional }: { value: string; onChange: (v: string) => void; label: string; pick: Pick; optional?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{optional ? "(nobody)" : "Pick a player…"}</option>
      <optgroup label="In this game">{pick.inGame.map((n) => <option key={n}>{n}</option>)}</optgroup>
      <optgroup label="Everyone else">{pick.others.map((n) => <option key={n}>{n}</option>)}</optgroup>
    </select>
  );
}

/** The form for one possession, or for an inserted pair. */
function SpecForms({ editing, setEditing, pick, sideName, onApply }: {
  editing: Editing; setEditing: (e: Editing | null) => void; pick: Pick; sideName: (ours: boolean) => string; onApply: () => void;
}) {
  const set = (i: number, s: Spec) => setEditing({ ...editing, specs: editing.specs.map((x, j) => (j === i ? s : x)) });
  const firstProblem = editing.specs.map(specProblem).find(Boolean);
  return (
    <div className="spec-forms">
      {editing.inserting && <p className="small muted">New possessions, {editing.specs.map((s) => sideName(s.side === "ours")).join(" then ")}:</p>}
      {editing.specs.map((s, i) => (
        <div key={i} className={"spec " + s.side}>
          <span className={"side " + s.side}>{sideName(s.side === "ours")}</span>
          {s.side === "ours"
            ? <OursForm s={s} onChange={(x) => set(i, x)} pick={pick} allowOpen={editing.allowOpen} />
            : <TheirsForm s={s} onChange={(x) => set(i, x)} pick={pick} />}
        </div>
      ))}
      <div className="row gap-sm wrap">
        {firstProblem && <span className="attn small">{firstProblem}</span>}
        <span className="grow" />
        <button className="small-btn" onClick={() => setEditing(null)}>Cancel</button>
        <button className="primary small-btn" disabled={!!firstProblem} onClick={onApply}>{editing.inserting ? "Insert both" : "Apply"}</button>
      </div>
    </div>
  );
}

function OursForm({ s, onChange, pick, allowOpen }: { s: OursSpec; onChange: (s: OursSpec) => void; pick: Pick; allowOpen: boolean }) {
  const setTouch = (i: number, v: string) => onChange({ ...s, touches: s.touches.map((t, j) => (j === i ? v : t)) });
  const holder = s.touches[s.touches.length - 1];
  const outcomes: [OursSpec["outcome"], string][] = [["Point", "Point"], ["Drop", "Drop"], ["T-Away", "Throwaway"], ...(allowOpen ? [["open", "Still going"] as [OursSpec["outcome"], string]] : [])];
  return (
    <div className="spec-body">
      <div className="catches">
        <span className="small muted">Catches</span>
        {s.touches.map((t, i) => (
          <span key={i} className="catch">
            {i > 0 && <span className="muted">→</span>}
            <PlayerSelect value={t} onChange={(v) => setTouch(i, v)} label={`Catch ${i + 1}`} pick={pick} />
            <button className="icon" aria-label={`Remove catch ${i + 1}`} onClick={() => onChange({ ...s, touches: s.touches.filter((_, j) => j !== i) })}>×</button>
          </span>
        ))}
        <button className="small-btn" onClick={() => onChange({ ...s, touches: [...s.touches, ""] })}>+ Catch</button>
      </div>
      <div className="outcome">
        <span className="small muted">Ended with</span>
        <div className="seg">
          {outcomes.map(([o, l]) => <button key={o} aria-pressed={s.outcome === o} onClick={() => onChange({ ...s, outcome: o })}>{l}</button>)}
        </div>
        {(s.outcome === "Point" || s.outcome === "T-Away") && holder && <span className="small">by {holder}</span>}
        {s.outcome === "Drop" && <>
          <span className="small">dropped by</span>
          <PlayerSelect value={s.droppedBy ?? ""} onChange={(v) => onChange({ ...s, droppedBy: v })} label="Dropped by" pick={pick} />
        </>}
      </div>
    </div>
  );
}

function TheirsForm({ s, onChange, pick }: { s: TheirsSpec; onChange: (s: TheirsSpec) => void; pick: Pick }) {
  const outcomes: [TheirsSpec["outcome"], string][] = [["D-Play", "D-Play"], ["O-Error", "Offensive error"], ["GSO", "GSO"]];
  return (
    <div className="spec-body">
      <div className="outcome">
        <span className="small muted">Ended with</span>
        <div className="seg">
          {outcomes.map(([o, l]) => <button key={o} aria-pressed={s.outcome === o} onClick={() => onChange({ ...s, outcome: o })}>{l}</button>)}
        </div>
        {s.outcome !== "O-Error" && (
          <PlayerSelect value={s.player ?? ""} onChange={(v) => onChange({ ...s, player: v || null })} pick={pick}
            label={s.outcome === "D-Play" ? "D-Play by" : "Scored on"} optional={s.outcome === "GSO"} />
        )}
      </div>
    </div>
  );
}
