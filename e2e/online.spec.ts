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
  await tablet.goto("/#/admin");
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
  await admin.goto("/#/admin");
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
  // The first season online goes on the main page.
  await expect(admin.locator(".league-settings")).toContainText("This season is on the main page");

  // The tablet opens /stats, unlocks once with the stats-entry password and lands in Track Stats,
  // with the Games tab beside it and nothing else.
  await tablet.goto("/#/stats");
  await tablet.getByLabel("Stats entry password").fill("tablet-pass");
  await tablet.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(tablet).toHaveURL(new RegExp(`/l/${slug}/s/[^/]+/record$`));
  await expect(tablet.locator(".role-pill")).toHaveText("Stats entry");
  await expect(tablet.locator("nav.tabs a")).toHaveText(["Games"]);

  // Record: each tap is saved on the tablet and synced to the league.
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
  // The site's main address shows the same page.
  await visitor.goto("/");
  await expect(visitor.locator(".pub-standings tbody tr").first()).toContainText("1–0");

  // The tablet sees the game's box score, as stats entry does: plays per player, no salaries.
  await tablet.getByRole("link", { name: "Open the game" }).click();
  await expect(tablet.locator(".game-summary").first()).toContainText("Team A3–0 W");
  await expect(tablet.locator(".game-summary thead").first()).toHaveText("PlayerPointAssistTouchD-PlayThrowawayDropGSO");
  await expect(tablet.locator("main")).not.toContainText("$");

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
  await tablet.click(".track-stats");
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

  // The tablet reopens at the site's main address: its open game is one tap away, as it was.
  const reopened = await tabletCtx.newPage();
  reopened.on("pageerror", (e) => errors.push(e.message));
  await reopened.goto("/");
  await expect(reopened.locator(".continue-game")).toContainText("Team B v Team A");
  await reopened.getByRole("link", { name: "Continue recording" }).click();
  await expect(reopened.locator(".score-team strong").first()).toHaveText("1");
  await expect(reopened.locator(".flag-note")).toHaveValue("Bo may have caught it out");
  await reopened.close();

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

// Stress: 200 random taps on a tablet with undos, reloads, screen locks and lost signal thrown in.
// After every disruption the game must be exactly where it was, and at the end the league's copy
// must match the tablet's, byte for byte.
test("stress: a tablet survives 200 random taps with reloads, locks and lost signal", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const slug = `stress-${Date.now().toString(36)}`;
  const adminCtx = await browser.newContext({ acceptDownloads: true }), tabletCtx = await browser.newContext({ acceptDownloads: true });
  const admin = await adminCtx.newPage(), tablet = await tabletCtx.newPage();
  const errors: string[] = [];
  for (const p of [admin, tablet]) p.on("pageerror", (e) => errors.push(e.message));

  await admin.goto("/#/admin");
  await admin.getByRole("link", { name: /New season/ }).click();
  await admin.fill("#ns-name", "Stress Season");
  await admin.fill("#ns-roster", ROSTER);
  await admin.fill("#ns-first", "2027-01-04"); await admin.fill("#ns-weeks", "4");
  await admin.click("text=Fill in weekly dates");
  await admin.click("text=Create season");
  await admin.click("nav.tabs >> text=Admin"); await admin.click(".subtabs >> text=Setup");
  await admin.fill("#mv-name", "Stress League"); await admin.fill("#mv-slug", slug);
  await admin.fill("#mv-stat", "tablet-pass"); await admin.fill("#mv-admin", "admin-pass"); await admin.fill("#mv-admin2", "admin-pass");
  await admin.getByRole("button", { name: "Create the league and move this season" }).click();
  await expect(admin).toHaveURL(new RegExp(`/l/${slug}/s/`));
  const seasonUrl = admin.url().replace(/#.*$/, "") + "#" + new URL(admin.url()).hash.slice(1).replace(/\/$/, "");

  await tablet.goto(`/#/l/${slug}`);
  await tablet.getByLabel("Stats entry password").fill("tablet-pass");
  await tablet.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(tablet.locator("main")).toContainText("unlocked for stats entry");
  await tablet.goto(`${seasonUrl}/record`);
  await tablet.fill('input[type="date"]', "2027-01-04");
  await tablet.click("text=Start recording");

  // A seeded generator, so a failure replays the same taps.
  let seed = 20261001;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const snapshot = async () => ({
    us: await tablet.locator(".score-team strong").first().textContent(),
    them: await tablet.locator(".score-team strong").last().textContent(),
    plays: (await tablet.locator(".live-foot").textContent())?.match(/(\d+) plays/)?.[1],
    phase: await tablet.locator(".poss").textContent(),
  });
  let offline = false;
  const did = { reloads: 0, locks: 0, signal: 0, undos: 0, taps: 0 };
  for (let i = 0; i < 200; i++) {
    const roll = rand(100);
    if (roll < 4) {
      // Reload: everything comes back as it was.
      const before = await snapshot();
      await tablet.reload(); did.reloads++;
      await expect(tablet.locator(".scorebar")).toBeVisible();
      expect(await snapshot(), `tap ${i}: after a reload`).toEqual(before);
    } else if (roll < 8) {
      // The screen locks and unlocks.
      const before = await snapshot();
      await tablet.evaluate(() => {
        for (const v of ["hidden", "visible"]) {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
          document.dispatchEvent(new Event("visibilitychange"));
        }
      });
      expect(await snapshot(), `tap ${i}: after a screen lock`).toEqual(before);
      did.locks++;
    } else if (roll < 12) {
      offline = !offline;
      await tabletCtx.setOffline(offline); did.signal++;
    } else if (roll < 20) {
      const undo = tablet.getByRole("button", { name: "Undo" });
      if (await undo.isEnabled()) { await undo.click(); did.undos++; }
    } else {
      const buttons = tablet.locator(".prow .rbtn:enabled, .live-top .rbtn.turnover");
      const n = await buttons.count();
      await buttons.nth(rand(n)).click(); did.taps++;
    }
  }
  // The run really did all of it.
  for (const [what, n] of Object.entries(did)) expect(n, what).toBeGreaterThan(what === "taps" ? 100 : 3);
  if (offline) await tabletCtx.setOffline(false);
  // Make sure the game has at least one play to finish.
  const touch = tablet.locator(".prow .rbtn:enabled").first();
  await touch.click();
  await expect(tablet.locator("[data-sync]")).toHaveText("Synced", { timeout: 30_000 });
  const final = await snapshot();

  // Finish on the tablet, keeping its CSV.
  await tablet.click("text=Finish game");
  const [tDl] = await Promise.all([tablet.waitForEvent("download"), tablet.click("text=Download CSV")]);
  const tPath = testInfo.outputPath("stress-tablet.csv");
  await tDl.saveAs(tPath);
  await tablet.click("text=Save to season");
  await expect(tablet.locator("h1")).toHaveText("Saved");

  // The league has every play, the same score, and the same file.
  await admin.goto(`${seasonUrl}/games`);
  await admin.locator("tbody a").first().click();
  const side = admin.locator("section", { hasText: `From ${final.plays} tablet events` });
  await expect(side).toBeVisible({ timeout: 20_000 });
  await expect(side.locator(".score")).toContainText(`${final.us}–${final.them}`);
  const [aDl] = await Promise.all([admin.waitForEvent("download"), side.getByRole("button", { name: "Download CSV" }).click()]);
  const aPath = testInfo.outputPath("stress-admin.csv");
  await aDl.saveAs(aPath);
  const { readFileSync } = await import("node:fs");
  expect(readFileSync(aPath, "utf8")).toBe(readFileSync(tPath, "utf8"));
  expect(errors).toEqual([]);
});
