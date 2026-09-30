import { HashRouter, NavLink, Outlet, Route, Routes, useParams } from "react-router-dom";
import { ConfirmHost } from "./lib/confirm";
import { SeasonProvider, useSeason } from "./lib/SeasonContext";
import { downloadJson } from "./lib/store";
import { GameDetail } from "./pages/GameDetail";
import { Games } from "./pages/Games";
import { Home } from "./pages/Home";
import { Names } from "./pages/Names";
import { Overview } from "./pages/Overview";
import { PlayerDetail } from "./pages/PlayerDetail";
import { Players } from "./pages/Players";
import { Record } from "./pages/Record";
import { Recordings } from "./pages/Recordings";
import { Setup } from "./pages/Setup";
import { Stats } from "./pages/Stats";
import { Subs } from "./pages/Subs";

// Hash routing keeps the build a plain folder of static files: no server rewrites needed.
export function App() {
  return (
    <HashRouter>
      <ConfirmHost />
      <Routes>
        <Route path="/" element={<Home />} />
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
    </HashRouter>
  );
}

function SeasonShell() {
  const { id = "" } = useParams();
  return (
    <SeasonProvider id={id}>
      <Header />
      <Outlet />
    </SeasonProvider>
  );
}

function Header() {
  const { season, nameIssueCount } = useSeason();
  const base = `/s/${season.id}`;
  const tabs: [string, string][] = [["", "Overview"], ["/record", "Record"], ["/players", "Players"], ["/games", "Games"], ["/subs", "Subs"], ["/names", "Names"], ["/recordings", "Recordings"], ["/stats", "Player stats"], ["/setup", "Setup"]];
  return (
    <header className="app-header">
      <div className="header-top">
        <NavLink to="/" className="brand">EUPA Stats</NavLink>
        <span className="season-title">{season.name}</span>
        <span className="grow" />
        <button className="small-btn" onClick={() => downloadJson(`${season.name}.json`, season)}>Export</button>
      </div>
      <nav className="tabs">
        {tabs.map(([to, label]) => <NavLink key={to} to={base + to} end={to === ""}>
          {label}{to === "/names" && nameIssueCount > 0 && <span className="badge" aria-label={`${nameIssueCount} to review`}>{nameIssueCount}</span>}
        </NavLink>)}
      </nav>
    </header>
  );
}
