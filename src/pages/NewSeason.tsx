import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { LeagueRules } from "../../engine/types";
import { money } from "../lib/format";
import { EUPA_RULES, buildNewSeason, parseRoster, scheduleProblem, shortTeams, skipWeek, weeklySchedule } from "../lib/newSeason";
import { checkSeason, type SeasonMeta } from "../lib/season";
import { listSeasons, loadSeason, saveSeason } from "../lib/store";

const EXAMPLE = "Player\tGender\tTeam\tStarting Salary\nAvery Example\tM\tTeam 1\t$7,500,000\nBlair Sample\tF\tTeam 1\t$4,050,000\nCasey Reserve\tF\tSub\t";
const nextMonday = () => {
  const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Start a season from a roster copied out of a spreadsheet, a weekly schedule, and a rule set. */
export function NewSeason() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [gms, setGms] = useState<Record<string, string>>({});
  const [first, setFirst] = useState(nextMonday());
  const [weeks, setWeeks] = useState(10);
  const [schedule, setSchedule] = useState(() => weeklySchedule(nextMonday(), 10));
  const [length, setLength] = useState(25);
  const [seasons, setSeasons] = useState<SeasonMeta[]>([]);
  const [rulesFrom, setRulesFrom] = useState("eupa");
  const [rules, setRules] = useState<LeagueRules>(EUPA_RULES);
  const [showRows, setShowRows] = useState(false);
  const [plugs, setPlugs] = useState<{ team: string; gender: string }[]>([]);
  const [plugGender, setPlugGender] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listSeasons().then(setSeasons); }, []);
  useEffect(() => {
    if (rulesFrom === "eupa") { setRules(EUPA_RULES); return; }
    loadSeason(rulesFrom).then((s) => s && setRules(s.input.rules));
  }, [rulesFrom]);

  const roster = useMemo(() => parseRoster(text), [text]);
  const blocking = roster.issues.filter((i) => i.blocking);
  const teams = roster.teams.map((t) => {
    const ps = roster.rows.filter((r) => r.team === t);
    return { t, n: ps.length, m: ps.filter((p) => p.gender === "M").length, f: ps.filter((p) => p.gender === "F").length, total: ps.reduce((a, p) => a + p.salary, 0) };
  });
  const subs = roster.rows.filter((r) => !r.team);
  const cap = teams.length ? teams.reduce((a, t) => a + t.total, 0) / teams.length + rules.capBuffer : 0;
  const problem = !name.trim() ? "Give the season a name." : !roster.rows.length ? "Paste the roster." : blocking.length ? "Fix the roster problems listed above." :
    scheduleProblem(schedule);

  const create = async () => {
    if (problem) return;
    setBusy(true);
    const season = buildNewSeason({ name, roster: roster.rows, plugs: plugs.filter((p) => roster.teams.includes(p.team)), gms, schedule, rules, gameLengthMin: length });
    try { checkSeason(season); } catch (e) { setError((e as Error).message); setBusy(false); return; }
    await saveSeason(season);
    nav(`/s/${season.id}`);
  };

  return (
    <>
      <header className="pub-band"><div className="pub-band-inner">
        <Link to="/admin" className="brand-badge brand-link">EUPA</Link>
        <span className="pub-band-name">New season</span>
      </div></header>
      <main className="page narrow">
        <p className="crumbs"><Link to="/admin">Seasons</Link> /</p>
        <h1>Start a new season</h1>

        <section className="card">
          <h2>1. Name</h2>
          <div className="fields">
            <label className="field"><span>Season name</span><input id="ns-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. EUPA Winter 2027" /></label>
            <label className="field"><span>Game length (minutes)</span><input id="ns-length" type="number" min={1} value={length} onChange={(e) => setLength(Math.max(1, Number(e.target.value) || 25))} /></label>
          </div>
        </section>

        <section className="card">
          <h2>2. Roster</h2>
          <p className="small">
            In your spreadsheet, select the roster including its header row, copy, and paste below.
            Columns: <strong>Player</strong>, <strong>Gender</strong> (M or F), <strong>Team</strong> (blank or “Sub” for the sub pool), <strong>Starting Salary</strong>.
            A CSV file with the same columns works too.
          </p>
          <textarea id="ns-roster" className="roster-box" value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} aria-label="Roster" />
          <div className="row gap-sm wrap">
            <label className="file-inline small-btn"><input type="file" className="visually-hidden" accept=".csv,.tsv,.txt,text/csv" onChange={async (e) => {
              const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = "";
            }} />Choose a CSV file…</label>
            {text && <button className="small-btn" onClick={() => setText("")}>Clear</button>}
          </div>

          {roster.issues.length > 0 && (
            <ul className="issues">
              {roster.issues.map((i, k) => <li key={k} className={i.blocking ? "error" : "attn"}>{i.line ? `Line ${i.line}: ` : ""}{i.message}</li>)}
            </ul>
          )}

          {teams.length > 0 && (
            <>
              <div className="scroll-x"><table className="data compact ns-teams">
                <thead><tr><th>Team</th><th>GM</th><th className="num">Players</th><th className="num">M / F</th><th className="num">Payroll</th></tr></thead>
                <tbody>
                  {teams.map((t) => (
                    <tr key={t.t}>
                      <td>{t.t}</td>
                      <td><input className="gm-in" value={gms[t.t] ?? ""} onChange={(e) => setGms({ ...gms, [t.t]: e.target.value })} aria-label={`GM of ${t.t}`} placeholder="GM" /></td>
                      <td className="num">{t.n}</td><td className="num">{t.m} / {t.f}</td>
                      <td className={"num" + (t.total > cap ? " over" : "")}>{money(t.total)}</td>
                    </tr>
                  ))}
                  {subs.length > 0 && <tr><td>Sub pool</td><td /><td className="num">{subs.length}</td><td className="num">{subs.filter((s) => s.gender === "M").length} / {subs.filter((s) => s.gender === "F").length}</td><td /></tr>}
                </tbody>
              </table></div>
              {shortTeams(roster.rows, plugs).map((g) => (
                <div key={g.team} className="note plug-prompt">
                  <span>{g.team} has {g.players} player{g.players === 1 ? "" : "s"}, the largest team has {g.largest}. Add a plug?</span>
                  <select value={plugGender[g.team] ?? "F"} onChange={(e) => setPlugGender({ ...plugGender, [g.team]: e.target.value })} aria-label={`Plug gender for ${g.team}`}>
                    <option value="F">F</option><option value="M">M</option><option value="X">X</option>
                  </select>
                  <button className="small-btn" onClick={() => setPlugs([...plugs, { team: g.team, gender: plugGender[g.team] ?? "F" }])}>Add plug</button>
                </div>
              ))}
              {plugs.length > 0 && (
                <p className="small">Plugs: {plugs.map((p, i) => (
                  <span key={i} className="tag">{p.team} ({p.gender}) <button className="link" aria-label="Remove plug" onClick={() => setPlugs(plugs.filter((_, j) => j !== i))}>×</button></span>
                ))} <span className="muted">A plug fills a roster spot; its salary is the average of rostered players of its gender.</span></p>
              )}
              <p className="small muted">Starting cap with these salaries: <strong>{money(cap)}</strong> (average team payroll plus the {money(rules.capBuffer)} buffer).</p>
              <button className="link small" onClick={() => setShowRows(!showRows)}>{showRows ? "Hide" : "Show"} all {roster.rows.length} players</button>
              {showRows && (
                <div className="scroll-x"><table className="data compact">
                  <thead><tr><th>Player</th><th>Gender</th><th>Team</th><th className="num">Starting salary</th></tr></thead>
                  <tbody>{roster.rows.map((r) => <tr key={r.line}><td>{r.name}</td><td>{r.gender}</td><td>{r.team ?? <span className="muted">Sub pool</span>}</td><td className="num">{money(r.salary)}</td></tr>)}</tbody>
                </table></div>
              )}
            </>
          )}
        </section>

        <section className="card">
          <h2>3. Schedule</h2>
          <div className="row gap-sm wrap ns-sched">
            <label className="field"><span>First game night</span><input id="ns-first" type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></label>
            <label className="field"><span>Weeks</span><input id="ns-weeks" type="number" min={1} max={30} value={weeks} onChange={(e) => setWeeks(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} /></label>
            <button onClick={() => first && setSchedule(weeklySchedule(first, weeks))}>Fill in weekly dates</button>
          </div>
          <p className="muted small">For a holiday, choose <strong>Skip</strong> on that week: it and every later week move back seven days. You can also type any date. A game belongs to the latest week that starts on or before its date.</p>
          {scheduleProblem(schedule) && <p className="error small">{scheduleProblem(schedule)}</p>}
          <ol className="ns-weeks">
            {schedule.map((w, i) => (
              <li key={w.week}>
                <span className="muted">Week {w.week}</span>
                <input type="date" value={w.date} aria-label={`Week ${w.week} date`} onChange={(e) => setSchedule(schedule.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
                <button className="link small" title="Push this week and every later week back seven days" onClick={() => setSchedule(skipWeek(schedule, i))}>Skip</button>
              </li>
            ))}
          </ol>
          <div className="row gap-sm">
            <button className="small-btn" onClick={() => {
              const last = schedule[schedule.length - 1];
              const next = last ? weeklySchedule(last.date, 2)[1].date : first;
              setSchedule([...schedule, { week: schedule.length + 1, date: next }]);
            }}>+ Week</button>
            {schedule.length > 0 && <button className="small-btn" onClick={() => setSchedule(schedule.slice(0, -1))}>− Last week</button>}
          </div>
        </section>

        <section className="card">
          <h2>4. Rules</h2>
          <label className="field"><span>Salary rules</span>
            <select id="ns-rules" value={rulesFrom} onChange={(e) => setRulesFrom(e.target.value)}>
              <option value="eupa">EUPA standard (as in the Fall and Thursday master sheets)</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>Same as {s.name}</option>)}
            </select>
          </label>
          <p className="muted small">
            Win, goal, assist and D-play {money(rules.weights.goal)} each; drop and throwaway {money(rules.weights.drop)}; cap buffer {money(rules.capBuffer)}.
            Change anything later on the Setup tab.
          </p>
        </section>

        {error && <p className="error pre-line">{error}</p>}
        <div className="row gap-sm wrap">
          {problem && <span className="attn">{problem}</span>}
          <span className="grow" />
          <Link to="/admin">Cancel</Link>
          <button className="primary big" aria-busy={busy} disabled={!!problem || busy} onClick={create}>Create season</button>
        </div>
      </main>
    </>
  );
}
