import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { autoPairSubs, genderOf } from "../../engine/pairing";
import type { GameLine, SubAssignment } from "../../engine/types";
import { delta, money, shortTeam } from "../lib/format";
import { useSeason } from "../lib/SeasonContext";

const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();

/**
 * The override screen for sub pairing. The engine suggests pairings by the league's rule
 * (same gender; best sub night covers the highest salary); the admin's pick is what counts.
 */
export function Subs() {
  const { input, result, update, resolveName } = useSeason();
  const [week, setWeek] = useState<number | "all">("all");
  const [onlyDiff, setOnlyDiff] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, GameLine[]>();
    for (const l of result.lines) {
      const k = `${l.week}|${l.team}|${l.opp}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    }
    return [...m.values()]
      .filter((g) => g.some((l) => l.role === "sub"))
      .map((g) => ({ lines: g, ...autoPairSubs(g, input.players, (p, w) => result.salary[p]?.[w - 1] ?? 0) }))
      .sort((x, y) => x.lines[0].week - y.lines[0].week || x.lines[0].team.localeCompare(y.lines[0].team));
  }, [result, input.players]);

  const current = (a: { week: number; team: string; opp: string }, sub: string) =>
    input.subAssignments.find((s) => s.week === a.week && s.team === a.team && s.opp === a.opp && same(s.sub, sub))?.subbedFor ?? "";

  const differs = (g: (typeof groups)[number]) =>
    g.flags.length > 0 || g.lines.filter((l) => l.role === "sub").some((l) => {
      const rule = g.assignments.find((a) => a.sub === l.player)?.subbedFor ?? "";
      return !same(rule, current(l, l.player));
    });

  const setAssignments = (week: number, team: string, opp: string, next: { sub: string; subbedFor: string }[]) =>
    update((inp) => ({
      ...inp,
      subAssignments: [
        ...inp.subAssignments.filter((s) => !(s.week === week && s.team === team && s.opp === opp && next.some((n) => same(n.sub, resolveName(s.sub))))),
        ...next.filter((n) => n.subbedFor).map((n): SubAssignment => ({ week, team, opp, ...n })),
      ],
    }));

  const shown = groups.filter((g) => (week === "all" || g.lines[0].week === week) && (!onlyDiff || differs(g)));
  const diffCount = groups.filter(differs).length;
  const gender = (n: string) => genderOf(input.players.find((p) => same(p.name, n))?.gender);

  return (
    <main className="page">
      <div className="toolbar">
        <select value={week} onChange={(e) => setWeek(e.target.value === "all" ? "all" : +e.target.value)}>
          <option value="all">All weeks</option>
          {Array.from({ length: input.throughWeek }, (_, i) => <option key={i} value={i + 1}>Week {i + 1}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          Only where the rule disagrees or can't decide ({diffCount})</label>
        {diffCount > 0 && (
          <button onClick={() => {
            if (!confirm(`Replace the current pairing with the rule's suggestion in ${diffCount} game(s)? Flagged subs the rule can't place are left as they are.`)) return;
            update((inp) => {
              let subs = inp.subAssignments;
              for (const g of groups.filter(differs)) {
                const { week, team, opp } = g.lines[0];
                subs = subs.filter((s) => !(s.week === week && s.team === team && s.opp === opp && g.assignments.some((a) => same(a.sub, resolveName(s.sub)))));
                subs = [...subs, ...g.assignments];
              }
              return { ...inp, subAssignments: subs };
            });
          }}>Apply the rule everywhere</button>
        )}
      </div>
      <p className="muted small">
        A sub's night is credited to the absent player they cover, when it beats that player's absence estimate.
        The rule pairs within gender: the sub who earned the most covers the highest-paid absentee.
      </p>

      {shown.map((g) => {
        const { week, team, opp } = g.lines[0];
        const subs = g.lines.filter((l) => l.role === "sub").sort((x, y) => (y.subEarned ?? 0) - (x.subEarned ?? 0));
        const absent = g.lines.filter((l) => l.role === "absent");
        const picks = subs.map((s) => current(s, s.player)).filter(Boolean);
        const doubled = picks.filter((p, i) => picks.findIndex((q) => same(p, q)) !== i);
        return (
          <section key={`${week}|${team}|${opp}`} className="card scroll-x">
            <div className="row">
              <h2 className="grow">
                <Link to={`../games/${week}/${encodeURIComponent(team)}/${encodeURIComponent(opp)}`}>W{week} · {shortTeam(team)} v {shortTeam(opp)}</Link>
              </h2>
              {differs(g) && g.assignments.length > 0 && (
                <button onClick={() => setAssignments(week, team, opp, g.assignments)}>Use the rule here</button>
              )}
            </div>
            <table className="data">
              <thead><tr><th>Sub</th><th>Gender</th><th className="num">Sub growth</th><th>Subbed for</th><th>Rule says</th></tr></thead>
              <tbody>
                {subs.map((s) => {
                  const cur = current(s, s.player);
                  const rule = g.assignments.find((a) => a.sub === s.player)?.subbedFor ?? "";
                  return (
                    <tr key={s.player}>
                      <td><Link to={`../players/${encodeURIComponent(s.player)}`}>{s.player}</Link></td>
                      <td>{gender(s.player)}</td>
                      <td className="num">{money(s.subEarned ?? 0)}</td>
                      <td>
                        <select value={cur} aria-label={`${s.player} covers`}
                          onChange={(e) => setAssignments(week, team, opp, [{ sub: s.player, subbedFor: e.target.value }])}>
                          <option value="">Nobody</option>
                          {cur && !absent.some((a) => same(a.player, cur)) && <option value={cur}>{cur} (not absent)</option>}
                          {absent.map((a) => (
                            <option key={a.player} value={a.player}>{a.player} ({gender(a.player)}, {money(result.salary[a.player]?.[week - 1])})</option>
                          ))}
                        </select>
                      </td>
                      <td className={same(rule, cur) ? "muted" : "attn"}>{rule || "—"}{!same(rule, cur) && " ≠"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {absent.length > 0 && (
              <p className="small muted">Absent: {absent.map((a) => `${a.player} (${delta(a.growth)}${a.coveredBy ? `, sub: ${a.coveredBy}` : ""})`).join(" · ")}</p>
            )}
            {doubled.length > 0 && <p className="small attn">{doubled.join(", ")} is picked for more than one sub; only the first counts.</p>}
            {g.flags.map((f, i) => <p key={i} className="small attn">⚑ {f.message}</p>)}
          </section>
        );
      })}
      {shown.length === 0 && <p className="empty">{groups.length ? "Every sub is paired the way the rule suggests." : "No subs have played yet."}</p>}
    </main>
  );
}
