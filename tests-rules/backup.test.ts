// The weekly backup, against the Firestore emulator and the real rules: npm run test:rules
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, type Firestore } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { backupAll } from "../scripts/backup";
import { split, stable } from "../src/lib/onlineShape";
import { seasonFromFixture, seasonFromJson } from "../src/lib/season";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-eupa-stats",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 },
  });
});
afterAll(async () => { await env?.cleanup(); });

it("saves every season in the app's export format, with no visitor access needed and no keys", async () => {
  const fall = { ...seasonFromFixture(JSON.parse(readFileSync("fixtures/fall-2026.json", "utf8")), "Fall 2026").season, id: "fall26" };
  const { seasonDoc, recs } = split(fall);
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore() as unknown as Firestore;
    await setDoc(doc(db, "leagues/eupa"), { slug: "eupa", name: "EUPA", salt: "s", seasons: [{ id: "fall26", name: "Fall 2026" }] });
    await setDoc(doc(db, "leagues/eupa/secrets/keys"), { statKey: "secret-stat", adminKey: "secret-admin" });
    await setDoc(doc(db, "leagues/eupa/members/tablet"), { role: "stat", key: "secret-stat" });
    await setDoc(doc(db, "leagues/eupa/seasons/fall26"), seasonDoc);
    for (const [id, body] of recs) await setDoc(doc(db, "leagues/eupa/seasons/fall26/recordings", id), { uid: "tablet", status: "finished", ...body, updatedAt: new Date() });
  });

  // A visitor with no login can take the whole backup: the rules allow it.
  const files = await backupAll(env.unauthenticatedContext().firestore() as unknown as Firestore);
  expect(files.map((f) => f.path).sort()).toEqual(["eupa/Fall 2026 (fall26).json", "eupa/league.json"]);
  expect(JSON.stringify(files)).not.toContain("secret-");

  // The season file imports, with every play.
  const data = JSON.parse(JSON.stringify(files.find((f) => f.path.includes("fall26"))!.data));
  const { season } = seasonFromJson(data, "x");
  expect(season.name).toBe("Fall 2026");
  expect(season.input.events.map((e) => stable(e)).sort()).toEqual(fall.input.events.map((e) => stable(e)).sort());
});
