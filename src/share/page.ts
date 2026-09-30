// The public stats page is ONE self-contained file: its script, styles and stats all inline.
// When the owner updates the stats, the page republishes itself from this same template with
// new data, so nothing it depends on can go missing between versions.
import type { Snapshot } from "../lib/publicStats";

export const PAGE_TITLE = "EUPA Player Stats";

/** Keeps inline code from ending its own <script> element early. */
export const escapeScript = (js: string) => js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const escapeJson = (s: Snapshot | null) => JSON.stringify(s).replace(/</g, "\\u003c");

/** The page content, as the Artifact tool publishes it (the host adds <html>/<head>/<body>). */
export function pageBody(css: string, js: string, snapshot: Snapshot | null) {
  return `<title>${PAGE_TITLE}</title>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&display=swap">\n<style id="app-css">${css}</style>\n<div id="root"></div>\n` +
    `<script type="application/json" id="stats-data">${escapeJson(snapshot)}</script>\n` +
    `<script type="module" id="app-js">${js}</script>\n`;
}

// The skeleton the host wraps pages in; a page that republishes itself sends it too.
const RESET = ":root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}" +
  "body{margin:0;font:14px/1.4 system-ui,-apple-system,sans-serif;background:#fafaf9}img{max-width:100%}[hidden]{display:none!important}";

export function fullDocument(body: string) {
  return `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${RESET}</style></head><body>${body}</body></html>`;
}
