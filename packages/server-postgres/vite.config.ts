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
const isExternal = (id: string) => {
    if (id.startsWith(".") || path.isAbsolute(id)) return false;
    // Externalize server to prevent singleton duplication (e.g. JWT config, etc)
    if (id === "@rebasepro/server" || id.startsWith("@rebasepro/server/")) return true;
    // Inline other @rebasepro/* packages (like common, types)

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
            entry: path.resolve(__dirname, "src/index.ts"),
            name: "Rebase Backend",
            formats: ["es"],
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
                if (warning.code === "EMPTY_IMPORT_META") return;
                warn(warning);
            },
            output: {
                banner: 'import { createRequire as __createRequire } from "module"; import process from "process"; const require = __createRequire(import.meta.url);'
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
