import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const source = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

/**
 * The packages the end-to-end suite boots, each resolved to its SOURCE, so the
 * suite runs this checkout's server and driver rather than whatever `dist`
 * was last built — the same rule `server-postgres`'s own e2e config follows.
 * The function's subpath entry is mapped too, or it would load the server's
 * `dist` beside the source and run two copies of it.
 */
const PACKAGES = ["types", "utils", "common", "client", "codegen", "server", "server-postgres"];

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["test/e2e/**/*.test.ts"],
        testTimeout: 180_000,
        fileParallelism: false
    },
    resolve: {
        alias: [
            { find: /^@rebasepro\/server\/functions$/, replacement: source("server/src/functions/index.ts") },
            ...PACKAGES.map(name => ({ find: new RegExp(`^@rebasepro/${name}$`), replacement: source(`${name}/src/index.ts`) }))
        ]
    }
});
