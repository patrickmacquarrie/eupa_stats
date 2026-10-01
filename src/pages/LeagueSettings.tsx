// The league's own settings, at the bottom of Admin → Setup for an online season: its name, both
// passwords, and locking this device. Loaded only for online seasons.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { changePassword, getLeague, lock, passwordProblem, renameLeague, type Role } from "../lib/league";
import { rememberLeague } from "../lib/recentLeagues";

export const ROLE_LABEL: Record<Role, string> = { stat: "Stats entry", admin: "League admin" };

export default function LeagueSettings({ slug }: { slug: string }) {
  const nav = useNavigate();
  const [name, setName] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getLeague(slug).then((l) => { if (l) { setName(l.name); setSaved(l.name); } }).catch(() => {}); }, [slug]);

  return (
    <section className="card league-settings" aria-labelledby="league-title">
      <h2 id="league-title">League</h2>
      <p className="muted small">The league this season is in, at the link name <code>{slug}</code>. These settings apply to all its seasons.</p>
      {name !== null && (
        <div className="row gap-sm wrap unlock-row">
          <label className="field inline"><span>League name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button disabled={!name.trim() || name.trim() === saved} onClick={async () => {
            setMsg(null); setError(null);
            try { await renameLeague(slug, name); setSaved(name.trim()); rememberLeague(slug, name.trim()); setMsg("League renamed."); }
            catch (e) { setError((e as Error).message); }
          }}>Rename</button>
        </div>
      )}
      <Passwords slug={slug} onMessage={(m, e) => { setMsg(m); setError(e); }} />
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}
      <p className="small">
        <button className="link" onClick={async () => { await lock(slug); nav(`/l/${slug}`); }}>Lock this device</button>
        <span className="muted"> · it'll need a password again to record or change anything.</span>
      </p>
    </section>
  );
}

/** Change either password. Devices that unlocked with the old one are locked out at once. */
export function Passwords({ slug, onMessage }: { slug: string; onMessage: (msg: string | null, error: string | null) => void }) {
  const [pw, setPw] = useState<Record<Role, string>>({ stat: "", admin: "" });
  const change = async (role: Role) => {
    onMessage(null, null);
    try {
      await changePassword(slug, role, pw[role]);
      setPw({ ...pw, [role]: "" });
      onMessage(`${ROLE_LABEL[role]} password changed. Every device that used the old one has to enter the new one.`, null);
    } catch (e) { onMessage(null, (e as Error).message); }
  };
  return (
    <>
      <h3>Passwords</h3>
      <p className="muted small">Changing a password locks out every device that unlocked with the old one.</p>
      {(["stat", "admin"] as Role[]).map((r) => (
        <div key={r} className="row gap-sm wrap unlock-row">
          <label className="field inline"><span>New {ROLE_LABEL[r].toLowerCase()} password</span>
            <input type="password" autoComplete="new-password" value={pw[r]} onChange={(e) => setPw({ ...pw, [r]: e.target.value })} /></label>
          <button disabled={!!passwordProblem(pw[r])} onClick={() => change(r)}>Change</button>
        </div>
      ))}
    </>
  );
}
