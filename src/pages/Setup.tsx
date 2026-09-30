import { useDeferredValue, useMemo, useState } from "react";
import { computeLeague } from "../../engine/compute";
import type { LeagueRules, Player, StatWeights } from "../../engine/types";
import { delta, money, shortTeam } from "../lib/format";
import { teamPayroll, useSeason } from "../lib/SeasonContext";

const WEIGHTS: [keyof StatWeights, string][] = [
  ["win", "Win"], ["goal", "Goal"], ["assist", "Assist"], ["secondAssist", "2nd assist"],
  ["block", "D-Play"], ["drop", "Drop"], ["throwaway", "Throwaway"], ["gso", "GSO"],
];

function Num({ label, value, onChange, step, hint }: { label: string; value: number; onChange: (n: number) => void; step?: number; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" step={step ?? "any"} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Setup() {
  const { input, result, update } = useSeason();
  const [draft, setDraft] = useState<LeagueRules>(input.rules);
  const deferred = useDeferredValue(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(input.rules);
  const w = input.throughWeek;

  const preview = useMemo(() => (JSON.stringify(deferred) === JSON.stringify(input.rules) ? null : computeLeague({ ...input, rules: deferred })), [deferred, input]);
  const changes = preview ? input.players
    .map((p) => ({ p: p.name, d: preview.salary[p.name][w] - result.salary[p.name][w] }))
    .filter((x) => Math.abs(x.d) > 0.5).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)) : [];
  const payNow = teamPayroll(input, result, w), payNext = preview ? teamPayroll(input, preview, w) : payNow;

  const set = <K extends keyof LeagueRules>(k: K, v: LeagueRules[K]) => setDraft({ ...draft, [k]: v });
  const setAbs = <K extends keyof LeagueRules["absence"]>(k: K, v: LeagueRules["absence"][K]) => setDraft({ ...draft, absence: { ...draft.absence, [k]: v } });
  const capExtraText = Object.entries(draft.capExtraByWeek).map(([k, v]) => `${k}: ${v}`).join(", ");

  return (
    <main className="page">
      <div className="two-col wide-left">
        <div>
          <section className="card">
            <h2>Stat values</h2>
            <p className="muted small">What each stat adds to (or takes off) a player's salary, per game.</p>
            <div className="fields">
              {WEIGHTS.map(([k, l]) => <Num key={k} label={l} value={draft.weights[k]} step={50000} onChange={(n) => set("weights", { ...draft.weights, [k]: n })} />)}
              <Num label="Tie pays (× win)" value={draft.tieWeightFactor} step={0.1} onChange={(n) => set("tieWeightFactor", n)} />
            </div>
          </section>

          <section className="card">
            <h2>Absences</h2>
            <div className="fields">
              <Num label="Early-season estimate (share of start salary per week)" value={draft.absence.pctOfInitialPerWeek} step={0.05} onChange={(n) => setAbs("pctOfInitialPerWeek", n)} />
              <Num label="Weeks using that estimate" value={draft.absence.pctRuleWeeks} step={1} onChange={(n) => setAbs("pctRuleWeeks", n)} />
              <Num label="Games per team per week" value={draft.matchesPerWeek} step={1} onChange={(n) => set("matchesPerWeek", n)} />
              <label className="field"><span>After that, an absence earns</span>
                <select value={draft.absence.thereafter} onChange={(e) => setAbs("thereafter", e.target.value as any)}>
                  <option value="seasonAvgRetroactive">the player's season average (past weeks shift as weeks are added; matches the sheet)</option>
                  <option value="avgToDate">the player's average up to that week (past weeks stay put)</option>
                </select>
              </label>
              <label className="field check"><input type="checkbox" checked={draft.absence.floorAtSubGrowth} onChange={(e) => setAbs("floorAtSubGrowth", e.target.checked)} />
                <span>Never less than what their sub earned</span></label>
              <label className="field check"><input type="checkbox" checked={!!draft.payResultToAbsent} onChange={(e) => set("payResultToAbsent", e.target.checked)} />
                <span>Pay the win bonus to absent players too</span></label>
              <label className="field"><span>Roster-filler (plug) players</span>
                <select value={draft.plugMode ?? "asAbsentPlayer"} onChange={(e) => set("plugMode", e.target.value as any)}>
                  <option value="asAbsentPlayer">treated as absent every game (the sheet's behaviour)</option>
                  <option value="leagueAverage">re-priced weekly at the league's average salary</option>
                </select>
              </label>
            </div>
          </section>

          <section className="card">
            <h2>Salary cap</h2>
            <p className="muted small">Cap = total league salary ÷ teams, plus a buffer, plus any one-off bumps.</p>
            <div className="fields">
              <Num label="Teams in the average" value={draft.teamsForCapAverage} step={1} onChange={(n) => set("teamsForCapAverage", n)} />
              <Num label="Buffer" value={draft.capBuffer} step={50000} onChange={(n) => set("capBuffer", n)} />
              <label className="field"><span>One-off bumps by week</span>
                <input defaultValue={capExtraText} placeholder="11: 500000, 13: 1000000" key={capExtraText}
                  onBlur={(e) => set("capExtraByWeek", Object.fromEntries(e.target.value.split(",").map((s) => s.split(":").map((x) => x.trim()))
                    .filter(([k, v]) => k && v && !Number.isNaN(+v)).map(([k, v]) => [k, +v])))} />
              </label>
              <label className="field check"><input type="checkbox" checked={!!draft.teamResultBonus}
                onChange={(e) => set("teamResultBonus", e.target.checked ? { win: 2000000, tieFactor: 0.5 } : undefined)} />
                <span>Team win bonus counts against the cap</span></label>
              {draft.teamResultBonus && <>
                <Num label="Per win" value={draft.teamResultBonus.win} step={100000} onChange={(n) => set("teamResultBonus", { ...draft.teamResultBonus!, win: n })} />
                <Num label="Tie (× win)" value={draft.teamResultBonus.tieFactor} step={0.1} onChange={(n) => set("teamResultBonus", { ...draft.teamResultBonus!, tieFactor: n })} />
              </>}
            </div>
          </section>
        </div>

        <aside>
          <section className="card sticky">
            <h2>Effect after week {w}</h2>
            {!dirty ? <p className="muted">Change a rule to see who it moves before you save.</p> : !preview ? <p className="muted">Recalculating…</p> : (
              <>
                <p>Cap {money(result.capByWeek[w])} → <strong>{money(preview.capByWeek[w])}</strong></p>
                <table className="data compact">
                  <tbody>{Object.keys(payNow).map((t) => (
                    <tr key={t}><td>{shortTeam(t)}</td><td className="num">{delta(payNext[t] - payNow[t])}</td></tr>
                  ))}</tbody>
                </table>
                <p className="small">{changes.length} player(s) change{changes.length ? ":" : "."}</p>
                <ul className="small plain">{changes.slice(0, 12).map((c) => <li key={c.p}>{c.p} <span className={c.d > 0 ? "up" : "down"}>{delta(c.d)}</span></li>)}</ul>
                {changes.length > 12 && <p className="muted small">and {changes.length - 12} more</p>}
              </>
            )}
            <div className="row gap">
              <button className="primary" disabled={!dirty} onClick={() => update((inp) => ({ ...inp, rules: draft }))}>Save rules</button>
              <button disabled={!dirty} onClick={() => setDraft(input.rules)}>Discard</button>
            </div>
          </section>
        </aside>
      </div>

      <SeasonBasics />
    </main>
  );
}

function SeasonBasics() {
  const { season, update } = useSeason();
  const { input } = season;
  const [name, setName] = useState(season.name);
  const [np, setNp] = useState<Player>({ name: "", gender: "M", initialSalary: 0, team: null, isSub: true });
  const [date, setDate] = useState("");
  const lastWeek = Math.max(0, ...input.schedule.map((s) => s.week));

  return (
    <div className="two-col">
      <section className="card">
        <h2>Season</h2>
        <div className="fields">
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== season.name && update((i) => i, { name })} /></label>
          <label className="field"><span>Count games through week</span>
            <select value={input.throughWeek} onChange={(e) => update((i) => ({ ...i, throughWeek: +e.target.value }))}>
              {input.schedule.map((s) => <option key={s.week} value={s.week}>Week {s.week} ({s.date})</option>)}
            </select>
          </label>
        </div>
        <h3>Schedule</h3>
        <p className="muted small">A recording belongs to the latest week that starts on or before its date.</p>
        <ul className="plain small">{[...input.schedule].sort((a, b) => a.week - b.week).map((s) => <li key={s.week}>Week {s.week}: {s.date}</li>)}</ul>
        <div className="row gap">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="New week date" />
          <button disabled={!date} onClick={() => { update((i) => ({ ...i, schedule: [...i.schedule, { week: lastWeek + 1, date }] })); setDate(""); }}>Add week {lastWeek + 1}</button>
        </div>
      </section>

      <section className="card">
        <h2>Add a player</h2>
        <p className="muted small">For new signings and subs whose names show up in recordings but not the player list.</p>
        <div className="fields">
          <label className="field"><span>Name (as the tablets spell it)</span><input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></label>
          <label className="field"><span>Gender group</span>
            <select value={np.gender} onChange={(e) => setNp({ ...np, gender: e.target.value })}>
              {[...new Set(input.players.map((p) => p.gender.replace(/^Sub/i, "")).concat(["M", "F"]))].map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <Num label="Starting salary" value={np.initialSalary} step={50000} onChange={(n) => setNp({ ...np, initialSalary: n })} />
          <label className="field"><span>Team</span>
            <select value={np.team ?? ""} onChange={(e) => setNp({ ...np, team: e.target.value || null, isSub: !e.target.value })}>
              <option value="">Sub pool</option>
              {input.teams.filter((t) => !t.isSubTeam).map((t) => <option key={t.name}>{t.name}</option>)}
            </select>
          </label>
        </div>
        <button className="primary" disabled={!np.name.trim() || input.players.some((p) => p.name.toLowerCase() === np.name.trim().toLowerCase())}
          onClick={() => { update((i) => ({ ...i, players: [...i.players, { ...np, name: np.name.trim() }] })); setNp({ ...np, name: "" }); }}>
          Add player
        </button>
      </section>
    </div>
  );
}
