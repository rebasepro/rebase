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
        target: "ESNEXT",
        modulePreload: false,
        cssCodeSplit: false,
        sourcemap: true,
        minify: false,
        lib: {
            // ESM only — this is an ESM-first framework; no UMD/CJS output.
            formats: ["es"],
            entry: path.resolve(__dirname, "src/index.ts"),
            name: "Formex",
            fileName: (format) => `index.${format}.js`
        },
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
    plugins: [react({
            babel: {
                plugins: [
                    ["babel-plugin-react-compiler", ReactCompilerConfig]
                ]
            }
        })]
}));
