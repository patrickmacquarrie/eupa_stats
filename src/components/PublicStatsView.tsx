import { Fragment, useMemo, useState } from "react";
import { COLUMNS, fmtStat, groupLabel, leaderboards, type ColumnKey, type Snapshot } from "../lib/publicStats";

/** What players see: leaderboards by gender group, then every player's line. */
export function PublicStatsView({ snapshot }: { snapshot: Snapshot }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [sort, setSort] = useState<{ k: ColumnKey | "name"; desc: boolean }>({ k: "name", desc: false });
  const boards = useMemo(() => leaderboards(snapshot), [snapshot]);
  const cols = COLUMNS.filter((c) => snapshot.settings.columns.includes(c.key));
  const groups = boards.map((g) => g.group); // same order as the leaderboards (F+ first)

  const rows = snapshot.rows
    .filter((r) => (group === "all" || r.group === group) && r.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sort.k === "name") return sort.desc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
      const c = COLUMNS.find((x) => x.key === sort.k)!;
      const d = (c.value(a) ?? -1) - (c.value(b) ?? -1);
      return (sort.desc ? -d : d) || a.name.localeCompare(b.name);
    });
  const th = (k: ColumnKey | "name", label: string, num = true) => (
    <th className={num ? "num" : "name-col"} aria-sort={sort.k === k ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button className="sort" onClick={() => setSort({ k, desc: sort.k === k ? !sort.desc : num })}>{label}{sort.k === k ? (sort.desc ? " ↓" : " ↑") : ""}</button>
    </th>
  );

  return (
    <div className="pub">
      <header className="pub-head">
        <h1>{snapshot.season}</h1>
        <p className="muted">Player stats through week {snapshot.throughWeek} · updated {new Date(snapshot.generatedAt).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}</p>
      </header>

      {groups.length > 1 && (
        <div className="seg division" role="group" aria-label="Division">
          {["all", ...groups].map((g) => (
            <button key={g} aria-pressed={group === g} onClick={() => setGroup(g)}>{g === "all" ? "Everyone" : groupLabel(g)}</button>
          ))}
        </div>
      )}

      {boards.some((g) => g.boards.length) && (
        <section aria-labelledby="lb-title">
          <h2 id="lb-title">Leaderboard</h2>
          {snapshot.settings.minGames > 1 && <p className="muted small">Players with at least {snapshot.settings.minGames} games.</p>}
          {boards.filter((g) => group === "all" || g.group === group).map((g) => (
            <div key={g.group} className="lb-group">
              {boards.length > 1 && <h3 className="lb-label">{g.label}</h3>}
              <div className="lb-grid">
                {g.boards.map((b) => (
                  <div key={b.key} className="lb-card">
                    <div className="lb-title" title={b.note}>{b.label}</div>
                    <ol>
                      {b.top.map((t, i) => (
                        <li key={t.name}><span className="lb-rank">{i + 1}</span><span className="lb-name">{t.name}</span><span className="lb-val">{t.value.toFixed(1)}</span></li>
                      ))}
                      {b.top.length === 0 && <li className="muted small">No games yet</li>}
                    </ol>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="all-title">
        <div className="row wrap gap-sm pub-tools">
          <h2 id="all-title" className="grow">All players</h2>
          <input id="pub-search" type="search" placeholder="Find a player" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a player" />
        </div>
        <div className="pub-table scroll-x">
          <table className="data">
            <thead><tr>{th("name", "Name", false)}{cols.map((c) => <Fragment key={c.key}>{th(c.key, c.label)}</Fragment>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="name-col">{r.name}</td>
                  {cols.map((c) => <td key={c.key} className="num">{fmtStat(c.value(r), c.perGame)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="empty">No players match.</p>}
        </div>
      </section>
    </div>
  );
}
