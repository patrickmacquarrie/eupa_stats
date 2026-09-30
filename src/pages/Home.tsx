import { useEffect, useState } from "react";
import { askConfirm } from "../lib/confirm";
import { Link, useNavigate } from "react-router-dom";
import fallUrl from "../../fixtures/fall-2026.json?url";
import thursdayUrl from "../../fixtures/thursday-s1-2026.json?url";
import plUrl from "../../fixtures/pl-2025.json?url";
import { seasonFromFixture, seasonFromJson, type SeasonMeta } from "../lib/season";
import { deleteSeason, downloadJson, listSeasons, loadSeason, saveSeason } from "../lib/store";

const DEMOS = [
  { name: "EUPA Fall 2026", detail: "weeks 1–4, 3 teams", url: fallUrl },
  { name: "EUPA Thursday S1 2026", detail: "weeks 1–8, trades mid-season", url: thursdayUrl },
  { name: "Premier League 2025", detail: "weeks 1–15, 6 teams, 39k events", url: plUrl },
];

export function Home() {
  const [seasons, setSeasons] = useState<SeasonMeta[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
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
      <h1>Seasons</h1>
      <p className="muted">
        Every salary, cap and box score is recalculated from the raw tablet recordings and the league's rules.
        Seasons are stored in this browser; export one to move it or back it up.
      </p>

      {seasons === null ? <p className="muted">Loading…</p> : seasons.length === 0 ? (
        <p className="empty">No seasons yet. Load a demo season below or import one.</p>
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

      <h2>Start a season</h2>
      <Link to="/new" className="card choice new-season">
        <strong>New season</strong>
        <span className="muted small">Paste your roster from a spreadsheet (players, genders, teams, starting salaries), set the schedule, pick the rules.</span>
      </Link>
      <h3>Or explore a demo season</h3>
      <div className="grid-3">
        {DEMOS.map((d) => (
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
