import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

/**
 * The frontend port.
 *
 * Not 5173, for the same reason API_PORT is not 3001: it is the conventional
 * one, so it is the likeliest to already belong to another project on a
 * developer's machine — and Vite hands it to the first asker, so a suite that
 * took it would either fail to bind or, worse, adopt somebody else's dev server
 * and test their code. `globalSetup` has a check for exactly that; moving off
 * the default is what stops it firing in the ordinary case.
 *
 * Overridable, because a machine can have anything on any port:
 *   REBASE_E2E_PORT=5399 npx playwright test -c e2e/playwright.config.ts
 */
export const PORT = Number(process.env.REBASE_E2E_PORT ?? 5399);

/**
 * The API port, pinned.
 *
 * `rebase dev` otherwise derives one per project ("your .env PORT / VITE_API_URL
 * are ignored here"), so the backend lands somewhere unpredictable — 3070 on
 * this checkout. That matters because `webServer.url` below can only wait for
 * one thing, and Vite binds 5173 whether or not the backend ever came up: the
 * suite would start against a dead API and every login failed with
 * ERR_CONNECTION_REFUSED, which surfaces as ten timeouts on a sidebar link.
 * Pinning it lets globalSetup wait for the backend too. Not 3001 — that is the
 * conventional port and the likeliest to be occupied by another project.
 */
export const API_PORT = Number(process.env.REBASE_E2E_API_PORT ?? 3199);

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
  reporter: [["html", { outputFolder: "../../.artifacts/playwright-report" }]],
  outputDir: "../../.artifacts/test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    // `rebase dev` direct, rather than the root `dev` script, so --port reaches it.
    command: `pnpm exec rebase dev --port ${API_PORT}`,
    env: { ...process.env, REBASE_FRONTEND_PORT: String(PORT) } as Record<string, string>,
    cwd: path.resolve(__dirname, "../../app"),
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI
  }
});
