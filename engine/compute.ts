import type {
  EngineResult, GameLine, LeagueInput, PlayEvent, Player, RecordingSummary, StatLine, StatWeights,
} from "./types";
import { ruleProblems } from "./rules";

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const emptyLine = (): StatLine => ({
  goals: 0, assists: 0, secondAssists: 0, blocks: 0, drops: 0, throwaways: 0, gso: 0, touches: 0,
});

/** Salary value of one stat line plus the team result. */
export function lineValue(s: StatLine, result: number | null, w: StatWeights, tieFactor: number): number {
  const res = result === 1 ? w.win : result === 0.5 ? w.win * tieFactor : 0;
  return (
    s.goals * w.goal + s.assists * w.assist + s.secondAssists * w.secondAssist + s.blocks * w.block +
    s.drops * w.drop + s.throwaways * w.throwaway + s.gso * w.gso + res
  );
}

/** Tally one recording's events into per-player stat lines. */
export function tallyRecording(events: PlayEvent[], canon: (n: string) => string) {
  const lines = new Map<string, StatLine>();
  const get = (n?: string | null) => {
    if (!n) return null;
    const c = canon(n);
    if (!lines.has(c)) lines.set(c, emptyLine());
    return lines.get(c)!;
  };
  for (const e of events) {
    const p = get(e.player);
    switch (e.action) {
      case "Point": {
        if (p) p.goals++;
        const a = get(e.lastPlayer); if (a) a.assists++;
        const a2 = get(e.secLastPlayer); if (a2) a2.secondAssists++;
        break;
      }
      case "Touch": if (p) p.touches++; break;
      case "D-Play": if (p) p.blocks++; break;
      case "Drop": if (p) p.drops++; break;
      case "T-Away": if (p) p.throwaways++; break;
      case "GSO": if (p) p.gso++; break;
      default: get(e.lastPlayer); get(e.secLastPlayer); // O-Error etc: no individual stat
    }
  }
  const last = events[events.length - 1];
  const result = last.statScore > last.otherScore ? 1 : last.statScore === last.otherScore ? 0.5 : 0;
  return { lines, result, finalScore: last.statScore, finalOppScore: last.otherScore };
}

export function computeLeague(input: LeagueInput): EngineResult {
  const { rules } = input;
  const bad = ruleProblems(rules);
  if (bad.length) throw new RangeError(`Invalid league rules: ${bad.join(" ")}`);
  const warnings: string[] = [];

  // --- identities -----------------------------------------------------------
  const byKey = new Map<string, Player>();
  for (const p of input.players) byKey.set(key(p.name), p);
  const canon = (n: string) => byKey.get(key(n))?.name ?? n.trim();
  const unknown = new Set<string>();

  // --- rosters over time ----------------------------------------------------
  const trades = [...input.trades].sort((a, b) => a.afterWeek - b.afterWeek);
  const teamOf = (player: string, week: number): string | null => {
    const p = byKey.get(key(player));
    if (!p) return null;
    let team = p.team;
    for (const t of trades) if (canon(t.player) === p.name && (t.effectiveWeek ?? t.afterWeek + 1) <= week) team = t.toTeam;
    return team;
  };
  // Rostered = on that team that week. Waivers can move players in and out of the sub pool,
  // so "is a sub" depends on the week, not on the player.
  const rosterOf = (team: string, week: number) =>
    input.players.filter((p) => teamOf(p.name, week) === team);

  // --- weeks ----------------------------------------------------------------
  const sched = [...input.schedule].sort((a, b) => a.date.localeCompare(b.date));
  const weekOf = (date: string) => {
    let wk: number | null = null;
    for (const s of sched) if (s.date <= date) wk = s.week;
    return wk;
  };

  // --- recordings -----------------------------------------------------------
  const recs = new Map<string, PlayEvent[]>();
  for (const e of input.events) {
    const k = `${e.date}|${e.statTeam}|${e.otherTeam}`;
    if (!recs.has(k)) recs.set(k, []);
    recs.get(k)!.push(e);
  }

  const subFor = new Map<string, string>(); // week|team|opp|sub -> absentee
  for (const a of input.subAssignments) {
    const k = `${a.week}|${a.team}|${a.opp}|${canon(a.sub)}`;
    if (!subFor.has(k)) subFor.set(k, canon(a.subbedFor));
  }

  const present = new Set((input.presentWithoutPlays ?? []).map((x) => `${x.week}|${x.team}|${x.opp}|${canon(x.player)}`));

  const lines: GameLine[] = [];
  const recordings: RecordingSummary[] = [];
  const val = (s: StatLine, r: number | null) => lineValue(s, r, rules.weights, rules.tieWeightFactor);

  type Source = { week: number; team: string; opp: string; eventCount: number } & ReturnType<typeof tallyRecording>;
  const sources = new Map<string, Source>();
  for (const [k, evs] of recs) {
    const [date, team, opp] = k.split("|");
    const week = weekOf(date);
    if (week === null) { warnings.push(`No schedule week for ${k}`); continue; }
    sources.set(`${week}|${team}|${opp}`, { week, team, opp, eventCount: evs.length, ...tallyRecording(evs, canon) });
  }
  for (const b of input.boxScores ?? []) {
    const m = new Map<string, StatLine>();
    for (const { player, ...s } of b.lines) m.set(canon(player), s);
    sources.set(`${b.week}|${b.team}|${b.opp}`, {
      week: b.week, team: b.team, opp: b.opp, eventCount: 0, lines: m, result: b.result,
      finalScore: b.finalScore ?? NaN, finalOppScore: b.finalOppScore ?? NaN,
    });
  }

  for (const t of sources.values()) {
    const { week, team, opp } = t;
    if (week > input.throughWeek) continue;
    recordings.push({ week, team, opp, finalScore: t.finalScore, finalOppScore: t.finalOppScore, result: t.result, eventCount: t.eventCount });

    const roster = rosterOf(team, week);
    const rosterNames = new Set(roster.map((p) => p.name));
    const gameLines: GameLine[] = [];
    for (const [name, s] of t.lines) {
      if (!byKey.has(key(name))) unknown.add(name);
      const isRostered = rosterNames.has(name);
      gameLines.push({
        week, team, opp, player: name, ...s, result: t.result,
        role: isRostered ? "rostered" : "sub",
        growth: isRostered ? val(s, t.result) : 0,
        subEarned: isRostered ? undefined : val(s, t.result),
        subbedFor: isRostered ? undefined : subFor.get(`${week}|${team}|${opp}|${name}`),
      });
    }
    for (const p of roster) {
      if (t.lines.has(p.name)) continue;
      if (present.has(`${week}|${team}|${opp}|${p.name}`)) {
        gameLines.push({ week, team, opp, player: p.name, ...emptyLine(), result: t.result, role: "rostered", growth: val(emptyLine(), t.result) });
        continue;
      }
      gameLines.push({ week, team, opp, player: p.name, ...emptyLine(), result: null, role: "absent", growth: 0 });
    }
    // Link subs to the absentee they covered (first sub wins, as the sheet's MATCH does).
    for (const sub of gameLines.filter((l) => l.role === "sub" && l.subbedFor)) {
      const abs = gameLines.find((l) => l.player === sub.subbedFor && l.role === "absent");
      if (!abs) { warnings.push(`W${week} ${team} v ${opp}: ${sub.player} assigned to ${sub.subbedFor}, who isn't absent`); continue; }
      if (!abs.coveredBy) abs.coveredBy = sub.player;
    }
    for (const l of gameLines) (l as any)._result = t.result;
    lines.push(...gameLines);
  }
  for (const n of unknown) warnings.push(`Name not in player list: "${n}"`);

  // --- absence growth -------------------------------------------------------
  const presentGrowth = (player: string, beforeWeek?: number) => {
    const xs = lines.filter((l) => l.player === player && l.role === "rostered" &&
      (beforeWeek === undefined || l.week < beforeWeek)).map((l) => l.growth);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const startSalary = (p: Player) =>
    p.initialSalary + trades.filter((t) => canon(t.player) === p.name && t.afterWeek === 0)
      .reduce((a, t) => a + (t.playerAdd ?? 0), 0);

  for (const l of lines) {
    if (l.role !== "absent") continue;
    const p = byKey.get(key(l.player))!;
    if (p.isPlug && rules.plugMode === "leagueAverage") continue; // priced separately below
    let est: number | null;
    if (l.week <= rules.absence.pctRuleWeeks) {
      est = (startSalary(p) * rules.absence.pctOfInitialPerWeek) / rules.matchesPerWeek;
    } else {
      est = rules.absence.thereafter === "seasonAvgRetroactive"
        ? presentGrowth(p.name) : presentGrowth(p.name, l.week);
    }
    const sub = l.coveredBy
      ? lines.find((s) => s.role === "sub" && s.player === l.coveredBy && s.week === l.week &&
          s.team === l.team && s.opp === l.opp)
      : undefined;
    const subEarned = sub?.subEarned ?? 0;
    const candidates = [est, rules.absence.floorAtSubGrowth ? subEarned : null].filter((x): x is number => x !== null);
    l.growth = candidates.length ? Math.max(...candidates) : 0;
    if (rules.payResultToAbsent) {
      const r = (l as any)._result as number;
      l.growth += r === 1 ? rules.weights.win : r === 0.5 ? rules.weights.win * rules.tieWeightFactor : 0;
    }
  }
  for (const l of lines) delete (l as any)._result;

  // --- horizon ----------------------------------------------------------------
  // Every week anything in the season refers to: the schedule, the counted-through week, trades
  // and cap bumps, and any game, box score, sub pick or presence entry.
  const horizon = Math.max(1, input.throughWeek,
    ...sched.map((s) => s.week),
    ...trades.map((t) => Math.max(t.afterWeek + 1, t.effectiveWeek ?? 0)),
    ...Object.keys(rules.capExtraByWeek).map(Number).filter(Number.isFinite),
    ...lines.map((l) => l.week),
    ...input.subAssignments.map((a) => a.week),
    ...(input.presentWithoutPlays ?? []).map((x) => x.week));

  // --- weekly salaries ------------------------------------------------------
  const salary: Record<string, number[]> = {};
  for (const p of input.players) {
    const row: number[] = [startSalary(p)];
    for (let w = 1; w <= horizon; w++) {
      const growth = lines.filter((l) => l.player === p.name && l.week === w && l.role !== "sub")
        .reduce((a, l) => a + l.growth, 0);
      const adds = trades.filter((t) => canon(t.player) === p.name && t.afterWeek === w && w > 0)
        .reduce((a, t) => a + (t.playerAdd ?? 0), 0);
      row.push(row[w - 1] + growth + adds);
    }
    salary[p.name] = row;
  }
  if (rules.plugMode === "leagueAverage") {
    const real = input.players.filter((p) => !p.isSub && !p.isPlug);
    for (const plug of input.players.filter((p) => p.isPlug)) {
      salary[plug.name] = salary[plug.name].map((_, w) =>
        real.reduce((a, p) => a + salary[p.name][w], 0) / real.length);
    }
  }

  // Team result bonus (PL): wins cost the team cap room; ties count half.
  const teamBonus: Record<string, number[]> = {};
  const tb = rules.teamResultBonus;
  for (const r of recordings) {
    if (!tb) break;
    const v = r.result === 1 ? tb.win : r.result === 0.5 ? tb.win * tb.tieFactor : 0;
    teamBonus[r.team] ??= Array(horizon + 1).fill(0);
    for (let w = r.week; w <= horizon; w++) teamBonus[r.team][w] += v;
  }
  const capByWeek = Array.from({ length: horizon + 1 }, (_, w) => {
    const total = input.players.reduce((a, p) => a + salary[p.name][w], 0) +
      Object.values(teamBonus).reduce((a, t) => a + t[w], 0);
    return total / rules.teamsForCapAverage + rules.capBuffer + (rules.capExtraByWeek[String(w)] ?? 0);
  });

  return { lines, recordings, salary, capByWeek, teamBonus, teamOf, warnings, horizon };
}
