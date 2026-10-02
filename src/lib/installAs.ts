// Which app "Add to Home Screen" installs. On the stats-entry screens it's "EUPA Stats Entry",
// which opens straight to /stats with its own darker icon; everywhere else it's "EUPA Stats".
import { useEffect } from "react";

const set = (sel: string, attr: string, value: string) => document.querySelector(sel)?.setAttribute(attr, value);

function installAs(entry: boolean) {
  set('link[rel="manifest"]', "href", entry ? "./manifest-entry.webmanifest" : "./manifest.webmanifest");
  set('link[rel="apple-touch-icon"]', "href", entry ? "./icon-entry-180.png" : "./icon-180.png");
  set('meta[name="apple-mobile-web-app-title"]', "content", entry ? "Stats Entry" : "EUPA Stats");
}

/** While the calling screen is open, installing the app installs Stats Entry. */
export function useInstallAsStatsEntry() {
  useEffect(() => { installAs(true); return () => installAs(false); }, []);
}
