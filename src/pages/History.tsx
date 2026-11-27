// League history, for the league's admins: past seasons (imported from their master sheets, or
// followed from seasons in the app), every person's career across them, all-time leaders, and
// merging the spellings one person was recorded under.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { LineChart } from "../components/LineChart";
import { Loading } from "../components/Loading";
import { SiteNav } from "../components/SiteNav";
import { askConfirm } from "../lib/confirm";
import { moneyShort, shortTeam } from "../lib/format";
import {
  careerLine, careers, isHidden, mergeSuggestions, withHidden, nameResolver, NO_META, pairKey, parseHistoryExport, samePerson, seasonLine,
  seasonOrder, sheetSeasonId, withDistinct, withMerge, withoutMerge,
  type Career, type HistoryExport, type HistoryLine, type HistoryMeta, type HistoryPlayer, type HistorySeason,
} from "../lib/history";
import { getLeague, watchRole, type League, type Role } from "../lib/league";
import { parseMasterSheet, readWorkbook, type ParsedSheet } from "../lib/masterSheet";
import { nameKey } from "../lib/names";
import { deleteHistorySeason, saveHistoryMeta, saveHistorySeason, saveHistorySeasons, watchHistory, watchHistoryMeta } from "../lib/onlineHistory";
import { fmtStat, groupLabel } from "../lib/publicStats";
import { downloadJson } from "../lib/store";
import { UnlockCard } from "./League";

const message = (e: unknown) => ((e as { code?: string }).code === "permission-denied"
  ? "This device isn't unlocked as the league's admin." : (e as Error).message);

/* ------------------------------------------------------------------ shared state */

interface Ctx {
  slug: string; base: string; league: League;
  /** The seasons counted; `all` adds the app seasons left out. */
  seasons: HistorySeason[]; all: HistorySeason[]; names: HistoryMeta; people: Career[];
  /** The person a spelling belongs to (after "Sub" and the merges). */
  find: (name: string) => Career | undefined;
  setNames: (n: HistoryMeta) => Promise<void>;
}
const HistoryContext = createContext<Ctx | null>(null);
function useHistory() {
  const c = useContext(HistoryContext);
  if (!c) throw new Error("useHistory outside HistoryShell");
  return c;
}

/** /l/:slug/history: the band, the admin check, and the league's history, live. */
export function HistoryShell() {
  const { slug = "" } = useParams();
  const [league, setLeague] = useState<League | null | undefined>(undefined);
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  const [seasons, setSeasons] = useState<HistorySeason[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [names, setNamesNow] = useState<HistoryMeta>(NO_META);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getLeague(slug).then((l) => live && setLeague(l)).catch((e) => live && setError(message(e)));
    const stop = watchRole(slug, (r) => live && setRole(r));
    return () => { live = false; stop(); };
  }, [slug]);
  useEffect(() => {
    if (role !== "admin") return;
    const a = watchHistory(slug, (s, bad) => { setSeasons(s); setSkipped(bad); }, (e) => setError(message(e)));
    const b = watchHistoryMeta(slug, setNamesNow, (e) => setError(message(e)));
    return () => { a(); b(); };
  }, [slug, role]);

  const counted = useMemo(() => (seasons ?? []).filter((s) => !isHidden(names, s.id)), [seasons, names]);
  const people = useMemo(() => careers(counted, names), [counted, names]);
  const find = useMemo(() => {
    const resolve = nameResolver(names), by = new Map(people.map((c) => [c.key, c]));
    return (n: string) => by.get(nameKey(resolve(n)));
  }, [people, names]);
  const suggestions = useMemo(() => mergeSuggestions(people, names).length, [people, names]);
  const base = `/l/${slug}/history`;
  const setNames = async (n: HistoryMeta) => {
    setError(null);
    try { await saveHistoryMeta(slug, n); } catch (e) { setError(message(e)); }
  };

  const band = (
    <header className="pub-band"><div className="pub-band-inner">
      <Link to={`/l/${slug}`} className="brand-badge brand-link">EUPA</Link>
      <span className="pub-band-name">History</span>
      {league && <span className="pub-band-sub">{league.name}</span>}
      <SiteNav current="admin" />
    </div></header>
  );

  if (league === undefined || role === undefined) return <>{band}<Loading pad /></>;
  if (league === null) return <>{band}<main className="page narrow"><p>There's no league called “{slug}”. <Link to="/admin">Seasons</Link></p></main></>;
  if (role !== "admin") {
    return (
      <>{band}
        <main className="page narrow">
          <p className="crumbs"><Link to={`/l/${slug}`}>{league.name}</Link> /</p>
          <h1>History</h1>
          <p className="muted">Past seasons, careers and salaries are for {league.name}'s admins. Enter the admin password to see them on this device.</p>
          <UnlockCard slug={slug} current={role} only="admin" />
        </main>
      </>
    );
  }
  return (
    <>
      {band}
      <div className="tab-bar"><div className="tab-row">
        <nav className="tabs">
          <NavLink to={base} end>All-time</NavLink>
          <NavLink to={`${base}/seasons`}>Seasons</NavLink>
          <NavLink to={`${base}/names`}>Names{suggestions > 0 && <span className="badge" aria-label={`${suggestions} to check`}>{suggestions}</span>}</NavLink>
          <NavLink to={`${base}/import`}>Import</NavLink>
        </nav>
      </div></div>
      <main className="page history">
        {error && <p className="error">{error}</p>}
        {skipped.length > 0 && <p className="error small">These history records are damaged and left out: {skipped.join(", ")}. Import their sheets again to replace them.</p>}
        {seasons === null ? <Loading label="Loading history…" /> : (
          <HistoryContext.Provider value={{ slug, base, league, seasons: counted, all: seasons, names, people, find, setNames }}>
            <Outlet />
          </HistoryContext.Provider>
        )}
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ tables */

interface Col<R> { key: string; label: string; title?: string; num?: boolean; value: (r: R) => number | string | null; show?: (r: R) => ReactNode }

/** A table that sorts by any column (numbers high to low first, blanks always last). */
function SortTable<R>({ cols, rows, rowKey, initial, foot }: {
  cols: Col<R>[]; rows: R[]; rowKey: (r: R) => string; initial?: { key: string; desc: boolean }; foot?: ReactNode;
}) {
  const [sort, setSort] = useState(initial ?? null);
  const shown = useMemo(() => {
    const c = sort && cols.find((x) => x.key === sort.key);
    if (!c) return rows;
    return [...rows].sort((a, b) => {
      const x = c.value(a), y = c.value(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const d = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
      return sort!.desc ? -d : d;
    });
  }, [rows, cols, sort]);
  return (
    <div className="scroll-x pub-table">
      <table className="data compact history-table">
        <thead><tr>{cols.map((c, i) => (
          <th key={c.key} className={(c.num ? "num" : "") + (i === 0 ? " name-col" : "")} title={c.title}
            aria-sort={sort?.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
            <button className="sort" onClick={() => setSort(sort?.key === c.key ? { key: c.key, desc: !sort.desc } : { key: c.key, desc: !!c.num })}>
              {c.label}{sort?.key === c.key ? (sort.desc ? " ▼" : " ▲") : ""}
            </button>
          </th>
        ))}</tr></thead>
        <tbody>{shown.map((r) => (
          <tr key={rowKey(r)}>{cols.map((c, i) => <td key={c.key} className={(c.num ? "num" : "") + (i === 0 ? " name-col" : "")}>{c.show ? c.show(r) : c.value(r) ?? "—"}</td>)}</tr>
        ))}</tbody>
        {foot}
      </table>
    </div>
  );
}

const per = (n: number, d: number) => (d ? n / d : null);
const statsOf = (l: HistoryLine) => l.goals + l.assists + l.blocks;
const plusMinus = (l: HistoryLine) => statsOf(l) - l.drops - l.throwaways;
const dec = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const division = (g: string) => (g === "?" ? "—" : groupLabel(g));
const fmtDate = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const dates = (s: Pick<HistorySeason, "firstDate" | "lastDate">) => (s.firstDate ? `${fmtDate(s.firstDate)} – ${fmtDate(s.lastDate)}` : "No dates");
const record = (t: { wins: number; losses: number; ties: number }) => `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ""}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const monthYear = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", year: "numeric", timeZone: "UTC" }) : "?");
/** A season's name short enough for a chart axis: "2025 PRG Monday 4v4 Fall" → "2025 Fall". */
const shortSeason = (n: string) => {
  const year = n.match(/\b(19|20)\d{2}\b/)?.[0];
  const last = n.split(/\s+/).filter((w) => w !== year).at(-1);
  return year && last ? `${year} ${last}` : n;
};

/** The stat columns every history table shares, for any row that has a line. */
function statCols<R>(line: (r: R) => HistoryLine): Col<R>[] {
  const n = (key: keyof HistoryLine, label: string, title?: string): Col<R> =>
    ({ key, label, title, num: true, value: (r) => line(r)[key], show: (r) => fmtStat(line(r)[key]) });
  return [
    n("gp", "GP", "Games played"), n("wins", "W", "Wins; a tie is half a win"),
    { key: "winPct", label: "Win %", num: true, value: (r) => per(line(r).wins, line(r).gp), show: (r) => pct(per(line(r).wins, line(r).gp)) },
    n("goals", "Goals"), n("assists", "Assists"), n("secondAssists", "2nd A", "Second assists"), n("blocks", "Blocks", "D-plays"),
    n("drops", "Drops"), n("throwaways", "T-aways", "Throwaways"), n("touches", "Touches"),
    { key: "stats", label: "Stats", title: "Goals + assists + blocks, as on the Rankings tab", num: true, value: (r) => statsOf(line(r)) },
    { key: "statsPg", label: "Stats/GP", num: true, value: (r) => per(statsOf(line(r)), line(r).gp), show: (r) => dec(per(statsOf(line(r)), line(r).gp)) },
    { key: "pm", label: "+/-", title: "Stats − drops − throwaways", num: true, value: (r) => (line(r).gp ? plusMinus(line(r)) : null) },
  ];
}

function SubToggle({ on, set }: { on: boolean; set: (b: boolean) => void }) {
  return (
    <label className="field inline small"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      Count games subbing for another team</label>
  );
}

/* ------------------------------------------------------------------ all-time */

type PersonRow = { c: Career; l: HistoryLine };

export function HistoryAllTime() {
  const { base, seasons, people } = useHistory();
  const [withSubs, setWithSubs] = useState(true);
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const [minGames, setMinGames] = useState(20);
  const rows = useMemo(() => people.map((c) => ({ c, l: careerLine(c, withSubs) })).filter((r) => r.l.gp > 0 || r.c.seasons.some((s) => s.player.team)), [people, withSubs]);
  const groups = [...new Set(rows.map((r) => r.c.group))].filter((g) => g !== "?").sort((a, b) => (a === "F" ? -1 : b === "F" ? 1 : a.localeCompare(b)));
  if (!seasons.length) return <EmptyHistory />;

  const shown = rows.filter((r) => (group === "all" || r.c.group === group) && r.c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const sorted = [...seasons].sort(seasonOrder);
  const goals = rows.reduce((a, r) => a + r.l.goals, 0);
  const games = seasons.reduce((a, s) => a + s.teams.reduce((b, t) => b + t.wins + t.losses + t.ties, 0) / 2, 0);
  const cols: Col<PersonRow>[] = [
    { key: "name", label: "Player", value: (r) => r.c.name, show: (r) => <Link to={`${base}/players/${encodeURIComponent(r.c.name)}`}>{r.c.name}</Link> },
    { key: "group", label: "Div", value: (r) => division(r.c.group) },
    { key: "seasons", label: "Seasons", num: true, value: (r) => r.c.seasons.length },
    ...statCols<PersonRow>((r) => r.l),
    { key: "last", label: "Last salary", title: "End of their most recent season on a team", num: true, value: (r) => r.c.lastSalary, show: (r) => moneyShort(r.c.lastSalary) },
    { key: "peak", label: "Peak salary", title: "Highest end-of-season salary", num: true, value: (r) => r.c.peakSalary, show: (r) => moneyShort(r.c.peakSalary) },
  ];
  const BOARDS: { key: string; label: string; value: (l: HistoryLine) => number | null; perGame?: boolean }[] = [
    { key: "gp", label: "Games played", value: (l) => l.gp },
    { key: "goals", label: "Goals", value: (l) => l.goals },
    { key: "assists", label: "Assists", value: (l) => l.assists },
    { key: "blocks", label: "Blocks", value: (l) => l.blocks },
    { key: "statsPg", label: "Stats per game", value: (l) => (l.gp >= Math.max(1, minGames) ? per(statsOf(l), l.gp) : null), perGame: true },
    { key: "winPct", label: "Win %", value: (l) => (l.gp >= Math.max(1, minGames) ? per(l.wins, l.gp) : null), perGame: true },
  ];

  return (
    <>
      <section className="tiles">
        <div className="tile"><span className="tile-label">Seasons</span><span className="tile-value">{seasons.length}</span>
          <span className="muted small">{sorted[0].firstDate?.slice(0, 4) ?? "?"} to {sorted.at(-1)!.lastDate?.slice(0, 4) ?? "now"}</span></div>
        <div className="tile"><span className="tile-label">Players</span><span className="tile-value">{rows.length}</span></div>
        <div className="tile"><span className="tile-label">Games</span><span className="tile-value">{Math.round(games)}</span></div>
        <div className="tile"><span className="tile-label">Goals</span><span className="tile-value">{goals.toLocaleString("en-CA")}</span></div>
      </section>

      <div className="toolbar">
        {groups.length > 1 && (
          <div className="seg division" role="group" aria-label="Division">
            {["all", ...groups].map((g) => <button key={g} aria-pressed={group === g} onClick={() => setGroup(g)}>{g === "all" ? "Everyone" : groupLabel(g)}</button>)}
          </div>
        )}
        <SubToggle on={withSubs} set={setWithSubs} />
        <label className="small">Per-game leaders need
          <input type="number" min={1} value={minGames} onChange={(e) => setMinGames(Math.max(1, Number(e.target.value) || 1))} className="num-in" aria-label="Minimum games" /> games</label>
      </div>

      <section aria-labelledby="lead-title">
        <h2 id="lead-title">All-time leaders</h2>
        {groups.filter((g) => group === "all" || g === group).map((g) => (
          <div key={g} className="lb-group">
            {groups.length > 1 && <h3 className="lb-label">{groupLabel(g)}</h3>}
            <div className="lb-grid">
              {BOARDS.map((b) => {
                const top = rows.filter((r) => r.c.group === g).map((r) => ({ c: r.c, v: b.value(r.l) }))
                  .filter((x): x is { c: Career; v: number } => x.v !== null && x.v > 0)
                  .sort((x, y) => y.v - x.v || x.c.name.localeCompare(y.c.name)).slice(0, 5);
                return (
                  <div key={b.key} className="lb-card">
                    <div className="lb-title">{b.label}</div>
                    <ol>
                      {top.map((t, i) => (
                        <li key={t.c.key}><span className="lb-rank">{i + 1}</span>
                          <span className="lb-name"><Link to={`${base}/players/${encodeURIComponent(t.c.name)}`}>{t.c.name}</Link></span>
                          <span className="lb-val">{b.key === "winPct" ? pct(t.v) : b.perGame ? t.v.toFixed(1) : fmtStat(t.v)}</span></li>
                      ))}
                      {top.length === 0 && <li className="muted small">{b.perGame ? `No one with ${minGames}+ games` : "No games yet"}</li>}
                    </ol>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="careers-title">
        <div className="row wrap gap-sm pub-tools">
          <h2 id="careers-title" className="grow">Careers</h2>
          <input type="search" placeholder="Find a player" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a player" />
        </div>
        <SortTable cols={cols} rows={shown} rowKey={(r) => r.c.key} initial={{ key: "gp", desc: true }} />
        {shown.length === 0 && <p className="empty">No players match.</p>}
        <p className="muted small">
          Every season in the history added together. Goals are the sheet's “Points”; Stats are goals + assists + blocks; a tie is half a win.
          Salaries are end-of-season, on a team. Click a column to sort.
        </p>
      </section>
    </>
  );
}

function EmptyHistory() {
  const { base } = useHistory();
  return (
    <section className="card">
      <h2>No seasons yet</h2>
      <p>Import past seasons from their master sheets: in Google Sheets, <strong>File → Download → Microsoft Excel (.xlsx)</strong>, then choose the files on the <Link to={`${base}/import`}>Import</Link> tab.</p>
      <p className="muted small">Seasons in this app join the history on their own once an admin opens them.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ seasons */

export function HistorySeasons() {
  const { base, league, seasons, all, names, setNames } = useHistory();
  const left = all.filter((s) => isHidden(names, s.id)).sort(seasonOrder);
  if (!all.length) return <EmptyHistory />;
  const rows = [...seasons].sort(seasonOrder).reverse();
  const cols: Col<HistorySeason>[] = [
    { key: "name", label: "Season", value: (s) => s.name, show: (s) => <Link to={`${base}/seasons/${encodeURIComponent(s.id)}`}>{s.name}</Link> },
    { key: "dates", label: "Dates", value: (s) => s.firstDate, show: dates },
    { key: "weeks", label: "Weeks", num: true, value: (s) => s.weeks },
    { key: "players", label: "Players", num: true, value: (s) => s.players.filter((p) => p.own.gp + p.sub.gp > 0).length },
    { key: "top", label: "First place", value: (s) => s.teams[0]?.team ?? null, show: (s) => (s.teams[0] ? <>{shortTeam(s.teams[0].team)} <span className="muted">{record(s.teams[0])}</span></> : "—") },
    { key: "source", label: "From", value: (s) => s.source, show: (s) => (s.source === "app" ? "This app" : "Master sheet") },
  ];
  const exportAll = () => downloadJson(`${league.name} history.json`, { kind: "eupa-history", v: 1, league: league.slug, exportedAt: new Date().toISOString(), seasons: all, names } satisfies HistoryExport);
  return (
    <>
      <div className="toolbar">
        <h1 className="grow">Seasons</h1>
        <Link to={`${base}/import`} className="button-link primary">Import season sheets</Link>
        <button onClick={exportAll} title="Everything on these pages, to keep or import again">Download history</button>
      </div>
      <section className="card"><SortTable cols={cols} rows={rows} rowKey={(s) => s.id} /></section>
      {left.length > 0 && (
        <section className="card">
          <h2>Left out</h2>
          <p className="muted small">Seasons in the app that don't count in the careers or leaders.</p>
          <ul className="plain">{left.map((s) => (
            <li key={s.id}><Link to={`${base}/seasons/${encodeURIComponent(s.id)}`}>{s.name}</Link> <span className="muted small">{dates(s)}</span>{" "}
              <button className="link small" onClick={() => setNames(withHidden(names, s.id, false))}>Count it again</button></li>
          ))}</ul>
        </section>
      )}
      <p className="muted small">The daily backup doesn't include history (it can't read admin-only pages), so download a copy after importing.</p>
    </>
  );
}

type SeasonRow = { p: HistoryPlayer; l: HistoryLine };

export function HistorySeasonPage() {
  const { hid = "" } = useParams();
  const { slug, base, all: seasons, names, setNames } = useHistory();
  const nav = useNavigate();
  const [withSubs, setWithSubs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = seasons.find((x) => x.id === hid);
  const [name, setName] = useState(s?.name ?? "");
  useEffect(() => { if (s) setName(s.name); }, [s?.name]);
  if (!s) return <p>That season isn't in the history. <Link to={`${base}/seasons`}>All seasons</Link></p>;

  const rename = async () => {
    const n = name.trim();
    if (!n || n === s.name) { setName(s.name); return; }
    setError(null);
    try { await saveHistorySeason(slug, { ...s, name: n }); } catch (e) { setError(message(e)); }
  };
  const remove = async () => {
    if (!(await askConfirm(`Remove “${s.name}” from the history? You can import its sheet again later.`, { ok: "Remove", danger: true }))) return;
    setBusy(true);
    try { await deleteHistorySeason(slug, s.id); nav(`${base}/seasons`); } catch (e) { setError(message(e)); setBusy(false); }
  };
  const rows = s.players.map((p) => ({ p, l: seasonLine(p, withSubs) }));
  const cols: Col<SeasonRow>[] = [
    { key: "name", label: "Player", value: (r) => r.p.name, show: (r) => <Link to={`${base}/players/${encodeURIComponent(r.p.name)}`}>{r.p.name}</Link> },
    { key: "team", label: "Team", value: (r) => r.p.team, show: (r) => (r.p.team ? <span className="nowrap">{shortTeam(r.p.team)}</span> : <span className="muted nowrap">Sub pool</span>) },
    { key: "group", label: "Div", value: (r) => division(r.p.group) },
    ...statCols<SeasonRow>((r) => r.l),
    ...(withSubs ? [] : [{ key: "subGp", label: "Sub GP", title: "Games subbing for another team", num: true, value: (r: SeasonRow) => r.p.sub.gp || null }]),
    { key: "start", label: "Start", title: "Starting salary", num: true, value: (r) => r.p.startSalary, show: (r) => moneyShort(r.p.startSalary) },
    { key: "end", label: "End", title: "Salary at the end of the season", num: true, value: (r) => r.p.endSalary, show: (r) => moneyShort(r.p.endSalary) },
  ];

  return (
    <>
      <p className="crumbs"><Link to={`${base}/seasons`}>Seasons</Link> /</p>
      {s.source === "sheet"
        ? <input className="title-in" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label="Season name" />
        : <h1>{s.name}</h1>}
      <p className="muted">
        {dates(s)} · {s.weeks} week{s.weeks === 1 ? "" : "s"} · {s.source === "app"
          ? <>followed from <Link to={`/l/${slug}/s/${s.id}`}>the season in this app</Link> whenever an admin has it open</>
          : <>imported from {s.file ?? "a master sheet"} on {fmtDate(s.updatedAt.slice(0, 10))}</>}
      </p>
      {error && <p className="error">{error}</p>}

      {s.teams.length > 0 && (
        <section className="card">
          <h2>Standings</h2>
          <table className="data compact">
            <thead><tr><th>Team</th><th>GM</th><th className="num">W–L{s.teams.some((t) => t.ties) ? "–T" : ""}</th><th className="num">GF</th><th className="num">GA</th></tr></thead>
            <tbody>{s.teams.map((t) => <tr key={t.team}><td>{t.team}</td><td>{t.gm ?? "—"}</td><td className="num strong">{record(t)}</td><td className="num">{t.goalsFor}</td><td className="num">{t.goalsAgainst}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      <section className="card">
        <div className="toolbar"><h2 className="grow">Players</h2><SubToggle on={withSubs} set={setWithSubs} /></div>
        <SortTable cols={cols} rows={rows} rowKey={(r) => r.p.name} initial={{ key: "end", desc: true }} />
      </section>

      {s.source === "sheet" && <button className="danger" disabled={busy} onClick={remove}>Remove from history</button>}
      {s.source === "app" && (isHidden(names, s.id)
        ? <p>This season is left out of the careers and leaders. <button onClick={() => setNames(withHidden(names, s.id, false))}>Count it again</button></p>
        : <button onClick={() => setNames(withHidden(names, s.id, true))} title="For a test season, say">Leave out of history</button>)}
    </>
  );
}

/* ------------------------------------------------------------------ one person */

export function HistoryPlayerPage() {
  const { name = "" } = useParams();
  const { base, find } = useHistory();
  const [withSubs, setWithSubs] = useState(true);
  const c = find(name);
  if (!c) return <p>No one called “{name}” is in the history. <Link to={base}>All-time</Link></p>;
  const total = careerLine(c, withSubs);
  const paid = [...c.seasons].reverse().filter((s) => s.player.endSalary);
  type R = (typeof c.seasons)[number];
  const line = (r: R) => seasonLine(r.player, withSubs);
  const cols = statCols<R>(line);

  return (
    <>
      <p className="crumbs"><Link to={base}>All-time</Link> /</p>
      <h1>{c.name}</h1>
      <p className="muted">
        {division(c.group)}{c.group !== "?" ? " · " : ""}{plural(c.seasons.length, "season")}, {monthYear(c.seasons.at(-1)!.firstDate)} to {monthYear(c.seasons[0].lastDate ?? c.seasons[0].firstDate)}
        {c.spellings.length > 0 && <> · recorded as {c.spellings.join(", ")} (<Link to={`${base}/names`}>names</Link>)</>}
      </p>

      <section className="tiles">
        <div className="tile"><span className="tile-label">Games</span><span className="tile-value">{total.gp}</span></div>
        <div className="tile"><span className="tile-label">Goals</span><span className="tile-value">{total.goals}</span></div>
        <div className="tile"><span className="tile-label">Assists</span><span className="tile-value">{total.assists}</span></div>
        <div className="tile"><span className="tile-label">Blocks</span><span className="tile-value">{total.blocks}</span></div>
        <div className="tile"><span className="tile-label">Stats / game</span><span className="tile-value">{dec(per(statsOf(total), total.gp))}</span></div>
        <div className="tile"><span className="tile-label">Peak salary</span><span className="tile-value">{moneyShort(c.peakSalary)}</span></div>
      </section>

      {paid.length > 1 && (
        <section className="card">
          <h2>End-of-season salary</h2>
          <LineChart xLabels={paid.map((s) => shortSeason(s.name))} format={moneyShort} series={[{ name: c.name, values: paid.map((s) => s.player.endSalary!) }]} height={200} />
        </section>
      )}

      <section className="card">
        <div className="toolbar"><h2 className="grow">By season</h2><SubToggle on={withSubs} set={setWithSubs} /></div>
        <div className="scroll-x pub-table">
          <table className="data compact history-table">
            <thead><tr><th className="name-col">Season</th><th>Team</th>{cols.map((x) => <th key={x.key} className="num" title={x.title}>{x.label}</th>)}
              {!withSubs && <th className="num" title="Games subbing for another team">Sub GP</th>}<th className="num">Start</th><th className="num">End</th></tr></thead>
            <tbody>{c.seasons.map((s) => (
              <tr key={s.id}>
                <td className="name-col"><Link to={`${base}/seasons/${encodeURIComponent(s.id)}`}>{s.name}</Link></td>
                <td className="nowrap">{s.player.team ? shortTeam(s.player.team) : <span className="muted">Sub pool</span>}</td>
                {cols.map((x) => <td key={x.key} className="num">{x.show ? x.show(s) : x.value(s) ?? "—"}</td>)}
                {!withSubs && <td className="num">{s.player.sub.gp || "—"}</td>}
                <td className="num">{moneyShort(s.player.startSalary)}</td><td className="num">{moneyShort(s.player.endSalary)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr className="total-row">
              <td className="name-col">Career</td><td />
              {statCols<HistoryLine>((l) => l).map((x) => <td key={x.key} className="num">{x.show ? x.show(total) : x.value(total) ?? "—"}</td>)}
              {!withSubs && <td className="num">{c.sub.gp || "—"}</td>}<td /><td />
            </tr></tfoot>
          </table>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ names */

export function HistoryMetaPage() {
  const { base, people, names, setNames, find } = useHistory();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const suggestions = useMemo(() => mergeSuggestions(people, names), [people, names]);
  const about = (n: string) => {
    const c = find(n);
    return c ? `${plural(c.seasons.length, "season")}, ${plural(careerLine(c, true).gp, "game")}, last in ${c.seasons[0].name}` : "";
  };
  const known = (n: string) => !!find(n);
  const manualProblem = !from.trim() || !to.trim() ? null : !known(from) ? `No one called “${from}” is in the history.` : !known(to) ? `No one called “${to}” is in the history.`
    : find(from) === find(to) ? "Those are already the same person." : null;

  return (
    <>
      <h1>Names</h1>
      <p className="muted">
        The sheets spell some people more than one way (“Jess” for “Jessica”, a first name for a sub, a typo). Merging two spellings makes one person in the
        careers and leaders. The seasons themselves keep the names they were recorded with, so a merge can be undone.
      </p>

      <section className="card">
        <h2>Probably the same person{suggestions.length ? ` (${suggestions.length})` : ""}</h2>
        {suggestions.length === 0 ? <p className="muted">Nothing to check.</p> : (
          <ul className="plain merge-list">
            {suggestions.map((s) => (
              <li key={pairKey(s.a, s.b)}>
                <div><strong>{s.a}</strong> <span className="muted small">{about(s.a)}</span></div>
                <div><strong>{s.b}</strong> <span className="muted small">{about(s.b)}</span></div>
                <div className="muted small">{s.why}</div>
                <div className="row gap-sm wrap">
                  <button className="small-btn" onClick={() => setNames(withMerge(names, s.b, s.a))}>Same person, shown as “{s.a}”</button>
                  <button className="small-btn" onClick={() => setNames(withMerge(names, s.a, s.b))}>Same person, shown as “{s.b}”</button>
                  <button className="small-btn" onClick={() => setNames(withDistinct(names, s.a, s.b))}>Different people</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Merge two names</h2>
        <datalist id="history-names">{people.map((c) => <option key={c.key} value={c.name} />)}</datalist>
        <div className="row gap-sm wrap">
          <input list="history-names" placeholder="This name…" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Name to merge" />
          <span>is the same person as</span>
          <input list="history-names" placeholder="…this name" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Name to keep" />
          <button className="primary" disabled={!from.trim() || !to.trim() || !!manualProblem}
            onClick={() => { setNames(withMerge(names, find(from)!.name, find(to)!.name)); setFrom(""); setTo(""); }}>Merge</button>
        </div>
        {manualProblem && <p className="error small">{manualProblem}</p>}
        <p className="muted small">The second name is the one shown.</p>
      </section>

      <section className="card">
        <h2>Merged</h2>
        {names.aliases.length === 0 ? <p className="muted">No names merged yet.</p> : (
          <table className="data compact">
            <thead><tr><th>Recorded as</th><th>Shown as</th><th /></tr></thead>
            <tbody>{[...names.aliases].sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from)).map((a) => (
              <tr key={a.from}><td>{a.from}</td><td><Link to={`${base}/players/${encodeURIComponent(a.to)}`}>{a.to}</Link></td>
                <td className="num"><button className="link small" onClick={() => setNames(withoutMerge(names, a.from))}>Undo</button></td></tr>
            ))}</tbody>
          </table>
        )}
        {names.distinct.length > 0 && (
          <p className="muted small">{names.distinct.length} pair{names.distinct.length === 1 ? "" : "s"} marked as different people.{" "}
            <button className="link small" onClick={() => setNames({ ...names, distinct: [] })}>Check them again</button></p>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ import */

interface Item {
  id: number; file: string;
  status: "reading" | "ready" | "error" | "saving" | "saved";
  error?: string;
  sheet?: ParsedSheet;
  restore?: HistoryExport;
  name: string;
  /** A new spelling → the person it's the same as ("" = a new person). */
  picks: Record<string, string>;
  savedId?: string;
}

export function HistoryImport() {
  const { base } = useHistory();
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);
  const patch = (id: number, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = async (files: File[]) => {
    for (const f of files) {
      const id = next.current++;
      setItems((xs) => [...xs, { id, file: f.name, status: "reading", name: "", picks: {} }]);
      try {
        if (/\.json$/i.test(f.name)) {
          const restore = parseHistoryExport(await f.text());
          patch(id, { status: "ready", restore, name: restore.league });
        } else {
          const sheet = parseMasterSheet(await readWorkbook(f), f.name);
          patch(id, { status: "ready", sheet, name: sheet.season.name });
        }
      } catch (e) {
        patch(id, { status: "error", error: /zip|xlsx|not supported/i.test((e as Error).message) ? `${f.name} isn't an .xlsx file. Download the sheet as Microsoft Excel (.xlsx).` : (e as Error).message });
      }
    }
  };

  return (
    <>
      <h1>Import</h1>
      <section className="card">
        <p>
          For each past season, open its master sheet in Google Sheets and choose <strong>File → Download → Microsoft Excel (.xlsx)</strong>.
          Then pick the files here; you can choose several at once. Each one is checked and shown below, and nothing is saved until you press Save.
        </p>
        <label className="file-inline primary">
          <input type="file" className="visually-hidden" accept=".xlsx,.json" multiple onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = ""; }} />
          Choose master sheets…
        </label>
        <p className="muted small">
          Each sheet gives every player's games for their own team and as a sub (from “4. Stats Entry”), starting salaries and divisions (Setup),
          end-of-season salaries and teams (Rankings), standings (Summary) and dates (Schedule). A history file downloaded from the Seasons tab can be imported here too.
        </p>
      </section>
      {items.map((it) => (
        <ImportCard key={it.id} item={it} patch={(p) => patch(it.id, p)} remove={() => setItems((xs) => xs.filter((x) => x.id !== it.id))} />
      ))}
      {items.some((x) => x.status === "saved") && <p><Link to={`${base}/seasons`}>See all seasons</Link> · <Link to={`${base}/names`}>Check names</Link></p>}
    </>
  );
}

function ImportCard({ item, patch, remove }: { item: Item; patch: (p: Partial<Item>) => void; remove: () => void }) {
  const { slug, base, seasons, names, people, find } = useHistory();
  const s = item.sheet?.season;

  // People new to the history, and who each might be: someone already in it, or another spelling in this sheet.
  const checks = useMemo(() => {
    if (!s) return { fresh: 0, ask: [] as { name: string; options: { name: string; why: string }[] }[] };
    const ruledOut = new Set(names.distinct);
    const fresh = s.players.filter((p) => !find(p.name));
    const games = (p: HistoryPlayer) => p.own.gp + p.sub.gp;
    const ask = fresh.map((p) => {
      const others = [
        ...people.map((c) => c.name),
        // Within the sheet, the spelling with fewer games is the one asked about.
        ...fresh.filter((o) => o !== p && (games(o) > games(p) || (games(o) === games(p) && o.name < p.name))).map((o) => o.name),
      ];
      const options = others.filter((o) => !ruledOut.has(pairKey(p.name, o)))
        .map((o) => ({ name: o, why: samePerson(p.name, o) })).filter((o): o is { name: string; why: string } => !!o.why);
      return { name: p.name, options };
    }).filter((x) => x.options.length);
    return { fresh: fresh.length, ask };
  }, [s, people, names, find]);

  const id = item.name.trim() ? sheetSeasonId(item.name.trim()) : "";
  const existing = seasons.find((x) => x.id === id);

  const save = async () => {
    if (item.restore) return restore();
    if (!s || !item.name.trim()) return;
    if (existing && !(await askConfirm(`“${existing.name}” is already in the history. Replace it with this sheet?`, { ok: "Replace" }))) return;
    patch({ status: "saving", error: undefined });
    try {
      let n = names;
      for (const [from, to] of Object.entries(item.picks)) if (to) n = withMerge(n, from, find(to)?.name ?? to);
      await saveHistorySeason(slug, { ...s, id, name: item.name.trim(), updatedAt: new Date().toISOString() });
      if (n !== names) await saveHistoryMeta(slug, n);
      patch({ status: "saved", savedId: id });
    } catch (e) { patch({ status: "ready", error: message(e) }); }
  };
  const restore = async () => {
    const r = item.restore!;
    const clash = r.seasons.filter((x) => seasons.some((y) => y.id === x.id));
    if (clash.length && !(await askConfirm(`${clash.length} of these season${clash.length === 1 ? " is" : "s are"} already in the history (${clash.map((x) => x.name).join(", ")}). Replace ${clash.length === 1 ? "it" : "them"} with the file's copy?`, { ok: "Replace" }))) return;
    patch({ status: "saving", error: undefined });
    try {
      await saveHistorySeasons(slug, r.seasons);
      let n = names;
      for (const a of r.names.aliases) n = withMerge(n, a.from, a.to);
      n = { ...n, distinct: [...new Set([...n.distinct, ...r.names.distinct])], hidden: [...new Set([...(n.hidden ?? []), ...(r.names.hidden ?? [])])] };
      await saveHistoryMeta(slug, n);
      patch({ status: "saved" });
    } catch (e) { patch({ status: "ready", error: message(e) }); }
  };

  return (
    <section className="card import-card" aria-busy={item.status === "reading" || item.status === "saving"}>
      <div className="row gap-sm wrap">
        <span className="muted small grow">{item.file}</span>
        {item.status !== "saving" && <button className="link small" onClick={remove}>{item.status === "saved" ? "Hide" : "Remove"}</button>}
      </div>
      {item.status === "reading" && <Loading label="Reading the sheet…" />}
      {item.status === "error" && <p className="error">{item.error}</p>}

      {item.restore && item.status !== "reading" && (
        <>
          <h2>History file{item.restore.league ? ` from ${item.restore.league}` : ""}</h2>
          <p>{item.restore.seasons.length} season{item.restore.seasons.length === 1 ? "" : "s"}: {[...item.restore.seasons].sort(seasonOrder).map((x) => x.name).join(", ")}.
            {" "}{item.restore.names.aliases.length} merged name{item.restore.names.aliases.length === 1 ? "" : "s"}.</p>
        </>
      )}

      {s && item.status !== "reading" && (
        <>
          <label className="field"><span>Season name</span>
            <input className="title-in" value={item.name} disabled={item.status !== "ready"} onChange={(e) => patch({ name: e.target.value })} /></label>
          <p className="muted">
            {dates(s)} · {s.weeks} weeks counted · {s.players.filter((p) => p.own.gp + p.sub.gp > 0).length} players with games
            {s.teams.length > 0 && <> · {s.teams.map((t) => `${shortTeam(t.team)} ${record(t)}`).join(", ")}</>}
          </p>
          {existing && item.status === "ready" && <p className="attn small">“{existing.name}” is already in the history; saving replaces it.</p>}
          {item.sheet!.notes.length > 0 && <ul className="issues">{item.sheet!.notes.map((n) => <li key={n} className="attn">{n}</li>)}</ul>}

          {item.status === "ready" && (
            <div className="name-checks">
              <h3>Names</h3>
              <p className="small">
                {checks.fresh === 0 ? "Everyone in this sheet is already in the history." : <>{checks.fresh} {checks.fresh === 1 ? "person is" : "people are"} new to the history.</>}
                {checks.ask.length > 0 && " These look like another spelling of someone already in the history or in this sheet: choose who they are, or leave them as new people. You can change this later on the Names tab."}
              </p>
              {checks.ask.length > 0 && (
                <ul className="plain small">
                  {checks.ask.map((a) => (
                    <li key={a.name} className="row gap-sm wrap">
                      <strong>{a.name}</strong>
                      <select value={item.picks[a.name] ?? ""} onChange={(e) => patch({ picks: { ...item.picks, [a.name]: e.target.value } })} aria-label={`Who ${a.name} is`}>
                        <option value="">a new person</option>
                        {a.options.map((o) => <option key={o.name} value={o.name}>same as {o.name} ({o.why})</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {item.error && item.status !== "error" && <p className="error">{item.error}</p>}
      {(item.status === "ready" || item.status === "saving") && (
        <button className="primary" disabled={item.status === "saving" || (!!s && !item.name.trim())} aria-busy={item.status === "saving"} onClick={save}>
          {item.status === "saving" ? "Saving…" : item.restore ? "Import this history" : existing ? "Replace in history" : "Save to history"}
        </button>
      )}
      {item.status === "saved" && (
        <p className="ok-text">Saved{item.savedId ? <>: <Link to={`${base}/seasons/${encodeURIComponent(item.savedId)}`}>{item.name.trim()}</Link></> : "."}</p>
      )}
    </section>
  );
}
