import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { HashRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { adminCounts } from "./lib/review";
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
const AdminFrame = lazy(() => import("./pages/Admin").then((m) => ({ default: m.AdminFrame })));
const AdminReview = lazy(() => import("./pages/Admin").then((m) => ({ default: m.AdminReview })));
const NewLeague = lazy(() => import("./pages/League").then((m) => ({ default: m.NewLeague })));
const LeagueHome = lazy(() => import("./pages/League").then((m) => ({ default: m.LeagueHome })));
const PublicPage = lazy(() => import("./pages/PublicPage").then((m) => ({ default: m.PublicPage })));
const OnlineSeasonProvider = lazy(() => import("./lib/OnlineSeason"));
const Subs = lazy(() => import("./pages/Subs").then((m) => ({ default: m.Subs })));

/** Catches crashes outside a season (Seasons, New season) and pages that fail to load; resets on navigation. */
function RouteBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary reset={useLocation().pathname}>{children}</ErrorBoundary>;
}

// Hash routing keeps the build a plain folder of static files: no server rewrites needed.
export function App() {
  return (
    <HashRouter>
      <ConfirmHost />
      <RouteBoundary>
      <Suspense fallback={<p className="muted pad">Loading…</p>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewSeason />} />
        <Route path="/new-league" element={<NewLeague />} />
        <Route path="/l/:slug" element={<LeagueHome />} />
        <Route path="/l/:slug/p/:sid" element={<PublicPage />} />
        <Route path="/s/:id" element={<SeasonShell />}>{seasonRoutes()}</Route>
        <Route path="/l/:slug/s/:sid" element={<OnlineSeasonShell />}>{seasonRoutes()}</Route>
        <Route path="*" element={<p className="pad">Page not found. <a href="#/">Seasons</a></p>} />
      </Routes>
      </Suspense>
      </RouteBoundary>
    </HashRouter>
  );
}

/** The screens of a season, the same whether it's kept in this browser or online. */
function seasonRoutes() {
  return (
    <>
      <Route index element={<Overview />} />
      <Route path="record" element={<Record />} />
      <Route path="players" element={<Players />} />
      <Route path="players/:name" element={<PlayerDetail />} />
      <Route path="games" element={<Games />} />
      <Route path="games/:week/:a/:b" element={<GameDetail />} />
      <Route path="stats" element={<Stats />} />
      {/* Admin screens are flat routes, not nested, so their "../games" links still reach the season. */}
      <Route path="admin" element={<AdminFrame><AdminReview /></AdminFrame>} />
      <Route path="admin/names" element={<AdminFrame><Names /></AdminFrame>} />
      <Route path="admin/subs" element={<AdminFrame><Subs /></AdminFrame>} />
      <Route path="admin/recordings" element={<AdminFrame><Recordings /></AdminFrame>} />
      <Route path="admin/setup" element={<AdminFrame><Setup /></AdminFrame>} />
      {/* Old addresses, from bookmarks and earlier links. */}
      {["names", "subs", "recordings", "setup"].map((p) => <Route key={p} path={p} element={<Navigate to={`../admin/${p}`} replace />} />)}
    </>
  );
}

/** A season kept online. Firebase loads with it, not with the rest of the app. */
function OnlineSeasonShell() {
  const { slug = "", sid = "" } = useParams();
  const { pathname } = useLocation();
  return (
    <ErrorBoundary reset={`${slug}/${sid}`}>
      <Suspense fallback={<p className="muted pad">Loading season…</p>}>
        <OnlineSeasonProvider slug={slug} sid={sid}>
          <Header />
          <SeasonScreen reset={pathname} />
        </OnlineSeasonProvider>
      </Suspense>
    </ErrorBoundary>
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
  const { season, nameIssueCount, open, result, base, canAdmin, canRecord, online: league } = useSeason();
  const online = useOnline();
  const admin = adminCounts(open, nameIssueCount, result.warnings.length, league?.unfinished.length).total;
  const tabs: [string, string][] = [["", "Overview"], ["/players", "Players"], ["/games", "Games"], ["/stats", "Player stats"], ...(canAdmin ? [["/admin", "Admin"] as [string, string]] : [])];
  return (
    <header className="app-header">
      <div className="header-bar">
        <div className="header-top">
          <BackButton />
          <NavLink to="/" className="brand" aria-label="EUPA Stats, all seasons"><span className="brand-badge">EUPA</span>Stats</NavLink>
          <span className="season-title">{season.name}</span>
          <span className="grow" />
          {!online && <span className="offline-pill" title="Everything still saves on this device">Offline</span>}
          {/* What this device can do; only a locked device links to the league page, to unlock. */}
          {league && (league.role
            ? <span className="role-pill" title="This device's access to the league">{league.role === "admin" ? "Admin" : "Stats entry"}</span>
            : <NavLink to={`/l/${league.slug}`} className="role-pill">View only · Unlock</NavLink>)}
          <button className="small-btn" onClick={() => downloadJson(`${season.name}.json`, season)}>Export</button>
        </div>
      </div>
      <div className="tab-bar">
        <div className="tab-row">
          <nav className="tabs">
            {tabs.map(([to, label]) => <NavLink key={to} to={base + to} end={to === ""}>
              {label}{to === "/admin" && admin > 0 && <span className="badge alert" aria-label={`${admin} to review`}>{admin}</span>}
            </NavLink>)}
          </nav>
          <NavLink to={canRecord ? base + "/record" : `/l/${league?.slug}`} className="track-stats"
            title={canRecord ? undefined : "Enter the league's stats-entry password to record games"}>Track Stats</NavLink>
        </div>
      </div>
    </header>
  );
}

/** One screen back, like the browser's Back; hidden on the first screen opened. */
function BackButton() {
  const nav = useNavigate();
  if (useLocation().key === "default") return null;
  return <button className="back-btn" onClick={() => nav(-1)} aria-label="Back" title="Back">←</button>;
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
