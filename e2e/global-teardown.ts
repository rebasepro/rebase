/**
 * Stop the dev server this run started — both halves of it.
 *
 * `rebase dev` is two processes: Vite on 5173 and the backend on the API port.
 * Playwright's teardown kills the supervisor but not the children, so they
 * outlive the run. Reaping only Vite is worse than reaping neither: the next run
 * sees 5173 free and starts a fresh server, whose backend cannot bind the API
 * port because the previous one is still dying on it — and the health check then
 * gets its answer from that corpse, passes, and every login afterwards hits a
 * closed socket. That is what made runs alternate pass/fail/pass/fail.
 *
 * So: kill both ports, and wait until they are actually free, because the next
 * run starts immediately and "signalled" is not "gone".
 *
 * Only a server we started is reaped; `REBASE_E2E_OWNS_SERVER` is decided in
 * playwright.config.ts before `webServer` launches. A dev server the developer
 * already had running is theirs to keep — that is what `reuseExistingServer`
 * is for.
 */
import { execSync } from "node:child_process";
import { PORT, API_PORT } from "./playwright.config";

const listenersOn = (port: number): number[] => {
    try {
        return execSync(`lsof -ti:${port} -sTCP:LISTEN`, { stdio: ["ignore", "pipe", "ignore"] })
            .toString().trim().split("\n").filter(Boolean).map(Number);
    } catch {
        return []; // lsof exits non-zero when nothing is listening
    }
};

export default async function globalTeardown() {
    if (process.env.REBASE_E2E_OWNS_SERVER !== "1") return;

    const ports = [PORT, API_PORT];
    for (const port of ports) {
        for (const pid of listenersOn(port)) {
            try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
        }
    }

    // Wait for the sockets to actually close, then insist.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        if (ports.every(p => listenersOn(p).length === 0)) return;
        await new Promise(r => setTimeout(r, 200));
    }
    for (const port of ports) {
        for (const pid of listenersOn(port)) {
            try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
        }
    }
}
