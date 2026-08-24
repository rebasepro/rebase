import path from "path";

import { defineConfig } from "vite";

/**
 * The second build of this package: `@rebasepro/server/functions`.
 *
 * It is a separate config rather than a second entry in `vite.config.ts`
 * because of one line in that file — the output banner:
 *
 *     import { createRequire as __createRequire } from "module";
 *     import process from "process";
 *     const require = __createRequire(import.meta.url);
 *
 * The main bundle needs it: it inlines CommonJS dependencies that call
 * `require()` at runtime. Every chunk that config emits carries it, and a chunk
 * carrying it imports `node:module` and `node:process` before it does anything
 * else — so an entry point built by that config can never load on a runtime
 * without Node built-ins, no matter how clean its own source is. Adding a
 * second entry there would have produced a file that looks portable, passes a
 * source-level review, and fails on the first import.
 *
 * So: no banner, and nothing inlined that could need one. The only external is
 * `hono`, which the consuming project already installs and which resolves on
 * every runtime this entry point targets.
 *
 * `tooling/scripts/assert-portable-entry.mjs` checks the emitted file rather than
 * trusting this config, because the failure mode being guarded against is
 * exactly a build setting that quietly stops being true.
 */
const EXTERNAL = ["hono"];

const isExternal = (id: string) =>
    EXTERNAL.some(ext => id === ext || id.startsWith(ext + "/"));

export default defineConfig(() => ({
    esbuild: {
        logOverride: { "this-is-undefined-in-esm": "silent" }
    },
    build: {
        // The main build runs first and empties `dist`. This one adds to it.
        emptyOutDir: false,
        lib: {
            entry: {
                // Key becomes the emitted path, so this lands at
                // `dist/functions/index.js` — the path `exports["./functions"]`
                // names, and the same shape `tsc --emitDeclarationOnly` uses
                // for the matching `.d.ts`.
                "functions/index": path.resolve(__dirname, "src/functions/index.ts")
            },
            formats: ["es"],
            fileName: (_format, entryName) => `${entryName}.js`
        },
        target: "ESNEXT",
        minify: false,
        sourcemap: true,
        rollupOptions: {
            external: isExternal,
            output: {
                // Explicitly no banner. See the comment above; this is the
                // single most important line in the file.
                banner: ""
            }
        }
    },
    resolve: {
        // Deliberately NOT `defaultServerConditions`. This entry point resolves
        // the same way on a worker as it does on Node, and asking for the
        // "node" condition here would let a dependency hand back its Node
        // implementation — silently reintroducing exactly what this build
        // exists to keep out.
        conditions: ["import", "module", "default"],
        alias: {
            "@rebasepro/common": path.resolve(__dirname, "../common/src"),
            "@rebasepro/types": path.resolve(__dirname, "../types/src")
        }
    },
    plugins: []
}));
