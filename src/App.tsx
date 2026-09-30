import { lazy, Suspense, useEffect, useState } from "react";
import { HashRouter, NavLink, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ConfirmHost } from "./lib/confirm";
import { SeasonProvider, useSeason } from "./lib/SeasonContext";
import { downloadJson } from "./lib/store";

// Each screen loads when first opened, so the recorder on a tablet doesn't wait for the rest.
const GameDetail = lazy(() => import("./pages/GameDetail").then((m) => ({ default: m.GameDetail })));
const Games = lazy(() => import("./pages/Games").then((m) => ({ default: m.Games })));
const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const Names = lazy(() => import("./pages/Names").then((m) => ({ default: m.Names })));
const NewSeason = lazy(() => import("./pages/NewSeason").then((m) => ({ default: m.NewSeason })));
const Overview = lazy(() => import("./pages/Overview").then((m) => ({ default: m.Overview })));
const PlayerDetail = lazy(() => import("./pages/PlayerDetail").then((m) => ({ default: m.PlayerDetail })));
const Players = lazy(() => import("./pages/Players").then((m) => ({ default: m.Players })));
const Record = lazy(() => import("./pages/Record").then((m) => ({ default: m.Record })));
const Recordings = lazy(() => import("./pages/Recordings").then((m) => ({ default: m.Recordings })));
const Setup = lazy(() => import("./pages/Setup").then((m) => ({ default: m.Setup })));
const Stats = lazy(() => import("./pages/Stats").then((m) => ({ default: m.Stats })));
const Subs = lazy(() => import("./pages/Subs").then((m) => ({ default: m.Subs })));

// Hash routing keeps the build a plain folder of static files: no server rewrites needed.
export function App() {
  return (
    <HashRouter>
      <ConfirmHost />
      <Suspense fallback={<p className="muted pad">Loading…</p>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewSeason />} />
        <Route path="/s/:id" element={<SeasonShell />}>
          <Route index element={<Overview />} />
          <Route path="record" element={<Record />} />
          <Route path="players" element={<Players />} />
          <Route path="players/:name" element={<PlayerDetail />} />
          <Route path="games" element={<Games />} />
          <Route path="games/:week/:a/:b" element={<GameDetail />} />
          <Route path="subs" element={<Subs />} />
          <Route path="names" element={<Names />} />
          <Route path="recordings" element={<Recordings />} />
          <Route path="stats" element={<Stats />} />
          <Route path="setup" element={<Setup />} />
        </Route>
        <Route path="*" element={<p className="pad">Page not found. <a href="#/">Seasons</a></p>} />
      </Routes>
      </Suspense>
    </HashRouter>
  );
}

function SeasonShell() {
  const { id = "" } = useParams();
  const { pathname } = useLocation();
  return (
    <ErrorBoundary reset={id}>
      <SeasonProvider id={id}>
        <Header />
        <SeasonScreen reset={pathname} />
      </SeasonProvider>
    </ErrorBoundary>
  );
}

/** One screen's crash stays in that screen; the header and the season remain usable. */
function SeasonScreen({ reset }: { reset: string }) {
  const { season } = useSeason();
  return (
    <ErrorBoundary reset={reset} onExport={() => downloadJson(`${season.name}.json`, season)}>
      <Suspense fallback={<p className="muted pad">Loading…</p>}><Outlet /></Suspense>
    </ErrorBoundary>
  );
}

function Header() {
  const { season, nameIssueCount } = useSeason();
  const online = useOnline();
  const base = `/s/${season.id}`;
  const tabs: [string, string][] = [["", "Overview"], ["/record", "Record"], ["/players", "Players"], ["/games", "Games"], ["/subs", "Subs"], ["/names", "Names"], ["/recordings", "Recordings"], ["/stats", "Player stats"], ["/setup", "Setup"]];
  return (
    <header className="app-header">
      <div className="header-bar">
        <div className="header-top">
          <NavLink to="/" className="brand" aria-label="EUPA Stats, all seasons"><span className="brand-badge">EUPA</span>Stats</NavLink>
          <span className="season-title">{season.name}</span>
          <span className="grow" />
          {!online && <span className="offline-pill" title="Everything still saves on this device">Offline</span>}
          <button className="small-btn" onClick={() => downloadJson(`${season.name}.json`, season)}>Export</button>
        </div>
      </div>
      <div className="tab-bar">
        <nav className="tabs">
          {tabs.map(([to, label]) => <NavLink key={to} to={base + to} end={to === ""}>
            {label}{to === "/names" && nameIssueCount > 0 && <span className="badge" aria-label={`${nameIssueCount} to review`}>{nameIssueCount}</span>}
          </NavLink>)}
        </nav>
      </div>
    </header>
  );
}

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
}
