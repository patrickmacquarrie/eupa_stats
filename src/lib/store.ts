// Seasons live in the browser's IndexedDB. Event logs run to tens of thousands of rows,
// well past what localStorage holds.
import { del, get, set } from "idb-keyval";
import type { Draft } from "./recorder";
import { SEASON_SCHEMA, migrateSeason, type Season, type SeasonMeta } from "./season";

const INDEX = "seasons";
const key = (id: string) => `season:${id}`;

export async function listSeasons(): Promise<SeasonMeta[]> {
  return ((await get<SeasonMeta[]>(INDEX)) ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadSeason(id: string): Promise<Season | undefined> {
  const raw = await get<Season>(key(id));
  return raw ? migrateSeason(raw) : undefined;
}

export async function saveSeason(s: Season): Promise<Season> {
  const next = { ...s, schemaVersion: SEASON_SCHEMA, updatedAt: new Date().toISOString() };
  await set(key(s.id), next);
  const idx = ((await get<SeasonMeta[]>(INDEX)) ?? []).filter((m) => m.id !== s.id);
  idx.push({ id: next.id, name: next.name, source: next.source, updatedAt: next.updatedAt });
  await set(INDEX, idx);
  return next;
}

export async function deleteSeason(id: string) {
  await del(key(id));
  await set(INDEX, ((await get<SeasonMeta[]>(INDEX)) ?? []).filter((m) => m.id !== id));
}

export function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A game being recorded on this device, saved on every tap so a refresh or a dead tablet
// doesn't lose it; one live game per season per device. IndexedDB writes finish after the tap
// returns, so each save also goes to localStorage, which is written before the next line runs;
// on load, whichever copy is newer wins.
type Stored = { savedAt: number; draft: Draft | null };
const draftKey = (seasonId: string) => `draft:${seasonId}`;
function readLocal(seasonId: string): Stored | null {
  try { const v = localStorage.getItem(draftKey(seasonId)); return v ? JSON.parse(v) : null; } catch { return null; }
}
function writeLocal(seasonId: string, v: Stored) {
  try { localStorage.setItem(draftKey(seasonId), JSON.stringify(v)); } catch { /* full or blocked: IndexedDB still has it */ }
}
export async function loadDraft(seasonId: string): Promise<Draft | null> {
  const local = readLocal(seasonId);
  let idb: Stored | null = null;
  try { idb = (await get<Stored>(draftKey(seasonId))) ?? null; } catch { /* fall back to local */ }
  const best = [local, idb].filter((x): x is Stored => !!x && typeof x.savedAt === "number").sort((a, b) => b.savedAt - a.savedAt)[0];
  return best?.draft ?? null;
}
export function saveDraft(d: Draft) {
  const v: Stored = { savedAt: Date.now(), draft: d };
  writeLocal(d.seasonId, v);
  return set(draftKey(d.seasonId), v);
}
export function clearDraft(seasonId: string) {
  const v: Stored = { savedAt: Date.now(), draft: null };
  writeLocal(seasonId, v);
  return set(draftKey(seasonId), v);
}

export function downloadText(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
