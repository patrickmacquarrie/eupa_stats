import { defineConfig, devices } from "@playwright/test";

// Browser tests of the online league against the Firebase emulators: npm run e2e:online
export default defineConfig({
  testDir: "e2e",
  testMatch: /online\.spec\.ts$/,
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4181", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } }],
  webServer: { command: "npx vite build --mode emulator && npx vite preview --port 4181 --strictPort", url: "http://localhost:4181", reuseExistingServer: false, timeout: 180_000 },
});
