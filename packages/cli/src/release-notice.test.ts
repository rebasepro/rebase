import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    compareVersions,
    distTagsUrl,
    newerRelease,
    readReleaseCheck,
    refreshReleaseCheckInBackground,
    RELEASE_CHECK_INTERVAL_MS,
    releaseCheckStale,
    releaseNoticeEnabled,
    releaseNoticeLines
} from "./release-notice";

describe("newerRelease", () => {
    it("names latest when a stable CLI is behind it", () => {
        expect(newerRelease("0.34.2", { latest: "0.35.0" })).toBe("0.35.0");
    });

    it("says nothing when the CLI is current, or ahead", () => {
        expect(newerRelease("0.34.2", { latest: "0.34.2" })).toBeNull();
        expect(newerRelease("0.35.0", { latest: "0.34.2" })).toBeNull();
    });

    it("never points a stable CLI at a canary", () => {
        expect(newerRelease("0.34.2", { latest: "0.34.2", canary: "0.35.0-canary.gabc1234" })).toBeNull();
    });

    it("keeps a canary CLI on its channel while the channel is ahead", () => {
        expect(newerRelease("0.35.0-canary.g1", { latest: "0.34.2", canary: "0.35.0-canary.g2" })).toBe("0.35.0-canary.g2");
    });

    it("moves a canary CLI to a stable release that has overtaken its channel", () => {
        // The registry as it is on 2026-11-23: canary was last cut at 0.31.
        expect(newerRelease("0.31.0-canary.g59cd6fd", { latest: "0.34.2", canary: "0.31.0-canary.g59cd6fd" })).toBe("0.34.2");
    });

    it("tells a version it cannot read nothing", () => {
        expect(newerRelease("unknown", { latest: "0.35.0" })).toBeNull();
        expect(newerRelease("0.34.2", { latest: "not-a-version" })).toBeNull();
    });
});

describe("compareVersions", () => {
    it("orders by release, then a release above its prereleases", () => {
        expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
        expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
        expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
        expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    });
});

describe("releaseNoticeEnabled", () => {
    it("is on for an ordinary command", () => {
        expect(releaseNoticeEnabled({}, "status")).toBe(true);
    });

    it("is off in CI, when switched off, and inside a CLI run by another", () => {
        expect(releaseNoticeEnabled({ CI: "true" }, "status")).toBe(false);
        expect(releaseNoticeEnabled({ REBASE_NO_UPDATE_CHECK: "1" }, "status")).toBe(false);
        expect(releaseNoticeEnabled({ NO_UPDATE_NOTIFIER: "" }, "status")).toBe(false);
        expect(releaseNoticeEnabled({ REBASE_RELEASE_NOTICE_SHOWN: "1" }, "status")).toBe(false);
    });

    it("is off for `upgrade`, which is the remedy, and with no command", () => {
        expect(releaseNoticeEnabled({}, "upgrade")).toBe(false);
        expect(releaseNoticeEnabled({}, undefined)).toBe(false);
    });

    it("reads CI=false as off", () => {
        expect(releaseNoticeEnabled({ CI: "false" }, "status")).toBe(true);
    });
});

describe("releaseNoticeLines", () => {
    it("in a project, names `rebase upgrade` and the skills it refreshes", () => {
        const text = releaseNoticeLines("0.34.2", "0.35.0", true).join("\n");
        expect(text).toContain("Rebase 0.35.0 is out; this CLI is 0.34.2.");
        expect(text).toContain("`rebase upgrade`");
        expect(text).toContain("agent skills");
        expect(text).toContain("REBASE_NO_UPDATE_CHECK=1");
    });

    it("outside one, names how to update the CLI itself", () => {
        expect(releaseNoticeLines("0.34.2", "0.35.0", false).join("\n")).toContain("@rebasepro/cli@0.35.0");
    });
});

describe("the release check file", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-release-check-"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("reads what the background check wrote, and nothing else", () => {
        const file = path.join(dir, "release-check.json");
        expect(readReleaseCheck(file)).toBeNull();
        fs.writeFileSync(file, "not json");
        expect(readReleaseCheck(file)).toBeNull();
        fs.writeFileSync(file, JSON.stringify({ checkedAt: "2026-11-23T00:00:00.000Z", distTags: { latest: "0.35.0", bogus: 3 } }));
        expect(readReleaseCheck(file)).toEqual({ checkedAt: "2026-11-23T00:00:00.000Z", distTags: { latest: "0.35.0" } });
    });

    it("is due again after a day, when missing, and when dated in the future", () => {
        const now = Date.parse("2026-11-23T12:00:00.000Z");
        const at = (ms: number) => ({ checkedAt: new Date(ms).toISOString(), distTags: {} });
        expect(releaseCheckStale(null, now)).toBe(true);
        expect(releaseCheckStale(at(now - 60_000), now)).toBe(false);
        expect(releaseCheckStale(at(now - RELEASE_CHECK_INTERVAL_MS - 1), now)).toBe(true);
        expect(releaseCheckStale(at(now + 60 * 60_000), now)).toBe(true);
    });

    it("asks the configured registry", () => {
        expect(distTagsUrl({})).toBe("https://registry.npmjs.org/-/package/@rebasepro%2fcli/dist-tags");
        expect(distTagsUrl({ npm_config_registry: "http://localhost:4873/" })).toBe("http://localhost:4873/-/package/@rebasepro%2fcli/dist-tags");
    });

    /** A registry that answers the dist-tags request, or fails it. */
    async function registry(answer: { status: number; body?: unknown }): Promise<{ url: string; requests: string[]; close: () => Promise<void> }> {
        const requests: string[] = [];
        const server = http.createServer((req, res) => {
            requests.push(req.url ?? "");
            res.writeHead(answer.status, { "content-type": "application/json" });
            res.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as { port: number };
        return {
            url: `http://127.0.0.1:${port}/`,
            requests,
            close: () => new Promise<void>((resolve) => server.close(() => resolve()))
        };
    }

    async function waitForFile(file: string, test: (check: ReturnType<typeof readReleaseCheck>) => boolean): Promise<ReturnType<typeof readReleaseCheck>> {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
            const check = readReleaseCheck(file);
            if (check && test(check)) return check;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`${file} was never written`);
    }

    it("the background process writes the registry's dist-tags", async () => {
        const server = await registry({ status: 200, body: { latest: "0.35.0", canary: "0.36.0-canary.g1" } });
        try {
            const file = path.join(dir, "nested", "release-check.json");
            refreshReleaseCheckInBackground(file, { ...process.env, npm_config_registry: server.url });
            const check = await waitForFile(file, () => true);
            expect(check?.distTags).toEqual({ latest: "0.35.0", canary: "0.36.0-canary.g1" });
            expect(server.requests).toEqual(["/-/package/@rebasepro%2fcli/dist-tags"]);
        } finally {
            await server.close();
        }
    });

    it("keeps the tags it had when the registry fails, and still records the attempt", async () => {
        const server = await registry({ status: 503 });
        try {
            const file = path.join(dir, "release-check.json");
            fs.writeFileSync(file, JSON.stringify({ checkedAt: "2026-01-01T00:00:00.000Z", distTags: { latest: "0.30.0" } }));
            refreshReleaseCheckInBackground(file, { ...process.env, npm_config_registry: server.url });
            const check = await waitForFile(file, (c) => c?.checkedAt !== "2026-01-01T00:00:00.000Z");
            expect(check?.distTags).toEqual({ latest: "0.30.0" });
        } finally {
            await server.close();
        }
    });
});
