import path from "path";

import { defaultServerConditions, defineConfig } from "vite";

/**
 * Only externalize true third-party deps that the consumer app would install.
 * Inline all @rebasepro/* sibling packages so that linked consumers
 * don't need to resolve them from the real path of the symlink.
 */
const isExternal = (id: string) => {
    if (id.startsWith(".") || path.isAbsolute(id)) return false;
    // Inline all @rebasepro/* packages into the bundle

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
            name: "Rebase MongoDB",
            fileName: (format) => `index.${format}.js`
        },
        target: "ESNEXT",
        minify: false,
        sourcemap: true,
        rollupOptions: {
            external: isExternal,
            onwarn(warning, warn) {
                if (warning.code === "MISSING_GLOBAL_NAME") return;
                // The one known ineffective dynamic import: factory.ts and
                // MongoDriver.ts import MongoHistoryService statically, so
                // MongoBootstrapper's `import()` of it cannot split it off. Any
                // other is a lazy import that is not lazy, so it is reported.
                if (warning.code === "INEFFECTIVE_DYNAMIC_IMPORT" && warning.message.includes("src/services/MongoHistoryService.ts")) return;
                warn(warning);
            },
            output: {
                globals: {
                    "json-logic-js": "jsonLogic",
                    "fast-equals": "fastEquals",
                    "lodash/cloneDeep.js": "cloneDeep"
                }
            }
        }
    },
    resolve: {
        // This is a Node-only library: resolve package exports with the "node"
        // condition (not "browser").
        conditions: [...defaultServerConditions],
        alias: {
            "@rebasepro/server": path.resolve(__dirname, "../server/src"),
            "@rebasepro/app": path.resolve(__dirname, "../app/src"),
            "@rebasepro/types": path.resolve(__dirname, "../types/src")
        }
    }
}));
