import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PublicStatsView } from "../components/PublicStatsView";
import { watchPublic } from "../lib/onlineSeason";
import type { Snapshot } from "../lib/publicStats";

/** The player stats page for one season: standings, leaderboards and totals, kept current by the league's admins. */
export function PublicPage() {
  const { slug = "", sid = "" } = useParams();
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => watchPublic(slug, sid, setSnap, (e) => setError(e.message)), [slug, sid]);

  return (
    <div className="pub-shell">
      <header className="pub-band">
        <div className="pub-band-inner">
          <span className="brand-badge">EUPA</span>
          <span className="pub-band-name">Player stats</span>
        </div>
      </header>
      <main className="page">
        {error ? <p className="error">{error}</p>
          : snap === undefined ? <p className="muted">Loading…</p>
          : snap === null ? <p className="empty">No stats published for this season yet.</p>
          : <PublicStatsView snapshot={snap} />}
      </main>
    </div>
  );
}
