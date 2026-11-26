// A small, made-up master sheet laid out like the league's (same tabs, headers in the same rows),
// for the importer's tests and the online browser test. No real league data.
import type { Cell, SheetTab } from "../src/lib/masterSheet";

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const row = (cells: Record<number, Cell>, width = 30) => Array.from({ length: width }, (_, i) => cells[i] ?? null);

export function fakeMasterSheet(opts: { rankingsGmLast?: boolean } = {}): SheetTab[] {
  const setup = [
    row({ 0: "F" }),
    row({ 0: "GM", 1: "Team Name", 2: "Team ID", 3: "Team Shortname", 4: "GM Shortname", 6: "Team", 7: "Team Shortname", 8: "Gender-Match", 9: "Player", 10: "Initial Salary", 11: "GM" }),
    row({ 0: "Gm One", 1: "Team 1 (X)", 4: "GmA", 8: "F", 9: "Ada Alpha", 10: 3_000_000, 11: "GmA" }),
    row({ 0: "Gm Two", 1: "Team 2 (X)", 4: "GmB", 8: "M", 9: "Ben Beta", 10: 2_500_000, 11: "GmA" }),
    row({ 8: "M", 9: "Cal Gamma", 10: 2_000_000, 11: "GmB" }),
    row({ 0: "The Sub Team", 1: "Ze Sub Team", 4: "Sub", 8: "SubF", 9: "Dee Delta", 10: 0, 11: "Sub" }),
    row({ 8: "SubM ", 9: "Eli Never", 10: 0, 11: "Sub" }),
    row({ 8: "F", 9: "T1-ExtraF+ Spot", 10: 1_000_000, 11: "GmA" }),
  ];
  const H = ["Wk", "Game", "GameID", "Team", "Opp. Team", "Player", "Sub?", "Subbed For", "Played Game", "Win?", "Points", "Assist", "2nd Assist", "Knock Down", "Drop", "Throw Away", "GSO", "Touch"];
  const g = (wk: number, team: string, opp: string, p: string | null, subFor: string | null, played: number, win: number, pts: number, ast = 0, touch = 5) =>
    [wk, 1, "id", team, opp, p, null, subFor, played, win, pts, ast, 0, 0, 0, 0, 0, touch];
  const entry: Cell[][] = [[], [], [], [], [], [], H,
    g(1, "Team 1 (X)", "Team 2 (X)", null, null, 0, 0, 0),                         // empty slot
    g(1, "Team 1 (X)", "Team 2 (X)", "Ada Alpha", null, 1, 1, 3, 1),
    g(1, "Team 1 (X)", "Team 2 (X)", "Dee Delta", "Ben Beta", 1, 1, 2),              // sub for an absent player
    g(1, "Team 1 (X)", "Team 2 (X)", "Ben Beta", null, 0, 0, 0),                     // absent
    g(1, "Team 2 (X)", "Team 1 (X)", "Cal Gamma", null, 1, 0, 1),
    g(1, "Team 2 (X)", "Team 1 (X)", "Unknown_Stat", null, 1, 0, 1),
    g(2, "Team 1 (X)", "Team 2 (X)", "Ada Alpha", null, 1, 0.5, 2),
    g(2, "Team 1 (X)", "Team 2 (X)", "Ben Beta", null, 1, 0.5, 0, 4),
    g(2, "Team 2 (X)", "Team 1 (X)", "Ada Alpha Sub", "Cal Gamma", 1, 0.5, 1),       // a rostered player subbing
    g(2, "Team 2 (X)", "Team 1 (X)", "Fay Walkon", null, 1, 0.5, 2),               // not on Setup
    g(3, "Team 1 (X)", "Team 2 (X)", "Ada Alpha", null, 1, 1, 9),                   // week 3 isn't counted yet
  ];
  const rk = opts.rankingsGmLast
    ? ["Row Labels", "Salary", "Player Growth", "Sub Growth", "Total Growth", "Games Played", "Wins", "Points", "GSO/GP", "GM"]
    : ["Row Labels", "Salary", "Salary Growth", "Games Played", "GM"];
  const rr = (name: string, sal: number, gp: number, gm: string) => (opts.rankingsGmLast ? [name, sal, 0, 0, 0, gp, 0, 0, 0, gm] : [name, sal, 0, gp, gm]);
  const rankings = [rk, rr("Ada Alpha", 4_200_000, 2, "GmA"), rr("Ben Beta", 2_600_000, 1, "GmB"), rr("Cal Gamma", 2_100_000, 1, "GmB"),
    rr("T1-ExtraF+ Spot", 1_000_000, 0, "GmA"), rr("Dee Delta", 0, 1, "Sub"), rr("Ada Alpha Sub", 0, 9, "Sub"), rr("Fay Walkon", 0, 1, "Sub")];
  const summary = [row({ 0: 2, 1: "<--No Touchy" }), row({ 5: "Current Budget Cap:" }),
    row({ 0: "Team Name", 1: "GM", 2: "Win", 3: "Loss", 4: "Tie", 10: "Points For", 11: "Points Against" }),
    row({ 0: "Team 1 (X)", 1: "GmA", 2: 1, 3: 0, 4: 1, 10: 20, 11: 15 }),
    row({ 0: "Team 2 (X)", 1: "GmB", 2: 0, 3: 1, 4: 1, 10: 15, 11: 20 }),
    row({ 0: "#N/A", 2: 0, 3: 0 })];
  const schedule = [row({ 0: 2, 2: "Slot" }), [], [], [], row({ 0: "Wk", 1: "Date", 2: "Time" }),
    row({ 0: 1, 1: D("2025-01-02") }), row({ 0: 2, 1: D("2025-01-09") }), row({ 0: 3, 1: D("2025-01-16") }), row({ 0: 1, 1: "20:15-20:35" })];
  return [
    { sheet: "Rankings", data: rankings }, { sheet: "Summary", data: summary }, { sheet: "4. Stats Entry", data: entry },
    { sheet: "Setup", data: setup }, { sheet: "Schedule ", data: schedule },
  ];
}

/** The same sheet as an .xlsx file, as Google Sheets' Download → Microsoft Excel gives it. */
export async function fakeMasterSheetXlsx(): Promise<Buffer> {
  const { default: writeExcelFile } = await import("write-excel-file/node");
  const cell = (v: Cell) => (v instanceof Date ? { value: v, type: Date, format: "yyyy-mm-dd" } : v === undefined ? null : v);
  const sheets = fakeMasterSheet().map((t) => ({ sheet: t.sheet, data: t.data.map((r) => (r.length ? r.map(cell) : [null])) }));
  return (await writeExcelFile(sheets as any).toBuffer()) as Buffer;
}
