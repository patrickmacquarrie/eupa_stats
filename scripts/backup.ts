// Weekly backup of every online league: `npm run backup -- <folder>` (run by .github/workflows/backup.yml).
//
// Everything a backup needs is readable by anyone (the passwords' keys aren't, and aren't needed),
// so this signs in to nothing. Each season is written in the app's export format, so restoring one
// is "Import" on the Seasons screen. With FIRESTORE_EMULATOR_HOST set, it reads the emulator.
import { initializeApp } from "firebase/app";
import { collection, connectFirestoreEmulator, getDocs, getFirestore, type Firestore } from "firebase/firestore";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "../src/lib/firebaseConfig";
import { assemble, type RecordingDoc } from "../src/lib/onlineShape";
import type { Season } from "../src/lib/season";

export interface BackupFile { path: string; data: unknown }

const fileName = (s: string) => s.replace(/[^\p{L}\p{N} ._-]+/gu, "-").trim() || "season";

/** Every league's details and every season, assembled the way the app exports it. */
export async function backupAll(db: Firestore): Promise<BackupFile[]> {
  const files: BackupFile[] = [];
  for (const league of (await getDocs(collection(db, "leagues"))).docs) {
    const slug = league.id;
    files.push({ path: `${slug}/league.json`, data: league.data() });
    for (const s of (await getDocs(collection(db, "leagues", slug, "seasons"))).docs) {
      const recs = (await getDocs(collection(db, "leagues", slug, "seasons", s.id, "recordings"))).docs.map((d) => {
        const r = d.data() as RecordingDoc & { updatedAt?: unknown };
        delete r.updatedAt;
        return r;
      });
      const season = assemble(s.data() as Season, recs);
      files.push({ path: `${slug}/${fileName(season.name)} (${s.id}).json`, data: season });
    }
  }
  return files;
}

async function main(out: string) {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const app = initializeApp(emulator ? { ...config, projectId: "demo-eupa-stats", apiKey: "demo-key" } : config);
  const db = getFirestore(app);
  if (emulator) { const [host, port] = emulator.split(":"); connectFirestoreEmulator(db, host, Number(port)); }
  const files = await backupAll(db);
  for (const f of files) {
    mkdirSync(join(out, f.path, ".."), { recursive: true });
    writeFileSync(join(out, f.path), JSON.stringify(f.data, null, 2));
  }
  const seasons = files.filter((f) => !f.path.endsWith("/league.json")).length;
  console.log(`Backed up ${files.length - seasons} league(s) and ${seasons} season(s) to ${out}.`);
  process.exit(0);   // Firestore keeps its connection open otherwise
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv[2] ?? "backup").catch((e) => { console.error(e); process.exit(1); });
}
