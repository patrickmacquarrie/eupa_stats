// Inlines the public stats page into one file (dist-share/stats-page.html) for publishing,
// seeded with the Fall 2026 demo season so the first version isn't empty.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { computeLeague } from "../engine/compute";
import { DEFAULT_PUBLIC, buildSnapshot } from "../src/lib/publicStats";
import { seasonFromFixture } from "../src/lib/season";
import { escapeScript, pageBody } from "../src/share/page";

const files = readdirSync("dist-share/assets");
const js = files.filter((f) => f.endsWith(".js")), css = files.filter((f) => f.endsWith(".css"));
if (js.length !== 1 || css.length !== 1) throw new Error(`Expected one script and one stylesheet, got ${files.join(", ")}`);
const { season } = seasonFromFixture(JSON.parse(readFileSync("fixtures/fall-2026.json", "utf8")), "EUPA Fall 2026 (demo)");
const snapshot = buildSnapshot(season.name, season.input, computeLeague(season.input), DEFAULT_PUBLIC);
const page = pageBody(readFileSync(`dist-share/assets/${css[0]}`, "utf8"), escapeScript(readFileSync(`dist-share/assets/${js[0]}`, "utf8")), snapshot);
writeFileSync("dist-share/stats-page.html", page);
console.log(`dist-share/stats-page.html: ${(page.length / 1024).toFixed(0)} KB`);
