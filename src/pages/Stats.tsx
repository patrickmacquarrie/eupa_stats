import { useMemo, useState } from "react";
import { PublicStatsView } from "../components/PublicStatsView";
import { Link } from "react-router-dom";
import { seasonSnapshot } from "../lib/publicStats";
import { askConfirm } from "../lib/confirm";
import { useSeason } from "../lib/SeasonContext";

/** The player-facing stats, as the public page will show them, and the way to update that page. */
export function Stats() {
  const { season, input, result, provisional, online } = useSeason();
  const snapshot = useMemo(() => seasonSnapshot(season.name, input, result, season.publicStats, provisional), [season, input, result, provisional]);
  const [copied, setCopied] = useState<"yes" | "manual" | null>(null);
  const text = JSON.stringify(snapshot);

  const copy = async () => {
    const weeks = snapshot.provisionalWeeks ?? [];
    if (weeks.length && !(await askConfirm(`Week ${weeks.join(", ")} still ${weeks.length > 1 ? "have" : "has"} open items (see Overview), so those numbers can change. Copy anyway? The public page will say they're provisional.`, { ok: "Copy anyway" }))) return;
    try { await navigator.clipboard.writeText(text); setCopied("yes"); }
    catch { setCopied("manual"); }
  };

  return (
    <main className="page">
      <section className="card share-card">
        <div className="row wrap gap-sm">
          <div className="grow">
            <h2>Player stats page</h2>
            <p className="muted small">
              This is what players see. The shareable page shows only this: no salaries, rules or recordings.
              Choose the columns and leaderboards on the Setup tab.
            </p>
          </div>
          {online
            ? <Link className="button-link" to={`/l/${online.slug}/p/${season.id}`}>Open the public page</Link>
            : <button className="primary" onClick={copy}>Copy stats for the public page</button>}
        </div>
        {online && <p className="muted small">The public page updates itself a few seconds after an admin's browser sees a change. Anyone with its link can open it; it shows only these stats, never salaries or rules.</p>}
        {copied === "yes" && (
          <p className="note small">Copied. Open the public stats page, choose <strong>Update stats</strong>, paste, and publish.</p>
        )}
        {copied === "manual" && (
          <div className="note small">
            <p>This browser didn't allow copying. Select all of the text below, copy it, then paste it into <strong>Update stats</strong> on the public page.</p>
            <textarea className="copy-box" readOnly value={text} onFocus={(e) => e.currentTarget.select()} aria-label="Stats to copy" />
          </div>
        )}
      </section>
      <PublicStatsView snapshot={snapshot} />
    </main>
  );
}
