// Which season the site's main page shows, and where /stats sends a tablet: one document,
// site/main { league, season }, set by that league's admin (Admin → Setup).
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { firebase } from "./firebase";

export interface MainSeason { league: string; season: string }

const mainRef = () => doc(firebase().db, "site", "main");

/** The main season, live; null when none is set. Works offline from this device's copy. */
export function watchMain(onMain: (m: MainSeason | null) => void, onError: (e: Error) => void) {
  return onSnapshot(mainRef(), (s) => onMain(s.exists() ? (s.data() as MainSeason) : null), onError);
}

/** Admin: makes a season of their league the main one. */
export async function setMain(m: MainSeason) {
  await setDoc(mainRef(), { league: m.league, season: m.season });
}

/** Admin: makes a season the main one only if none is set yet (the first season moved online). */
export async function setMainIfNone(m: MainSeason) {
  if (!(await getDoc(mainRef())).exists()) await setMain(m);
}
