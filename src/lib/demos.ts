// Demo seasons (real archived master sheets, ~17 MB). Only bundled when VITE_DEMOS=true
// (npm run build:demo); a production build leaves them out entirely.
import fallUrl from "../../fixtures/fall-2026.json?url";
import thursdayUrl from "../../fixtures/thursday-s1-2026.json?url";
import plUrl from "../../fixtures/pl-2025.json?url";

export const DEMOS = [
  { name: "EUPA Fall 2026", detail: "weeks 1–4, 3 teams", url: fallUrl },
  { name: "EUPA Thursday S1 2026", detail: "weeks 1–8, trades mid-season", url: thursdayUrl },
  { name: "Premier League 2025", detail: "weeks 1–15, 6 teams, 39k events", url: plUrl },
];

import sample1a from "../../fixtures/disputes/2026-08-31_T3vT2_team2.csv?raw";
import sample1b from "../../fixtures/disputes/2026-08-31_T3vT2_team3.csv?raw";
import sample2a from "../../fixtures/disputes/2026-09-21_T3vT1_team1.csv?raw";
import sample2b from "../../fixtures/disputes/2026-09-21_T3vT1_team3.csv?raw";

/** Pairs of tablet exports for one game each, where the two tablets disagree. */
export const SAMPLES: { label: string; files: [string, string][] }[] = [
  { label: "Aug 31, Team 3 v Team 2", files: [["team2.csv", sample1a], ["team3.csv", sample1b]] },
  { label: "Sep 21, Team 3 v Team 1", files: [["team1.csv", sample2a], ["team3.csv", sample2b]] },
];
