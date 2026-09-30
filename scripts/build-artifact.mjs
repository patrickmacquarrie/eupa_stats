// Packages `vite build` output for hosting as a claude.ai Artifact: the host wraps the page in
// its own <html>/<head>/<body>, so the page file carries only the title, the stylesheet link,
// the root element and the entry script. Assets are published alongside under assets/.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)].map((m) => m[1]);
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"/g)].map((m) => m[1]);
if (!js.length) throw new Error("No entry script found in dist/index.html");
const page = [
  "<title>EUPA Stats</title>",
  ...css.map((f) => `<link rel="stylesheet" href="${f}">`),
  '<div id="root"></div>',
  ...js.map((f) => `<script type="module" src="${f}"></script>`),
].join("\n") + "\n";
writeFileSync("dist/artifact.html", page);
const files = Object.fromEntries(readdirSync("dist/assets").map((f) => [`assets/${f}`, `dist/assets/${f}`]));
writeFileSync("dist/artifact-files.json", JSON.stringify(files, null, 1));
console.log(page);
console.log(Object.keys(files).join("\n"));
