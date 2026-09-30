// Seasons live in the browser's IndexedDB. Event logs run to tens of thousands of rows,
// well past what localStorage holds.
import { del, get, set } from "idb-keyval";
import type { Season, SeasonMeta } from "./season";

const INDEX = "seasons";
const key = (id: string) => `season:${id}`;

export async function listSeasons(): Promise<SeasonMeta[]> {
  return ((await get<SeasonMeta[]>(INDEX)) ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const loadSeason = (id: string) => get<Season>(key(id));

export async function saveSeason(s: Season): Promise<Season> {
  const next = { ...s, updatedAt: new Date().toISOString() };
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
