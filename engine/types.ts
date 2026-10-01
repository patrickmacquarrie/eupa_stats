// Core data model for the league engine. Everything the app shows is derived from
// these inputs; nothing downstream is stored as a pasted value.

export type Action = "Touch" | "Point" | "Drop" | "T-Away" | "D-Play" | "GSO" | "O-Error";

/** One tap in a stat-taker's recording. A recording tracks ONE team's side of a game. */
export interface PlayEvent {
  date: string;            // ISO date of the game night
  clock?: string;          // device timestamp (for ordering/undo history)
  statTeam: string;        // team this recording is tracking
  otherTeam: string;
  statScore: number;       // score after this event, from statTeam's point of view
  otherScore: number;
  action: Action | string;
  player?: string | null;        // actor (scorer for Point, dropper for Drop, etc.)
  lastPlayer?: string | null;    // thrower of the goal (assist) on a Point
  secLastPlayer?: string | null; // 2nd assist on a Point
  gameTime?: string;       // time left on the game clock ("00:24:52"), kept for the tablet CSV
}

export interface StatWeights {
  win: number; goal: number; assist: number; secondAssist: number;
  block: number; drop: number; throwaway: number; gso: number;
}

export interface LeagueRules {
  weights: StatWeights;
  /** A tie pays win * this factor (0.5 in every sheet so far). */
  tieWeightFactor: number;
  absence: {
    /** Early-season estimate: this share of initial salary per week, split across the week's games. */
    pctOfInitialPerWeek: number;
    /** How many opening weeks use the % estimate before switching to the player's own average. */
    pctRuleWeeks: number;
    /**
     * "seasonAvgRetroactive": the spreadsheet's behaviour — the player's average over ALL games
     *   entered so far, so past weeks' salaries shift every time a new week is added.
     * "avgToDate": the player's average over games before the missed week only (stable history).
     */
    thereafter: "seasonAvgRetroactive" | "avgToDate";
    /** When true, an absent player's growth is never below what their sub earned (or 0 with no sub). */
    floorAtSubGrowth: boolean;
  };
  /** Games each team plays per week (absence estimate is split across these). */
  matchesPerWeek: number;
  capBuffer: number;
  /** One-off cap bumps by week (the sheet hardcodes these in weeks 11–14). */
  capExtraByWeek: Record<string, number>;
  /** Divisor for "average team salary" in the cap formula. */
  teamsForCapAverage: number;
  /** Win bonus also paid to absent players (LoEU sheet does this; EUPA sheets do not). */
  payResultToAbsent?: boolean;
  /**
   * How roster-filler "plug" players are valued.
   * "asAbsentPlayer": the sheet's behaviour — treated as absent every game (freezes after the % weeks).
   * "leagueAverage": re-priced every week at the league's average rostered-player salary.
   */
  plugMode?: "asAbsentPlayer" | "leagueAverage";
  /**
   * Team-level result bonus that counts against the team's cap (Premier League: $2M per win,
   * half for a tie). Players' salaries are untouched; the league cap rises with the total.
   */
  teamResultBonus?: { win: number; tieFactor: number };
}

export interface Team { name: string; gm: string; isSubTeam?: boolean }

export interface Player {
  name: string;
  gender: string;          // "M" | "F" | "SubM" | "SubF" ...
  initialSalary: number;
  team: string | null;     // initial team; null for pure subs
  isSub: boolean;          // lives in the sub pool
  isPlug?: boolean;        // exists only to balance roster counts
}

export interface Trade {
  afterWeek: number;
  /** First week the player plays for the new team (defaults to afterWeek + 1). */
  effectiveWeek?: number;
  player: string;
  toTeam: string | null;   // null = removed from league
  playerAdd?: number;      // salary adjustment applied to the player at that week (waivers)
}

export interface ScheduleWeek { week: number; date: string }

/** A human decision: which absent rostered player a sub stood in for, in one game. */
export interface SubAssignment { week: number; team: string; opp: string; sub: string; subbedFor: string }

/**
 * Admin-entered totals for one team-side of a game. Replaces the event log for that
 * recording: used when a recording was lost, or to correct one after the fact.
 */
export interface BoxScore {
  week: number; team: string; opp: string;
  result: number;                 // 1 / 0.5 / 0
  finalScore?: number; finalOppScore?: number;
  lines: ({ player: string } & StatLine)[];
}

export interface LeagueInput {
  rules: LeagueRules;
  teams: Team[];
  players: Player[];
  trades: Trade[];
  schedule: ScheduleWeek[];
  events: PlayEvent[];
  boxScores?: BoxScore[];
  subAssignments: SubAssignment[];
  /**
   * Rostered players who were at a game but recorded no plays. Without an entry, a rostered
   * player with no plays is treated as absent; with one, they get a zero stat line and the result.
   */
  presentWithoutPlays?: { week: number; team: string; opp: string; player: string }[];
  /**
   * Scores an administrator set when the two tablets disagreed. The official score decides the
   * result for BOTH sides (each tablet's own stats still count); `scoreA` is team `a`'s.
   */
  /** Admin-set final scores; `basis` fingerprints the recordings they were set against (app-side). */
  officialScores?: { week: number; a: string; b: string; scoreA: number; scoreB: number; basis?: string }[];
  /** Games up to and including this week are counted. */
  throughWeek: number;
}

export interface StatLine {
  goals: number; assists: number; secondAssists: number; blocks: number;
  drops: number; throwaways: number; gso: number; touches: number;
}

/** One player's line for one team-side of one game (what the sheet calls a Stats Entry row). */
export interface GameLine extends StatLine {
  week: number;
  team: string;
  opp: string;
  player: string;
  role: "rostered" | "sub" | "absent";
  subbedFor?: string;       // for role=sub
  coveredBy?: string;       // for role=absent: the sub who stood in
  result: number | null;    // 1 win, 0.5 tie, 0 loss (null for absent rows)
  growth: number;           // salary change from this game
  subEarned?: number;       // for role=sub: what their line was worth (credited to the absentee)
}

export interface RecordingSummary {
  week: number; team: string; opp: string;
  finalScore: number; finalOppScore: number;
  result: number;          // 1 / 0.5 / 0 for `team`
  eventCount: number;
  /** True when an administrator's official score set this result. */
  official?: boolean;
}

export interface EngineResult {
  lines: GameLine[];
  recordings: RecordingSummary[];
  /** salary[player][week] — index 0 is before week 1. */
  salary: Record<string, number[]>;
  capByWeek: number[];
  /** Cumulative team result bonus by week (only when teamResultBonus is set). */
  teamBonus: Record<string, number[]>;
  teamOf: (player: string, week: number) => string | null;
  warnings: string[];
  /** Last week the salary and cap arrays cover (indexes 0..horizon). */
  horizon: number;
}
