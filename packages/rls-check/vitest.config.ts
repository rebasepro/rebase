import { defineConfig } from "vitest/config";

/**
 * Unit tests only: every check is a pure function of a snapshot, so the whole
 * catalog is testable without a database. The Docker-backed introspection suite
 * lives under `test/e2e` with its own config, and must not be picked up here —
 * `pnpm test` has to stay runnable with nothing installed but node_modules.
 */
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        exclude: ["**/node_modules/**", "dist/**", "test/e2e/**"],
        environment: "node"
    }
});
