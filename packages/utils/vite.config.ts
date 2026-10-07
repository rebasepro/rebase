import path from "path";

import { defineConfig } from "vite";

const isExternal = (id: string) => {
    if (id.startsWith(".") || path.isAbsolute(id)) return false;

    return true;
};

export default defineConfig(() => ({
    esbuild: {
        logOverride: { "this-is-undefined-in-esm": "silent" }
    },
    build: {
        lib: {
            // ESM only — this is an ESM-first framework; no UMD/CJS output.
            formats: ["es"],
            entry: path.resolve(__dirname, "src/index.ts"),
            name: "Rebase Util",
            // One file per source module (`preserveModules` below), so the
            // entry is `index.es.js` — the path package.json's `exports` names
            // — and `src/objects.ts` becomes `objects.es.js`.
            fileName: (format, entryName) => `${entryName}.${format}.js`
        },
        target: "ESNEXT",
        minify: false,
        sourcemap: true,
        rollupOptions: {
            external: isExternal,
            // Inlining a constant from another file would leave the importer
            // with a bare `import "./common.es.js"` (kept for evaluation
            // order), which esbuild-based consumer builds then warn about
            // under `"sideEffects": false`. A consumer's bundler inlines it.
            optimization: { inlineConst: false },
            onwarn(warning, warn) {
                if (warning.code === "MISSING_GLOBAL_NAME") return;
                warn(warning);
            },
            output: {
                // A consumer's bundler drops a whole MODULE nobody imports from
                // (package.json says `"sideEffects": false`), but inside one
                // module it keeps every import that module makes. Shipped as a
                // single file, an app that only ever calls the client's `find()`
                // still bundled `object-hash` and `json-logic-js` (40 kB). One
                // file per module lets the bundler leave out the modules that
                // import them. Guarded by the `sdk-minimal` target of
                // tooling/scripts/check-bundle-budget.mjs.
                preserveModules: true,
                preserveModulesRoot: path.resolve(__dirname, "src"),
                globals: {
                    "json-logic-js": "jsonLogic",
                    "fast-equals": "fastEquals",
                    "lodash/cloneDeep.js": "cloneDeep"
                }
            }
        }
    },
    resolve: {
        alias: {
            "@rebasepro/types": path.resolve(__dirname, "../types/src")
        }
    },
    // No plugins: this package has no JSX. The React plugin was here from when
    // the type surface still had .tsx files in it.
    plugins: []
}));
