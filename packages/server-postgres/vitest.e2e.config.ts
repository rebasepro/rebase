import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgSource = (name: string) => fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url));

/**
 * `@rebasepro/<name>` → its `src/index.ts`, on an exact match only.
 *
 * A string key matches subpaths too, and would rewrite
 * `@rebasepro/server/functions` into `…/server/src/index.ts/functions`. A
 * subpath entry point is left to normal resolution (its `dist`).
 */
const toSource = (name: string) => ({
    find: new RegExp(`^@rebasepro/${name}$`),
    replacement: pkgSource(name)
});

/**
 * Every workspace package this one depends on — read from `package.json`, not
 * listed here.
 *
 * The list used to be written out, and it drifted twice. It named `client`,
 * `types`, `common` and `utils`, and not `server`, which this package's source
 * imports on nearly every path, nor `codegen`, which `schema/doctor.ts` and an
 * e2e import. Both resolved through `dist`: in a fresh worktree the import
 * failed for want of one, and with the primary checkout's `dist` linked in, the
 * suite passed against that build while a mutation in the package's source
 * survived. The dependency list is the one that already has to be right.
 */
function workspaceDependencies(): string[] {
    const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };
    return [manifest.dependencies, manifest.devDependencies]
        .flatMap((declared) => Object.entries(declared ?? {}))
        .filter(([name, range]) => name.startsWith("@rebasepro/") && range.startsWith("workspace:"))
        .map(([name]) => name.slice("@rebasepro/".length));
}

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
        //
        // This reaches only what vitest loads. A file that spawns a process —
        // `db-e2e` and `db-push-safety` run the CLI under tsx, `split-roles`
        // starts `rebase-server` — gets Node's own resolution in that process,
        // which is `dist`. Those files still need the packages built.
        alias: workspaceDependencies().map(toSource)
    }
});
