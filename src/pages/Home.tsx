import { lazy, Suspense, useEffect, useState } from "react";
import { askConfirm } from "../lib/confirm";
import { Link, useNavigate } from "react-router-dom";
import { recentLeagues } from "../lib/recentLeagues";
import { seasonFromFixture, seasonFromJson, type SeasonMeta } from "../lib/season";
import { deleteSeason, downloadJson, listSeasons, loadSeason, saveSeason } from "../lib/store";
import { Loading } from "../components/Loading";

const MainSeasonLink = lazy(() => import("./Entry").then((m) => ({ default: m.MainSeasonLink })));

type Demo = { name: string; detail: string; url: string };
/** Demo seasons exist only in demo builds; the import is removed from production builds. */
const loadDemos = (): Promise<Demo[]> => (import.meta.env.VITE_DEMOS === "true" ? import("../lib/demos").then((m) => m.DEMOS) : Promise.resolve([]));

export function Home() {
  const [seasons, setSeasons] = useState<SeasonMeta[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const [demos, setDemos] = useState<Demo[]>([]);
  useEffect(() => { loadDemos().then(setDemos); }, []);
  const refresh = () => listSeasons().then(setSeasons).catch((e) => { setSeasons([]); setError((e as Error).message); });
  useEffect(() => { refresh(); }, []);

  async function importFrom(label: string, get: () => Promise<any>, name: string) {
    setBusy(label); setError(null);
    try {
      const { season, notes } = seasonFromJson(await get(), name);
      await saveSeason(season);
      if (notes.length) sessionStorage.setItem(`notes:${season.id}`, notes.join("\n"));
      nav(`/s/${season.id}`);
    } catch (e) {
      setError(`${label}: ${(e as Error).message}`);
    } finally { setBusy(null); }
  }

  return (
    <>
    <header className="pub-band"><div className="pub-band-inner">
      <span className="brand-badge">EUPA</span>
      <span className="pub-band-name">Stats</span>
      <span className="pub-band-sub">Edmonton Ultimate Players Association</span>
    </div></header>
    <main className="page narrow">
      {/* Only a browser that has opened a league loads Firebase here. */}
      {recentLeagues().length > 0 && <Suspense fallback={null}><MainSeasonLink /></Suspense>}
      <h1>Seasons</h1>
      <p className="muted">
        Every salary, cap and box score is recalculated from the raw tablet recordings and the league's rules.
        Seasons are stored in this browser; export one to move it or back it up.
      </p>

      {seasons === null ? <Loading /> : seasons.length === 0 ? (
        <p className="empty">No seasons yet. Start a new season below, or import one you exported.</p>
      ) : (
        <ul className="season-list">
          {seasons.map((s) => (
            <li key={s.id} className="card row">
              <div className="grow">
                <Link to={`/s/${s.id}`} className="season-name">{s.name}</Link>
                <div className="muted small">Updated {new Date(s.updatedAt).toLocaleString("en-CA")}</div>
              </div>
              <button onClick={async () => { const x = await loadSeason(s.id); if (x) downloadJson(`${x.name}.json`, x); }}>Export</button>
              <button className="danger" onClick={async () => {
                if (await askConfirm(`Delete "${s.name}" from this browser? Export it first if you want a copy.`, { ok: "Delete", danger: true })) {
                  try { await deleteSeason(s.id); refresh(); } catch (e) { setError((e as Error).message); }
                }
              }}>Delete</button>
            </li>
          ))}
        </ul>
      )}

      <LeaguesOnline />

      <h2>Start a season</h2>
      <Link to="/new" className="card choice new-season">
        <strong>New season</strong>
        <span className="muted small">Paste your roster from a spreadsheet (players, genders, teams, starting salaries), set the schedule, pick the rules.</span>
      </Link>
      {demos.length > 0 && <h3>Or explore a demo season</h3>}
      <div className="grid-3">
        {demos.map((d) => (
          <button key={d.name} className="card choice" disabled={!!busy}
            onClick={() => importFrom(d.name, () => fetch(d.url).then((r) => r.json()), d.name)}>
            <strong>{busy === d.name ? "Loading…" : d.name}</strong>
            <span className="muted small">{d.detail}</span>
          </button>
        ))}
      </div>
      <label className="file-drop">
        <input type="file" accept=".json,application/json" disabled={!!busy} onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importFrom(f.name, async () => JSON.parse(await f.text()), f.name.replace(/\.json$/i, ""));
          e.target.value = "";
        }} />
        <strong>Import a season file</strong>
        <span className="muted small">A season exported from this app, or a master-sheet fixture from <code>scripts/extract_fixture.py</code>.</span>
      </label>
      {error && <p className="error pre-line">{error}</p>}
    </main>
    </>
  );
}

/** Leagues kept online, shared by every tablet and admin: the ones this browser has opened, and a way to open or create one. */
function LeaguesOnline() {
  const nav = useNavigate();
  const [slug, setSlug] = useState("");
  const leagues = recentLeagues();
  return (
    <section className="leagues-online">
      <h2>Leagues online</h2>
      {leagues.length > 0 && (
        <ul className="plain season-list">{leagues.map((l) => <li key={l.slug}><Link to={`/l/${l.slug}`} className="season-name">{l.name}</Link> <span className="muted small">/l/{l.slug}</span></li>)}</ul>
      )}
      <div className="row gap-sm wrap">
        <form className="row gap-sm" onSubmit={(e) => { e.preventDefault(); if (slug.trim()) nav(`/l/${slug.trim().toLowerCase()}`); }}>
          <input aria-label="League link name" placeholder="League link name, e.g. eupa-fall" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <button type="submit" disabled={!slug.trim()}>Open league</button>
        </form>
        <Link to="/new-league" className="button-link">Create a league online</Link>
      </div>
    </section>
  );
}
