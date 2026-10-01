import type { PlayEvent } from "../../engine/types";

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF, and a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Mon Aug 31 2026" (the tablet app's format) or "2026-08-31" → "2026-08-31". */
export function isoDate(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/.exec(t);
  if (m) {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    if (mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  throw new Error(`Unrecognised date "${s}"`);
}

/** One tablet export (one team's side of one game) → engine events. */
export function tabletCsvToEvents(text: string): PlayEvent[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) throw new Error("Empty file");
  const col = (name: string) => head.findIndex((h) => h.trim() === name);
  const need = ["date", "time", "statTeam", "otherTeam", "statTeamScore", "otherTeamScore", "action", "player"];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(", ")}`);
  const get = (r: string[], n: string) => { const i = col(n); return i < 0 ? "" : (r[i] ?? "").trim(); };
  return rows.map((r) => ({
    date: isoDate(get(r, "date")),
    clock: get(r, "time"),
    statTeam: get(r, "statTeam"),
    otherTeam: get(r, "otherTeam"),
    statScore: Number(get(r, "statTeamScore")),
    otherScore: Number(get(r, "otherTeamScore")),
    action: get(r, "action"),
    player: get(r, "player") || null,
    lastPlayer: get(r, "lastPlayer") || null,
    secLastPlayer: get(r, "secLastPlayer") || null,
    ...(get(r, "gameTime") ? { gameTime: get(r, "gameTime") } : {}),
  }));
}
