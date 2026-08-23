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
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
    "@google-cloud/storage",
    "dotenv",
    "pg",
    "chokidar",
    "fsevents",
    "ws",
    "ts-morph",
    "sharp",
    "nodemailer",
    "google-auth-library"
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
            // ESM only: the output banner injects `import`/`import.meta.url`,
            // which a UMD build cannot parse as CommonJS.
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
                warn(warning);
            },
            output: {
                /**
                 * Prepended verbatim to EVERY chunk, which is the whole
                 * difficulty: a banner is opaque text, so rollup's renamer
                 * cannot see the bindings it introduces and can never
                 * deconflict against them.
                 *
                 * It used to bind `process` directly — `import process from
                 * "process"`. zod exports a function called `process`, and the
                 * day a graph change put zod in a chunk with this banner the
                 * output was `SyntaxError: Identifier 'process' has already
                 * been declared`: a package that builds, passes every
                 * structural gate, and throws the moment anything imports it.
                 * Which chunk zod lands in is not something anyone controls,
                 * so this was luck rather than design.
                 *
                 * Now nothing named `process` is declared. Node already
                 * provides the global in ESM; the assignment is a belt for a
                 * host that somehow does not, and `??=` means it never
                 * overwrites a real one. `__rebaseRequire` is namespaced for
                 * the same reason — `require` is a plausible name for bundled
                 * CJS to declare.
                 */
                banner:
                    'import { createRequire as __rebaseCreateRequire } from "module";' +
                    ' import __rebaseProcess from "process";' +
                    ' globalThis.process ??= __rebaseProcess;' +
                    ' const require = __rebaseCreateRequire(import.meta.url);',
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
            "@rebasepro/common": path.resolve(__dirname, "../common/src"),
            "@rebasepro/types": path.resolve(__dirname, "../types/src")
        }
    },
    // No plugins: this package has no JSX. The React plugin was here from when
    // the type surface still had .tsx files in it.
    plugins: []
}));
