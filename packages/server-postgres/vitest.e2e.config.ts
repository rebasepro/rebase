import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const pkgSource = (name: string) => fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url));

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["test/e2e/**/*.test.ts"],
        testTimeout: 180_000, // 3 min — container startup + migrations
        // Each e2e file boots and tears down its own Postgres container. Running
        // the files in parallel means N containers racing for the Docker daemon
        // and host resources at once, which flakes on constrained runners (a
        // container fails to become ready, or the daemon drops a connection).
        // Serialize the files so exactly one container is live at a time.
        fileParallelism: false
    },
    resolve: {
        // Resolve workspace packages to their SOURCE, not their built dist.
        // Without this, an e2e that drives the real SDK against this server
        // exercises whatever was last built — which inside a git worktree is
        // the primary checkout's build, not the code under test. The test would
        // pass while proving nothing about the change.
        alias: {
            "@rebasepro/client": pkgSource("client"),
            "@rebasepro/types": pkgSource("types"),
            "@rebasepro/common": pkgSource("common"),
            "@rebasepro/utils": pkgSource("utils")
        }
    }
});
