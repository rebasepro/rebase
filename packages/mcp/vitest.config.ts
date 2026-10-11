import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * `@rebasepro/client` → its `src/index.ts`, on an exact match only.
 *
 * Without it vitest resolved the client through its `exports`, which point at
 * `dist`: a change to `packages/client` plus a test here checked the last
 * build, and in a fresh worktree there is no build to check. `pnpm
 * check:test-resolution` holds every package's test runners to this.
 */
export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^@rebasepro\/client$/,
                replacement: fileURLToPath(new URL("../client/src/index.ts", import.meta.url))
            }
        ]
    }
});
