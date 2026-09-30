import { useMemo, useState } from "react";
import { askConfirm } from "../lib/confirm";
import { Link } from "react-router-dom";
import { computeLeague } from "../../engine/compute";
import { genderOf } from "../../engine/pairing";
import { delta, money } from "../lib/format";
import { findNameIssues, mergeName, nameKey, resolveInput, stripSub, unmergeName, type Alias } from "../lib/names";
import type { Season } from "../lib/season";
import { useSeason } from "../lib/SeasonContext";

type Merge = { from: string; to: string };

function applyMerges(s: Season, merges: Merge[]): Season {
  let input = s.input, aliases = s.aliases ?? [];
  for (const m of merges) ({ input, aliases } = mergeName(input, aliases, m.from, m.to));
  return { ...s, input, aliases };
}

/** Who a set of merges would move, after the last counted week. */
function effectOf(s: Season, merges: Merge[], before: Record<string, number[]>) {
  const next = applyMerges(s, merges);
  const res = computeLeague(resolveInput(next.input, next.aliases));
  const w = s.input.throughWeek;
  return next.input.players.map((p) => ({ name: p.name, d: res.salary[p.name][w] - (before[p.name]?.[w] ?? res.salary[p.name][w]) }))
    .filter((x) => Math.abs(x.d) > 0.5).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
}

export function Names() {
  const { season, result, updateSeason } = useSeason();
  const issues = useMemo(() => findNameIssues(season.input, season.aliases, season.ignoredNames), [season]);
  const players = useMemo(() => [...season.input.players].sort((a, b) => a.name.localeCompare(b.name)), [season.input.players]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [newGender, setNewGender] = useState<Record<string, string>>({});
  const genders = [...new Set(season.input.players.map((p) => genderOf(p.gender)).filter((g) => g !== "?"))];

  const merge = async (merges: Merge[], confirmText?: string) => {
    if (confirmText && !(await askConfirm(confirmText, { ok: "Merge" }))) return;
    return updateSeason((s) => applyMerges(s, merges));
  };
  const ignore = (k: string) => updateSeason((s) => ({ ...s, ignoredNames: [...(s.ignoredNames ?? []), k] }));
  const undo = (a: Alias) => updateSeason((s) => ({ ...s, ...unmergeName(s.input, s.aliases ?? [], a) }));

  const subMerges: Merge[] = issues.subRecords.map((s) => ({ from: s.player.name, to: s.base?.name ?? stripSub(s.player.name) }));
  const typoMerges: Merge[] = issues.unknown.filter((u) => u.suggestion).map((u) => ({ from: u.name, to: u.suggestion! }));
  const subEffect = useMemo(() => (subMerges.length ? effectOf(season, subMerges, result.salary) : []), [season, result]);
  const typoEffect = useMemo(() => (typoMerges.length ? effectOf(season, typoMerges, result.salary) : []), [season, result]);

  const Effect = ({ e }: { e: { name: string; d: number }[] }) => (
    <p className="small">
      {e.length === 0 ? <span className="muted">No salary changes.</span> : <>Salary effect after week {season.input.throughWeek}:{" "}
        {e.slice(0, 6).map((x, i) => <span key={x.name}>{i ? ", " : ""}{x.name} <span className={x.d > 0 ? "up" : "down"}>{delta(x.d)}</span></span>)}
        {e.length > 6 && ` and ${e.length - 6} more`}</>}
    </p>
  );
  const nothing = !issues.unknown.length && !issues.subRecords.length && !issues.dupes.length;

  return (
    <main className="page">
      {nothing && <p className="note">Every recorded name matches a player. Nothing to review.</p>}

      {issues.unknown.length > 0 && (
        <section className="card scroll-x">
          <div className="row">
            <h2 className="grow">Recorded names that don't match a player ({issues.unknown.length})</h2>
            {typoMerges.length > 0 && <button className="primary" onClick={() => merge(typoMerges)}>Accept all {typoMerges.length} suggestions</button>}
          </div>
          <p className="muted small">
            A name the engine can't match plays as a stranger: its stats go nowhere and it can't be paired as a sub.
            Merging keeps the tablet's original spelling in the recording and counts it for the player you pick.
          </p>
          {typoMerges.length > 0 && <Effect e={typoEffect} />}
          <table className="data">
            <thead><tr><th>As recorded</th><th className="num">Plays</th><th>Where</th><th>Count as</th><th /></tr></thead>
            <tbody>
              {issues.unknown.map((u) => {
                const pick = picks[u.name] ?? u.suggestion ?? "";
                const g = newGender[u.name] ?? genders[0] ?? "M";
                return (
                  <tr key={u.name}>
                    <td><strong>{u.name}</strong>{u.why && pick === u.suggestion && <div className="muted small">{u.why}</div>}</td>
                    <td className="num">{u.plays}</td>
                    <td className="small muted">{u.recordings.slice(0, 2).join("; ")}{u.recordings.length > 2 && ` +${u.recordings.length - 2}`}</td>
                    <td>
                      <select value={pick} onChange={(e) => setPicks({ ...picks, [u.name]: e.target.value })} aria-label={`Count ${u.name} as`}>
                        <option value="">Choose a player…</option>
                        <option value="__new">A new player (add to the sub pool)</option>
                        {players.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                      </select>
                      {pick === "__new" && (
                        <select value={g} onChange={(e) => setNewGender({ ...newGender, [u.name]: e.target.value })} aria-label="Gender group">
                          {genders.map((x) => <option key={x}>{x}</option>)}
                        </select>
                      )}
                    </td>
                    <td><div className="row gap-sm">
                      {pick === "__new" ? (
                        <button className="primary" onClick={() => updateSeason((s) => ({ ...s, input: { ...s.input,
                          players: [...s.input.players, { name: u.name.trim(), gender: g, initialSalary: 0, team: null, isSub: true }] } }))}>Add</button>
                      ) : (
                        <button className="primary" disabled={!pick} onClick={() => merge([{ from: u.name, to: pick }])}>Merge</button>
                      )}
                      <button onClick={() => ignore(u.name)}>Ignore</button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {issues.subRecords.length > 0 && (
        <section className="card">
          <div className="row">
            <h2 className="grow">Old “Name Sub” records ({issues.subRecords.length})</h2>
            <button className="primary" onClick={() => merge(subMerges)}>Merge all</button>
          </div>
          <p className="muted small">
            The master sheet kept a second, $0 record per person for games they subbed, so a sub night didn't touch their own salary.
            The engine now works that out from the week's roster: a player in another team's game is a sub there automatically.
            Merging folds each “Sub” record into the real one; players who only ever sub keep one record under their plain name.
          </p>
          <Effect e={subEffect} />
          <ul className="plain small cols">
            {issues.subRecords.map((s) => (
              <li key={s.player.name}>
                {s.player.name} → {s.base ? <Link to={`../players/${encodeURIComponent(s.base.name)}`}>{s.base.name}</Link> : <em>{stripSub(s.player.name)}</em>}
                {!s.base && <span className="muted"> (renamed)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {issues.dupes.length > 0 && (
        <section className="card scroll-x">
          <h2>Players who may be listed twice ({issues.dupes.length})</h2>
          <table className="data">
            <thead><tr><th>Player</th><th>Player</th><th>Why</th><th /></tr></thead>
            <tbody>
              {issues.dupes.map(({ a, b, why }) => {
                const desc = (p: typeof a) => `${p.team ?? "sub pool"}, ${money(p.initialSalary)}`;
                const keep = (from: typeof a, to: typeof a) => merge([{ from: from.name, to: to.name }],
                  `Merge ${from.name} (${desc(from)}) into ${to.name}? ${from.name}'s own record, team and starting salary are dropped.`);
                return (
                  <tr key={a.name + b.name}>
                    <td>{a.name}<div className="muted small">{desc(a)}</div></td>
                    <td>{b.name}<div className="muted small">{desc(b)}</div></td>
                    <td className="small">{why}</td>
                    <td><div className="row gap-sm">
                      <button onClick={() => keep(b, a)}>Keep first</button>
                      <button onClick={() => keep(a, b)}>Keep second</button>
                      <button onClick={() => ignore(`${nameKey(a.name)}|${nameKey(b.name)}`)}>Different people</button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {(season.aliases?.length ?? 0) > 0 && (
        <section className="card scroll-x">
          <h2>Merged names ({season.aliases!.length})</h2>
          <p className="muted small">Recordings keep the tablet's spelling; these are counted for the player on the right.</p>
          <table className="data compact">
            <tbody>
              {season.aliases!.map((a) => (
                <tr key={a.from}>
                  <td>{a.from}</td><td>→ {a.to}{a.renamed && <span className="muted small"> (record renamed)</span>}</td>
                  <td className="num"><button className="small-btn" onClick={() => undo(a)}>Undo</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(season.ignoredNames?.length ?? 0) > 0 && (
        <p className="muted small">
          {season.ignoredNames!.length} flag(s) dismissed.{" "}
          <button className="link" onClick={() => updateSeason((s) => ({ ...s, ignoredNames: [] }))}>Show them again</button>
        </p>
      )}
    </main>
  );
}
