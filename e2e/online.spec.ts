import { expect, test } from "@playwright/test";

// Two devices (separate browser contexts) on one league, against the Firebase emulators.
test("create a league, unlock a tablet with the stats password, and lock it out by changing it", async ({ browser }) => {
  const slug = `e2e-${Date.now().toString(36)}`;
  const admin = await (await browser.newContext()).newPage();
  const tablet = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  for (const p of [admin, tablet]) p.on("pageerror", (e) => errors.push(e.message));

  // The admin creates the league and is unlocked as its admin.
  await admin.goto("/#/new-league");
  await admin.fill("#lg-name", "E2E League");
  await admin.fill("#lg-slug", slug);
  await admin.fill("#lg-stat", "tablet-pass");
  await admin.fill("#lg-admin", "admin-pass");
  await admin.fill("#lg-admin2", "admin-pass");
  await admin.click("text=Create league");
  await expect(admin.locator("h1")).toHaveText("E2E League");
  await expect(admin.locator("main")).toContainText("unlocked for league admin");

  // Another device can read the league but isn't unlocked; a wrong password is refused.
  await tablet.goto(`/#/l/${slug}`);
  await expect(tablet.locator("main")).toContainText("Anyone with this link can see");
  await tablet.fill('input[aria-label="Stats entry password"]', "nope");
  await tablet.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(tablet.locator(".error")).toHaveText("That password isn't right.");
  await tablet.fill('input[aria-label="Stats entry password"]', "tablet-pass");
  await tablet.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(tablet.locator("main")).toContainText("unlocked for stats entry");
  // The stats password doesn't open admin.
  await tablet.getByRole("button", { name: "League admin" }).click();
  await tablet.fill('input[aria-label="League admin password"]', "tablet-pass");
  await tablet.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(tablet.locator(".error")).toHaveText("That password isn't right.");

  // The admin changes the stats password: the tablet is locked out at once.
  await admin.getByLabel("New stats entry password").fill("new-tablet-pass");
  await admin.locator(".unlock-row", { hasText: "stats entry" }).getByRole("button", { name: "Change" }).click();
  await expect(admin.locator(".ok-text")).toContainText("Stats entry password changed");
  await expect(tablet.locator("main")).toContainText("Anyone with this link can see");

  // The league is listed on each device's Seasons screen.
  await tablet.goto("/#/");
  await expect(tablet.locator(".leagues-online")).toContainText("E2E League");
  expect(errors).toEqual([]);
});

const ROSTER = ["Player\tGender\tTeam\tStarting Salary",
  "Ann Arbour\tF\tTeam A\t$2,000,000", "Al Ames\tM\tTeam A\t$1,500,000",
  "Bea Brook\tF\tTeam B\t$2,000,000", "Bo Birch\tM\tTeam B\t$1,500,000"].join("\n");
const tap = (page: import("@playwright/test").Page, player: string, button: string) =>
  page.click(`.prow:has(.pname:text-is("${player}")) >> button:text-is("${button}")`);

test("a season moved online gets a tablet's recording live, with and without a signal", async ({ browser }) => {
  const slug = `sync-${Date.now().toString(36)}`;
  const adminCtx = await browser.newContext(), tabletCtx = await browser.newContext();
  const admin = await adminCtx.newPage(), tablet = await tabletCtx.newPage();
  const errors: string[] = [];
  for (const p of [admin, tablet]) p.on("pageerror", (e) => errors.push(e.message));

  // A season made in the admin's browser, moved online into a league created in the same step.
  await admin.goto("/");
  await admin.getByRole("link", { name: /New season/ }).click();
  await admin.fill("#ns-name", "Winter Online");
  await admin.fill("#ns-roster", ROSTER);
  await admin.fill("#ns-first", "2027-01-04"); await admin.fill("#ns-weeks", "4");
  await admin.click("text=Fill in weekly dates");
  await admin.click("text=Create season");
  await admin.click("nav.tabs >> text=Admin"); await admin.click(".subtabs >> text=Setup");
  await expect(admin.getByRole("button", { name: "Create a new league" })).toHaveAttribute("aria-pressed", "true");
  await admin.fill("#mv-name", "Sync League"); await admin.fill("#mv-slug", slug);
  await admin.fill("#mv-stat", "tablet-pass"); await admin.fill("#mv-admin", "admin-pass"); await admin.fill("#mv-admin2", "admin-pass");
  await admin.getByRole("button", { name: "Create the league and move this season" }).click();
  await expect(admin).toHaveURL(new RegExp(`/l/${slug}/s/`));
  await expect(admin.locator(".role-pill")).toHaveText("Admin");
  // The league's settings are at the bottom of Admin → Setup.
  await admin.click("nav.tabs >> text=Admin"); await admin.click(".subtabs >> text=Setup");
  await expect(admin.locator(".league-settings")).toContainText("New stats entry password");
  await admin.getByLabel("League name").fill("Sync League Online");
  await admin.getByRole("button", { name: "Rename" }).click();
  await expect(admin.locator(".league-settings .ok-text")).toHaveText("League renamed.");

  // The tablet unlocks for stats entry and opens the season: no Admin tab.
  await tablet.goto(`/#/l/${slug}`);
  await tablet.getByLabel("Stats entry password").fill("tablet-pass");
  await tablet.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(tablet.locator("main")).toContainText("unlocked for stats entry");
  await tablet.click("text=Winter Online");
  await expect(tablet.locator(".role-pill")).toHaveText("Stats entry");
  await expect(tablet.locator("nav.tabs")).not.toContainText("Admin");

  // Record: each tap is saved on the tablet and synced to the league.
  await tablet.click(".track-stats");
  await tablet.fill('input[type="date"]', "2027-01-04");
  await tablet.click("text=Start recording");
  await tap(tablet, "Ann Arbour", "Touch");
  await tap(tablet, "Al Ames", "Point");
  await expect(tablet.locator("[data-sync]")).toHaveText("Synced", { timeout: 15_000 });
  await admin.click("nav.tabs >> text=Games");
  await expect(admin.locator(".pill")).toHaveText("live", { timeout: 15_000 });

  // No signal: taps still save on the tablet and wait to sync.
  await tabletCtx.setOffline(true);
  await tap(tablet, "Ann Arbour", "D-Play");                 // on defense after the point: a block
  await tap(tablet, "Al Ames", "Touch");
  await tap(tablet, "Ann Arbour", "Point");
  await expect(tablet.locator("[data-sync]")).toHaveText("will sync when online", { timeout: 15_000 });
  await tablet.reload();                                        // even a reload keeps the game
  await expect(tablet.locator(".score-team strong").first()).toHaveText("2");
  await tabletCtx.setOffline(false);
  await expect(tablet.locator("[data-sync]")).toHaveText("Synced", { timeout: 20_000 });

  // The admin closes the season, so only the tablet can bring the public page up to date.
  const seasonUrl = admin.url(), publicUrl = seasonUrl.replace(/\/s\/([^/]+).*$/, "/p/$1");
  await admin.goto(`/#/l/${slug}`);
  await tap(tablet, "Ann Arbour", "D-Play");
  await tap(tablet, "Al Ames", "Touch");
  await tap(tablet, "Al Ames", "Point");                       // 3–0, after the admin left

  // Finish: a visitor with no password sees the public page, kept current by the tablet:
  // standings and player stats, never salaries.
  await tablet.click("text=Finish game");
  await tablet.click("text=Save to season");
  await expect(tablet.locator("h1")).toHaveText("Saved");
  const visitor = await (await browser.newContext()).newPage();
  visitor.on("pageerror", (e) => errors.push(e.message));
  await visitor.goto(publicUrl);
  await expect(visitor.locator(".pub-standings tbody tr").first()).toContainText("Team A", { timeout: 15_000 });
  await expect(visitor.locator(".pub-standings tbody tr").first()).toContainText("1–0");
  await expect(visitor.locator(".pub-standings tbody tr").first().locator("td").nth(2)).toHaveText("3", { timeout: 15_000 });
  await expect(visitor.locator(".pub")).toContainText("Ann Arbour");
  await expect(visitor.locator("body")).not.toContainText("$");

  // The admin sees the finished game, and the standings follow it.
  await admin.goto(seasonUrl);
  await admin.click("nav.tabs >> text=Games");
  await expect(admin.locator(".pill")).toHaveText("one side only", { timeout: 15_000 });
  await admin.click("nav.tabs >> text=Overview");
  await expect(admin.locator(".standings tbody tr").first()).toContainText("Team A");
  await expect(admin.locator(".standings tbody tr").first()).toContainText("1–0");
  await admin.click("nav.tabs >> text=Player stats");
  await expect(admin.getByRole("link", { name: "Open the public page" })).toHaveAttribute("href", new RegExp(`/l/${slug}/p/`));

  // Team B's side, recorded on the same tablet: a flag with a note made during the game, then the
  // tablet is closed without Finish. Nothing is lost.
  await tablet.getByRole("button", { name: "Record another game" }).click();
  await tablet.fill('input[type="date"]', "2027-01-04");
  await tablet.getByLabel("Recording for").selectOption("Team B");
  await tablet.getByLabel("Against").selectOption("Team A");
  await tablet.click("text=Start recording");
  await tap(tablet, "Bea Brook", "Touch");
  await tap(tablet, "Bo Birch", "Point");
  // Finish sits beside "Add a sub".
  await expect(tablet.locator(".roster-actions")).toContainText("Finish game");
  await tablet.getByRole("button", { name: "Flag this possession" }).first().click();
  await tablet.locator(".flag-note").fill("Bo may have caught it out");
  await expect(tablet.locator("[data-sync]")).toHaveText("Synced", { timeout: 15_000 });
  await tablet.close();

  // Two days later an admin sees the game wasn't finished, with its plays and the flag's note in.
  const later = await (await browser.newContext()).newPage();
  later.on("pageerror", (e) => errors.push(e.message));
  await later.clock.setFixedTime(new Date("2027-01-06T12:00:00"));
  await later.goto(`/#/l/${slug}`);
  await later.getByRole("button", { name: "League admin" }).click();
  await later.getByLabel("League admin password").fill("admin-pass");
  await later.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(later.locator("main")).toContainText("unlocked for league admin");
  await later.goto(seasonUrl.replace(/\/games$/, "/admin"));
  await expect(later.locator("#unfinished-title + p + ul li")).toContainText("Team B's recording v Team A, 2027-01-04");
  await expect(later.locator(".tabs .badge.alert")).toContainText(/\d/);
  await later.click("text=Team B's recording v Team A, 2027-01-04");
  await expect(later.locator("main")).toContainText("Bo may have caught it out");
  await later.click("nav.tabs >> text=Games");
  await expect(later.locator(".pill")).toHaveText("not finished");
  await later.click("nav.tabs >> text=Admin");
  await later.getByRole("button", { name: "Mark finished" }).click();
  await expect(later.locator("#unfinished-title")).toHaveCount(0, { timeout: 15_000 });
  await later.click("nav.tabs >> text=Games");
  await expect(later.locator(".pill")).not.toHaveText("not finished");
  expect(errors).toEqual([]);
});
