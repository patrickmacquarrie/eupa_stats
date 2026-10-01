// Replaces every real name in fixtures/*.json and fixtures/disputes/*.csv with a stable fake one.
//
//   npx tsx scripts/anonymise-fixtures.ts [--rewrite file ...]
//
// One mapping covers every fixture, so a person keeps the same fake name in every season and CSV.
// Fake names are two invented words, kept far enough apart that the Names screen never mistakes
// two different fakes for the same person. Every pair the Names screen does link in the real data
// (a typo like Katelyn/Katelynn, a short first name like Jess/Jessica, a "Name Sub" record) gets a
// fake pair it links for the same reason, and the script checks that before writing anything.
//
// The mapping is written to fixtures/.anonymise-map.json, which is git-ignored and must never be
// committed. --rewrite applies it to other text files (tests, README) that quote real names.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { editDistance, likelySame, nameKey, stripSub } from "../src/lib/names";

const FIXTURES = ["fixtures/fall-2026.json", "fixtures/thursday-s1-2026.json", "fixtures/pl-2025.json"];
const CSVS = readdirSync("fixtures/disputes").filter((f) => f.endsWith(".csv")).map((f) => `fixtures/disputes/${f}`);
const MAP_FILE = "fixtures/.anonymise-map.json";

// Not people: plug placeholders ("T2-Extra-F+ Sub") and the sub pool's GM.
const KEEP = (s: string) => /extra/i.test(s) || /^sub$/i.test(s.trim());
const GENERIC_TEAM = /^EUPA .* Team \d+$/;

const FIRST = ["Alder", "Briony", "Corwin", "Delphine", "Emrys", "Fenella", "Gideon", "Halcyon", "Isolde", "Jorah", "Kestrel",
  "Lysander", "Marisol", "Nerys", "Oswin", "Perrin", "Quillon", "Rosalind", "Soren", "Tamsin", "Ulric", "Vesper", "Wynne",
  "Xanthe", "Yorick", "Zephyr", "Anselm", "Bettany", "Caspian", "Darrow", "Elowen", "Florian", "Greer", "Hollis", "Imogen",
  "Jasper", "Kerensa", "Leopold", "Morwenna", "Niamh", "Orrin", "Peregrine", "Ravenna", "Silas", "Tobias", "Undine", "Valerian",
  "Winslow", "Ysolde", "Zinnia", "Ambrose", "Blythe", "Cordelia", "Dashiell", "Evander", "Fiora", "Galen", "Honora", "Ignatius",
  "Juniper", "Linnea", "Magnus", "Octavia", "Phineas", "Rowena", "Sabine", "Thaddeus", "Verity", "Wilder", "Aurelio"];
const LAST = ["Ashgrove", "Blackwood", "Coldwater", "Dunmore", "Elderfield", "Fairhaven", "Greystoke", "Hawthorne", "Ironside",
  "Juniperhill", "Kingsley", "Larkspur", "Merriweather", "Northcott", "Oakenshaw", "Pendleton", "Quarrington", "Ravenscroft",
  "Silverthorn", "Thistlewood", "Underhill", "Valemont", "Whitlock", "Yarborough", "Zellweger", "Ambleside", "Brackenbury",
  "Cranleigh", "Drummond", "Eversley", "Foxworth", "Glenmore", "Hartigan", "Inglewood", "Kilbride", "Lockhart", "Moorcroft",
  "Netherby", "Ormsby", "Penhallow", "Rookwood", "Stanhope", "Tregarthen", "Wexcombe", "Abernathy", "Birchall", "Calloway",
  "Dalrymple", "Ellsworth", "Fennimore", "Gallagher", "Holloway", "Kettering", "Lindqvist", "Mallory", "Norwood", "Pembrook",
  "Quenby", "Redfern", "Sedgwick", "Tolliver", "Wakefield", "Ashcombe", "Bellamy", "Crowther", "Delacroix", "Easterby",
  "Fairweather", "Goodfellow", "Hargreaves"];
const TEAMS = ["Comets", "Falcons", "Otters", "Herons", "Lynx", "Ravens", "Badgers", "Kestrels", "Coyotes", "Marmots"];

// --- collect every name ------------------------------------------------------------------------
type Fixture = any;
const fixtures: Fixture[] = FIXTURES.map((f) => JSON.parse(readFileSync(f, "utf8")));
const csvText = CSVS.map((f) => readFileSync(f, "utf8"));

/** Names in the order they become canonical: roster players first, then everything recorded. */
const names: string[] = [];
const add = (n: unknown) => { if (typeof n === "string" && n.trim() && !KEEP(n)) names.push(n); };
for (const fx of fixtures) for (const p of fx.players) add(p.name);
for (const fx of fixtures) {
  for (const t of fx.trades) add(t.player);
  for (const e of fx.events) { add(e.player); add(e.lastPlayer); add(e.secLastPlayer); }
  for (const s of fx.sheetEntries) { add(s.player); add(s.subbedFor); }
  for (const n of Object.keys(fx.expected?.salaries ?? {})) add(n);
}
const csvRows = csvText.map(parseCsv);
for (const rows of csvRows) for (const r of rows.slice(1)) for (const i of playerCols(rows[0])) add(r[i]);

// --- fake names --------------------------------------------------------------------------------
/** Deterministic shuffle so the fakes don't follow the alphabet of the real names. */
function* candidates() {
  const order = (n: number, seed: number) => Array.from({ length: n }, (_, i) => i).sort((a, b) => ((a * 7919 + seed) % 104729) - ((b * 7919 + seed) % 104729));
  for (const l of order(LAST.length, 31)) for (const f of order(FIRST.length, 17)) yield `${FIRST[f]} ${LAST[l]}`;
}
const pool = candidates();
const taken: string[] = [];
function freshName() {
  // pool.next(), not for...of: returning from a for...of would close the generator.
  for (let it = pool.next(); !it.done; it = pool.next()) {
    const c = it.value;
    const k = nameKey(c);
    // Far apart: no likelySame link and at least 6 letters different from every earlier fake.
    if (taken.some((t) => likelySame(t, c) || editDistance(nameKey(t), k) < 6)) continue;
    taken.push(c);
    return c;
  }
  throw new Error("Ran out of fake names; add words to FIRST/LAST.");
}

/** Lower-case the fake when the real spelling was all lower case, so case-only variants survive. */
const styled = (fake: string, real: string) => (real === real.toLowerCase() ? fake.toLowerCase() : fake);

/** The fake form of `variant`, given the fake for the real name it's a misspelling or short form of. */
const variantCount = new Map<string, number>();
function variantOf(variantBase: string, canonBase: string, fakeCanon: string) {
  const v = nameKey(variantBase), c = nameKey(canonBase);
  if (v === c) return styled(fakeCanon, variantBase);
  const d = editDistance(v, c);
  if (d <= (Math.min(v.length, c.length) >= 8 ? 2 : 1)) {
    // A different letter for each misspelling of the same name, so they stay different people.
    const n = variantCount.get(fakeCanon) ?? 0;
    variantCount.set(fakeCanon, n + 1);
    return styled(`${fakeCanon}${"xqzjkv"[n].repeat(d)}`, variantBase);
  }
  // Short first name: keep the same share of the fake first name (at least 3 letters).
  const [vf] = v.split(" "), [cf] = c.split(" ");
  const [ff, ...rest] = fakeCanon.split(" ");
  const keep = Math.max(3, Math.min(ff.length - 3, Math.round((ff.length * Math.min(vf.length, cf.length)) / Math.max(vf.length, cf.length))));
  const short = vf.length < cf.length ? ff.slice(0, keep) : `${ff}${"a".repeat(vf.length - cf.length)}`;
  return styled([short, ...rest].join(" "), variantBase);
}

const canon = new Map<string, { real: string; fake: string }>(); // nameKey(real base) -> canonical
const baseMap = new Map<string, string>();                         // nameKey(real base) -> fake base (unstyled for canonicals)
function fakeBase(realBase: string) {
  const k = nameKey(realBase);
  const known = baseMap.get(k);
  if (known) return styled(known, realBase);
  let best: { c: { real: string; fake: string }; d: number } | undefined;
  for (const c of canon.values()) {
    if (!likelySame(realBase, c.real)) continue;
    const d = editDistance(k, nameKey(c.real));
    if (!best || d < best.d) best = { c, d };
  }
  if (best) {
    const f = variantOf(realBase, best.c.real, best.c.fake);
    baseMap.set(k, f);
    return f;
  }
  const f = freshName();
  canon.set(k, { real: realBase.trim(), fake: f });
  baseMap.set(k, f);
  return styled(f, realBase);
}

/** A full name, with any " Sub" suffix and surrounding spaces carried over as written. */
const full = new Map<string, string>();
function fake(raw: string): string;
function fake(raw: string | null | undefined): string | null | undefined;
function fake(raw: string | null | undefined) {
  if (typeof raw !== "string" || !raw.trim() || KEEP(raw)) return raw;
  const hit = full.get(raw);
  if (hit !== undefined) return hit;
  const base = stripSub(raw);
  const suffix = raw.trim().slice(base.length);
  const lead = raw.match(/^\s*/)![0], trail = raw.match(/\s*$/)![0];
  const out = lead + fakeBase(base) + suffix + trail;
  full.set(raw, out);
  return out;
}
for (const n of names) fake(n);

// --- check the Names screen sees the same links ------------------------------------------------
const distinct = [...new Map(names.map((n) => [nameKey(n), n])).values()];
const kind = (why: string | null) => (why ? why.replace(/\d+ letters?/, "N letters") : null);
let broken = 0;
for (let i = 0; i < distinct.length; i++) for (let j = i + 1; j < distinct.length; j++) {
  const [a, b] = [distinct[i], distinct[j]];
  const real = kind(likelySame(a, b)), anon = kind(likelySame(fake(a), fake(b)));
  if (real !== anon) { broken++; console.error(`Link differs: "${a}" / "${b}" (${real}) -> "${fake(a)}" / "${fake(b)}" (${anon})`); }
}
const fakeKeys = new Map<string, string>();
for (const n of distinct) {
  const k = nameKey(fake(n));
  if (fakeKeys.has(k) && fakeKeys.get(k) !== nameKey(n)) { broken++; console.error(`Two people share the fake "${fake(n)}"`); }
  fakeKeys.set(k, nameKey(n));
}
if (broken) throw new Error(`${broken} problem(s); nothing written.`);

// --- GMs and team names -------------------------------------------------------------------------
const gmMap = new Map<string, string>();
const teamMap = new Map<string, string>();
let gmN = 0, teamN = 0;
function fakeGm(gm: string, fx: Fixture) {
  if (KEEP(gm)) return gm;
  const hit = gmMap.get(gm);
  if (hit) return hit;
  // "JaneD" or "Jane": find the player it stands for, and shorten their fake name the same way.
  const players: string[] = fx.players.map((p: any) => p.name).filter((n: string) => !/\ssub$/i.test(n));
  const byInitial = players.filter((n) => { const [f, l] = n.split(" "); return l && nameKey(f + l[0]) === nameKey(gm); });
  const byFirst = players.filter((n) => nameKey(n.split(" ")[0]) === nameKey(gm));
  let out: string;
  if (byInitial.length === 1) { const [f, l] = fake(byInitial[0]).split(" "); out = f + l[0]; }
  else if (byFirst.length === 1) out = fake(byFirst[0]).split(" ")[0];
  else out = "";
  // Trades find a team by its GM, so two GMs must never share a fake.
  if (!out || [...gmMap.values()].includes(out)) out = `GM${String(++gmN).padStart(2, "0")}`;
  gmMap.set(gm, out);
  return out;
}
function fakeTeam(t: string | null | undefined, fx?: Fixture) {
  if (typeof t !== "string" || GENERIC_TEAM.test(t)) return t;
  if (fx?.teams.find((x: any) => x.name === t)?.isSubTeam) return t;
  if (/sub team/i.test(t)) return t;
  const hit = teamMap.get(t);
  if (hit) return hit;
  const out = TEAMS[teamN++];
  if (!out) throw new Error("Ran out of fake team names.");
  teamMap.set(t, out);
  return out;
}

// --- write -------------------------------------------------------------------------------------
fixtures.forEach((fx, i) => {
  for (const t of fx.teams) { t.gm = fakeGm(t.gm, fx); }
  const teamName = (t: string) => fakeTeam(t, fx);
  for (const t of fx.teams) t.name = teamName(t.name);
  for (const p of fx.players) { p.name = fake(p.name); p.team = p.team && teamName(p.team); }
  for (const t of fx.trades) { t.player = fake(t.player); t.fromGm = fakeGm(t.fromGm, fx); t.toGm = fakeGm(t.toGm, fx); }
  for (const e of fx.events) {
    e.player = fake(e.player); e.lastPlayer = fake(e.lastPlayer); e.secLastPlayer = fake(e.secLastPlayer);
    e.statTeam = teamName(e.statTeam); e.otherTeam = teamName(e.otherTeam);
  }
  for (const s of fx.sheetEntries) {
    s.player = fake(s.player); s.subbedFor = fake(s.subbedFor);
    s.gameId = typeof s.gameId === "string" ? s.gameId.split("_").map((part: string, j: number) => (j ? teamName(part) : part)).join("_") : s.gameId;
    s.team = teamName(s.team); s.opp = teamName(s.opp);
  }
  if (fx.expected?.salaries) fx.expected.salaries = Object.fromEntries(Object.entries(fx.expected.salaries).map(([n, v]) => [fake(n), v]));
  writeFileSync(FIXTURES[i], JSON.stringify(fx, null, 1) + "\n");
});
csvRows.forEach((rows, i) => {
  const cols = playerCols(rows[0]);
  const teamCols = ["statTeam", "otherTeam"].map((c) => rows[0].indexOf(c)).filter((x) => x >= 0);
  const out = rows.map((r, n) => (n === 0 ? r : r.map((v, c) => (cols.includes(c) ? fake(v) ?? v : teamCols.includes(c) ? fakeTeam(v) ?? v : v))));
  writeFileSync(CSVS[i], (csvText[i].startsWith("﻿") ? "﻿" : "") + out.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n") + (csvText[i].endsWith("\n") ? "\n" : ""));
});

// Longest first, so "Jess Smith Sub" is replaced before "Jess Smith".
const pairs: [string, string][] = [...full.entries(), ...gmMap.entries(), ...teamMap.entries()]
  .map(([a, b]) => [a.trim(), b.trim()] as [string, string]).filter(([a, b]) => a && a !== b).sort((x, y) => y[0].length - x[0].length);
writeFileSync(MAP_FILE, JSON.stringify(Object.fromEntries(pairs), null, 1) + "\n");

const rewrite = process.argv.indexOf("--rewrite");
if (rewrite >= 0) {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w])(${pairs.map(([a]) => esc(a)).join("|")})(?![\\w])`, "g");
  const to = new Map(pairs);
  for (const f of process.argv.slice(rewrite + 1)) {
    const before = readFileSync(f, "utf8");
    const after = before.replace(re, (m) => to.get(m) ?? m);
    if (after !== before) { writeFileSync(f, after); console.log(`rewrote ${f}`); }
  }
}
console.log(`${canon.size} people, ${full.size} spellings, ${gmMap.size} GMs, ${teamMap.size} team names. Mapping in ${MAP_FILE} (git-ignored).`);

// --- csv helpers -------------------------------------------------------------------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function playerCols(header: string[]) { return ["player", "lastPlayer", "secLastPlayer"].map((c) => header.indexOf(c)).filter((x) => x >= 0); }
