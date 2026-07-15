/**
 * Stop the dev server this run started, including the children it spawned.
 *
 * Playwright's `webServer` teardown kills `pnpm run dev` but not the Vite and
 * tsx grandchildren under it, so Vite survives on the port with `ppid` 1 while
 * its backend does not. The next run's `reuseExistingServer` then adopts that
 * half-dead leftover instead of starting a fresh one — the frontend answers, so
 * the port check and the title guard both pass, and every test fails at login
 * against a backend that is gone. It reads as an app regression and is not one.
 *
 * Only a server we started is reaped; `REBASE_E2E_OWNS_SERVER` is decided in
 * playwright.config.ts before `webServer` launches. A dev server the developer
 * already had running is theirs to keep — that is what `reuseExistingServer`
 * is for.
 */
import { execSync } from "node:child_process";
import { PORT } from "./playwright.config";

export default async function globalTeardown() {
    if (process.env.REBASE_E2E_OWNS_SERVER !== "1") return;

    let pids: string[] = [];
    try {
        pids = execSync(`lsof -ti:${PORT} -sTCP:LISTEN`, { stdio: ["ignore", "pipe", "ignore"] })
            .toString().trim().split("\n").filter(Boolean);
    } catch {
        return; // already gone
    }

    for (const pid of pids) {
        try { process.kill(Number(pid), "SIGTERM"); } catch { /* already gone */ }
    }
}
