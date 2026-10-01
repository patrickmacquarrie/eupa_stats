# EUPA Stats

A web app for running a salary-cap ultimate league from tablet stat recordings. It runs the
league stats engine (below) in the browser: load a season, add each game's tablet CSVs, settle
sub matches and score differences, and every salary, box score and cap figure is recalculated
from the raw plays.

```
npm install
npm run dev          # http://localhost:5173, with the demo seasons
npm test             # unit tests, incl. Fall 2026 rebuilt to the sheet's exact 180/180 salaries
npm run typecheck
npm run validate     # engine vs the three master sheets; fails if any result differs from scripts/validate-baseline.json
npm run build        # production site in dist/ (hash routing, relative paths: host it anywhere)
npm run build:demo   # the same, plus the three demo seasons and sample CSVs
npm run build:share  # the shareable player stats page, one file in dist-share/
npm run e2e          # browser test: create a season, record, refresh mid-game, finish,
                     # settle a dispute, export and re-import, then reload offline
npm run test:rules   # Firestore security rules, in the Firebase emulator (needs Java)
npm run e2e:online   # two devices on one online league, in the Firebase emulators: passwords,
                     # moving a season online, a tablet recording live and with no signal
```

What's in the app (`src/`). The header has five tabs (Overview, Players, Games, Player stats, Admin) and, on the right, **Track Stats** for stat-takers. Admin's red bubble counts everything waiting on an admin.

| Screen | What it does |
|---|---|
| Seasons | Start a new season by pasting the roster from a spreadsheet (player, gender, team, starting salary), setting the weekly schedule (with a Skip for holidays) and choosing the rules (a short team is offered a plug: "Team 2 has 9 players, the largest team has 10. Add a plug?"); or start from one of the three demo seasons, import a season export or a master-sheet fixture, export, delete |
| Overview | Team standings after any week: record, goals for and against, goal difference and salary (over-cap salaries in red), with the cap as a footnote; salary-by-week chart |
| Players | Sortable salary and stat table by team and week; each player has a salary chart and game log |
| Games | Every game with both tablets' scores; when the tablets' finals differ, the game page shows a recommended score with a plain-language reason for every goal only one tablet has (a missed tap, a tablet that stopped recording, O-Error tapped instead of scored-on, two quick scores) and any goal the other tablet contradicts; an admin clicks Approve or Change, and nothing settles on its own. The page also shows the official score, a "Was here" box for rostered players with no plays (otherwise they count as absent), stat-takers' flagged possessions, and a possession editor for either side's recording: edit a possession's catches and how it ended, insert possessions (in pairs, so the teams keep alternating), or delete a pair. The editor previews the stat, score and salary effect before saving. A side can also be replaced with a box score |
| Player stats | What players see: leaderboards (top N per gender group, per game) and every rostered player's totals, with the columns chosen in Setup. "Copy stats for the public page" copies a snapshot for the shareable page |
| Admin → Needs attention | Provisional weeks and what keeps each one open (score differences, each with its recommended score and an Approve button; official scores to reconfirm; flagged possessions; unmatched subs); players marked present with no stats, which count in the bubble but don't make a week provisional and can be acknowledged; games counted, engine warnings |
| Admin → Names | Recorded spellings that match no player, with a suggested match (typos like Katelyn/Katelynn, short first names like Jess/Jessica); the sheet's old "Name Sub" records, merged in one click; likely duplicate player records. Merges are aliases applied when computing, so recordings keep the tablet's spelling and every merge can be undone |
| Admin → Subs | Who each sub covered. With auto-match subs on (Setup), every sub is matched automatically and tagged "auto-matched"; any match can be overridden, including "Nobody (extra player)", and "Clear override" hands it back to auto-match. A filter shows only overrides and unmatched subs |
| Admin → Recordings | Upload tablet CSVs (one per team per game), preview problems and the cross-check before saving, delete recordings |
| Admin → Setup | Edit the league rules with a live preview of who moves before saving; schedule, counted-through week, game length, auto-match subs, add players, add plugs per team (removal waits for the trades screen once games exist), public stats columns |
| Track Stats | Live stat entry for one team's side, on a tablet: check in who's here, add subs, then record with buttons behind each name, like the old tablet app: Touch / Point / Drop on offense (Drop becomes Throwaway on the row of whoever has the disc), D-Play / GSO on defense, plus an Offensive error button. Point on a receiver records the catch and the point in one press. Undo reverts a whole press. Beside the roster is a log of recent possessions; flagging one (⚑) sends it to the game page for the admin. Saved on every tap; resumes after a refresh. The clock starts with the first play. Finish shows the box score and lists checked-in players with no plays (absent unless ticked), then saves to the season and/or downloads the old app's CSV |

The shareable player stats page is a separate single-file page (`npm run build:share` → `dist-share/stats-page.html`) containing only the stats view and a snapshot of player totals, so sharing its link exposes nothing else. Its owner updates it by pasting a snapshot from the Player stats tab; the page republishes itself with the new numbers.

**Leagues online** (Firebase project `eupa-stats`). A league has a name, a link name (`/l/eupa-fall`)
and seasons. Anyone with the link can read it. Two passwords unlock changes: the stats-entry
password (Track Stats) and the admin password (everything). A device enters a password once and
remembers it. There are no accounts and no server: each password is stored as a salted SHA-256
key in a document no browser can read, a device unlocks by writing its own member record with the
key, and `firestore.rules` allows that write only when the key matches. Every check compares the
device's key with the current one, so changing a password (on the league page) locks out every
device that used the old one. `tests-rules/` covers the rules against the emulator.

An online season is one season document (rules, players, schedule, overrides; no plays) and one
document per recording (one team's side of one game: its plays, check-in list, subs, first-time
subs, ticked no-play players and flags). Stat-takers write only their own recordings; the app
reassembles the season from the documents (`src/lib/onlineShape.ts`), so every screen works the
same as for a season kept in a browser, and an admin's change is written back as only the
documents it touched. Track Stats still saves every tap on the tablet first, sends the recording
to the league every few seconds, and shows "Saved on this tablet · Synced" or "· will sync when
online"; Firestore keeps the device's own copy, so the season opens and records with no signal and
catches up when one returns. The admin's Games page shows each game as "live" while it's being
recorded. A season kept in a browser has "Move this season online" in Admin → Setup (admin
password needed); the browser's copy stays, marked as moved. Admin → Recordings keeps CSV upload
and download as a backup.

Seasons are stored in the browser's IndexedDB, one per key, so nothing leaves the device. Export a
season to back it up or hand it to another admin. There is no server or login yet. If the
browser refuses to store (full, private window, site data blocked) the app says so in a bar with
an Export button rather than failing quietly; a crash in any screen shows a recovery screen
with the same Export.

Saved seasons and exports carry a `schemaVersion`. Older files are migrated on load; a file from
a newer version of the app is refused rather than half-read. Every import (tablet CSV, season
export, master-sheet fixture, public snapshot) is checked before it's saved: problems that would
corrupt salaries block the import, oddities real recordings contain are shown as warnings.

A week with an open item is marked provisional on the Overview and on the public page. Open
items are: a score the tablets disagree on with no official score set; an official score whose
game has changed since it was set; a flagged possession; a name (in a tablet recording or a box
score) that isn't in the player list; a sub nobody has decided on.

Setting an official score on the game page settles a dispute for both sides. It stores a
fingerprint of the game's recordings and box scores; if any of them change afterwards (a
re-upload, a deleted recording, a possession edit, a box score), the score keeps applying but
the game page asks you to confirm, change or clear it. Undoing the change settles it again.

Auto-match subs (on by default, switched in Setup) matches each sub to an absent player of the
same gender: the sub with the best night covers the highest-paid absent player, and so on down,
using salaries from before that week (earlier weeks' matches included). Only the admin's
overrides are stored, so a stat edit re-matches automatically. A sub it can't match (no absent
player of their gender, or nobody absent) stays an open item until the admin picks one or
"Nobody (extra player)". With it off, every sub needs a pick on the Subs tab.

The production build works offline once it has loaded (a service worker caches the app; fonts
are bundled, see `src/assets/fonts/OFL.txt`) and shows an Offline pill in the header. The demo
fixtures are only in `build:demo` / `dev`, so a production build carries no real league data.

The production build is published to https://patrickmacquarrie.github.io/eupa_stats/ by
`.github/workflows/pages.yml`, and to Firebase Hosting (https://eupa-stats.web.app) with the
Firestore security rules by `.github/workflows/firebase.yml`, on every change to `main`. GitHub
Pages stays until the league switches over; after that the repository can be made private.

The Firebase deploy needs a key, stored as the GitHub secret `FIREBASE_SERVICE_ACCOUNT`; until
it's set, that workflow skips itself. To make one (as the Google account that owns the project):
in the Google Cloud console for project `eupa-stats`, IAM & Admin → Service accounts → Create
service account (`github-deploy`), with the roles Firebase Hosting Admin, Firebase Rules Admin,
API Keys Viewer and Service Usage Consumer; then on that account, Keys → Add key → JSON. In
GitHub, Settings → Secrets and variables → Actions → New repository secret, named
`FIREBASE_SERVICE_ACCOUNT`, with the whole JSON file as its value. Delete the downloaded file.

The public player stats page for an online season is `/l/<league>/p/<season>`. Whichever
unlocked device has the season open (an admin, or a tablet once its own game is finished)
rebuilds the snapshot a few seconds after the numbers change and writes it if it differs, so the
page catches up after game night without an admin opening the app. The write needs a signal: a
device offline skips it rather than queueing old numbers. The page reads the snapshot live and
marks provisional weeks. The copy-and-paste shareable page (`npm run build:share`) remains
for seasons kept in a browser, and until the online page has replaced it.

Backups: every Monday, `.github/workflows/backup.yml` saves every online league's details and
each season, in the same format as the app's Export, as a download on that run's page in the
repo's Actions tab ("Backup"), kept for 90 days. To restore a season, download it, unzip it and
use Import on the Seasons screen; from there an admin can move it online again. "Run workflow"
on the Backup page takes one at any time. It needs no secret, because everything it saves is
readable by anyone already; the password keys aren't readable and aren't saved. While the repo is
public, anyone signed in to GitHub can download these files too. `npm run backup -- <folder>`
does the same from a computer.

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, the validation baseline, both
builds and the browser test on every push and pull request. Its two jobs, `Typecheck` and
`Browser`, are the required checks for merging into `main`.

---

## League stats engine

The salary/stat rules from the PRG master sheets, rewritten as plain TypeScript functions so the
future web app can run them in the browser. Everything is recalculated from the raw event log
plus league settings, so fixing one play anywhere updates every downstream number.

```
engine/
  types.ts       data model (events, players, rules, box scores, sub assignments)
  compute.ts     events → per-game lines → salary growth → weekly salaries → cap
  pairing.ts     auto-match subs (sub ↔ absent player): same gender only, best sub night covers
                 the highest salary; anything left over is flagged for the admin override screen
  crosscheck.ts  lines up each tablet's goals with the other tablet's "scored on" taps, labels every
                 one-sided goal missed-tap / conflict / review, and proposes a final score
scripts/
  extract_fixture.py   pulls a master-sheet .xlsx into fixtures/*.json (validation only)
  validate.ts          diffs the engine against the sheet's own numbers
  experiments.ts       what-ifs: auto-matched subs, fixed plug, to-date absence average
  dispute.ts           two tablet CSVs for one game → where they disagree and a proposed score
  anonymise-fixtures.ts  replaces real names in fixtures/ with stable fakes (see below)
fixtures/              Fall 2026 (weeks 1–4), Thursday S1 2026 (weeks 1–8), Premier League 2025
                       (weeks 1–15, 39k events), disputes/ (tablet CSV pairs); names anonymised
```

Run: `npm i && npx tsx scripts/validate.ts fixtures/*.json` (add `--boxscore` to feed the sheet's
own stat lines instead of the event log), `npx tsx scripts/experiments.ts`.

## Validation results

`npm run validate` compares every fixture, in both event and box-score mode, with the recorded baseline (`scripts/validate-baseline.json`: the counts below plus every known mismatch line) and exits non-zero on any change. After an intended change, `npm run validate -- --update` rewrites the baseline; review its diff before committing.

| | Fall 2026 | Thursday S1 | Premier League 2025 |
|---|---|---|---|
| Weekly salaries, from the sheet's stat lines | 180 / 180 exact | 659 / 680 exact; the 21 misses trace to 4 sheet errors | 1,455 / 1,500 exact; misses trace to waiver pickups' sub games, late trades, missing absence rows |
| Weekly salaries, rebuilt from the raw event log | 180 / 180 exact | same 4 errors, plus drift from week 3 on: the archive for weeks 5–7 is missing about a third of the assists, and the retroactive absence average carries that back into weeks 3–4 | not run |
| Cap by week | exact | follows from the above | within 0.1% (includes the $2M team win bonus) |

The fixtures' player, GM and team names are fakes from `scripts/anonymise-fixtures.ts`. It
uses one mapping across every fixture and CSV, so a person keeps the same fake everywhere, and it
keeps every pair the Names screen links (typos, short first names, "Name Sub" records) linked
for the same reason. Run it on a newly extracted fixture before committing; its mapping file
(`fixtures/.anonymise-map.json`) is git-ignored and must never be committed. Anonymising
changed no count above, only the names in the mismatch lines.

Sheet errors the engine surfaced (Thursday S1; names are the fixtures' anonymised ones):
- Dashiell Oakenshaw, week 2: no absence rows entered for either game (underpaid $240,000).
- Alder Oakenshaw, week 5: their own-team game was recorded under "Alder Oakenshaw Sub" and their
  sub appearance for Team 3 under their real name, so they earned $0 for a game they played.
- Ignatius Lindqvist, week 4: Leopold Rookwood's sub credit ($500,000) never reached them (manual rows).
- Ravenna Lindqvist, week 4 vs Team 2: growth shows $0; their stat line is worth −$300,000.

Rule settings live in `LeagueRules`, stored with each season; the sheet's behaviour is reproduced
with `absence.thereafter = "seasonAvgRetroactive"` and `plugMode = "asAbsentPlayer"`, which
imported master-sheet seasons keep. New seasons default to `avgToDate` absences, no cap bumps,
and `leagueAverage` plugs: each plug's salary is the average, that week, of rostered real players
of its gender (all rostered real players if nobody of its gender is).

## Licence

MIT, see `LICENSE`. The bundled Oswald font is under the SIL Open Font License (`src/assets/fonts/OFL.txt`).
