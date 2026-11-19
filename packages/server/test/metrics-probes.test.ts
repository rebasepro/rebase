/**
 * Uptime monitors and marked platform checks are served but not counted as
 * traffic, and `/metrics` says what the app does on its own (cron jobs, job
 * workers) — both so a platform that sleeps idle projects can decide honestly.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { createMetricsMiddleware, MetricsRegistry } from "../src/metrics";
import {
    PROBE_HEADER,
    PROBE_REQUESTS_METRIC,
    UPTIME_MONITOR_AGENTS,
    classifyProbe,
    matchUptimeMonitor
} from "../src/metrics/probes";
import {
    BACKGROUND_WORKERS_METRIC,
    SCHEDULED_JOBS_METRIC,
    recordScheduledWork
} from "../src/metrics/scheduled-work";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function app() {
    const metrics = createMetricsMiddleware("/api");
    const server = new Hono<HonoEnv>();
    server.use("/*", metrics.middleware);
    server.get("/", c => c.text("home"));
    server.get("/api/data/items", c => c.json([]));
    return { server, registry: metrics.registry };
}

/** The value of one rendered series line, or undefined when it is absent. */
function sample(text: string, line: string): number | undefined {
    const found = text.split("\n").find(l => l.startsWith(`${line} `));
    return found === undefined ? undefined : Number(found.slice(line.length + 1));
}

function requestsTotal(text: string): number {
    return text.split("\n")
        .filter(l => l.startsWith("rebase_requests_total{") || l.startsWith("rebase_requests_total "))
        .reduce((sum, l) => sum + Number(l.slice(l.lastIndexOf(" ") + 1)), 0);
}

describe("probe requests", () => {
    it("a request with x-rebase-probe is served, left out of rebase_requests_total and counted apart", async () => {
        const { server, registry } = app();

        const res = await server.request("/", { headers: { [PROBE_HEADER]: "1", "user-agent": CHROME } });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("home");

        const text = registry.render();
        expect(requestsTotal(text)).toBe(0);
        expect(sample(text, `${PROBE_REQUESTS_METRIC}{by="header",status="200"}`)).toBe(1);
        expect(text).toContain(`# TYPE ${PROBE_REQUESTS_METRIC} counter`);
        // Not in the per-minute history either.
        expect(registry.requestTotalsBySurface()).toEqual({});
    });

    it("the header counts with any value, an empty one included", async () => {
        const { server, registry } = app();
        await server.request("/", { headers: { [PROBE_HEADER]: "" } });
        await server.request("/", { headers: { [PROBE_HEADER]: "uptime-check" } });

        expect(sample(registry.render(), `${PROBE_REQUESTS_METRIC}{by="header",status="200"}`)).toBe(2);
    });

    it("a monitor's user agent is a probe, labelled with the monitor", async () => {
        const { server, registry } = app();

        await server.request("/", { headers: { "user-agent": "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)" } });
        await server.request("/api/data/items", { headers: { "user-agent": "Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)" } });

        const text = registry.render();
        expect(requestsTotal(text)).toBe(0);
        expect(sample(text, `${PROBE_REQUESTS_METRIC}{agent="uptimerobot",by="user_agent",status="200"}`)).toBe(1);
        expect(sample(text, `${PROBE_REQUESTS_METRIC}{agent="pingdom",by="user_agent",status="200"}`)).toBe(1);
    });

    it("ordinary requests count exactly as before, beside probes", async () => {
        const { server, registry } = app();

        await server.request("/", { headers: { "user-agent": CHROME } });
        await server.request("/api/data/items", { headers: { "user-agent": CHROME } });
        await server.request("/", { headers: { "user-agent": "kube-probe/1.29" } });

        const text = registry.render();
        expect(requestsTotal(text)).toBe(2);
        expect(sample(text, `rebase_requests_total{method="GET",status="200",surface="app"}`)).toBe(1);
        expect(sample(text, `rebase_requests_total{method="GET",status="200",surface="data"}`)).toBe(1);
        expect(registry.requestTotalsBySurface()).toEqual({
            app: { requests: 1, errors: 0 },
            data: { requests: 1, errors: 0 }
        });
        expect(sample(text, `${PROBE_REQUESTS_METRIC}{agent="kube-probe",by="user_agent",status="200"}`)).toBe(1);
    });

    it("a request with no user agent and no header is ordinary", async () => {
        const { server, registry } = app();
        await server.request("/");
        const text = registry.render();
        expect(requestsTotal(text)).toBe(1);
        expect(text).not.toContain(PROBE_REQUESTS_METRIC);
    });
});

describe("matchUptimeMonitor", () => {
    it.each([
        ["Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)", "uptimerobot"],
        ["Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)", "pingdom"],
        ["Better Uptime Bot Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "better uptime"],
        ["kube-probe/1.29", "kube-probe"],
        ["GoogleHC/1.0", "googlehc"],
        ["ELB-HealthChecker/2.0", "elb-healthchecker"],
        ["Datadog/Synthetics", "datadog"],
        ["Uptime-Kuma/1.23.11", "uptime-kuma"],
        ["updown.io daemon 2.11", "updown.io"],
        ["STATUSCAKE_BOT", "statuscake"],
        ["Mozilla/5.0 (compatible; StatusCake)", "statuscake"],
        ["NewRelicPinger/1.0 (269061)", "newrelicpinger"]
    ])("%s → %s", (ua, expected) => {
        expect(matchUptimeMonitor(ua)).toBe(expected);
    });

    it("is case-insensitive", () => {
        expect(matchUptimeMonitor("UPTIMEROBOT/2.0")).toBe("uptimerobot");
        expect(matchUptimeMonitor("uptimerobot/2.0")).toBe("uptimerobot");
    });

    it("does not take a browser for a monitor because a word contains a monitor's name", () => {
        // Substring matching (the waker's regex) would call each of these a probe.
        expect(matchUptimeMonitor(`${CHROME} DatadogDashboardViewer/3.1`)).toBeUndefined();
        expect(matchUptimeMonitor(`${CHROME} MyPingdomReader/1.0`)).toBeUndefined();
        expect(matchUptimeMonitor(`Mozilla/5.0 (Linux; Android 14; healthchecksapp) ${CHROME}`)).toBeUndefined();
        expect(matchUptimeMonitor(CHROME)).toBeUndefined();
        expect(matchUptimeMonitor("")).toBeUndefined();
        expect(matchUptimeMonitor(undefined)).toBeUndefined();
    });

    it("names every listed monitor when it is the product", () => {
        for (const agent of UPTIME_MONITOR_AGENTS) {
            expect(matchUptimeMonitor(`${agent}/1.0`)).toBeDefined();
        }
    });

    it("the header wins over the user agent", () => {
        const headers: Record<string, string> = { [PROBE_HEADER]: "1", "user-agent": "UptimeRobot/2.0" };
        expect(classifyProbe(name => headers[name])).toEqual({ by: "header" });
        expect(classifyProbe(name => (name === "user-agent" ? "UptimeRobot/2.0" : undefined))).toEqual({ by: "user_agent", agent: "uptimerobot" });
        expect(classifyProbe(() => undefined)).toBeUndefined();
    });
});

describe("scheduled work in /metrics", () => {
    it("counts the enabled cron jobs and reports a running job worker", () => {
        const registry = new MetricsRegistry();
        const jobs = [{ enabled: true }, { enabled: true }, { enabled: false }];
        let running = true;
        recordScheduledWork(registry, { listJobs: () => jobs }, { isRunning: () => running });

        let text = registry.render();
        expect(text).toContain(`# TYPE ${SCHEDULED_JOBS_METRIC} gauge`);
        expect(sample(text, SCHEDULED_JOBS_METRIC)).toBe(2);
        expect(sample(text, BACKGROUND_WORKERS_METRIC)).toBe(1);

        // Read at each render: a job registered or disabled later shows up.
        jobs.push({ enabled: true });
        jobs[0].enabled = false;
        running = false;
        text = registry.render();
        expect(sample(text, SCHEDULED_JOBS_METRIC)).toBe(2);
        expect(sample(text, BACKGROUND_WORKERS_METRIC)).toBe(0);
    });

    it("says zero rather than nothing when the app has no scheduler or queue", () => {
        const registry = new MetricsRegistry();
        recordScheduledWork(registry, undefined, undefined);
        const text = registry.render();
        expect(sample(text, SCHEDULED_JOBS_METRIC)).toBe(0);
        expect(sample(text, BACKGROUND_WORKERS_METRIC)).toBe(0);
    });

    it("reflects jobs registered in a real CronScheduler", async () => {
        const { CronScheduler } = await import("../src/cron/cron-scheduler");
        const scheduler = new CronScheduler();
        const registry = new MetricsRegistry();
        recordScheduledWork(registry, scheduler, undefined);
        expect(sample(registry.render(), SCHEDULED_JOBS_METRIC)).toBe(0);

        scheduler.registerJobs([
            { id: "nightly", definition: { schedule: "0 3 * * *", handler: async () => undefined } },
            { id: "hourly", definition: { schedule: "0 * * * *", handler: async () => undefined } }
        ]);
        expect(sample(registry.render(), SCHEDULED_JOBS_METRIC)).toBe(2);
    });

    it("is wired by both runtime boots, before the route is mounted", () => {
        const boot = readFileSync(path.join(__dirname, "../src/boot/boot.ts"), "utf8");
        expect(boot).toMatch(/recordScheduledWork\(metrics\.registry, backend\.cronScheduler, backend\.jobQueue\);/);
        expect(boot).toMatch(/recordScheduledWork\(metrics\.registry, undefined, undefined\);\s+app\.route\("\/metrics"/);
    });
});
