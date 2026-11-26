// A finished season from a PRG master sheet (.xlsx), as a history record. Columns are found by
// their headers, not their letters, because the Rankings tab's columns moved between seasons.
//
//   Setup            teams (GM shortname → team name); players' division, starting salary and GM
//   4. Stats Entry   one row per player per game: the stats, own games and sub games
//   Rankings         end-of-season salary and team (after trades); a cross-check of games played
//   Summary          standings, and the weeks counted (cell A1)
//   Schedule         game nights
import { emptyLine, sheetSeasonId, type HistoryLine, type HistoryPlayer, type HistorySeason, type HistoryTeam } from "./history";
import { nameKey, stripSub } from "./names";

export type Cell = string | number | boolean | Date | null | undefined;
export interface SheetTab { sheet: string; data: Cell[][] }

/** Placeholder rows the sheets carry ("Unknown_Stat", "zSub_T1", "Sub2"). */
const PLACEHOLDER = /^(unknown[_ ]?stat|zsub_.*|sub\s*\d+|#n\/a|#ref!|total|grand total)$/i;
/** Roster fillers ("T1-ExtraF+ Spot", "T3-Extra-F+ Sub"). */
const PLUG = /^t\d+\s*-\s*extra/i;
export const isPlaceholder = (n: string) => PLACEHOLDER.test(n.trim()) || PLUG.test(n.trim());

const norm = (v: Cell) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const text = (v: Cell) => (v === null || v === undefined ? "" : v instanceof Date ? "" : String(v).trim());
const num = (v: Cell) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** "2025_EUPA_4v4_S1_-__Master_Sheet_-_Working.xlsx" → "2025 EUPA 4v4 S1"; "2026-PRG_Thursday_…" → "2026 PRG Thursday …". */
export function seasonNameFromFile(file: string) {
  const base = file.replace(/^.*[\\/]/, "").replace(/\.xlsx?$/i, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  const cut = base.split(/\s+-\s+(?=master sheet)/i)[0].replace(/\s+-\s*$/, "").replace(/^(\d{4})-(?=\p{L})/u, "$1 ").trim();
  return cut || base || "Imported season";
}

function tab(tabs: SheetTab[], name: string) {
  return tabs.find((t) => norm(t.sheet) === norm(name))?.data ?? null;
}

/** The first row (of the first `within`) holding every header; each header's column, first match. */
function headerRow(data: Cell[][], need: string[], within = 20) {
  for (let r = 0; r < Math.min(within, data.length); r++) {
    const cells = (data[r] ?? []).map(norm);
    if (need.every((h) => cells.includes(h))) {
      const col = (h: string, from = 0) => { const i = cells.indexOf(h, from); return i; };
      return { row: r, cells, col };
    }
  }
  return null;
}

/** "SubF " → "F", "NA" → "?". */
const groupOf = (g: Cell) => {
  const s = text(g).toUpperCase().replace(/^SUB/, "").trim();
  return s === "F" || s === "M" || s === "X" ? s : "?";
};

export interface ParsedSheet { season: HistorySeason; notes: string[] }

export function parseMasterSheet(tabs: SheetTab[], file: string, now = new Date()): ParsedSheet {
  const notes: string[] = [];
  const setup = tab(tabs, "Setup"), entry = tab(tabs, "4. Stats Entry");
  if (!setup || !entry) throw new Error(`${file} doesn't look like a master sheet: it needs the “Setup” and “4. Stats Entry” tabs.`);

  // --- Setup: teams, then players -------------------------------------------------------
  const tH = headerRow(setup, ["team name", "gm shortname"]);
  const teamOfGm = new Map<string, string>();
  if (tH) {
    const name = tH.col("team name"), gm = tH.col("gm shortname");
    for (let r = tH.row + 1; r < Math.min(setup.length, tH.row + 20); r++) {
      const t = text(setup[r]?.[name]), g = text(setup[r]?.[gm]);
      if (t && g && g.toLowerCase() !== "sub" && !t.startsWith("#")) teamOfGm.set(g, t);
    }
  }
  const pH = headerRow(setup, ["player", "initial salary", "gender-match"]);
  if (!pH) throw new Error(`${file}: the Setup tab has no player list (Gender-Match, Player, Initial Salary, GM).`);
  const pName = pH.col("player"), pSal = pH.col("initial salary"), pGender = pH.col("gender-match"), pGm = pH.col("gm", pName);
  const setupPlayers = new Map<string, { name: string; group: string; salary: number; gm: string }>();
  for (let r = pH.row + 1; r < setup.length; r++) {
    const n = text(setup[r]?.[pName]);
    if (!n || isPlaceholder(n)) continue;
    setupPlayers.set(nameKey(n), { name: n, group: groupOf(setup[r]?.[pGender]), salary: num(setup[r]?.[pSal]), gm: pGm >= 0 ? text(setup[r]?.[pGm]) : "" });
  }

  // --- Summary: weeks counted, standings -------------------------------------------------
  const summary = tab(tabs, "Summary");
  let weeks = summary && typeof summary[0]?.[0] === "number" ? Math.round(summary[0][0] as number) : 0;
  const teams: HistoryTeam[] = [];
  const sH = summary ? headerRow(summary, ["team name", "win", "loss"]) : null;
  if (summary && sH) {
    const c = (h: string) => sH.col(h);
    for (let r = sH.row + 1; r < Math.min(summary.length, sH.row + 20); r++) {
      const t = text(summary[r]?.[c("team name")]);
      if (!t || t.startsWith("#")) continue;
      const val = (h: string) => (c(h) >= 0 ? num(summary[r]?.[c(h)]) : 0);
      teams.push({ team: t, gm: c("gm") >= 0 ? text(summary[r]?.[c("gm")]) || null : null, wins: val("win"), losses: val("loss"), ties: val("tie"), goalsFor: val("points for"), goalsAgainst: val("points against") });
    }
    const pct = (t: HistoryTeam) => { const gp = t.wins + t.losses + t.ties; return gp ? (t.wins + t.ties / 2) / gp : 0; };
    teams.sort((a, b) => pct(b) - pct(a) || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor || a.team.localeCompare(b.team));
  } else notes.push("No standings: the sheet has no Summary tab with Team Name, Win and Loss.");

  // --- Stats Entry: every player's games ------------------------------------------------
  const eH = headerRow(entry, ["wk", "player", "subbed for", "played game"]);
  if (!eH) throw new Error(`${file}: the “4. Stats Entry” tab has no header row (Wk, Player, Subbed For, Played Game).`);
  const col = (h: string) => eH.col(h);
  const STAT: [keyof HistoryLine, string][] = [
    ["goals", "points"], ["assists", "assist"], ["secondAssists", "2nd assist"], ["blocks", "knock down"],
    ["drops", "drop"], ["throwaways", "throw away"], ["gso", "gso"], ["touches", "touch"],
  ];
  const missing = STAT.filter(([, h]) => col(h) < 0).map(([, h]) => h);
  if (missing.length) notes.push(`The Stats Entry tab has no ${missing.join(", ")} column, so those count as 0.`);
  const lines = new Map<string, { name: string; own: HistoryLine; sub: HistoryLine }>();
  const skipped = new Set<string>();
  let maxWeek = 0;
  for (let r = eH.row + 1; r < entry.length; r++) {
    const row = entry[r] ?? [];
    const raw = text(row[col("player")]);
    const week = num(row[col("wk")]);
    if (!raw || !week) continue;
    const played = row[col("played game")];
    if (!(played === true || num(played) > 0)) continue;
    if (weeks && week > weeks) continue;
    if (isPlaceholder(raw)) { skipped.add(raw); continue; }
    maxWeek = Math.max(maxWeek, week);
    const isSub = !!text(row[col("subbed for")]) || /\s+sub$/i.test(raw);
    const name = stripSub(raw), key = nameKey(name);
    let p = lines.get(key);
    if (!p) { p = { name: setupPlayers.get(key)?.name ?? name, own: emptyLine(), sub: emptyLine() }; lines.set(key, p); }
    const to = isSub ? p.sub : p.own;
    to.gp++;
    to.wins += col("win?") >= 0 ? num(row[col("win?")]) : 0;
    for (const [k, h] of STAT) if (col(h) >= 0) to[k] += num(row[col(h)]);
  }
  if (!weeks) weeks = maxWeek;
  if (skipped.size) notes.push(`Left out placeholder rows: ${[...skipped].join(", ")}.`);

  // --- Rankings: end salary and final team; games played to cross-check ------------------
  const rankings = tab(tabs, "Rankings");
  const rH = rankings ? headerRow(rankings, ["salary", "games played", "gm"], 5) : null;
  const endOf = new Map<string, { salary: number; gm: string }>();
  const disagree: string[] = [];
  if (rankings && rH) {
    const gpCol = rH.col("games played"), salCol = rH.col("salary"), gmCol = rH.col("gm");
    for (let r = rH.row + 1; r < rankings.length; r++) {
      const n = text(rankings[r]?.[0]);
      if (!n || isPlaceholder(n)) continue;
      const gm = text(rankings[r]?.[gmCol]);
      const sub = gm.toLowerCase() === "sub";
      const key = nameKey(stripSub(n));
      if (!sub) endOf.set(key, { salary: num(rankings[r]?.[salCol]), gm });
      const ours = lines.get(key)?.[sub ? "sub" : "own"].gp ?? 0;
      if (num(rankings[r]?.[gpCol]) !== ours) disagree.push(`${n} (Rankings ${num(rankings[r]?.[gpCol])}, game rows ${ours})`);
    }
    if (disagree.length) notes.push(`Games played differ between the Rankings tab and the game rows for ${disagree.length} row${disagree.length > 1 ? "s" : ""}; the game rows are used: ${disagree.slice(0, 6).join("; ")}${disagree.length > 6 ? "; …" : ""}.`);
  } else notes.push("No Rankings tab with Salary, Games Played and GM, so end-of-season salaries are missing.");

  // --- Schedule: game nights --------------------------------------------------------------
  const schedule = tab(tabs, "Schedule");
  const nights: { week: number; date: string }[] = [];
  const dH = schedule ? headerRow(schedule, ["wk", "date"]) : null;
  if (schedule && dH) {
    for (let r = dH.row + 1; r < schedule.length; r++) {
      const w = schedule[r]?.[dH.col("wk")], d = schedule[r]?.[dH.col("date")];
      if (typeof w === "number" && Number.isInteger(w) && d instanceof Date) nights.push({ week: w, date: iso(d) });
    }
  }
  nights.sort((a, b) => a.week - b.week);
  const counted = nights.filter((n) => n.week <= weeks);
  if (!nights.length) notes.push("No game nights found on the Schedule tab, so the season has no dates.");

  // --- Players: everyone rostered, and anyone who played ----------------------------------
  const players: HistoryPlayer[] = [];
  const noSetup: string[] = [];
  const keys = new Set([...lines.keys(), ...[...setupPlayers].filter(([, p]) => p.gm && p.gm.toLowerCase() !== "sub").map(([k]) => k)]);
  for (const key of keys) {
    const s = setupPlayers.get(key), l = lines.get(key), end = endOf.get(key);
    const gm = end?.gm || s?.gm || "";
    const team = teamOfGm.get(gm) ?? null;
    if (!s) noSetup.push(l!.name);
    players.push({
      name: s?.name ?? l!.name,
      group: s?.group ?? "?",
      team,
      startSalary: s && s.gm.toLowerCase() !== "sub" && s.salary > 0 ? s.salary : null,
      endSalary: end && team && end.salary > 0 ? Math.round(end.salary) : null,
      own: l?.own ?? emptyLine(),
      sub: l?.sub ?? emptyLine(),
    });
  }
  players.sort((a, b) => a.name.localeCompare(b.name));
  if (noSetup.length) notes.push(`${noSetup.length} player${noSetup.length > 1 ? "s aren't" : " isn't"} on the Setup tab, so their division is unknown: ${noSetup.sort().join(", ")}.`);

  const name = seasonNameFromFile(file);
  return {
    season: {
      v: 1, id: sheetSeasonId(name), name, source: "sheet", file: file.replace(/^.*[\\/]/, ""),
      firstDate: nights[0]?.date ?? null, lastDate: (counted.at(-1) ?? nights.at(-1))?.date ?? null, weeks,
      teams, players, updatedAt: now.toISOString(),
    },
    notes,
  };
}

/** Reads an .xlsx file in the browser (the reader loads only when a sheet is imported). */
export async function readWorkbook(file: Blob): Promise<SheetTab[]> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => ({ sheet: s.sheet, data: s.data as Cell[][] }));
}
