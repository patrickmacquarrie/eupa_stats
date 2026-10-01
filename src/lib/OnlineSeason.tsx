// A season kept online: the same screens as a season kept in this browser, reading and writing
// Firestore. Loaded only for online seasons, so Firebase stays out of the local app.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { deviceId } from "./firebase";
import { getLeague, watchRole, type Role } from "./league";
import { deleteRecording, publishSnapshot, pushRecording, saveSeasonOnline, watchSeason, watchSynced, type Remote } from "./onlineSeason";
import { seasonSnapshot } from "./publicStats";
import { assemble, recKey } from "./onlineShape";
import { rememberLeague } from "./recentLeagues";
import { SeasonView, useSeason, type OnlineCtx } from "./SeasonContext";
import { weekOfDate, type Season } from "./season";

const message = (e: unknown) => {
  const code = (e as { code?: string }).code;
  return code === "permission-denied" ? "This device isn't unlocked for that. Enter the league's admin password on the league page." : (e as Error).message;
};

export default function OnlineSeasonProvider({ slug, sid, children }: { slug: string; sid: string; children: ReactNode }) {
  const [remote, setRemote] = useState<Remote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [uid, setUid] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => watchSeason(slug, sid, setRemote, (e) => setLoadError(message(e))), [slug, sid]);
  useEffect(() => watchRole(slug, setRole), [slug]);
  useEffect(() => { deviceId().then(setUid).catch(() => {}); }, []);
  useEffect(() => { getLeague(slug).then((l) => l && rememberLeague(slug, l.name)).catch(() => {}); }, [slug]);

  const season = useMemo<Season | null>(() => (remote?.seasonDoc ? assemble(remote.seasonDoc, [...remote.recs.values()]) : null), [remote]);
  const remoteRef = useRef(remote);
  remoteRef.current = remote;

  // Firestore shows a write at once (even offline) and sends it when it can; a refusal arrives later.
  const persist = useCallback(async (next: Season) => {
    if (role !== "admin") { setSaveError("This device isn't unlocked for changes. Enter the league's admin password on the league page."); return; }
    setSaveError(null);
    saveSeasonOnline(slug, next, remoteRef.current!).catch((e) => setSaveError(message(e)));
  }, [slug, role]);

  const online = useMemo<OnlineCtx>(() => {
    const live = new Set<string>(), owners = new Map<string, string>();
    for (const r of remote?.recs.values() ?? []) {
      owners.set(recKey(r.date, r.team, r.opp), r.uid);
      const week = season ? weekOfDate(season.input.schedule, r.date) : null;
      if (r.status === "live" && week !== null) live.add(`${week}|${r.team}|${r.opp}`);
    }
    return {
      slug, role, uid, live, owners,
      pushRecording: (d, status, finish) => pushRecording(slug, sid, d, status, finish),
      deleteRecording: (d) => deleteRecording(slug, sid, d),
      watchSynced: (d, cb) => watchSynced(slug, sid, d, cb),
    };
  }, [remote, season, slug, sid, role, uid]);

  if (loadError) return <p className="pad">{loadError} <a href={`#/l/${slug}`}>Back to the league</a></p>;
  if (!remote?.ready) return <p className="muted pad">Loading season…</p>;
  if (!season) return <p className="pad">This league has no season “{sid}”. <a href={`#/l/${slug}`}>Back to the league</a></p>;
  return (
    <SeasonView season={season} persist={persist} saveError={saveError} base={`/l/${slug}/s/${sid}`} draftKey={`l:${slug}:${sid}`}
      canAdmin={role === "admin"} canRecord={role === "admin" || role === "stat"} online={online}>
      {role === "admin" && <PublishSnapshot slug={slug} sid={sid} />}
      {children}
    </SeasonView>
  );
}

/**
 * While an admin has the season open, their browser keeps the public page current: a few seconds
 * after the numbers change (an edit, or a tablet's recording arriving), it rebuilds the snapshot
 * and writes it if it differs from what's published.
 */
function PublishSnapshot({ slug, sid }: { slug: string; sid: string }) {
  const { season, input, result, provisional } = useSeason();
  const last = useRef<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      publishSnapshot(slug, sid, seasonSnapshot(season.name, input, result, season.publicStats, provisional), last).catch(() => { last.current = null; });
    }, 3000);
    return () => clearTimeout(t);
  }, [slug, sid, season, input, result, provisional]);
  return null;
}
