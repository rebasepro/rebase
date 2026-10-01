import { defineConfig } from "vitest/config";

import { TEST_ENV, workspaceSourceAliases } from "./vitest.config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        // See vitest.config.ts. This suite is the one with the most to lose:
        // it scaffolds and runs real projects, so without this every e2e run
        // wrote `cli.init` rows — with real, freshly minted project ids — into
        // the production telemetry table.
        env: TEST_ENV,
        include: ["test/e2e/**/*.test.ts"],
        testTimeout: 240_000, // Scaffolding, dependency installation, and db migrations can take time
        // Each e2e file boots its own Postgres container and scaffolds/installs a
        // project. Running the files in parallel races N containers plus N pnpm
        // installs for the same resources, which flakes on constrained runners.
        // Serialize the files so one container is live at a time.
        fileParallelism: false
    },
    // See vitest.config.ts. What this reaches is only what the suite imports
    // itself; the CLI it drives is `bin/rebase.js`, which runs `dist` — and the
    // scaffolds it installs consume every package as built output. Build first.
    resolve: { alias: workspaceSourceAliases() }
});
