import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PublicStatsView } from "../components/PublicStatsView";
import { parseSnapshot, snapshotProblems, type Snapshot } from "../lib/publicStats";
import { fullDocument, pageBody } from "./page";
import "../styles.css";

function readSnapshot(): Snapshot | null {
  try {
    const d = JSON.parse(document.getElementById("stats-data")?.textContent ?? "null");
    return d && snapshotProblems(d).length === 0 ? d : null;
  } catch { return null; }
}

type ArtifactNs = { publish: (html: string) => Promise<unknown> };

function App() {
  const [snapshot] = useState(readSnapshot);
  // The owner can update the stats from here; everyone else only reads.
  const [artifact, setArtifact] = useState<ArtifactNs | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    const claude = (window as any).claude;
    if (!claude?.use) return;
    claude.use("artifact").then((a: ArtifactNs | null) => setArtifact(a)).catch(() => {});
    claude.use("user").then(async (u: any) => setCanEdit(u ? await u.canEdit() : true)).catch(() => setCanEdit(true));
  }, []);

  return (
    <>
    <header className="pub-band"><div className="pub-band-inner">
      <span className="brand-badge">EUPA</span>
      <span className="pub-band-name">Edmonton Ultimate Players Association</span>
      <span className="pub-band-sub">Player stats</span>
    </div></header>
    <main className="page">
      {snapshot ? <PublicStatsView snapshot={snapshot} /> : <p className="empty">No stats have been published yet.</p>}
      {artifact && canEdit && <UpdatePanel artifact={artifact} onReadOnly={() => setCanEdit(false)} />}
    </main>
    </>
  );
}

function UpdatePanel({ artifact, onReadOnly }: { artifact: ArtifactNs; onReadOnly: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  let parsed: Snapshot | null = null, problem: string | null = null;
  if (text.trim()) { try { parsed = parseSnapshot(text.trim()); } catch (e) { problem = (e as Error).message; } }

  const publish = async () => {
    if (!parsed) return;
    const css = document.getElementById("app-css")?.textContent, js = document.getElementById("app-js")?.textContent;
    if (!css || !js) { setMsg("This copy of the page can't update itself. Ask Claude to republish it."); return; }
    setBusy(true); setMsg(null);
    try {
      await artifact.publish(fullDocument(pageBody(css, js, parsed)));
      // The page reloads to the new version on its own.
    } catch (e: any) {
      if (e?.code === "not_writer" || e?.code === "not_granted") { onReadOnly(); return; }
      if (e?.code === "conflict") return; // someone else published; the page is reloading to theirs
      setMsg(e?.code === "rate_limited" ? "Too many updates in a row. Wait a minute and publish again." : `Couldn't publish (${e?.code ?? "error"}). Try again.`);
    } finally { setBusy(false); }
  };

  if (!open) return <p className="owner-bar"><button onClick={() => setOpen(true)}>Update stats</button> <span className="muted small">Only you see this.</span></p>;
  return (
    <section className="card owner-panel" aria-labelledby="upd-title">
      <h2 id="upd-title">Update stats</h2>
      <p className="muted small">In the league app, open <strong>Player stats</strong>, choose <strong>Copy stats for the public page</strong>, and paste here.</p>
      <textarea id="upd-text" className="copy-box" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the copied stats" aria-label="Copied stats" />
      {problem && <p className="error small">{problem}</p>}
      {parsed && <p className="small">{parsed.season}, through week {parsed.throughWeek}, {parsed.rows.length} players.</p>}
      {msg && <p className="error small">{msg}</p>}
      <div className="row gap-sm">
        <button onClick={() => { setOpen(false); setText(""); }}>Cancel</button>
        <button className="primary" disabled={!parsed || busy} onClick={publish}>{busy ? "Publishing…" : "Publish for everyone"}</button>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
