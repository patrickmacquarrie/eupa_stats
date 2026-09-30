import { useMemo, useState } from "react";
import { PublicStatsView } from "../components/PublicStatsView";
import { DEFAULT_PUBLIC, buildSnapshot } from "../lib/publicStats";
import { useSeason } from "../lib/SeasonContext";

/** The player-facing stats, as the public page will show them, and the way to update that page. */
export function Stats() {
  const { season, input, result } = useSeason();
  const snapshot = useMemo(() => buildSnapshot(season.name, input, result, season.publicStats ?? DEFAULT_PUBLIC), [season, input, result]);
  const [copied, setCopied] = useState<"yes" | "manual" | null>(null);
  const text = JSON.stringify(snapshot);

  const copy = async () => {
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
          <button className="primary" onClick={copy}>Copy stats for the public page</button>
        </div>
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
