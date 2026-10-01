import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tabletCsvToEvents } from "../src/lib/csv";

const ROSTER = [
  "Player\tGender\tTeam\tStarting Salary",
  "Ann Arbour\tF\tTeam A\t$2,000,000", "Al Ames\tM\tTeam A\t$1,500,000", "Amy Ash\tF\tTeam A\t$1,000,000", "Art Aldo\tM\tTeam A\t$500,000", "Ada Alto\tF\tTeam A\t$500,000",
  "Bea Brook\tF\tTeam B\t$2,000,000", "Bo Birch\tM\tTeam B\t$1,500,000", "Bree Bell\tF\tTeam B\t$1,000,000", "Ben Bay\tM\tTeam B\t$500,000",
  "Casey Sub\tF\tSub\t",
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

  // A stand-in for the tablet's "keep the screen on" request, which the tablet drops when it locks.
  await page.addInitScript(() => {
    const locks: any[] = ((window as any).__locks = []);
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => {
      const l: any = { ls: [], addEventListener: (_: string, f: () => void) => l.ls.push(f), release: () => { l.ls.forEach((f: () => void) => f()); return Promise.resolve(); } };
      locks.push(l);
      return Promise.resolve(l);
    } } });
  });
  const locks = () => page.evaluate(() => (window as any).__locks.length as number);
  const setVisible = (v: boolean) => page.evaluate((v) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (v ? "visible" : "hidden") });
    if (!v) (window as any).__locks.at(-1)?.release();
    document.dispatchEvent(new Event("visibilitychange"));
  }, v);

  // 1. Create a season from a pasted roster.
  await page.goto("/#/admin");
  await page.getByRole("link", { name: /New season/ }).click();
  await page.fill("#ns-name", "E2E Winter");
  await page.fill("#ns-roster", ROSTER);
  await expect(page.locator(".ns-teams tbody tr")).toHaveCount(3);
  // Team B is one short: add an F plug.
  await expect(page.locator(".plug-prompt")).toContainText("Team B has 4 players, the largest team has 5. Add a plug?");
  await page.locator(".plug-prompt").getByRole("button", { name: "Add plug" }).click();
  await expect(page.locator(".plug-prompt")).toHaveCount(0);
  await page.fill("#ns-first", "2027-01-04");
  await page.fill("#ns-weeks", "4");
  await page.click("text=Fill in weekly dates");
  await page.click("text=Create season");
  await expect(page.locator("h2", { hasText: "Standings" })).toBeVisible();

  // 2. Record Team A's side: A 2 – B 1.
  await page.click(".track-stats");
  await page.fill('input[type="date"]', "2027-01-04");
  // Plugs never show in Track Stats, not even in the sub search.
  await page.fill('input[placeholder="Start typing a name"]', "plug");
  await expect(page.locator(".addsub button", { hasText: "plug" })).toHaveCount(0);
  await page.fill('input[placeholder="Start typing a name"]', "");
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

  // The screen stays on while recording, and after the tablet locks and unlocks it asks again.
  await expect.poll(locks).toBe(1);
  await setVisible(false);
  await setVisible(true);
  await expect.poll(locks).toBe(2);
  expect(await score(page)).toBe("2–1");

  // 3. A refresh mid-game resumes exactly where it was.
  await page.reload();
  await expect(page.locator(".scorebar")).toBeVisible();
  expect(await score(page)).toBe("2–1");

  // 4. Finish: the CSV download is a valid tablet recording; save to the season.
  await page.click("text=Finish game");
  // Closing the browser on the Finish screen comes back to it, ticks and all.
  const ada = page.locator(".noplays label", { hasText: "Ada Alto" }).locator("input");
  await ada.check();
  await page.reload();
  await expect(page.getByRole("button", { name: "Save to season" })).toBeVisible();
  await expect(ada).toBeChecked();
  await ada.uncheck();
  const [csvDownload] = await Promise.all([page.waitForEvent("download"), page.click("text=Download CSV")]);
  const csvPath = testInfo.outputPath("teamA.csv");
  await csvDownload.saveAs(csvPath);
  const events = tabletCsvToEvents(readFileSync(csvPath, "utf8"));
  expect(events.at(-1)).toMatchObject({ statTeam: "Team A", statScore: 2, otherScore: 1, action: "Point", player: "Amy Ash", lastPlayer: "Ann Arbour" });
  await page.click("text=Save to season");
  await expect(page.locator("text=Saved")).toBeVisible();
  // Once it's in the season, the game page downloads the same file, byte for byte.
  await page.getByRole("link", { name: "Open the game" }).click();
  const [again] = await Promise.all([page.waitForEvent("download"), page.locator("section", { hasText: "From 10 tablet events" }).getByRole("button", { name: "Download CSV" }).click()]);
  const againPath = testInfo.outputPath("teamA-again.csv");
  await again.saveAs(againPath);
  expect(readFileSync(againPath, "utf8")).toBe(readFileSync(csvPath, "utf8"));

  // 5. Team B's tablet disagrees (3–1): the week goes provisional.
  await page.click("nav.tabs >> text=Admin");
  await page.click(".subtabs >> text=Recordings");
  await page.setInputFiles('label.file-drop input[type="file"]', { name: "teamB.csv", mimeType: "text/csv", buffer: Buffer.from(teamBTablet()) });
  await page.click("text=/Add 1 recording/");
  // The Recordings list downloads each recording as a CSV with the same plays as the upload.
  const [bDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download Team B's .* recording as CSV/ }).click()]);
  const bPath = testInfo.outputPath("teamB-again.csv");
  await bDownload.saveAs(bPath);
  expect(tabletCsvToEvents(readFileSync(bPath, "utf8"))).toEqual(tabletCsvToEvents(teamBTablet()));
  await page.click("nav.tabs >> text=Admin");
  // The dispute, plus the roster's "Casey Sub", which Names flags as an old "Name Sub" record.
  await expect(page.locator(".tabs .badge.alert")).toHaveText("2");
  await expect(page.locator(".open-items h2")).toHaveText("Provisional: week 1");
  await expect(page.locator(".open-items summary")).toContainText("1 score difference");

  // 6. Settle it with an official score, then fix a possession in the editor.
  await page.click(".open-items >> text=/tablets disagree/");
  await expect(page.locator(".score-diff h2")).toHaveText("Score difference");
  await page.getByRole("button", { name: "Change" }).click();
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
  // The edit changed a recording the official score was set against: it still applies, but needs confirming.
  await page.click("nav.tabs >> text=Admin");
  await expect(page.locator(".open-items summary")).toContainText("1 official score to reconfirm");
  await page.click(".open-items >> text=/official score was set/");
  await expect(page.locator(".official.stale")).toBeVisible();
  await page.getByRole("button", { name: "Confirm official score" }).click();
  await expect(page.locator(".official.stale")).toHaveCount(0);
  await page.click("nav.tabs >> text=Admin");
  await expect(page.locator(".open-items")).toHaveCount(0);
  await expect(page.locator(".tabs .badge.alert")).toHaveText("1");
  await expect(page.locator(".subtabs .badge.alert")).toHaveText("1");    // on Names

  // Ada didn't play; ticking "Was here" makes her an admin item, which the admin acknowledges.
  await page.click("nav.tabs >> text=Games");
  await page.click("text=Team A v Team B");
  // Back goes one screen back, to the games list.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/games$/);
  await page.click("text=Team A v Team B");
  await page.locator("tr", { hasText: "Ada Alto" }).locator("text=Was here").click();
  await page.click("nav.tabs >> text=Admin");
  await expect(page.locator(".tabs .badge.alert")).toHaveText("2");
  await expect(page.locator("#quiet-title + p + ul li")).toContainText("Ada Alto was marked present for Team A v Team B (week 1) but has no stats");
  await expect(page.locator(".open-items")).toHaveCount(0);                 // not provisional
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.locator(".tabs .badge.alert")).toHaveText("1");

  // 7. Export, delete, import: everything comes back.
  const [jsonDownload] = await Promise.all([page.waitForEvent("download"), page.click("header >> text=Export")]);
  const jsonPath = testInfo.outputPath("season.json");
  await jsonDownload.saveAs(jsonPath);
  await page.goto("/#/admin");
  await page.click(".season-list li:has-text('E2E Winter') >> button:text-is('Delete')");
  await page.click(".modal >> button:text-is('Delete')");
  await expect(page.locator(".season-list li")).toHaveCount(0);
  await page.setInputFiles('label.file-drop input[type="file"]', { name: "E2E Winter.json", mimeType: "application/json", buffer: readFileSync(jsonPath) });
  await expect(page.locator("h2", { hasText: "Standings" })).toBeVisible();
  // Standings follow the official score: Team A 1–0, 2 for and 1 against.
  await expect(page.locator(".standings tbody tr").first()).toContainText("Team A");
  await expect(page.locator(".standings tbody tr").first().locator("td")).toHaveText(["1", "Team A", "", "1–0", "2", "1", "+1", /\$/]);
  await page.click("nav.tabs >> text=Games");
  await expect(page.locator(".pill")).toHaveText("official score set");
  await page.click("nav.tabs >> text=Player stats");
  await expect(page.locator("main")).toContainText("Amy Ash");
  await expect(page.locator("main")).not.toContainText("plug");
  await page.click("nav.tabs >> text=Players");
  await expect(page.locator("tr:has-text('Amy Ash')")).toBeVisible();

  expect(errors).toEqual([]);
});

test("works offline once loaded", async ({ page, context }) => {
  await page.goto("/#/admin");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // now controlled by the service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Seasons");
  await page.getByRole("link", { name: /New season/ }).click();                 // a screen loaded on demand, from the cache
  await expect(page.locator("h1")).toHaveText("Start a new season");
});
