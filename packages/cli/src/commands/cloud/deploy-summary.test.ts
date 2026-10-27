/**
 * What `rebase cloud deploy` ends on.
 *
 * A successful deploy of a project live at `songbuzz.rebase.website` printed
 * `{"success":true,…,"following":true,"status":"success","hosts":[]}` — no URL,
 * an empty `hosts` for a project with a live host, and nothing that said the new
 * version was being served, so its developer checked with `curl` after every
 * deploy. These pin the pieces that replace that: which apps shipped and where,
 * whether each one answers, and the one line a failure ends on.
 */
import { describe, it, expect } from "vitest";
import {
    bundleApps,
    sourceBuildApps,
    deployHosts,
    probeUrl,
    probeOnce,
    checkLive,
    liveVerdict,
    deploySummaryLines,
    failureReason,
    failureLine,
    formatDuration,
    type DeployedApp
} from "./deploy-summary";

// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

/** SongBuzz: a managed backend with a static "game" folded in at `/`. */
const SONGBUZZ = {
    app: "backend",
    kind: "backend" as const,
    entry: { static: [{ name: "game",
path: "/",
dir: "static/game",
spa: true }] }
};

describe("bundleApps", () => {
    it("lists the site at the project's root first, then the API", () => {
        expect(bundleApps(SONGBUZZ, "songbuzz.rebase.website")).toEqual([
            { name: "game",
type: "static",
host: "songbuzz.rebase.website",
url: "https://songbuzz.rebase.website" },
            { name: "backend",
type: "backend",
host: "songbuzz.rebase.website",
url: "https://songbuzz.rebase.website/api" }
        ]);
    });

    it("puts an app with a hostname of its own on that hostname", () => {
        const apps = bundleApps({
            app: "backend",
            kind: "backend",
            entry: { static: [{ name: "admin",
path: "/",
host: "admin.example.com",
dir: "static/admin",
spa: true }] }
        }, "shop.rebase.website");
        expect(apps.find(a => a.name === "admin")?.url).toBe("https://admin.example.com");
    });

    it("names a static app deployed alone after the bundle's app", () => {
        const apps = bundleApps({ app: "web",
kind: "static",
entry: { static: [{ path: "/docs",
dir: "static/x",
spa: false }] } }, "p.rebase.website");
        expect(apps).toEqual([{ name: "web",
type: "static",
host: "p.rebase.website",
url: "https://p.rebase.website/docs" }]);
    });

    it("gives no URL rather than a guessed one when the project host is unknown", () => {
        expect(bundleApps(SONGBUZZ, undefined).every(a => a.url === undefined)).toBe(true);
    });

    it("describes a source build as one app on the project's host", () => {
        expect(sourceBuildApps("api", "p.rebase.website")).toEqual([
            { name: "api",
type: "backend",
host: "p.rebase.website",
url: "https://p.rebase.website" }
        ]);
    });
});

describe("deployHosts", () => {
    it("lists the project's own host when the control plane registered none", () => {
        // The bug: the control plane's `hosts` names only hostnames an app
        // declares, so the ordinary project got `[]`.
        expect(deployHosts([], "songbuzz.rebase.website")).toEqual([
            { host: "songbuzz.rebase.website",
status: "verified" }
        ]);
    });

    it("keeps the registered ones after it, pending included, without duplicates", () => {
        expect(deployHosts([
            { host: "admin.example.com",
status: "pending" },
            { host: "songbuzz.rebase.website",
status: "verified" }
        ], "songbuzz.rebase.website")).toEqual([
            { host: "songbuzz.rebase.website",
status: "verified" },
            { host: "admin.example.com",
status: "pending" }
        ]);
    });

    it("is what the control plane said when the project host cannot be resolved", () => {
        expect(deployHosts(undefined, undefined)).toEqual([]);
    });
});

/** A fetch that answers from a table, counting calls per URL. */
function fakeFetch(answer: (url: string, call: number) => Response | Error) {
    const calls = new Map<string, number>();
    const impl = async (input: string | URL | Request): Promise<Response> => {
        const url = String(input);
        const n = (calls.get(url) ?? 0) + 1;
        calls.set(url, n);
        const res = answer(url, n);
        if (res instanceof Error) throw res;
        return res;
    };
    return { impl: impl as typeof fetch,
calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
headers: { "content-type": "application/json" } });
const html = (status = 200, headers: Record<string, string> = {}) => new Response("<html></html>", { status,
headers });

const backend: DeployedApp = { name: "backend",
type: "backend",
host: "p.rebase.website",
url: "https://p.rebase.website/api" };
const site: DeployedApp = { name: "game",
type: "static",
host: "p.rebase.website",
url: "https://p.rebase.website" };

describe("probeOnce", () => {
    it("probes a backend's health route, not its API root", () => {
        // The bare `/health`: every rebase-server registers it whatever its
        // REBASE_BASE_PATH, and the platform routes it to the backend ahead of
        // any static app.
        expect(probeUrl(backend)).toBe("https://p.rebase.website/health");
        expect(probeUrl(site)).toBe("https://p.rebase.website");
    });

    it("finds a backend live when its API is not under /api", async () => {
        // REBASE_BASE_PATH=/v1 with a site folded in: `/api/health` is the
        // site's index.html, and the deploy used to be reported as not live.
        const { impl } = fakeFetch((url) => url.endsWith("/api/health") ? html(200) : json({ status: "ok" }));
        await expect(probeOnce(backend, "d1", impl)).resolves.toMatchObject({ live: true, url: "https://p.rebase.website/health" });
    });

    it("still reads `/api/health` from a server that has only that", async () => {
        const { impl } = fakeFetch((url) => url.endsWith("/api/health") ? json({ status: "ok" }) : html(404));
        await expect(probeOnce(backend, "d1", impl)).resolves.toMatchObject({ live: true, url: "https://p.rebase.website/api/health" });
    });

    it("calls a backend live on 200 {status: ok}", async () => {
        const { impl } = fakeFetch(() => json({ status: "ok" }));
        await expect(probeOnce(backend, "d1", impl)).resolves.toMatchObject({ live: true,
httpStatus: 200 });
    });

    it("does not let a folded SPA's 200 vouch for a backend", async () => {
        // A site at `/` with client-side routing answers 200 with index.html to
        // any path, `/api/health` included when the API is not up.
        const { impl } = fakeFetch(() => html(200));
        await expect(probeOnce(backend, "d1", impl)).resolves.toMatchObject({ live: false });
    });

    it("says what a degraded backend answered", async () => {
        const { impl } = fakeFetch(() => json({ status: "degraded" }, 503));
        await expect(probeOnce(backend, "d1", impl)).resolves.toMatchObject({
            live: false,
reason: "health check answered 503"
        });
    });

    it("is not live while the platform still serves the previous deployment", async () => {
        const { impl } = fakeFetch(() => html(200, { "x-rebase-deployment": "d0" }));
        await expect(probeOnce(site, "d1", impl)).resolves.toMatchObject({
            live: false,
servingDeployment: "d0",
reason: "still serving deployment d0"
        });
    });

    it("confirms the deployment when the answer names it", async () => {
        const { impl } = fakeFetch(() => html(200, { "x-rebase-deployment": "d1" }));
        await expect(probeOnce(site, "d1", impl)).resolves.toMatchObject({ live: true,
servingDeployment: "d1" });
    });

    it("names an unresolvable hostname rather than `fetch failed`", async () => {
        const cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
        const { impl } = fakeFetch(() => new TypeError("fetch failed", { cause }));
        await expect(probeOnce(site, "d1", impl)).resolves.toMatchObject({
            live: false,
reason: "hostname does not resolve yet"
        });
    });
});

describe("checkLive", () => {
    const fakeClock = () => {
        let t = 0;
        return { now: () => t,
sleep: async (ms: number) => { t += ms; } };
    };
    const verified = [{ host: "p.rebase.website",
status: "verified" as const }];

    it("polls until every app answers", async () => {
        const { impl, calls } = fakeFetch((url, n) => url.endsWith("/health")
            ? (n < 3 ? json({ status: "degraded" }, 503) : json({ status: "ok" }))
            : html(200));
        const clock = fakeClock();
        const result = await checkLive([site, backend], {
            deploymentId: "d1",
hosts: verified,
timeoutMs: 60_000,
fetchImpl: impl,
...clock
        });
        expect(result.map(r => [r.app, r.live])).toEqual([["game", true], ["backend", true]]);
        // The site was live on the first round and is not asked again.
        expect(calls.get("https://p.rebase.website")).toBe(1);
        expect(calls.get("https://p.rebase.website/health")).toBe(3);
        // A backend that answered "degraded" has answered: not asked again elsewhere.
        expect(calls.get("https://p.rebase.website/api/health")).toBeUndefined();
    });

    it("gives up at the timeout with the last reason", async () => {
        const { impl } = fakeFetch(() => json({}, 502));
        const clock = fakeClock();
        const result = await checkLive([backend], {
            deploymentId: "d1",
hosts: verified,
timeoutMs: 10_000,
fetchImpl: impl,
...clock
        });
        expect(result).toEqual([expect.objectContaining({ live: false,
reason: "health check answered 502" })]);
        expect(clock.now()).toBeGreaterThanOrEqual(10_000);
    });

    it("reports an app on an unverified hostname without probing it", async () => {
        const { impl, calls } = fakeFetch(() => html(200));
        const admin: DeployedApp = { name: "admin",
type: "static",
host: "admin.example.com",
url: "https://admin.example.com" };
        const result = await checkLive([admin], {
            deploymentId: "d1",
            hosts: [...verified, { host: "admin.example.com",
status: "pending" }],
            timeoutMs: 60_000,
            fetchImpl: impl,
            ...fakeClock()
        });
        expect(result).toEqual([expect.objectContaining({ live: false,
reason: "DNS for admin.example.com is not verified yet" })]);
        expect(calls.size).toBe(0);
    });
});

describe("the summary", () => {
    it("says where each app answers and that the new version is live", () => {
        const apps = bundleApps(SONGBUZZ, "songbuzz.rebase.website");
        const text = plain(deploySummaryLines({
            projectRef: "songbuzz",
            deploymentId: "fb3c7442",
            elapsedMs: 72_000,
            apps,
            live: [
                { app: "game",
url: "https://songbuzz.rebase.website",
live: true,
httpStatus: 200 },
                { app: "backend",
url: "https://songbuzz.rebase.website/api/health",
live: true,
httpStatus: 200 }
            ],
            liveTimeoutMs: 60_000
        }).join("\n"));
        expect(text).toContain("✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442)");
        expect(text).toMatch(/game\s+static\s+https:\/\/songbuzz\.rebase\.website\s+live/);
        expect(text).toMatch(/backend\s+backend\s+https:\/\/songbuzz\.rebase\.website\/api\s+live/);
        expect(text).toContain("✓ Live: the new version answers on every address above.");
    });

    it("says plainly when it could not confirm, and which app", () => {
        const verdict = liveVerdict([
            { app: "game",
url: "u",
live: true },
            { app: "backend",
url: "u",
live: false,
reason: "health check answered 503" }
        ], 60_000);
        expect(verdict.live).toBe(false);
        expect(verdict.message).toContain("Not confirmed live after 1m: backend (health check answered 503)");
    });

    it("does not report a skipped check as a failed one", () => {
        expect(liveVerdict(undefined, 0)).toEqual({ live: null,
message: "Live check skipped (--live-timeout 0)." });
    });

    it.each([[4_000, "4s"], [60_000, "1m"], [72_400, "1m 12s"]])("formats %dms as %s", (ms, out) => {
        expect(formatDuration(ms)).toBe(out);
    });
});

describe("the failure line", () => {
    const log = [
        "[10:01:02] 📦 Managed deploy — runtime 1.21.0",
        "[10:01:09] ⏳ Waiting for the new version to become ready...",
        "",
        "❌ Managed deploy failed: The new version did not become ready: CrashLoopBackOff (exit 1)",
        ""
    ].join("\n");

    it("takes the reason from the control plane's ❌ line", () => {
        expect(failureReason(log)).toBe("Managed deploy failed: The new version did not become ready: CrashLoopBackOff (exit 1)");
    });

    it("reads a timestamped static failure the same way", () => {
        expect(failureReason("[10:00:00] ❌ Static deploy failed: upload rejected\n")).toBe("Static deploy failed: upload rejected");
    });

    it("falls back to the last line of a log with no marker", () => {
        expect(failureReason("step 1\nstep 2: out of memory\n")).toBe("step 2: out of memory");
    });

    it("names the apps that failed", () => {
        expect(failureLine({ apps: ["backend", "game"],
status: "failed",
deploymentId: "d1",
logs: log }))
            .toBe("backend + game failed to deploy: Managed deploy failed: The new version did not become ready: CrashLoopBackOff (exit 1)");
    });
});
