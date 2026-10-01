// Leagues this browser has opened, so the Seasons screen can list them without loading Firebase.
const KEY = "eupa:leagues";

export interface RecentLeague { slug: string; name: string }

export function recentLeagues(): RecentLeague[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

export function rememberLeague(slug: string, name: string) {
  try {
    const rest = recentLeagues().filter((l) => l.slug !== slug);
    localStorage.setItem(KEY, JSON.stringify([{ slug, name }, ...rest].slice(0, 20)));
  } catch { /* private window or storage blocked: the list is only a convenience */ }
}
