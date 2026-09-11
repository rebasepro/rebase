import { defineConfig } from "vitest/config";

/**
 * Nothing this suite runs may reach the telemetry collector.
 *
 * Several tests spawn the real `bin/rebase.js` — `bin-output.test.ts` runs
 * `rebase status extra` five times to prove stderr carries no ANSI escapes —
 * and a spawned CLI inherits this process's environment, consults the
 * developer's own `~/.rebase/telemetry.json`, and posts to production. On a
 * machine that has opted in, one `pnpm test` wrote five `cli.error` rows
 * recording a command nobody typed. The `CI` guard in `suppressionReason`
 * covers the build runners; it does not cover a laptop, which is where this
 * suite is run most.
 *
 * Set here rather than in each spawning test, because the next test to spawn
 * the binary should not have to know this. The four telemetry test files
 * `delete` this variable in their own `beforeEach` — they manage the whole
 * environment deliberately — so nothing here weakens what they assert.
 */
export const TEST_ENV = { REBASE_TELEMETRY_DISABLED: "1" };

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        env: TEST_ENV,
        include: ["src/**/*.test.ts"],
        // The DB-backed suite runs under vitest.integration.config.ts. It is
        // excluded here because those tests start real databases, and the CPU
        // they take made unrelated fast tests time out on contention alone.
        exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
        testTimeout: 15_000
    }
});
