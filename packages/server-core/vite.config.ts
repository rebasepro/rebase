// @ts-ignore
import path from "path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react"

const ReactCompilerConfig = {
    target: "18"
};

/**
 * Only externalize dependencies that the consumer app installs directly.
 * Everything else gets inlined so linked consumers work without installing them.
 * The createRequire banner in output config provides require() for inlined CJS deps.
 */
const CONSUMER_EXTERNALS = [
    "hono",
    "drizzle-orm",
    "@hono/node-server",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
    "dotenv",
    "pg",
    "chokidar",
    "fsevents",
    "ws",
    "ts-morph",
    "sharp",
];
const isExternal = (id: string) => {
    if (id.startsWith(".") || path.isAbsolute(id)) return false;
    // Inline all @rebasepro/* packages

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
            fileName: (format) => `index.${format}.js`
        },
        target: "ESNEXT",
        minify: false,
        sourcemap: true,
        rollupOptions: {
            external: isExternal,
            output: [
                {
                    format: "es",
                    entryFileNames: "index.es.js",
                    banner: 'import { createRequire as __createRequire } from "module"; import process from "process"; const require = __createRequire(import.meta.url);',
                    sourcemap: true,
                    globals: {
                        "json-logic-js": "jsonLogic",
                        "fast-equals": "fastEquals",
                        "lodash/cloneDeep.js": "cloneDeep"
                    }
                },
                {
                    format: "umd",
                    entryFileNames: "index.umd.js",
                    name: "Rebase Backend",
                    sourcemap: true,
                    globals: {
                        "json-logic-js": "jsonLogic",
                        "fast-equals": "fastEquals",
                        "lodash/cloneDeep.js": "cloneDeep"
                    }
                }
            ]
        }
    },
    resolve: {
        alias: {
            "@rebasepro/common": path.resolve(__dirname, "../common/src"),
            "@rebasepro/types": path.resolve(__dirname, "../types/src")
        }
    },
    plugins: [
        react({
            babel: {
                plugins: [
                    ["babel-plugin-react-compiler", ReactCompilerConfig]
                ]
            }
        })
    ]
}));
