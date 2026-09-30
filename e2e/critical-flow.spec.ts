import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tabletCsvToEvents } from "../src/lib/csv";

const ROSTER = [
  "Player\tGender\tTeam\tStarting Salary",
  "Ann Arbour\tF\tTeam A\t$2,000,000", "Al Ames\tM\tTeam A\t$1,500,000", "Amy Ash\tF\tTeam A\t$1,000,000", "Art Aldo\tM\tTeam A\t$500,000",
  "Bea Brook\tF\tTeam B\t$2,000,000", "Bo Birch\tM\tTeam B\t$1,500,000", "Bree Bell\tF\tTeam B\t$1,000,000", "Ben Bay\tM\tTeam B\t$500,000",
  "Cass Sub\tF\tSub\t",
].join("\n");

const tap = (page: Page, player: string, button: string) => page.click(`.prow:has(.pname:text-is("${player}")) >> button:text-is("${button}")`);
const score = async (page: Page) => (await page.locator(".score-team strong").allTextContents()).join("–");

/** Team B's tablet for the same game, recording A 2 – B 1 as A 3 – B 1 (an extra A point). */
function teamBTablet() {
  const rows = [
    ["19:00:10", "0", "0", "Touch", "Bea Brook"], ["19:00:20", "0", "1", "GSO", "Bo Birch"],
    ["19:01:00", "1", "1", "Touch", "Bree Bell"], ["19:01:10", "1", "1", "Point", "Bree Bell"],
    ["19:02:00", "1", "2", "GSO", "Ben Bay"], ["19:03:00", "1", "3", "GSO", "Bea Brook"],
  ];
  const head = '"date","time","statTeam","otherTeam","statTeamScore","otherTeamScore","action","player","lastPlayer","secLastPlayer"';
  return [head, ...rows.map(([t, us, them, a, p]) => `"Mon Jan 04 2027","${t} GMT-0700 (Mountain Standard Time)","Team B","Team A","${us}","${them}","${a}","${p}","",""`)].join("\n");
}

test("create season, record, refresh recovery, finish, dispute, correct, export and import", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. Create a season from a pasted roster.
  await page.goto("/");
  await page.click("text=New season");
  await page.fill("#ns-name", "E2E Winter");
  await page.fill("#ns-roster", ROSTER);
  await expect(page.locator(".ns-teams tbody tr")).toHaveCount(3);
  await page.fill("#ns-first", "2027-01-04");
  await page.fill("#ns-weeks", "4");
  await page.click("text=Fill in weekly dates");
  await page.click("text=Create season");
  await expect(page.locator("text=Payroll vs cap")).toBeVisible();

  // 2. Record Team A's side: A 2 – B 1.
  await page.click("nav.tabs >> text=Record");
  await page.fill('input[type="date"]', "2027-01-04");
  await page.click("text=Start recording");
  await tap(page, "Ann Arbour", "Touch");
  await tap(page, "Al Ames", "Point");                 // 1–0, assist Ann
  await tap(page, "Art Aldo", "GSO");                  // 1–1
  await tap(page, "Amy Ash", "Touch");
  await tap(page, "Amy Ash", "Throwaway");
  await page.click("text=Offensive error");
  await tap(page, "Ann Arbour", "Touch");
  await tap(page, "Amy Ash", "Point");                 // 2–1
  expect(await score(page)).toBe("2–1");

  // 3. A refresh mid-game resumes exactly where it was.
  await page.reload();
  await expect(page.locator(".scorebar")).toBeVisible();
  expect(await score(page)).toBe("2–1");

  // 4. Finish: the CSV download is a valid tablet recording; save to the season.
  await page.click("text=Finish game");
  const [csvDownload] = await Promise.all([page.waitForEvent("download"), page.click("text=Download CSV")]);
  const csvPath = testInfo.outputPath("teamA.csv");
  await csvDownload.saveAs(csvPath);
  const events = tabletCsvToEvents(readFileSync(csvPath, "utf8"));
  expect(events.at(-1)).toMatchObject({ statTeam: "Team A", statScore: 2, otherScore: 1, action: "Point", player: "Amy Ash", lastPlayer: "Ann Arbour" });
  await page.click("text=Save to season");
  await expect(page.locator("text=Saved")).toBeVisible();

  // 5. Team B's tablet disagrees (3–1): the week goes provisional.
  await page.click("nav.tabs >> text=Recordings");
  await page.setInputFiles('label.file-drop input[type="file"]', { name: "teamB.csv", mimeType: "text/csv", buffer: Buffer.from(teamBTablet()) });
  await page.click("text=/Add 1 recording/");
  await page.click("nav.tabs >> text=Overview");
  await expect(page.locator(".open-items h2")).toHaveText("Provisional: week 1");
  await expect(page.locator(".open-items summary")).toContainText("1 score dispute");

  // 6. Settle it with an official score, then fix a possession in the editor.
  await page.click(".open-items >> text=/tablets disagree/");
  await page.fill('input[aria-label="Team A official score"]', "2");
  await page.fill('input[aria-label="Team B official score"]', "1");
  await page.click("text=Set official score");
  await expect(page.locator(".official p")).toContainText("Official score: Team A 2–1 Team B");
  await page.click("text=Edit possessions >> nth=0");
  await page.click(".poss-item >> nth=0 >> text=Edit");
  await page.selectOption('.spec-forms select[aria-label="Catch 1"]', "Amy Ash");
  await page.click(".spec-forms >> text=Apply");
  await expect(page.locator(".edit-effect")).toContainText("Amy Ash +1 A");
  await page.click(".editor-card >> button:text-is('Save')");
  await page.click("nav.tabs >> text=Overview");
  await expect(page.locator(".open-items")).toHaveCount(0);

  // 7. Export, delete, import: everything comes back.
  const [jsonDownload] = await Promise.all([page.waitForEvent("download"), page.click("header >> text=Export")]);
  const jsonPath = testInfo.outputPath("season.json");
  await jsonDownload.saveAs(jsonPath);
  await page.goto("/");
  await page.click(".season-list li:has-text('E2E Winter') >> button:text-is('Delete')");
  await page.click(".modal >> button:text-is('Delete')");
  await expect(page.locator(".season-list li")).toHaveCount(0);
  await page.setInputFiles('label.file-drop input[type="file"]', { name: "E2E Winter.json", mimeType: "application/json", buffer: readFileSync(jsonPath) });
  await expect(page.locator("text=Payroll vs cap")).toBeVisible();
  await page.click("nav.tabs >> text=Games");
  await expect(page.locator(".pill")).toHaveText("official score set");
  await page.click("nav.tabs >> text=Players");
  await expect(page.locator("tr:has-text('Amy Ash')")).toBeVisible();

  expect(errors).toEqual([]);
});

test("works offline once loaded", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // now controlled by the service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Seasons");
  await page.click("text=New season");                 // a screen loaded on demand, from the cache
  await expect(page.locator("h1")).toHaveText("Start a new season");
});
