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
                if (warning.code === "INEFFECTIVE_DYNAMIC_IMPORT") return;
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
