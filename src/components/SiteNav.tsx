import { Link } from "react-router-dom";

/** The site's three places, in the band's right corner: player stats, stats entry and admin. */
export function SiteNav({ current }: { current: "stats" | "entry" | "admin" }) {
  const items: [typeof current, string, string][] = [["stats", "/", "Player stats"], ["entry", "/stats", "Stats entry"], ["admin", "/admin", "Admin"]];
  return (
    <nav className="site-nav" aria-label="EUPA Stats">
      {items.filter(([k]) => k !== current).map(([k, to, label]) => <Link key={k} to={to}>{label}</Link>)}
    </nav>
  );
}
