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
    optimizeDeps: {
    },
    server: {
        fs: {
            allow: ["../.."]
        }
    },
    esbuild: {
        logOverride: { "this-is-undefined-in-esm": "silent" }
    },
    build: {
        lib: {
            entry: {
                index: path.resolve(__dirname, "src/index.ts"),
                editor: path.resolve(__dirname, "src/editor/index.ts"),
                collection_editor_ui: path.resolve(__dirname, "src/collection_editor_ui.ts")
            },
            name: "Rebase CMS",
            formats: ["es"]
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
                preserveModules: false
            }
        }
    },
    resolve: {
        alias: {
            "@rebasepro/client": path.resolve(__dirname, "../client/src"),
            "@rebasepro/common": path.resolve(__dirname, "../common/src"),
            "@rebasepro/app": path.resolve(__dirname, "../app/src"),
            "@rebasepro/forms": path.resolve(__dirname, "../forms/src"),
            "@rebasepro/inference": path.resolve(__dirname, "../inference/src"),
            "@rebasepro/types": path.resolve(__dirname, "../types/src"),
            "@rebasepro/ui": path.resolve(__dirname, "../ui/src")
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
    ],
    css: {
        preprocessorOptions: {
            scss: {
                api: "modern-compiler",
                silenceDeprecations: ["mixed-decls", "color-functions", "global-builtin", "import", "legacy-js-api", "slash-div"]
            }
        }
    }
}));
