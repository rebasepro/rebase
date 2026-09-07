import path from "path";

import { defaultServerConditions, defineConfig } from "vite";

/**
 * Only externalize dependencies that the consumer app installs directly.
 * Everything else gets inlined so linked consumers work without installing them.
 * The createRequire banner in output config provides require() for inlined CJS deps.
 */
const CONSUMER_EXTERNALS = [
    "hono",
    "drizzle-orm",
    "@hono/node-server",
    "dotenv",
    "pg",
    "chokidar",
    "fsevents",
    "ws",
    "ts-morph"
];
/**
 * `@rebasepro/*` packages the runtime image supplies. Kept in step with
 * `RUNTIME_PROVIDED` in packages/cli/src/bundle.ts and docker/entrypoint.mjs by
 * `scripts/test/runtime-provided.test.mjs`.
 */
const RUNTIME_PROVIDED_SCOPED = [
    "@rebasepro/types",
    "@rebasepro/common",
    "@rebasepro/utils"
];
const isExternal = (id: string) => {
    if (id.startsWith(".") || path.isAbsolute(id)) return false;
    // Externalize server to prevent singleton duplication (e.g. JWT config, etc)
    if (id === "@rebasepro/server" || id.startsWith("@rebasepro/server/")) return true;
    // …and the rest of what the runtime image provides, for the same reason.
    //
    // Inlining `@rebasepro/types` put a whole second copy of the resource-kind
    // registry inside this driver's dist. A tenant's pod then held two: the
    // image's, and the one frozen into whatever driver the bundle was built
    // with. They register into shared process state, so the older copy — always
    // the second to load, because a driver is imported after the runtime — ran
    // ITS release's comparison rule against the current definition. Kinds now
    // live under a versioned symbol so that cannot throw (see
    // `KINDS_KEY` in @rebasepro/types), but the duplication is the disease and
    // that is the antidote: one copy per process, so there is nothing to
    // reconcile.
    //
    // Safe to externalize precisely because each is declared in this package's
    // `dependencies` AND is in the CLI's RUNTIME_PROVIDED set: an npm consumer
    // installs them, a linked consumer resolves them through the workspace, and
    // a managed bundle gets the image's. `@rebasepro/codegen` is in neither
    // list, so it stays inlined.
    if (RUNTIME_PROVIDED_SCOPED.some(pkg => id === pkg || id.startsWith(pkg + "/"))) return true;

    // Externalize only deps the consumer app explicitly installs
    if (CONSUMER_EXTERNALS.some(ext => id === ext || id.startsWith(ext + "/"))) return true;
    // Externalize Node built-ins
    if (["fs", "path", "url", "util", "crypto", "http", "https", "net", "tls", "stream", "events", "os", "child_process", "buffer", "assert", "dns", "zlib", "querystring", "process", "module", "worker_threads", "v8", "vm", "string_decoder", "node:"].some(b => id === b || id.startsWith("node:") || id.startsWith(b + "/"))) return true;
    // Inline everything else — createRequire banner handles require() for CJS deps
    return false;
};

export default defineConfig(() => ({
    esbuild: {
        logOverride: { "this-is-undefined-in-esm": "silent" }
    },
    build: {
        lib: {
            /**
             * Two entries, and `cli` is not optional.
             *
             * `rebase schema generate`, every `rebase db …` and `rebase
             * introspect` shell into the driver's own CLI, which the parent CLI
             * locates as `<pkg>/dist/cli.js` or `<pkg>/src/cli.ts`. Only the
             * second ever existed, and it worked solely because `files` shipped
             * `src` — so removing `src` from the tarball to halve its size
             * (dff34e8688) deleted the driver's entire command surface from
             * every published copy, in silence. 0.18.0 shipped that way: a
             * scaffolded project's first `rebase dev` could not regenerate its
             * schema, reported "Dependencies are not installed" at a project
             * that had just installed cleanly, and answered every
             * `GET /api/data/*` with `Table not found for collection 'posts'`.
             *
             * Building it means the tarball carries the command surface as an
             * artifact rather than as source the consumer happens to be able to
             * compile. `check:package-contents` fails without it.
             */
            entry: {
                index: path.resolve(__dirname, "src/index.ts"),
                cli: path.resolve(__dirname, "src/cli.ts"),
                // The four scripts `cli.ts` spawns as child processes, by path.
                // They are separate processes on purpose (the generators are
                // long-running and the watch mode restarts them), so they have
                // to exist as files — which is the second half of why `src` was
                // being shipped. They still run under tsx: they load the
                // project's own TypeScript collections, which import each other
                // as `./authors.js`, and only tsx maps that back to `.ts`.
                // These two go through `schema/bin/*`, which calls their exported
                // `main`. Their own `import.meta.url` guard cannot fire once the
                // module is a shared chunk rather than the process entry.
                "schema/generate-drizzle-schema": path.resolve(__dirname, "src/schema/bin/generate-drizzle-schema.ts"),
                "schema/generate-postgres-ddl": path.resolve(__dirname, "src/schema/bin/generate-postgres-ddl.ts"),
                "schema/introspect-db": path.resolve(__dirname, "src/schema/introspect-db.ts"),
                "schema/doctor-cli": path.resolve(__dirname, "src/schema/doctor-cli.ts")
            },
            name: "Rebase Backend",
            formats: ["es"],
            // `index.es.js` is named in `exports`, `main` and the runtime image's
            // stitching; `cli.js` is what resolvePluginCliScript looks for.
            fileName: (format, entryName) => (entryName === "index" ? `index.${format}.js` : `${entryName}.js`)
        },
        target: "ESNEXT",
        minify: false,
        sourcemap: true,
        rollupOptions: {
            external: isExternal,
            onwarn(warning, warn) {
                if (warning.code === "MISSING_GLOBAL_NAME") return;
                if (warning.code === "INEFFECTIVE_DYNAMIC_IMPORT") return;
                if (warning.code === "EMPTY_IMPORT_META") return;
                warn(warning);
            },
            output: {
                /**
                 * `require` for the CJS dependencies rolled into this bundle.
                 *
                 * It does NOT import `process`. It used to, and that was a
                 * latent syntax error waiting for the chunk layout to move:
                 * the banner is prepended to EVERY chunk, so any chunk that
                 * also contained a module importing `node:process` — chalk's
                 * supports-color does — ended up declaring the identifier
                 * twice and failed to parse. Splitting the CLI into its own
                 * entries reshuffled the chunks and produced exactly that, and
                 * only inside the image, where the grouping differed from the
                 * local build. `process` is a Node global; the import bought
                 * nothing and cost a driver that would not load.
                 */
                banner: 'import { createRequire as __createRequire } from "module"; const require = __createRequire(import.meta.url);'
            }
        }
    },
    resolve: {
        // This is a Node-only library: resolve package exports with the "node"
        // condition (not "browser"), e.g. unicorn-magic via execa/npm-run-path.
        conditions: [...defaultServerConditions],
        alias: {
            "@rebasepro/common": path.resolve(__dirname, "../common/src"),
            "@rebasepro/server": path.resolve(__dirname, "../server/src"),
            "@rebasepro/types": path.resolve(__dirname, "../types/src"),
            "@rebasepro/utils": path.resolve(__dirname, "../utils/src")
        }
    },
    // No plugins: this package has no JSX. The React plugin was here from when
    // the type surface still had .tsx files in it.
    plugins: []
}));
