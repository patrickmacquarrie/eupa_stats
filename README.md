# EUPA Stats

A web app for running a salary-cap ultimate league from tablet stat recordings. It runs the
league stats engine (below) in the browser: load a season, add each game's tablet CSVs, settle
sub pairings and score disputes, and every salary, box score and cap figure is recalculated
from the raw plays.

```
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests, incl. Fall 2026 rebuilt to the sheet's exact 180/180 salaries
npm run build      # static site in dist/ (hash routing, relative paths: host it anywhere)
npm run validate   # the engine's own diff against the three master sheets
```

What's in the app (`src/`):

| Tab | What it does |
|---|---|
| Seasons | Start from one of the three demo seasons, import a season export or a master-sheet fixture, export, delete |
| Record | Live stat entry for one team's side, on a tablet: check in who's here, add subs (anyone in the league, or a first-time player; a new name that looks like an existing player is questioned first), then record with buttons behind each name, like the old tablet app: Touch / Point / Drop / Throwaway on offense, D-Play / GSO on defense, plus an Offensive error button. Point on a receiver records the catch and the point in one press; Drop or Point on whoever has the disc counts as if pressed before their catch was credited. Undo reverts a whole press. Saved on every tap; resumes after a refresh. Finish shows the box score and lists checked-in players with no plays (absent unless ticked), then saves to the season and/or downloads the old app's CSV |
| Overview | Payroll vs cap per team after any week, payroll-by-week chart, engine warnings |
| Players | Sortable salary and stat table by team and week; each player has a salary chart and game log |
| Games | Every game with both tablets' scores; the game page shows the cross-check (which Points don't line up with a GSO and why), a "Was here" box for rostered players with no plays (otherwise they count as absent), and lets the admin replace either side with a box score |
| Subs | The pairing override screen: current pick vs the same-gender rule, flags the rule can't settle, apply the rule per game or everywhere |
| Names | Recorded spellings that match no player, with a suggested match (typos like Katelyn/Katelynn, short first names like Jess/Jessica); the sheet's old "Name Sub" records, merged in one click; likely duplicate player records. Merges are aliases applied when computing, so recordings keep the tablet's spelling and every merge can be undone |
| Recordings | Upload tablet CSVs (one per team per game), preview problems and the cross-check before saving, delete recordings |
| Setup | Edit the league rules with a live preview of who moves before saving; schedule, counted-through week, add players |

Seasons are stored in the browser's IndexedDB, one per key, so nothing leaves the device. Export a
season to back it up or hand it to another admin. There is no server or login yet.

---

## League stats engine

The salary/stat rules from the PRG master sheets, rewritten as plain TypeScript functions so the
future web app can run them in the browser. Everything is recalculated from the raw event log
plus league settings, so fixing one play anywhere updates every downstream number.

```
engine/
  types.ts       data model (events, players, rules, box scores, sub assignments)
  compute.ts     events → per-game lines → salary growth → weekly salaries → cap
  pairing.ts     automatic sub ↔ absent-player pairing: same gender only, best sub night covers
                 the highest salary; anything left over is flagged for the admin override screen
  crosscheck.ts  lines up each tablet's goals with the other tablet's "scored on" taps, labels every
                 one-sided goal missed-tap / conflict / review, and proposes a final score
scripts/
  extract_fixture.py   pulls a master-sheet .xlsx into fixtures/*.json (validation only)
  validate.ts          diffs the engine against the sheet's own numbers
  experiments.ts       what-ifs: auto pairing, fixed plug, to-date absence average
  dispute.ts           two tablet CSVs for one game → where they disagree and a proposed score
fixtures/              Fall 2026 (weeks 1–4), Thursday S1 2026 (weeks 1–8), Premier League 2025
                       (weeks 1–15, 39k events), disputes/ (tablet CSV pairs)
```

Run: `npm i && npx tsx scripts/validate.ts fixtures/*.json` (add `--boxscore` to feed the sheet's
own stat lines instead of the event log), `npx tsx scripts/experiments.ts`.

## Validation results

| | Fall 2026 | Thursday S1 | Premier League 2025 |
|---|---|---|---|
| Weekly salaries, from the sheet's stat lines | 180 / 180 exact | 659 / 680 exact; the 21 misses trace to 4 sheet errors | 1,455 / 1,500 exact; misses trace to waiver pickups' sub games, late trades, missing absence rows |
| Weekly salaries, rebuilt from the raw event log | 180 / 180 exact | same 4 errors, plus drift from week 3 on: the archive for weeks 5–7 is missing about a third of the assists, and the retroactive absence average carries that back into weeks 3–4 | not run |
| Cap by week | exact | follows from the above | within 0.1% (includes the $2M team win bonus) |

Sheet errors the engine surfaced (Thursday S1):
- Kenny Bedecki, week 2: no absence rows entered for either game (underpaid $240,000).
- Jared Dembicki, week 5: his own-team game was recorded under "Jared Dembicki Sub" and his
  sub appearance for Team 3 under his real name, so he earned $0 for a game he played.
- Masha Parshykova, week 4: Vanessa Chow's sub credit ($500,000) didn't reach her (manual rows).
- Jessica Van Os, week 4 vs Team 2: growth shows $0; her stat line is worth −$300,000.

Rule settings live in `LeagueRules`; the sheet's behaviour is reproduced with
`absence.thereafter = "seasonAvgRetroactive"` and `plugMode = "asAbsentPlayer"`.
