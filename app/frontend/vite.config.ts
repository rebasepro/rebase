// @ts-ignore
import path from "path";
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import svgr from "vite-plugin-svgr";
import tailwindcss from "@tailwindcss/vite";
import { rebaseCollectionsPlugin } from "@rebasepro/core/vitePlugin";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
    envDir: path.resolve(__dirname, ".."),
    server: {
        port: 5173,
        strictPort: true,
        fs: {
            allow: ["../../.."]
        }
    },
    esbuild: {
        logOverride: { "this-is-undefined-in-esm": "silent" }
    },
    build: {
        minify: true,
        outDir: "./dist",
        target: "ESNEXT",
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    // Heavy vendor libraries — split into individually cached chunks
                    if (id.includes("xlsx")) return "vendor-xlsx";
                    if (id.includes("prosemirror")) return "vendor-prosemirror";
                    if (id.includes("monaco-editor") || id.includes("@monaco-editor")) return "vendor-monaco";
                    if (id.includes("@xyflow") || id.includes("dagre")) return "vendor-xyflow";
                    if (id.includes("@dnd-kit")) return "vendor-dnd";
                    if (id.includes("prism-react-renderer")) return "vendor-prism";
                    if (id.includes("markdown-it")) return "vendor-markdown";
                    if (id.includes("react-dropzone")) return "vendor-dropzone";
                    if (id.includes("date-fns")) return "vendor-datefns";
                    if (id.includes("fuse.js")) return "vendor-fuse";
                    if (id.includes("node_modules/react-dom/")) return "vendor-react-dom";
                    if (id.includes("node_modules/react-router") || id.includes("node_modules/@remix-run")) return "vendor-react-router";
                    if (id.includes("node_modules/@radix-ui/")) return "vendor-radix";
                    if (id.includes("node_modules/framer-motion/")) return "vendor-framer-motion";
                    if (id.includes("node_modules/zod/")) return "vendor-zod";
                    if (id.includes("node_modules/i18next") || id.includes("node_modules/react-i18next")) return "vendor-i18next";
                    if (id.includes("node_modules/@floating-ui/")) return "vendor-floating-ui";
                    if (id.includes("node_modules/tailwind-merge/")) return "vendor-tailwind-merge";
                    if (id.includes("node_modules/notistack/")) return "vendor-notistack";
                    if (id.includes("node_modules/lucide-react/")) return "vendor-lucide-react";
                    
                    if (id.includes("packages/ui/")) return "rebase-ui";
                    if (id.includes("packages/core/")) return "rebase-core";
                    if (id.includes("packages/admin/")) return "rebase-admin";

                    return undefined;
                }
            }
        }
    },
    optimizeDeps: { include: ["react/jsx-runtime", "pgsql-ast-parser"] },
    plugins: [
        svgr(),
        react({}),
        tailwindcss(),
        rebaseCollectionsPlugin({ collectionsDir: "../config/collections" }),
        visualizer({ filename: "stats.json", template: "raw-data" })
    ],
    css: {
        preprocessorOptions: {
            scss: {
                includePaths: [path.resolve(__dirname, "../../packages")],
                api: "modern-compiler",
                silenceDeprecations: ["mixed-decls", "color-functions", "global-builtin", "import", "legacy-js-api", "slash-div"]
            }
        }
    },
    resolve: {
        alias: {
            "@rebasepro/core": path.resolve(__dirname, "../../packages/core/src"),
            "@rebasepro/types": path.resolve(__dirname, "../../packages/types/src"),
            "@rebasepro/common": path.resolve(__dirname, "../../packages/common/src"),
            "@rebasepro/client": path.resolve(__dirname, "../../packages/client/src"),
            "@rebasepro/ui": path.resolve(__dirname, "../../packages/ui/src"),
            "@rebasepro/ui/index.css": path.resolve(__dirname, "../../packages/ui/index.css"),
            "@rebasepro/formex": path.resolve(__dirname, "../../packages/formex/src"),
            "@rebasepro/client-postgresql": path.resolve(__dirname, "../../packages/client-postgresql/src"),
            "@rebasepro/client-firebase": path.resolve(__dirname, "../../packages/client-firebase/src"),
            "@rebasepro/plugin-data-enhancement": path.resolve(__dirname, "../../packages/plugin-data-enhancement/src"),
            "@rebasepro/plugin-insights": path.resolve(__dirname, "../../packages/plugin-insights/src"),
            "@rebasepro/schema-inference": path.resolve(__dirname, "../../packages/schema-inference/src"),
            "@rebasepro/auth": path.resolve(__dirname, "../../packages/auth/src"),
            "@rebasepro/admin": path.resolve(__dirname, "../../packages/admin/src"),
            "@rebasepro/studio": path.resolve(__dirname, "../../packages/studio/src"),
            "config": path.resolve(__dirname, "../config")
        }
    }
})
