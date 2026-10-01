// Reading and writing a season online. See onlineShape.ts for how a season maps to documents.
import {
  arrayUnion, collection, deleteDoc, doc, getDoc, onSnapshot, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
import type { Draft } from "./recorder";
import { deviceId, firebase } from "./firebase";
import { getLeague, leagueRef } from "./league";
import { recId, split, stable, type RecordingBody, type RecordingDoc } from "./onlineShape";
import type { Snapshot } from "./publicStats";
import { SEASON_SCHEMA, type SavedFlag, type Season } from "./season";

const seasonRef = (slug: string, sid: string) => doc(firebase().db, "leagues", slug, "seasons", sid);
const recsRef = (slug: string, sid: string) => collection(firebase().db, "leagues", slug, "seasons", sid, "recordings");
const recRef = (slug: string, sid: string, id: string) => doc(recsRef(slug, sid), id);

export interface Remote {
  seasonDoc: Season | null;
  recs: Map<string, RecordingDoc>;
  /** False until both the season and its recordings have loaded (from the server or this device's copy). */
  ready: boolean;
}

/** Live view of a season and its recordings. Works offline from this device's copy. */
export function watchSeason(slug: string, sid: string, onChange: (r: Remote) => void, onError: (e: Error) => void) {
  let seasonDoc: Season | null = null, recs = new Map<string, RecordingDoc>();
  let gotSeason = false, gotRecs = false;
  const emit = () => onChange({ seasonDoc, recs, ready: gotSeason && gotRecs });
  const a = onSnapshot(seasonRef(slug, sid), (s) => { gotSeason = true; seasonDoc = s.exists() ? (s.data() as Season) : null; emit(); }, onError);
  const b = onSnapshot(recsRef(slug, sid), (q) => {
    gotRecs = true;
    recs = new Map(q.docs.map((d) => { const x = d.data() as RecordingDoc & { updatedAt?: unknown }; delete x.updatedAt; return [d.id, x]; }));
    emit();
  }, onError);
  return () => { a(); b(); };
}

/** Writes in batches Firestore accepts (at most 500 operations each). */
async function inBatches(ops: ((b: ReturnType<typeof writeBatch>) => void)[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(firebase().db);
    ops.slice(i, i + 400).forEach((op) => op(b));
    await b.commit();
  }
}

const bodyOf = (r: RecordingDoc | RecordingBody): RecordingBody =>
  ({ date: r.date, team: r.team, opp: r.opp, events: r.events ?? [], newPlayers: r.newPlayers ?? [], present: r.present ?? [], flags: r.flags ?? [] });

/**
 * Admin: saves a changed season, writing only the documents that changed. A tablet's first-time
 * subs move into the season's players here, so their recordings' lists are emptied.
 */
export async function saveSeasonOnline(slug: string, next: Season, remote: Remote) {
  const uid = await deviceId();
  const sid = next.id;
  const { seasonDoc, recs } = split({ ...next, schemaVersion: SEASON_SCHEMA });
  const ops: ((b: ReturnType<typeof writeBatch>) => void)[] = [];
  if (!remote.seasonDoc || stable(seasonDoc) !== stable(remote.seasonDoc)) ops.push((b) => b.set(seasonRef(slug, sid), seasonDoc));
  for (const [id, body] of recs) {
    const old = remote.recs.get(id);
    if (old && stable(bodyOf(old)) === stable(body)) continue;
    // Merged, so what only the tablet knows (its check-in list) stays.
    ops.push((b) => b.set(recRef(slug, sid, id), { uid: old?.uid ?? uid, status: old?.status ?? "finished", ...body, updatedAt: serverTimestamp() }, { merge: true }));
  }
  for (const id of remote.recs.keys()) if (!recs.has(id)) ops.push((b) => b.delete(recRef(slug, sid, id)));
  if (!ops.length) return;
  await inBatches(ops);
  // Keep the league's season list's name current.
  const league = await getLeague(slug);
  if (league && league.seasons.find((s) => s.id === sid)?.name !== next.name) {
    await updateDoc(leagueRef(slug), { seasons: [...league.seasons.filter((s) => s.id !== sid), { id: sid, name: next.name }] });
  }
}

/** Admin: puts a season that exists only in this browser online, in the league. */
export async function moveSeasonOnline(slug: string, season: Season) {
  if ((await getDoc(seasonRef(slug, season.id))).exists()) throw new Error("This season is already online in that league.");
  await saveSeasonOnline(slug, season, { seasonDoc: null, recs: new Map(), ready: true });
  await updateDoc(leagueRef(slug), { seasons: arrayUnion({ id: season.id, name: season.name }) });
}

/** Track Stats: the recording as it stands, written while recording and again at Finish. */
export async function pushRecording(slug: string, sid: string, d: Draft, status: RecordingDoc["status"], extra?: { present?: string[]; flags?: SavedFlag[] }) {
  const uid = await deviceId();
  await setDoc(recRef(slug, sid, recId(d.date, d.team, d.opp)), {
    uid, status, date: d.date, team: d.team, opp: d.opp, events: d.events, newPlayers: d.newPlayers, checkIn: d.present, subs: d.subs,
    ...(extra ?? {}), updatedAt: serverTimestamp(),
  }, { merge: true });
}

/** Admin: marks a recording finished when its tablet was closed without pressing Finish. */
export async function markFinished(slug: string, sid: string, d: Pick<Draft, "date" | "team" | "opp">) {
  await updateDoc(recRef(slug, sid, recId(d.date, d.team, d.opp)), { status: "finished", updatedAt: serverTimestamp() });
}

/** Track Stats: removes this device's recording (Discard). */
export async function deleteRecording(slug: string, sid: string, d: Pick<Draft, "date" | "team" | "opp">) {
  await deleteDoc(recRef(slug, sid, recId(d.date, d.team, d.opp)));
}

/** Whether this device's writes to a recording have reached the server: true synced, false waiting. */
export function watchSynced(slug: string, sid: string, d: Pick<Draft, "date" | "team" | "opp">, onSynced: (synced: boolean) => void) {
  return onSnapshot(recRef(slug, sid, recId(d.date, d.team, d.opp)), { includeMetadataChanges: true },
    (s) => onSynced(s.exists() && !s.metadata.hasPendingWrites), () => onSynced(false));
}

const publicRef = (slug: string, sid: string) => doc(firebase().db, "leagues", slug, "public", sid);

/**
 * Admin or tablet: the public page's snapshot, written only when its numbers change. A transaction,
 * because it needs the server: a device without a signal fails here instead of queueing a snapshot
 * that would overwrite newer numbers when it reconnects.
 */
export async function publishSnapshot(slug: string, sid: string, snapshot: Snapshot, last: { current: string | null }) {
  const key = stable({ ...snapshot, generatedAt: null });
  if (key === last.current) return;
  await runTransaction(firebase().db, async (t) => {
    const now = await t.get(publicRef(slug, sid));
    if (now.exists() && stable({ ...now.data(), generatedAt: null }) === key) return;
    t.set(publicRef(slug, sid), snapshot);
  });
  last.current = key;
}

/** The public page: the published snapshot, live. */
export function watchPublic(slug: string, sid: string, onSnap: (s: Snapshot | null) => void, onError: (e: Error) => void) {
  return onSnapshot(publicRef(slug, sid), (d) => onSnap(d.exists() ? (d.data() as Snapshot) : null), onError);
}
