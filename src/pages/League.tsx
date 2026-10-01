import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createLeague, getLeague, lock, unlock, watchRole, type League, type Role } from "../lib/league";
import { newLeagueProblem, slugFrom } from "../lib/leagueForm";
import { rememberLeague } from "../lib/recentLeagues";
import { Passwords, ROLE_LABEL } from "./LeagueSettings";

/** Create a league: a name, a link name, and the two passwords. */
export function NewLeague() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [stat, setStat] = useState("");
  const [admin, setAdmin] = useState("");
  const [admin2, setAdmin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = slugTouched ? slug : slugFrom(name);
  const problem = newLeagueProblem({ name, slug: link, stat, admin, admin2 });

  return (
    <main className="page narrow">
      <p className="crumbs"><Link to="/">Seasons</Link> /</p>
      <h1>Create a league online</h1>
      <p className="muted">Anyone with the league's link can see its standings and stats. The stats-entry password lets a tablet record games; the admin password allows everything else. You can change either one later.</p>
      <section className="card">
        <div className="fields">
          <label className="field"><span>League name</span><input id="lg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="EUPA Fall League" /></label>
          <label className="field"><span>Link name</span>
            <input id="lg-slug" value={link} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} placeholder="eupa-fall" />
            <small className="muted">The league's address ends in <code>/l/{link || "…"}</code>.</small></label>
          <label className="field"><span>Stats-entry password</span><input id="lg-stat" type="password" autoComplete="new-password" value={stat} onChange={(e) => setStat(e.target.value)} />
            <small className="muted">For the volunteers with the tablets.</small></label>
          <label className="field"><span>Admin password</span><input id="lg-admin" type="password" autoComplete="new-password" value={admin} onChange={(e) => setAdmin(e.target.value)} /></label>
          <label className="field"><span>Admin password again</span><input id="lg-admin2" type="password" autoComplete="new-password" value={admin2} onChange={(e) => setAdmin2(e.target.value)} /></label>
        </div>
        {(error || (problem && (stat || admin))) && <p className="error">{error ?? problem}</p>}
        <button className="primary" disabled={!!problem || busy} onClick={async () => {
          setBusy(true); setError(null);
          try { await createLeague(link, name, stat, admin); rememberLeague(link, name.trim()); nav(`/l/${link}`); }
          catch (e) { setError((e as Error).message); setBusy(false); }
        }}>{busy ? "Creating…" : "Create league"}</button>
      </section>
    </main>
  );
}

/** A league's home: its seasons, and unlocking this device for stats entry or admin. */
export function LeagueHome() {
  const { slug = "" } = useParams();
  const [league, setLeague] = useState<League | null | undefined>(undefined);
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getLeague(slug).then((l) => { if (!live) return; setLeague(l); if (l) rememberLeague(slug, l.name); })
      .catch((e) => live && setError((e as Error).message));
    const stop = watchRole(slug, (r) => live && setRole(r));
    return () => { live = false; stop(); };
  }, [slug]);

  if (error) return <main className="page narrow"><p className="error">{error}</p><Link to="/">Back to seasons</Link></main>;
  if (league === undefined) return <p className="muted pad">Loading league…</p>;
  if (league === null) return <main className="page narrow"><p>There's no league called “{slug}”.</p><Link to="/">Back to seasons</Link></main>;

  return (
    <main className="page narrow">
      <p className="crumbs"><Link to="/">Seasons</Link> /</p>
      <h1>{league.name}</h1>
      <p className="muted">
        {role ? <>This device is unlocked for <strong>{ROLE_LABEL[role].toLowerCase()}</strong>.</> : role === null ? "Anyone with this link can see the standings and stats." : ""}
        {role && <> <button className="link" onClick={() => lock(slug)}>Lock this device</button></>}
      </p>

      <section className="card">
        <h2>Seasons</h2>
        {league.seasons.length ? (
          <ul className="plain season-links">{league.seasons.map((s) => (
            <li key={s.id}><Link to={`/l/${slug}/s/${s.id}`}>{s.name}</Link> · <Link to={`/l/${slug}/p/${s.id}`} className="small">Player stats</Link></li>
          ))}</ul>
        ) : <p className="muted">No seasons online yet.{role === "admin" ? " Open a season from this device's list and choose “Move this season online”." : ""}</p>}
      </section>

      {role !== "admin" && <UnlockCard slug={slug} current={role ?? null} />}
      {/* Once the league has a season, its settings live in that season's Admin → Setup. */}
      {role === "admin" && (league.seasons.length
        ? <p className="muted small">The league's name and passwords are in a season's Admin → Setup.</p>
        : <PasswordsCard slug={slug} />)}
    </main>
  );
}

function UnlockCard({ slug, current }: { slug: string; current: Role | null }) {
  const [which, setWhich] = useState<Role>(current === "stat" ? "admin" : "stat");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card">
      <h2>Unlock this device</h2>
      <p className="muted small">Enter a password once; this device remembers it until it's locked or the password changes.</p>
      <div className="seg" role="group" aria-label="Unlock for">
        {(["stat", "admin"] as Role[]).filter((r) => r !== current).map((r) => (
          <button key={r} aria-pressed={which === r} onClick={() => setWhich(r)}>{ROLE_LABEL[r]}</button>
        ))}
      </div>
      <div className="row gap-sm wrap unlock-row">
        <input type="password" aria-label={`${ROLE_LABEL[which]} password`} placeholder="Password" value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }} />
        <button className="primary" disabled={!password || busy} onClick={async () => {
          setBusy(true);
          try { await unlock(slug, which, password); setPassword(""); setError(null); }
          catch (e) { setError((e as Error).message); }
          setBusy(false);
        }}>Unlock</button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function PasswordsCard({ slug }: { slug: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card">
      <Passwords slug={slug} onMessage={(m, e) => { setMsg(m); setError(e); }} />
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
