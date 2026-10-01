// Security rules, against the Firestore emulator: npm run test:rules
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SALT = "s4lt";
const key = (pw: string) => createHash("sha256").update(`${SALT}:${pw}`).digest("hex");
const STAT = "stat-pass", ADMIN = "admin-pass";
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-eupa-stats",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 },
  });
});
afterAll(async () => { await env?.cleanup(); });

/** A league "eupa" with both passwords, a season, and one recording by the stat-taker "tablet". */
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "leagues/eupa"), { slug: "eupa", name: "EUPA", salt: SALT, seasons: [] });
    await setDoc(doc(db, "leagues/eupa/secrets/keys"), { statKey: key(STAT), adminKey: key(ADMIN) });
    await setDoc(doc(db, "leagues/eupa/members/admin1"), { role: "admin", key: key(ADMIN) });
    await setDoc(doc(db, "leagues/eupa/members/tablet"), { role: "stat", key: key(STAT) });
    await setDoc(doc(db, "leagues/eupa/seasons/fall"), { name: "Fall", input: { rules: { capBuffer: 200000 } } });
    await setDoc(doc(db, "leagues/eupa/seasons/fall/recordings/r1"), { uid: "tablet", team: "A", opp: "B", events: [] });
    await setDoc(doc(db, "leagues/eupa/public/fall"), { rows: [] });
  });
});

const as = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

describe("anyone can read the league, but never its passwords", () => {
  it("lets a visitor with no login read the league, seasons, recordings and public page", async () => {
    const db = as(null);
    for (const p of ["leagues/eupa", "leagues/eupa/seasons/fall", "leagues/eupa/seasons/fall/recordings/r1", "leagues/eupa/public/fall"])
      await assertSucceeds(getDoc(doc(db, p)));
  });
  it("hides the stored keys from everyone, admins included", async () => {
    for (const uid of [null, "stranger", "tablet", "admin1"]) await assertFails(getDoc(doc(as(uid), "leagues/eupa/secrets/keys")));
  });
  it("hides other devices' unlock records from all but admins", async () => {
    await assertFails(getDoc(doc(as("tablet"), "leagues/eupa/members/admin1")));
    await assertSucceeds(getDoc(doc(as("tablet"), "leagues/eupa/members/tablet")));
    await assertSucceeds(getDocs(collection(as("admin1"), "leagues/eupa/members")));
  });
});

describe("unlocking", () => {
  it("refuses a wrong password, and a stat password claimed as admin", async () => {
    const db = as("phone");
    await assertFails(setDoc(doc(db, "leagues/eupa/members/phone"), { role: "stat", key: key("guess") }));
    await assertFails(setDoc(doc(db, "leagues/eupa/members/phone"), { role: "admin", key: key(STAT) }));
    await assertFails(setDoc(doc(db, "leagues/eupa/members/phone"), { role: "owner", key: key(ADMIN) }));
  });
  it("accepts the right password, for your own device only", async () => {
    await assertSucceeds(setDoc(doc(as("phone"), "leagues/eupa/members/phone"), { role: "stat", key: key(STAT) }));
    await assertFails(setDoc(doc(as("phone"), "leagues/eupa/members/other"), { role: "stat", key: key(STAT) }));
    await assertFails(setDoc(doc(as(null), "leagues/eupa/members/phone"), { role: "stat", key: key(STAT) }));
  });
});

describe("what each password allows", () => {
  it("keeps visitors and stat-takers out of the season and its rules", async () => {
    for (const uid of [null, "stranger", "tablet"]) {
      const db = as(uid);
      await assertFails(updateDoc(doc(db, "leagues/eupa/seasons/fall"), { "input.rules.capBuffer": 0 }));
      await assertFails(updateDoc(doc(db, "leagues/eupa"), { name: "Hacked" }));
    }
  });
  it("lets a stat-taker update the public page, but not a visitor, and only an admin remove it", async () => {
    for (const uid of [null, "stranger"]) await assertFails(setDoc(doc(as(uid), "leagues/eupa/public/fall"), { rows: ["fake"] }));
    await assertSucceeds(setDoc(doc(as("tablet"), "leagues/eupa/public/fall"), { rows: [] }));
    await assertFails(deleteDoc(doc(as("tablet"), "leagues/eupa/public/fall")));
    await assertSucceeds(deleteDoc(doc(as("admin1"), "leagues/eupa/public/fall")));
  });
  it("lets a stat-taker write their own recordings, but not another device's", async () => {
    const db = as("tablet");
    await assertSucceeds(setDoc(doc(db, "leagues/eupa/seasons/fall/recordings/r2"), { uid: "tablet", team: "B", opp: "A", events: [] }));
    await assertSucceeds(updateDoc(doc(db, "leagues/eupa/seasons/fall/recordings/r1"), { events: [{ action: "Touch" }] }));
    await assertFails(setDoc(doc(db, "leagues/eupa/seasons/fall/recordings/r3"), { uid: "someone-else", events: [] }));
    // Another stat device can't touch the first one's recording, or discard it.
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "leagues/eupa/members/tablet2"), { role: "stat", key: key(STAT) }));
    await assertFails(updateDoc(doc(as("tablet2"), "leagues/eupa/seasons/fall/recordings/r1"), { events: [] }));
    await assertFails(deleteDoc(doc(as("tablet2"), "leagues/eupa/seasons/fall/recordings/r1")));
    // Its own device can discard it.
    await assertSucceeds(deleteDoc(doc(db, "leagues/eupa/seasons/fall/recordings/r1")));
    // Without a password, no recording at all.
    await assertFails(setDoc(doc(as("stranger"), "leagues/eupa/seasons/fall/recordings/r4"), { uid: "stranger", events: [] }));
  });
  it("lets an admin change everything except the stored keys' readability", async () => {
    const db = as("admin1");
    await assertSucceeds(updateDoc(doc(db, "leagues/eupa/seasons/fall"), { "input.rules.capBuffer": 0 }));
    await assertSucceeds(updateDoc(doc(db, "leagues/eupa/seasons/fall/recordings/r1"), { events: [] }));
    await assertSucceeds(deleteDoc(doc(db, "leagues/eupa/seasons/fall/recordings/r1")));
    await assertSucceeds(setDoc(doc(db, "leagues/eupa/public/fall"), { rows: [] }));
    await assertSucceeds(updateDoc(doc(db, "leagues/eupa"), { name: "EUPA Fall" }));
    await assertFails(updateDoc(doc(db, "leagues/eupa"), { salt: "new" }));
  });
});

describe("changing a password", () => {
  it("locks out every device unlocked with the old one", async () => {
    await assertSucceeds(updateDoc(doc(as("admin1"), "leagues/eupa/secrets/keys"), { statKey: key("new-stat") }));
    // The tablet's record still exists, but no longer counts.
    await assertFails(updateDoc(doc(as("tablet"), "leagues/eupa/seasons/fall/recordings/r1"), { events: [] }));
    await assertSucceeds(setDoc(doc(as("tablet"), "leagues/eupa/members/tablet"), { role: "stat", key: key("new-stat") }));
    await assertSucceeds(updateDoc(doc(as("tablet"), "leagues/eupa/seasons/fall/recordings/r1"), { events: [] }));
  });
  it("can't be done by a stat-taker", async () => {
    await assertFails(updateDoc(doc(as("tablet"), "leagues/eupa/secrets/keys"), { statKey: key("mine") }));
  });
});

describe("creating a league", () => {
  const create = (uid: string, slug: string, adminKey = key(ADMIN)) => {
    const db = as(uid), b = writeBatch(db);
    b.set(doc(db, `leagues/${slug}`), { slug, name: "New", salt: SALT, seasons: [] });
    b.set(doc(db, `leagues/${slug}/secrets/keys`), { statKey: key(STAT), adminKey });
    b.set(doc(db, `leagues/${slug}/members/${uid}`), { role: "admin", key: adminKey });
    return b.commit();
  };
  it("creates a league with its passwords and its first admin in one write", async () => {
    await assertSucceeds(create("founder", "thursday"));
    await assertSucceeds(updateDoc(doc(as("founder"), "leagues/thursday"), { name: "Thursday" }));
  });
  it("can't take over an existing league", async () => {
    await assertFails(create("stranger", "eupa"));
    let adminKey: unknown;
    await env.withSecurityRulesDisabled(async (c) => { adminKey = (await getDoc(doc(c.firestore(), "leagues/eupa/secrets/keys"))).data()?.adminKey; });
    expect(adminKey).toBe(key(ADMIN));
  });
  it("needs a signed-in device", async () => {
    const db = as(null), b = writeBatch(db);
    b.set(doc(db, "leagues/anon"), { slug: "anon", name: "x", salt: SALT, seasons: [] });
    b.set(doc(db, "leagues/anon/secrets/keys"), { statKey: "a", adminKey: "b" });
    await assertFails(b.commit());
  });
});

describe("the main page's season", () => {
  it("is set by an admin of its league, never by a stat-taker or visitor", async () => {
    for (const uid of [null, "stranger", "tablet"]) await assertFails(setDoc(doc(as(uid), "site/main"), { league: "eupa", season: "fall" }));
    await assertSucceeds(setDoc(doc(as("admin1"), "site/main"), { league: "eupa", season: "fall" }));
    await assertSucceeds(getDoc(doc(as(null), "site/main")));
    await assertFails(setDoc(doc(as("admin1"), "site/main"), { league: "eupa", season: "fall", extra: 1 }));
  });
  it("can't be taken over by another league's admin", async () => {
    await assertSucceeds(setDoc(doc(as("admin1"), "site/main"), { league: "eupa", season: "fall" }));
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, "leagues/other"), { slug: "other", name: "Other", salt: SALT, seasons: [] });
      await setDoc(doc(db, "leagues/other/secrets/keys"), { statKey: key("o-stat"), adminKey: key("o-admin") });
      await setDoc(doc(db, "leagues/other/members/otherAdmin"), { role: "admin", key: key("o-admin") });
    });
    await assertFails(setDoc(doc(as("otherAdmin"), "site/main"), { league: "other", season: "x" }));
  });
});
