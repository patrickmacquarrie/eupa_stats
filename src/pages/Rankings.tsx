import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { downloadText } from "../lib/store";
import { money, shortTeam } from "../lib/format";
import { useSeason } from "../lib/SeasonContext";
import { cellText, RANK_COLUMNS, rankings, rankingsCsv, type RankColumn, type RankRow } from "../lib/rankings";

/** Excel number formats matching the master sheet's Rankings tab. */
const XLSX_FORMAT: Record<RankColumn["kind"], string | undefined> = {
  money: '"$"#,##0;-"$"#,##0', int: "#,##0", dec: "#,##0.00", pct: "0.0%", text: undefined,
};

/** The master sheet's Rankings tab: every player's salary, growth, stats and rates, sortable, and downloadable. */
export function Rankings() {
  const { season, input, result, provisional } = useSeason();
  const last = input.throughWeek;
  const [week, setWeek] = useState(last);
  const w = Math.min(week, last);
  const [team, setTeam] = useState("");
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const { rows, avgGso } = useMemo(() => rankings(input, result, w), [input, result, w]);
  const teams = input.teams.filter((t) => !t.isSubTeam);

  const shown = useMemo(() => {
    const xs = rows.filter((r) => !team || (team === "__subs" ? r.sub : r.team === team));
    if (!sort) return xs;
    const col = RANK_COLUMNS.find((c) => c.key === sort.key)!;
    const v = (r: RankRow) => col.value(r, avgGso);
    return [...xs].sort((a, b) => {
      const x = v(a), y = v(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;   // blanks last either way
      const c = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
      return sort.desc ? -c : c;
    });
  }, [rows, team, sort, avgGso]);

  const fileBase = `${season.name} - Rankings through week ${w}`;
  const downloadXlsx = async () => {
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    const header = RANK_COLUMNS.map((c) => ({ value: c.label, fontWeight: "bold" as const, backgroundColor: "#DBE5F1", wrap: true }));
    const body = shown.map((r) => RANK_COLUMNS.map((c) => {
      const v = c.value(r, avgGso);
      if (v === null || v === undefined) return null;
      return typeof v === "string" ? { value: v } : { value: v, type: Number, format: XLSX_FORMAT[c.kind] };
    }));
    await writeExcelFile([header, ...body] as any, {
      sheet: "Rankings", stickyRowsCount: 1, stickyColumnsCount: 1,
      columns: RANK_COLUMNS.map((c) => ({ width: c.key === "name" ? 24 : c.kind === "money" ? 13 : 10 })),
    }).toFile(`${fileBase}.xlsx`);
  };

  const th = (c: RankColumn, i: number) => (
    <th key={c.key} className={(c.kind === "text" ? "" : "num") + (i === 0 ? " name-col" : "")} title={c.title}
      aria-sort={sort?.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button className="sort" onClick={() => setSort(sort?.key === c.key ? { key: c.key, desc: !sort.desc } : { key: c.key, desc: c.kind !== "text" })}>
        {c.label}{sort?.key === c.key ? (sort.desc ? " ▼" : " ▲") : ""}
      </button>
    </th>
  );
  const td = (c: RankColumn, r: RankRow, i: number) => {
    const v = c.value(r, avgGso);
    const text = c.kind === "money" && typeof v === "number" ? money(v) : cellText(c, r, avgGso);
    return (
      <td key={c.key} className={(c.kind === "text" ? "" : "num") + (i === 0 ? " name-col" : "") + (typeof v === "number" && v < 0 && c.kind !== "pct" ? " neg" : "")}>
        {i === 0 ? <Link to={`../players/${encodeURIComponent(r.player)}`}>{text}</Link> : text}
      </td>
    );
  };

  return (
    <main className="page wide">
      <div className="toolbar">
        <label>Through
          <select value={w} onChange={(e) => setWeek(+e.target.value)}>
            {Array.from({ length: last + 1 }, (_, i) => i).map((wk) => (
              <option key={wk} value={wk}>{wk === 0 ? "start of season" : `week ${wk}${provisional.includes(wk) ? " (provisional)" : ""}`}</option>
            ))}
          </select>
        </label>
        <label>Show
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Everyone</option>
            {teams.map((t) => <option key={t.name} value={t.name}>{shortTeam(t.name)}{t.gm ? ` (${t.gm})` : ""}</option>)}
            <option value="__subs">Sub appearances</option>
          </select>
        </label>
        {sort && <button className="link small" onClick={() => setSort(null)}>Back to the sheet's order</button>}
        <span className="grow" />
        <button className="primary" onClick={downloadXlsx}>Download Excel</button>
        <button onClick={() => downloadText(`${fileBase}.csv`, rankingsCsv(shown, avgGso))}>CSV</button>
      </div>
      <section className="card rankings">
        <div className="scroll-x rankings-scroll">
          <table className="data compact rankings-table">
            <thead><tr>{RANK_COLUMNS.map(th)}</tr></thead>
            <tbody>
              {shown.map((r) => <tr key={r.name} className={r.sub ? "sub-row" : ""}>{RANK_COLUMNS.map((c, i) => td(c, r, i))}</tr>)}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          As on the master sheet's Rankings tab: a player's own row counts games for their team; games they subbed for another team are a
          separate “(sub)” row. Points are goals; Stats are points + assists + blocks; a tie is half a win. League average GSO per game:{" "}
          {avgGso.toFixed(2)}. Click a column to sort.
        </p>
      </section>
    </main>
  );
}
