/**
 * `/metrics` reports what realtime is carrying on this process, so a deployment
 * of several instances can see where its sockets are and how much crossed
 * between them.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RealtimeCounts } from "@rebasepro/types";
import { createMetricsRoutes, MetricsRegistry } from "../src/metrics";
import {
    REALTIME_BUS_PUBLISHED_METRIC,
    REALTIME_BUS_SKIPPED_METRIC,
    REALTIME_CHANNELS_METRIC,
    REALTIME_SOCKETS_METRIC,
    recordRealtimeCounts
} from "../src/metrics/realtime";

const quiet: RealtimeCounts = { sockets: 0, channels: 0, busFramesPublished: {}, busFramesSkipped: 0 };

describe("realtime counts in /metrics", () => {
    it("renders each count as its Prometheus type", () => {
        const registry = new MetricsRegistry();
        recordRealtimeCounts(registry, { counts: () => ({
            sockets: 12,
            channels: 3,
            busFramesPublished: { broadcast: 40, channels: 2 },
            busFramesSkipped: 900
        }) });

        const text = registry.render();

        expect(text).toContain(`# TYPE ${REALTIME_SOCKETS_METRIC} gauge\n${REALTIME_SOCKETS_METRIC} 12\n`);
        expect(text).toContain(`# TYPE ${REALTIME_CHANNELS_METRIC} gauge`);
        expect(text).toContain(`${REALTIME_CHANNELS_METRIC} 3\n`);
        expect(text).toContain(`# TYPE ${REALTIME_BUS_PUBLISHED_METRIC} counter`);
        expect(text).toContain(`${REALTIME_BUS_PUBLISHED_METRIC}{kind="broadcast"} 40\n`);
        expect(text).toContain(`${REALTIME_BUS_PUBLISHED_METRIC}{kind="channels"} 2\n`);
        expect(text).toContain(`# TYPE ${REALTIME_BUS_SKIPPED_METRIC} counter\n${REALTIME_BUS_SKIPPED_METRIC} 900\n`);
    });

    it("reports zeros from a runtime that counts, so absent can mean it doesn't", () => {
        const registry = new MetricsRegistry();
        recordRealtimeCounts(registry, { counts: () => quiet });

        const text = registry.render();

        expect(text).toContain(`${REALTIME_SOCKETS_METRIC} 0\n`);
        expect(text).toContain(`${REALTIME_BUS_SKIPPED_METRIC} 0\n`);
    });

    it("reads the counts at each render, and replaces rather than adds", () => {
        const registry = new MetricsRegistry();
        let sockets = 1;
        let skipped = 10;
        recordRealtimeCounts(registry, { counts: () => ({ ...quiet, sockets, busFramesSkipped: skipped }) });

        expect(registry.render()).toContain(`${REALTIME_SOCKETS_METRIC} 1\n`);
        sockets = 7;
        skipped = 25;

        const text = registry.render();
        expect(text).toContain(`${REALTIME_SOCKETS_METRIC} 7\n`);
        expect(text).toContain(`${REALTIME_BUS_SKIPPED_METRIC} 25\n`);
    });

    it("emits nothing for a deployment with no realtime, or a provider that keeps no counts", () => {
        const none = new MetricsRegistry();
        recordRealtimeCounts(none, undefined);
        const uncounted = new MetricsRegistry();
        recordRealtimeCounts(uncounted, {});

        expect(none.render()).not.toContain("rebase_realtime");
        expect(uncounted.render()).not.toContain("rebase_realtime");
    });

    it("is wired by the runtime boot, before the route is mounted", () => {
        const boot = readFileSync(path.join(__dirname, "../src/boot/boot.ts"), "utf8");
        expect(boot).toMatch(/recordRealtimeCounts\(metrics\.registry, backend\.realtimeService\);\s+app\.route\("\/metrics"/);
    });

    it("is behind the metrics token like everything else on the route", async () => {
        const registry = new MetricsRegistry();
        recordRealtimeCounts(registry, { counts: () => ({ ...quiet, sockets: 12 }) });
        const router = createMetricsRoutes(registry, "the-token");

        const anonymous = await router.request("http://local/");
        expect(anonymous.status).toBe(401);
        expect(await anonymous.text()).not.toContain("rebase_realtime");

        const wrong = await router.request("http://local/", { headers: { authorization: "Bearer nope" } });
        expect(wrong.status).toBe(401);

        const scraper = await router.request("http://local/", { headers: { authorization: "Bearer the-token" } });
        expect(scraper.status).toBe(200);
        expect(await scraper.text()).toContain(`${REALTIME_SOCKETS_METRIC} 12\n`);
    });
});
