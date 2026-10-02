// The site's three ways in: the main page (player stats), /stats (tablets) and /admin.
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { getLeague, watchRole, type Role } from "../lib/league";
import { watchMain, type MainSeason } from "../lib/site";
import { loadDraft } from "../lib/store";
import { shortTeam } from "../lib/format";
import type { Draft } from "../lib/recorder";
import { UnlockCard } from "./League";
import { PublicPage, PublicShell } from "./PublicPage";
import { Loading } from "../components/Loading";

function useMain() {
  const [main, setMain] = useState<MainSeason | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => watchMain(setMain, (e) => setError(e.message)), []);
  return { main, error };
}

/** The site's main page: the main season's player stats. */
export function MainPage() {
  const { main, error } = useMain();
  if (main) return <><ContinueGame main={main} /><PublicPage slug={main.league} sid={main.season} /></>;
  return (
    <PublicShell>
      {error ? <p className="error">{error}</p> : main === undefined ? <Loading /> : (
        <p className="empty">Player stats appear here once a league admin puts a season online.</p>
      )}
    </PublicShell>
  );
}

/** A tablet that reopens here (a home-screen icon, a restored tab) with a game still open on it. */
function ContinueGame({ main }: { main: MainSeason }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => { loadDraft(`l:${main.league}:${main.season}`).then((d) => setDraft(d?.events && d.present !== undefined ? d : null)).catch(() => {}); }, [main.league, main.season]);
  if (!draft) return null;
  return (
    <div className="continue-game" role="status">
      <span>A game is open on this device: <strong>{shortTeam(draft.team)} v {shortTeam(draft.opp)}</strong>, {draft.events.length} plays.</span>
      <Link to={`/l/${main.league}/s/${main.season}/record`} className="button-link primary">Continue recording</Link>
    </div>
  );
}

/** /stats: a tablet unlocks once with the stats-entry password, then goes straight to Track Stats. */
export function StatsEntry() {
  const { main, error } = useMain();
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  useEffect(() => (main ? watchRole(main.league, setRole) : undefined), [main?.league]);

  if (error) return <main className="page narrow"><p className="error">{error}</p></main>;
  if (main === undefined || (main && role === undefined)) return <Loading pad />;
  if (!main) return <main className="page narrow"><h1>Stats entry</h1><p>No season is online yet. A league admin sets one up under <Link to="/admin">League admin</Link>.</p></main>;
  if (role) return <Navigate to={`/l/${main.league}/s/${main.season}/record`} replace />;
  return (
    <main className="page narrow">
      <p className="crumbs"><Link to="/">Player stats</Link> /</p>
      <h1>Stats entry</h1>
      <p className="muted">Enter the stats-entry password once; this tablet remembers it.</p>
      <UnlockCard slug={main.league} current={null} />
    </main>
  );
}

/** /admin: a shortcut to the main season online, above this browser's own seasons. */
export function MainSeasonLink() {
  const { main } = useMain();
  const [names, setNames] = useState<{ league: string; season: string } | null>(null);
  useEffect(() => {
    if (!main) return;
    getLeague(main.league).then((l) => l && setNames({ league: l.name, season: l.seasons.find((s) => s.id === main.season)?.name ?? main.season })).catch(() => {});
  }, [main?.league, main?.season]);
  if (!main || !names) return null;
  return (
    <section className="card main-season">
      <h2>Online</h2>
      <p><Link to={`/l/${main.league}/s/${main.season}`} className="season-name">{names.season}</Link> <span className="muted small">{names.league} · on the main page</span></p>
      <p className="muted small">Other seasons online are on the <Link to={`/l/${main.league}`}>league page</Link>.</p>
    </section>
  );
}
