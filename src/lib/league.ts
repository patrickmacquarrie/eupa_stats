// Leagues online: a league has a name, a link name ("eupa-fall") and seasons. Anyone can read it.
// Two passwords unlock changes: the stat password (Track Stats) and the admin password
// (everything). See firestore.rules for how the passwords are checked without a server.
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch, deleteDoc, setDoc,
} from "firebase/firestore";
import { deviceId, firebase } from "./firebase";
import { passwordProblem, slugProblem } from "./leagueForm";

export type Role = "stat" | "admin";
export interface League { slug: string; name: string; salt: string; seasons: { id: string; name: string }[] }

export { passwordProblem, slugProblem } from "./leagueForm";

/** The key stored for a password: sha256 of the league's salt and the password, as hex. */
export async function keyOf(salt: string, password: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${password}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const randomSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

export const leagueRef = (slug: string) => doc(firebase().db, "leagues", slug);
const keysRef = (slug: string) => doc(firebase().db, "leagues", slug, "secrets", "keys");
const memberRef = (slug: string, uid: string) => doc(firebase().db, "leagues", slug, "members", uid);

export async function getLeague(slug: string): Promise<League | null> {
  const s = await getDoc(leagueRef(slug));
  return s.exists() ? (s.data() as League) : null;
}

/** Creates the league, its two passwords, and makes this device its first admin, in one write. */
export async function createLeague(slug: string, name: string, statPassword: string, adminPassword: string) {
  const problem = slugProblem(slug) ?? passwordProblem(statPassword) ?? passwordProblem(adminPassword);
  if (problem) throw new Error(problem);
  if (statPassword === adminPassword) throw new Error("Use different passwords for stats entry and admin.");
  const uid = await deviceId();
  if (await getLeague(slug)) throw new Error(`There's already a league called “${slug}”. Choose another link name.`);
  const salt = randomSalt();
  const [statKey, adminKey] = await Promise.all([keyOf(salt, statPassword), keyOf(salt, adminPassword)]);
  const b = writeBatch(firebase().db);
  b.set(leagueRef(slug), { slug, name: name.trim(), salt, seasons: [], createdAt: serverTimestamp() });
  b.set(keysRef(slug), { statKey, adminKey });
  b.set(memberRef(slug, uid), { role: "admin", key: adminKey, at: serverTimestamp() });
  await b.commit();
}

/** Unlocks this device for a role. A wrong password is refused by the rules. */
export async function unlock(slug: string, role: Role, password: string) {
  const league = await getLeague(slug);
  if (!league) throw new Error("That league doesn't exist.");
  const uid = await deviceId();
  try {
    await setDoc(memberRef(slug, uid), { role, key: await keyOf(league.salt, password), at: serverTimestamp() });
  } catch (e) {
    if ((e as { code?: string }).code === "permission-denied") throw new Error("That password isn't right.");
    throw e;
  }
}

/** Forgets this device's unlock. */
export async function lock(slug: string) {
  await deleteDoc(memberRef(slug, await deviceId()));
}

/**
 * Admin: changes one password. Devices unlocked with the old one stop working at once (the rules
 * compare keys); their records are also removed so they're asked for the new password.
 */
export async function changePassword(slug: string, role: Role, password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const league = await getLeague(slug);
  if (!league) throw new Error("That league doesn't exist.");
  const uid = await deviceId();
  const key = await keyOf(league.salt, password);
  const old = await getDocs(query(collection(firebase().db, "leagues", slug, "members"), where("role", "==", role)));
  const b = writeBatch(firebase().db);
  b.update(keysRef(slug), { [role === "admin" ? "adminKey" : "statKey"]: key });
  for (const m of old.docs) if (m.id !== uid) b.delete(m.ref);
  // An admin changing the admin password stays unlocked with the new one.
  if (role === "admin") b.set(memberRef(slug, uid), { role, key, at: serverTimestamp() });
  await b.commit();
}

/** Admin: renames the league (its link name stays). */
export async function renameLeague(slug: string, name: string) {
  if (!name.trim()) throw new Error("Give the league a name.");
  await updateDoc(leagueRef(slug), { name: name.trim() });
}

/** This device's role in a league, live: "admin", "stat", or null when locked. */
export function watchRole(slug: string, onRole: (r: Role | null) => void) {
  let stop = () => {};
  let live = true;
  deviceId().then((uid) => {
    if (!live) return;
    // Only what the server has accepted: an unlock with a wrong password shows up locally for a
    // moment before the rules refuse it.
    stop = onSnapshot(memberRef(slug, uid), { includeMetadataChanges: true }, (s) => {
      if (s.metadata.hasPendingWrites) return;
      onRole(s.exists() ? (s.data().role as Role) : null);
    }, () => onRole(null));
  });
  return () => { live = false; stop(); };
}
