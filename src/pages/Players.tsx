import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { delta, money } from "../lib/format";
import { useSeason } from "../lib/SeasonContext";

type SortKey = "name" | "team" | "salary" | "change" | "gp" | "goals" | "assists" | "blocks" | "turnovers";

export function Players() {
  const { input, result, provisional } = useSeason();
  const [params, setParams] = useSearchParams();
  const team = params.get("team") ?? "";
  const [week, setWeek] = useState(input.throughWeek);
  const [q, setQ] = useState("");
  const [showSubs, setShowSubs] = useState(false);
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: "salary", desc: true });

  const rows = useMemo(() => {
    const stats = new Map<string, { gp: number; goals: number; assists: number; blocks: number; turnovers: number }>();
    for (const l of result.lines) {
      if (l.week > week || l.role === "absent") continue;
      const s = stats.get(l.player) ?? { gp: 0, goals: 0, assists: 0, blocks: 0, turnovers: 0 };
      s.gp++; s.goals += l.goals; s.assists += l.assists; s.blocks += l.blocks; s.turnovers += l.drops + l.throwaways;
      stats.set(l.player, s);
    }
    return input.players.map((p) => ({
      p,
      team: result.teamOf(p.name, week + 1) ?? (p.isSub ? "Sub pool" : "—"),
      salary: result.salary[p.name][week],
      change: week === 0 ? 0 : result.salary[p.name][week] - result.salary[p.name][week - 1],
      ...(stats.get(p.name) ?? { gp: 0, goals: 0, assists: 0, blocks: 0, turnovers: 0 }),
    }));
  }, [input, result, week]);

  const shown = rows
    .filter((r) => (showSubs || !r.p.isSub) && (!team || r.team === team) && r.p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      const k = sort.k;
      const va = k === "name" ? a.p.name : (a as any)[k], vb = k === "name" ? b.p.name : (b as any)[k];
      const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      return sort.desc ? -c : c;
    });

  const th = (k: SortKey, label: string, num = true) => (
    <th className={num ? "num" : ""} aria-sort={sort.k === k ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button className="sort" onClick={() => setSort({ k, desc: sort.k === k ? !sort.desc : num })}>
        {label}{sort.k === k ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <main className="page">
      <div className="toolbar">
        <input type="search" placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={team} onChange={(e) => setParams(e.target.value ? { team: e.target.value } : {})}>
          <option value="">All teams</option>
          {input.teams.filter((t) => !t.isSubTeam).map((t) => <option key={t.name}>{t.name}</option>)}
        </select>
        <label>After
          <select value={week} onChange={(e) => setWeek(+e.target.value)}>
            {Array.from({ length: input.throughWeek + 1 }, (_, i) => <option key={i} value={i}>{i === 0 ? "start" : `week ${i}${provisional.includes(i) ? " (provisional)" : ""}`}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={showSubs} onChange={(e) => setShowSubs(e.target.checked)} /> Sub pool</label>
      </div>
      <div className="card scroll-x">
        <table className="data">
          <thead><tr>
            {th("name", "Player", false)}{th("team", "Team", false)}
            {th("salary", "Salary")}{th("change", week ? `Week ${week}` : "Change")}
            {th("gp", "GP")}{th("goals", "G")}{th("assists", "A")}{th("blocks", "D")}{th("turnovers", "TO")}
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.p.name}>
                <td><Link to={`../players/${encodeURIComponent(r.p.name)}`}>{r.p.name}</Link>
                  {r.p.isPlug && <span className="tag" title="Roster filler">plug</span>}</td>
                <td className="muted">{r.team}</td>
                <td className="num">{money(r.salary)}</td>
                <td className={"num " + (r.change > 0 ? "up" : r.change < 0 ? "down" : "muted")}>{delta(r.change)}</td>
                <td className="num">{r.gp}</td><td className="num">{r.goals}</td><td className="num">{r.assists}</td>
                <td className="num">{r.blocks}</td><td className="num">{r.turnovers}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">No players match.</p>}
      </div>
      <p className="muted small">GP counts every appearance, including games played as a sub. TO is drops plus throwaways.</p>
    </main>
  );
}
