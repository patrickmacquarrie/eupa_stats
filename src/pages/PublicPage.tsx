import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PublicStatsView } from "../components/PublicStatsView";
import { watchPublic } from "../lib/onlineSeason";
import type { Snapshot } from "../lib/publicStats";

/** The player stats page for one season: standings, leaderboards and totals, kept current by the league's devices. */
export function PublicPage({ slug: slugProp, sid: sidProp }: { slug?: string; sid?: string }) {
  const params = useParams();
  const slug = slugProp ?? params.slug ?? "", sid = sidProp ?? params.sid ?? "";
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => watchPublic(slug, sid, setSnap, (e) => setError(e.message)), [slug, sid]);

  return (
    <PublicShell>
      {error ? <p className="error">{error}</p>
        : snap === undefined ? <p className="muted">Loading…</p>
        : snap === null ? <p className="empty">No stats published for this season yet.</p>
        : <PublicStatsView snapshot={snap} />}
    </PublicShell>
  );
}

/** The public pages' band and footer; the footer has the way in for volunteers and admins. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="pub-shell">
      <header className="pub-band">
        <div className="pub-band-inner">
          <span className="brand-badge">EUPA</span>
          <span className="pub-band-name">Player stats</span>
        </div>
      </header>
      <main className="page">{children}</main>
      <footer className="pub-foot muted small"><Link to="/stats">Stats entry</Link> · <Link to="/admin">League admin</Link></footer>
    </div>
  );
}
