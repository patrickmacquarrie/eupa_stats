import { defineConfig, devices } from "@playwright/test";

// Browser tests of the critical flows, against a production build (no demo data).
export default defineConfig({
  testDir: "e2e",
  testIgnore: /online\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4180", viewport: { width: 1024, height: 768 }, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } }],
  webServer: { command: "npm run build && npx vite preview --port 4180 --strictPort", url: "http://localhost:4180", reuseExistingServer: false, timeout: 180_000 },
});
