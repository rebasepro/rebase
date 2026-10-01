import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

/**
 * `@rebasepro/<name>` → `packages/<name>/src/index.ts`, for every workspace
 * package this one depends on that has one — read from `package.json`, not
 * listed here, which is how `server-postgres/vitest.e2e.config.ts` does it and
 * why its list stopped drifting.
 *
 * Without it every suite here imported `@rebasepro/types`, `/server`,
 * `/codegen` and `/server-postgres` through their `exports`, which point at
 * `dist`: a change to `packages/types` plus a CLI test checked the LAST BUILD.
 * In a fresh worktree the integration suite failed outright ("Failed to resolve
 * entry for package @rebasepro/types"), and with the primary checkout's `dist`
 * linked in it passed against that build — so a mutation in the source survived,
 * and the CLI e2e passed locally against a `dist` from before the commit it was
 * failing on in CI.
 *
 * Exact match only: a string key would also rewrite `@rebasepro/server/functions`
 * into `…/server/src/index.ts/functions`. A subpath entry point is left to normal
 * resolution (its `dist`). And this reaches only what vitest loads — a test that
 * spawns `bin/rebase.js` runs the built CLI, which is what the e2e is for.
 */
export function workspaceSourceAliases(): { find: RegExp; replacement: string }[] {
    const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };
    return [manifest.dependencies, manifest.devDependencies]
        .flatMap((declared) => Object.entries(declared ?? {}))
        .filter(([name, range]) => name.startsWith("@rebasepro/") && range.startsWith("workspace:"))
        .map(([name]) => ({
            name,
            source: fileURLToPath(new URL(`../${name.slice("@rebasepro/".length)}/src/index.ts`, import.meta.url))
        }))
        // `@rebasepro/agent-skills` lives under tooling/ and ships markdown, not a
        // TypeScript entry; it has no source to point at.
        .filter(({ source }) => existsSync(source))
        .map(({ name, source }) => ({ find: new RegExp(`^${name}$`), replacement: source }));
}

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
    },
    resolve: { alias: workspaceSourceAliases() }
});
