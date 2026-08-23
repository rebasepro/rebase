import { defineConfig } from "vitest/config";

/**
 * The DB-backed suite: tests that start a real managed database.
 *
 * Separated from the default run for one measured reason. These start PGlite
 * instances, which is CPU-hungry for a minute or two at a time, and running
 * them beside the fast suite starved it — `init.test.ts`, already close to the
 * 15s ceiling, began timing out purely from contention rather than from
 * anything it does. A slow test that makes an unrelated fast test flaky is
 * worse than a slow test.
 *
 * They are not optional. `pnpm test:integration` runs them, and CI runs both.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.integration.test.ts"],
        // A first boot runs initdb: ~11s cold, ~4s warm, and slower on CI.
        testTimeout: 120_000,
        hookTimeout: 60_000,
        // One file at a time. Several PGlite instances competing for cores make
        // every one of them slower and the timings unpredictable.
        fileParallelism: false
    }
});
