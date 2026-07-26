import { defineConfig } from "vitest/config";

/**
 * The Docker-backed suite. Separate from `vitest.config.ts` (the unit suite)
 * because it needs a real Postgres, a minute of startup, and must never be part
 * of a plain `pnpm test`.
 *
 *   pnpm --filter @rebasepro/rls-check exec vitest run --config vitest.e2e.config.ts
 *
 * It skips itself, rather than failing, when Docker is unavailable — a
 * contributor without Docker should still be able to run everything else.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["test/e2e/**/*.test.ts"],
        // Container pull + boot + fixture schema.
        testTimeout: 180_000,
        hookTimeout: 180_000,
        // One container at a time: parallel files race the Docker daemon and
        // flake on constrained runners.
        fileParallelism: false
    }
});
