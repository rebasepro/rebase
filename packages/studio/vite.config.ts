import path from "path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react"

const ReactCompilerConfig = {
    target: "18"
};
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
            name: "Rebase collection editor",
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
        alias: {
            "@rebasepro/client": path.resolve(__dirname, "../client/src"),
            "@rebasepro/cms": path.resolve(__dirname, "../cms/src"),
            "@rebasepro/common": path.resolve(__dirname, "../common/src"),
            "@rebasepro/app": path.resolve(__dirname, "../app/src"),
            "@rebasepro/forms": path.resolve(__dirname, "../forms/src"),
            "@rebasepro/inference": path.resolve(__dirname, "../inference/src"),
            "@rebasepro/types": path.resolve(__dirname, "../types/src"),
            "@rebasepro/ui": path.resolve(__dirname, "../ui/src")
        }
    },
    // The schema visualizer's layout worker (`dagre-layout.worker.ts`) is
    // inlined into this library as a module worker. Not the `iife` default:
    // dagre's CommonJS files pick lodash and graphlib behind a
    // `typeof require === "function"` test, which an ES bundle answers with
    // its own `require` and an `iife` one leaves to the worker's scope —
    // where it is undefined, and the fallback reads `window`, which a worker
    // does not have.
    worker: {
        format: "es"
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
