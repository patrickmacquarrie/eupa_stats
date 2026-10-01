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
