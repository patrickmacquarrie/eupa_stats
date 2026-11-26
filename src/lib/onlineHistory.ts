// Reading and writing a league's history online. Admins only (firestore.rules):
//   leagues/{league}/history/{id}    one HistorySeason per season
//   leagues/{league}/meta/history    HistoryMeta: merged spellings, pairs that aren't one person, seasons left out
import { collection, deleteDoc, doc, getDoc, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { firebase } from "./firebase";
import { historyProblems, NO_META, plain, type HistoryMeta, type HistorySeason } from "./history";
import { stable } from "./onlineShape";

const histCol = (slug: string) => collection(firebase().db, "leagues", slug, "history");
const histRef = (slug: string, id: string) => doc(histCol(slug), id);
const namesRef = (slug: string) => doc(firebase().db, "leagues", slug, "meta", "history");

/** Every season in the league's history, live. Damaged records are left out and named in `skipped`. */
export function watchHistory(slug: string, onSeasons: (s: HistorySeason[], skipped: string[]) => void, onError: (e: Error) => void) {
  return onSnapshot(histCol(slug), (q) => {
    const ok: HistorySeason[] = [], skipped: string[] = [];
    for (const d of q.docs) {
      const s = d.data();
      if (historyProblems(s).length) skipped.push(String(s?.name ?? d.id)); else ok.push(s as HistorySeason);
    }
    onSeasons(ok, skipped);
  }, onError);
}

export function watchHistoryMeta(slug: string, onNames: (n: HistoryMeta) => void, onError: (e: Error) => void) {
  return onSnapshot(namesRef(slug), (d) => {
    const x = d.data();
    onNames(x ? {
      aliases: Array.isArray(x.aliases) ? x.aliases : [], distinct: Array.isArray(x.distinct) ? x.distinct : [], hidden: Array.isArray(x.hidden) ? x.hidden : [],
    } : NO_META);
  }, onError);
}

export const saveHistorySeason = (slug: string, s: HistorySeason) => setDoc(histRef(slug, s.id), plain(s));
export const deleteHistorySeason = (slug: string, id: string) => deleteDoc(histRef(slug, id));
export const saveHistoryMeta = (slug: string, n: HistoryMeta) => setDoc(namesRef(slug), plain(n));

/** Saves several seasons (an export being restored) in batches Firestore accepts. */
export async function saveHistorySeasons(slug: string, seasons: HistorySeason[]) {
  for (let i = 0; i < seasons.length; i += 400) {
    const b = writeBatch(firebase().db);
    for (const s of seasons.slice(i, i + 400)) b.set(histRef(slug, s.id), plain(s));
    await b.commit();
  }
}

/**
 * Admin: keeps an app season's history record current while the season is open, written only when
 * its numbers change (the time it was built doesn't count as a change).
 */
export async function publishHistory(slug: string, s: HistorySeason, last: { current: string | null }) {
  const key = stable(plain({ ...s, updatedAt: null }));
  if (key === last.current) return;
  const now = await getDoc(histRef(slug, s.id));
  if (!now.exists() || stable({ ...now.data(), updatedAt: null }) !== key) await setDoc(histRef(slug, s.id), plain(s));
  last.current = key;
}
