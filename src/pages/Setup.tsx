import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";
import { computeLeague } from "../../engine/compute";
import { ruleProblems } from "../../engine/rules";
import type { LeagueRules, Player, StatWeights } from "../../engine/types";
import { delta, money, shortTeam } from "../lib/format";
import { BOARDS, COLUMNS, DEFAULT_PUBLIC, type PublicSettings } from "../lib/publicStats";
import { newPlug } from "../lib/newSeason";
import { recentLeagues } from "../lib/recentLeagues";
import { newLeagueProblem, slugFrom } from "../lib/leagueForm";
import { Link, useNavigate } from "react-router-dom";
import { teamPayroll, useSeason } from "../lib/SeasonContext";

const LeagueSettings = lazy(() => import("./LeagueSettings"));

const WEIGHTS: [keyof StatWeights, string][] = [
  ["win", "Win"], ["goal", "Goal"], ["assist", "Assist"], ["secondAssist", "2nd assist"],
  ["block", "D-Play"], ["drop", "Drop"], ["throwaway", "Throwaway"], ["gso", "GSO"],
];

function Num({ label, value, onChange, step, hint, min, max }: { label: string; value: number; onChange: (n: number) => void; step?: number; hint?: string; min?: number; max?: number }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" step={step ?? "any"} min={min} max={max} value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value.trim() === "" ? NaN : Number(e.target.value))} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Setup() {
  const { input, result, update } = useSeason();
  const [draft, setDraft] = useState<LeagueRules>(input.rules);
  const deferred = useDeferredValue(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(input.rules);
  const problems = ruleProblems(draft);
  const w = input.throughWeek;

  const preview = useMemo(() => (JSON.stringify(deferred) === JSON.stringify(input.rules) || ruleProblems(deferred).length
    ? null : computeLeague({ ...input, rules: deferred })), [deferred, input]);
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
              <Num label="Tie pays (× win)" value={draft.tieWeightFactor} step={0.1} min={0} max={1} onChange={(n) => set("tieWeightFactor", n)} />
            </div>
          </section>

          <section className="card">
            <h2>Absences</h2>
            <div className="fields">
              <Num label="Early-season estimate (share of start salary per week)" value={draft.absence.pctOfInitialPerWeek} step={0.05} onChange={(n) => setAbs("pctOfInitialPerWeek", n)} />
              <Num label="Weeks using that estimate" value={draft.absence.pctRuleWeeks} step={1} min={0} onChange={(n) => setAbs("pctRuleWeeks", n)} />
              <Num label="Games per team per week" value={draft.matchesPerWeek} step={1} min={1} onChange={(n) => set("matchesPerWeek", n)} />
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
              <Num label="Teams in the average" value={draft.teamsForCapAverage} step={1} min={1} onChange={(n) => set("teamsForCapAverage", n)} />
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
            {problems.length > 0 && (
              <ul className="issues">{problems.map((p) => <li key={p} className="error">{p}</li>)}</ul>
            )}
            {!dirty ? <p className="muted">Change a rule to see who it moves before you save.</p> : problems.length ? null : !preview ? <p className="muted">Recalculating…</p> : (
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
              <button className="primary" disabled={!dirty || problems.length > 0} onClick={() => update((inp) => ({ ...inp, rules: draft }))}>Save rules</button>
              <button disabled={!dirty} onClick={() => setDraft(input.rules)}>Discard</button>
            </div>
          </section>
        </aside>
      </div>

      <SeasonBasics />
      <PublicSettingsCard />
    </main>
  );
}

function SeasonBasics() {
  const { season, update, updateSeason, online } = useSeason();
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
          <label className="field"><span>Game length (minutes)</span>
            <input type="number" min={1} defaultValue={season.gameLengthMin ?? 25} key={season.gameLengthMin ?? 25}
              onBlur={(e) => { const n = Math.round(Number(e.target.value)); if (n > 0 && n !== (season.gameLengthMin ?? 25)) updateSeason((s) => ({ ...s, gameLengthMin: n })); }} />
            <small className="muted">The clock's starting time on Track Stats. Each game can still change it.</small>
          </label>
          <label className="field check">
            <input type="checkbox" checked={season.autoMatchSubs !== false} onChange={(e) => updateSeason((s) => ({ ...s, autoMatchSubs: e.target.checked }))} />
            <span><strong>Auto-match subs</strong><br />
              <small className="muted">Each sub covers an absent player of the same gender: the sub with the best night covers the highest-paid absent player, and so on down. You can override any match on the Subs tab.</small></span>
          </label>
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
      <PlugsCard />
      <MoveOnlineCard />
      {online && online.role === "admin" && <Suspense fallback={null}><LeagueSettings slug={online.slug} /></Suspense>}
    </div>
  );
}

/** Roster fillers for short teams. Removing one mid-season needs trades, so until then it's blocked once games exist. */
function PlugsCard() {
  const { season, result, update } = useSeason();
  const { input } = season;
  const [gender, setGender] = useState<Record<string, string>>({});
  const week = Math.max(1, input.throughWeek + 1);
  const teams = input.teams.filter((t) => !t.isSubTeam).map((t) => t.name);
  const size = (t: string) => input.players.filter((p) => !p.isSub && result.teamOf(p.name, week) === t).length;
  const largest = Math.max(0, ...teams.map(size));
  const played = input.events.length > 0 || (input.boxScores?.length ?? 0) > 0;
  return (
    <section className="card">
      <h2>Plugs</h2>
      <p className="muted small">A plug fills a roster spot on a short team. Its salary is the average, each week, of rostered players of its gender; it never shows in Track Stats or on the player stats pages.</p>
      <table className="data compact plugs-table">
        <thead><tr><th>Team</th><th className="num">Players</th><th>Plugs</th><th></th></tr></thead>
        <tbody>
          {teams.map((t) => {
            const plugs = input.players.filter((p) => p.isPlug && p.team === t);
            return (
              <tr key={t}>
                <td>{shortTeam(t)}</td>
                <td className={"num" + (size(t) < largest ? " attn" : "")}>{size(t)}{size(t) < largest && <span className="muted"> of {largest}</span>}</td>
                <td>{plugs.map((p) => (
                  <span key={p.name} className="tag">{p.name}{" "}
                    <button className="link" disabled={played} aria-label={`Remove ${p.name}`}
                      title={played ? "Games are recorded: removing a plug from a given week comes with the trades screen" : "Remove"}
                      onClick={() => update((i) => ({ ...i, players: i.players.filter((x) => x.name !== p.name) }))}>×</button>
                  </span>
                ))}</td>
                <td className="row gap-sm">
                  <select value={gender[t] ?? "F"} onChange={(e) => setGender({ ...gender, [t]: e.target.value })} aria-label={`Plug gender for ${t}`}>
                    <option value="F">F</option><option value="M">M</option><option value="X">X</option>
                  </select>
                  <button className="small-btn" onClick={() => update((i) => ({ ...i, players: [...i.players, newPlug(i.players, t, gender[t] ?? "F")] }))}>Add plug</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {played && <p className="muted small">Games are recorded, so plugs can be added but not removed yet: removing one from a given week will come with the trades screen.</p>}
    </section>
  );
}

function PublicSettingsCard() {
  const { season, updateSeason } = useSeason();
  const ps = season.publicStats ?? DEFAULT_PUBLIC;
  const set = (patch: Partial<PublicSettings>) => updateSeason((s) => ({ ...s, publicStats: { ...ps, ...patch } }));
  const toggle = <K extends "columns" | "leaderboards">(k: K, key: PublicSettings[K][number]) => {
    const list = ps[k] as string[];
    set({ [k]: list.includes(key) ? list.filter((x) => x !== key) : [...list, key] } as Partial<PublicSettings>);
  };
  return (
    <section className="card">
      <h2>Player stats page</h2>
      <p className="muted small">What players see on the shareable stats page (preview it on the Player stats tab). Salaries are never shown there.</p>
      <h3>Columns</h3>
      <div className="checks">
        {COLUMNS.map((c) => (
          <label key={c.key} className="check"><input type="checkbox" checked={ps.columns.includes(c.key)} onChange={() => toggle("columns", c.key)} /> {c.label}</label>
        ))}
      </div>
      <h3>Leaderboards</h3>
      <p className="muted small">Top players in each gender group, per game.</p>
      <div className="checks">
        {BOARDS.map((b) => (
          <label key={b.key} className="check" title={b.short}><input type="checkbox" checked={ps.leaderboards.includes(b.key)} onChange={() => toggle("leaderboards", b.key)} /> {b.label}</label>
        ))}
      </div>
      <div className="fields">
        <Num label="Players per leaderboard" value={ps.topN} step={1} onChange={(n) => set({ topN: Math.max(1, Math.round(n) || 5) })} />
        <Num label="Minimum games to appear on a leaderboard" value={ps.minGames} step={1} onChange={(n) => set({ minGames: Math.max(1, Math.round(n) || 1) })} />
        <label className="field check"><input type="checkbox" checked={ps.includeSubGames} onChange={(e) => set({ includeSubGames: e.target.checked })} />
          <span>Count games played as a sub for another team (the master sheet didn't)</span></label>
      </div>
      <button className="small-btn" onClick={() => updateSeason((s) => ({ ...s, publicStats: DEFAULT_PUBLIC }))}>Reset to the master sheet's layout</button>
    </section>
  );
}

/** A season kept only in this browser can be moved online to a league; this copy stays as it is. */
/**
 * Puts a season kept in this browser into a league online: one the browser already knows, or a new
 * one made right here. Either way it ends in the online season, where everything else continues.
 */
function MoveOnlineCard() {
  const { season, online, updateSeason } = useSeason();
  const nav = useNavigate();
  const leagues = recentLeagues();
  const [mode, setMode] = useState<"existing" | "new">(leagues.length ? "existing" : "new");
  const [slug, setSlug] = useState(leagues[0]?.slug ?? "");
  const [password, setPassword] = useState("");
  const [f, setF] = useState({ name: "", slug: "", stat: "", admin: "", admin2: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (online) return null;
  if (season.movedOnline) {
    return (
      <section className="card">
        <h2>Online</h2>
        <p>Moved online to “{season.movedOnline.slug}”. <Link to={`/l/${season.movedOnline.slug}/s/${season.id}`}>Open the online season</Link></p>
      </section>
    );
  }
  const form = { ...f, slug: slugTouched ? f.slug : slugFrom(f.name) };
  const problem = mode === "new" ? newLeagueProblem(form) : !slug ? "Pick the league." : null;
  const typed = mode === "new" ? !!(form.stat || form.admin) : false;
  const target = mode === "new" ? form.slug : slug;

  const move = async () => {
    setBusy(true); setError(null);
    try {
      const league = await import("../lib/league");
      if (mode === "new") await league.createLeague(form.slug, form.name, form.stat, form.admin);
      else if (password) await league.unlock(slug, "admin", password);
      const { moveSeasonOnline } = await import("../lib/onlineSeason");
      try { await moveSeasonOnline(target, season); }
      catch (e) {
        if ((e as { code?: string }).code === "permission-denied") throw new Error("This device isn't unlocked as that league's admin. Enter its admin password.");
        throw e;
      }
      if (mode === "new") (await import("../lib/recentLeagues")).rememberLeague(form.slug, form.name.trim());
      await updateSeason((s) => ({ ...s, movedOnline: { slug: target, at: new Date().toISOString() } }));
      nav(`/l/${target}/s/${season.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <section className="card move-online">
      <h2>Move this season online</h2>
      <p className="muted small">Puts the season in a league online, where every tablet and admin shares it and recordings arrive as they're made. This browser keeps its copy.</p>
      <div className="seg" role="group" aria-label="League">
        <button aria-pressed={mode === "existing"} onClick={() => setMode("existing")} disabled={!leagues.length}>A league I've opened</button>
        <button aria-pressed={mode === "new"} onClick={() => setMode("new")}>Create a new league</button>
      </div>
      {mode === "existing" ? (
        <div className="fields">
          <label className="field"><span>League</span>
            <select value={slug} onChange={(e) => setSlug(e.target.value)}>
              {leagues.map((l) => <option key={l.slug} value={l.slug}>{l.name} ({l.slug})</option>)}
            </select></label>
          <label className="field"><span>League admin password</span>
            <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} />
            <small className="muted">Not needed if this device is already unlocked as its admin.</small></label>
        </div>
      ) : (
        <div className="fields">
          <label className="field"><span>League name</span><input id="mv-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="EUPA" /></label>
          <label className="field"><span>Link name</span>
            <input id="mv-slug" value={form.slug} onChange={(e) => { setSlugTouched(true); setF({ ...f, slug: e.target.value.toLowerCase() }); }} placeholder="eupa" /></label>
          <label className="field"><span>Stats-entry password</span><input id="mv-stat" type="password" autoComplete="new-password" value={f.stat} onChange={(e) => setF({ ...f, stat: e.target.value })} />
            <small className="muted">For the volunteers with the tablets.</small></label>
          <label className="field"><span>Admin password</span><input id="mv-admin" type="password" autoComplete="new-password" value={f.admin} onChange={(e) => setF({ ...f, admin: e.target.value })} /></label>
          <label className="field"><span>Admin password again</span><input id="mv-admin2" type="password" autoComplete="new-password" value={f.admin2} onChange={(e) => setF({ ...f, admin2: e.target.value })} /></label>
        </div>
      )}
      {(error || (problem && typed)) && <p className="error">{error ?? problem}</p>}
      <button className="primary" disabled={!!problem || busy} onClick={move}>
        {busy ? "Moving…" : mode === "new" ? "Create the league and move this season" : "Move this season online"}
      </button>
    </section>
  );
}
