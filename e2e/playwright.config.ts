import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";

export const PORT = 5173;

/**
 * Did *this* run start the dev server, or adopt one that was already there?
 *
 * Decided here because the config is evaluated before `webServer` launches —
 * `globalSetup` runs after it, by which point the port is always busy and the
 * question can no longer be asked. globalTeardown reads this to reap only a
 * server we own, leaving a developer's own `pnpm dev` alone.
 */
const portWasFree = (() => {
  try {
    execSync(`lsof -ti:${PORT} -sTCP:LISTEN`, { stdio: "ignore" });
    return false;
  } catch {
    return true; // lsof exits non-zero when nothing is listening
  }
})();
process.env.REBASE_E2E_OWNS_SERVER = portWasFree ? "1" : "0";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "pnpm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI
  }
});
