import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { genderOf } from "../../engine/pairing";
import type { GameLine, SubAssignment } from "../../engine/types";
import { subKey } from "../lib/autoMatch";
import { delta, money, shortTeam } from "../lib/format";
import { useSeason } from "../lib/SeasonContext";
import { autoMatchOn } from "../lib/season";

const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();

/** Select value for "no saved pick": auto-match decides, or (with it off) nobody has yet. */
const NO_PICK = "\u0000none";

/**
 * Who each sub covered. With auto-match subs on, every sub gets a match unless one can't be
 * made; the admin can override any of them. With it off, every sub needs a pick here.
 */
export function Subs() {
  const { season, input, result, update, resolveName, autoMatched, unmatched } = useSeason();
  const auto = autoMatchOn(season);
  const [week, setWeek] = useState<number | "all">("all");
  const [onlyOpen, setOnlyOpen] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, GameLine[]>();
    for (const l of result.lines) {
      const k = `${l.week}|${l.team}|${l.opp}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    }
    return [...m.values()].filter((g) => g.some((l) => l.role === "sub"))
      .sort((x, y) => x[0].week - y[0].week || x[0].team.localeCompare(y[0].team));
  }, [result]);

  /** The admin's saved pick for a sub: a name, "" for nobody (an extra player), or undefined. */
  const saved = (a: { week: number; team: string; opp: string }, sub: string) =>
    season.input.subAssignments.find((s) => s.week === a.week && s.team === a.team && s.opp === a.opp && same(resolveName(s.sub), sub))?.subbedFor;
  /** Who the sub covers in the numbers right now: a saved pick or an auto-match. */
  const current = (l: GameLine) => input.subAssignments.find((s) => s.week === l.week && s.team === l.team && s.opp === l.opp && same(s.sub, l.player))?.subbedFor;

  /** `subbedFor`: a name, "" for nobody (an extra player), or undefined to clear the saved pick. */
  const setPick = (l: GameLine, subbedFor: string | undefined) =>
    update((inp) => ({
      ...inp,
      subAssignments: [
        ...inp.subAssignments.filter((s) => !(s.week === l.week && s.team === l.team && s.opp === l.opp && same(resolveName(s.sub), l.player))),
        ...(subbedFor === undefined ? [] : [{ week: l.week, team: l.team, opp: l.opp, sub: l.player, subbedFor } satisfies SubAssignment]),
      ],
    }));

  /** Needs a look: the admin overrode it, or nothing covers it yet. */
  const needsLook = (l: GameLine) => saved(l, l.player) !== undefined || current(l) === undefined;
  const shown = groups.filter((g) => (week === "all" || g[0].week === week) && (!onlyOpen || g.some((l) => l.role === "sub" && needsLook(l))));
  const openCount = groups.filter((g) => g.some((l) => l.role === "sub" && needsLook(l))).length;
  const gender = (n: string) => genderOf(input.players.find((p) => same(p.name, n))?.gender);

  return (
    <main className="page">
      <div className="toolbar">
        <select value={week} onChange={(e) => setWeek(e.target.value === "all" ? "all" : +e.target.value)} aria-label="Week">
          <option value="all">All weeks</option>
          {Array.from({ length: input.throughWeek }, (_, i) => <option key={i} value={i + 1}>Week {i + 1}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          Only overrides and unmatched ({openCount})</label>
      </div>
      <p className="muted small">
        A sub's night is credited to the absent player they cover, when it beats that player's absence estimate.{" "}
        {auto
          ? <>Auto-match subs is on: each sub covers an absent player of the same gender, the sub with the best night covering the highest-paid absent player, and so on down. Change any match below; <Link to="../admin/setup">Setup</Link> turns auto-match off.</>
          : <>Auto-match subs is off, so every sub needs a match picked here. <Link to="../admin/setup">Setup</Link> turns it on.</>}
      </p>

      {shown.map((g) => {
        const { week, team, opp } = g[0];
        const subs = g.filter((l) => l.role === "sub").sort((x, y) => (y.subEarned ?? 0) - (x.subEarned ?? 0));
        const absent = g.filter((l) => l.role === "absent");
        const picks = subs.map((s) => current(s)).filter(Boolean) as string[];
        const doubled = picks.filter((p, i) => picks.findIndex((q) => same(p, q)) !== i);
        const why = unmatched.filter((f) => f.week === week && f.team === team && f.opp === opp);
        return (
          <section key={`${week}|${team}|${opp}`} className="card scroll-x">
            <h2>
              <Link to={`../games/${week}/${encodeURIComponent(team)}/${encodeURIComponent(opp)}`}>W{week} · {shortTeam(team)} v {shortTeam(opp)}</Link>
            </h2>
            <table className="data">
              <thead><tr><th>Sub</th><th>Gender</th><th className="num">Sub growth</th><th>Covers</th><th></th></tr></thead>
              <tbody>
                {subs.map((s) => {
                  const pick = saved(s, s.player);
                  const cur = current(s);
                  const isAuto = autoMatched.has(subKey(s, s.player));
                  const value = pick === undefined ? (isAuto ? cur! : NO_PICK) : pick;
                  return (
                    <tr key={s.player}>
                      <td><Link to={`../players/${encodeURIComponent(s.player)}`}>{s.player}</Link></td>
                      <td>{gender(s.player)}</td>
                      <td className="num">{money(s.subEarned ?? 0)}</td>
                      <td>
                        <select value={value} aria-label={`${s.player} covers`} className={cur === undefined ? "attn" : undefined}
                          onChange={(e) => setPick(s, e.target.value === NO_PICK ? undefined : e.target.value)}>
                          {(pick !== undefined || !isAuto) && cur === undefined && <option value={NO_PICK}>{auto ? "Unmatched" : "Not matched yet"}</option>}
                          <option value="">Nobody (extra player)</option>
                          {value !== NO_PICK && value && !absent.some((a) => same(a.player, value)) && <option value={value}>{value} (not absent)</option>}
                          {absent.map((a) => (
                            <option key={a.player} value={a.player}>{a.player} ({gender(a.player)}, {money(result.salary[a.player]?.[week - 1])})</option>
                          ))}
                        </select>
                        {isAuto && <span className="tag">auto-matched</span>}
                        {pick !== undefined && auto && <span className="tag">override</span>}
                      </td>
                      <td>{pick !== undefined && <button className="link small" onClick={() => setPick(s, undefined)}>{auto ? "Clear override" : "Clear"}</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {absent.length > 0 && (
              <p className="small muted">Absent: {absent.map((a) => `${a.player} (${delta(a.growth)}${a.coveredBy ? `, sub: ${a.coveredBy}` : ""})`).join(" · ")}</p>
            )}
            {doubled.length > 0 && <p className="small attn">{doubled.join(", ")} is picked for more than one sub; only the first counts.</p>}
            {why.map((f, i) => <p key={i} className="small attn">⚑ {f.message}</p>)}
          </section>
        );
      })}
      {shown.length === 0 && <p className="empty">{groups.length ? "Every sub is matched, with no overrides." : "No subs have played yet."}</p>}
    </main>
  );
}
