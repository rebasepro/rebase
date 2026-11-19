/**
 * A Jest reporter that makes a stuck or starving run name itself.
 *
 * Jest's default reporter prints a suite only when it finishes. When a CI job
 * dies partway — a suite that never settles, or a runner that runs out of
 * memory and is shut down ("The runner has received a shutdown signal") — the
 * log ends on the last suite that passed and says nothing about the ones still
 * running, nor about how much memory was left. server-postgres's shard 2 died
 * that way six times in three days (2026-11-17..19) and no log could tell a
 * hang from an out-of-memory runner; it was the latter (see
 * packages/server-postgres/test/helpers/release-pglite-on-close.ts).
 *
 * This reporter keeps the set of suites in flight and, on a timer:
 *
 *   - prints every suite that has been running longer than the threshold
 *     (REBASE_JEST_WATCHDOG_MINUTES, default 3), with how long;
 *   - on CI (or with REBASE_JEST_WATCHDOG_HEARTBEAT=1) prints a one-line
 *     heartbeat every minute: suites done, suites in flight, free system
 *     memory, and the resident memory of the jest process tree (the workers
 *     and any PGlite/Postgres children they started). The period is
 *     REBASE_JEST_WATCHDOG_INTERVAL_SECONDS (default 60).
 *
 * The timer is unref'd, so it never keeps jest alive on its own. Add it next to
 * the default reporter:
 *
 *     reporters: ["default", "<rootDir>/../../tooling/scripts/jest/suite-watchdog-reporter.cjs"]
 */
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MB = 1024 * 1024;

/** Resident memory (bytes) of `rootPid` and all its descendants, or null. */
function treeRss(rootPid) {
    let out;
    try {
        out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], { encoding: "utf8", timeout: 5000 });
    } catch {
        return null;
    }
    const children = new Map();
    const rss = new Map();
    for (const line of out.split("\n")) {
        const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
        if (!pid) continue;
        rss.set(pid, kb * 1024);
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(pid);
    }
    let total = 0;
    const stack = [rootPid];
    const seen = new Set();
    while (stack.length) {
        const pid = stack.pop();
        if (seen.has(pid)) continue;
        seen.add(pid);
        total += rss.get(pid) ?? 0;
        for (const c of children.get(pid) ?? []) stack.push(c);
    }
    return total;
}

/**
 * Available memory. os.freemem() on Linux is MemFree, which excludes the page
 * cache and reads near zero on a healthy runner; MemAvailable is the number
 * the OOM killer cares about.
 */
function availableMemory() {
    try {
        const meminfo = require("node:fs").readFileSync("/proc/meminfo", "utf8");
        const m = /^MemAvailable:\s+(\d+) kB/m.exec(meminfo);
        if (m) return Number(m[1]) * 1024;
    } catch {
        // not Linux
    }
    return os.freemem();
}

function minutes(ms) {
    return `${(ms / 60000).toFixed(1)}m`;
}

class SuiteWatchdogReporter {
    constructor(globalConfig) {
        this.rootDir = globalConfig.rootDir;
        this.running = new Map();
        this.done = 0;
        this.total = 0;
        this.started = Date.now();
        this.thresholdMs = Number(process.env.REBASE_JEST_WATCHDOG_MINUTES || 3) * 60000;
        this.heartbeat = Boolean(process.env.CI) || process.env.REBASE_JEST_WATCHDOG_HEARTBEAT === "1";
        this.intervalMs = Number(process.env.REBASE_JEST_WATCHDOG_INTERVAL_SECONDS || 60) * 1000;
        this.timer = null;
    }

    rel(testPath) {
        return path.relative(this.rootDir, testPath);
    }

    log(message) {
        process.stderr.write(`[suite-watchdog +${minutes(Date.now() - this.started)}] ${message}\n`);
    }

    onRunStart(results) {
        this.total = results.numTotalTestSuites;
        this.started = Date.now();
        this.timer = setInterval(() => this.tick(), this.intervalMs);
        this.timer.unref();
    }

    onTestFileStart(test) {
        this.running.set(test.path, Date.now());
    }

    onTestFileResult(test) {
        const began = this.running.get(test.path);
        this.running.delete(test.path);
        this.done += 1;
        if (began !== undefined && Date.now() - began > this.thresholdMs) {
            this.log(`slow suite finished: ${this.rel(test.path)} took ${minutes(Date.now() - began)}`);
        }
    }

    tick() {
        const now = Date.now();
        if (this.heartbeat) {
            const tree = treeRss(process.pid);
            const inFlight = [...this.running.entries()]
                .map(([p, t]) => `${this.rel(p)} (${minutes(now - t)})`)
                .join(", ");
            this.log(
                `${this.done}/${this.total} done; mem available ${Math.round(availableMemory() / MB)} MB` +
                    ` of ${Math.round(os.totalmem() / MB)} MB; jest tree RSS ` +
                    (tree === null ? "n/a" : `${Math.round(tree / MB)} MB`) +
                    `; running: ${inFlight || "none"}`
            );
            return;
        }
        for (const [p, t] of this.running) {
            if (now - t > this.thresholdMs) {
                this.log(`still running after ${minutes(now - t)}: ${this.rel(p)}`);
            }
        }
    }

    onRunComplete() {
        if (this.timer) clearInterval(this.timer);
    }

    getLastError() {
        return undefined;
    }
}

module.exports = SuiteWatchdogReporter;
