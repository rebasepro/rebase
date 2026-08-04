import fs from "fs";
import path from "path";
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import svgr from "vite-plugin-svgr";
import tailwindcss from "@tailwindcss/vite";
import { rebaseCollectionsPlugin } from "@rebasepro/app/vitePlugin";
import { visualizer } from "rollup-plugin-visualizer";

const PACKAGES_DIR = path.resolve(__dirname, "../../packages");

/**
 * Point every workspace package at its source, derived rather than listed.
 *
 * This was a hand-written list of fourteen, and it carried a comment about the
 * one it had already been caught missing: "without this one `utils` alone came
 * from its built `dist`, so edits to it did nothing in dev until the package
 * was rebuilt." It was still missing `@rebasepro/admin-types`, with exactly
 * that consequence — an edit there does nothing, and what runs is whatever
 * `dist` was last built, which is worse than nothing happening because it looks
 * like the edit was wrong.
 *
 * A list of packages that must contain every package is a list that should not
 * be written by hand, so this reads the directory.
 */
function workspaceSourceAliases(): Record<string, string> {
    const aliases: Record<string, string> = {};
    for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const manifest = path.join(PACKAGES_DIR, entry.name, "package.json");
        const src = path.join(PACKAGES_DIR, entry.name, "src");
        if (!fs.existsSync(manifest) || !fs.existsSync(src)) continue;
        const { name } = JSON.parse(fs.readFileSync(manifest, "utf-8")) as { name?: string };
        if (name) aliases[name] = src;
    }
    return aliases;
}

export default defineConfig({
    envDir: path.resolve(__dirname, ".."),
    // The public path this app is served under, from its `path` in rebase.json.
    // See docs/apps-and-runtimes.md §4.2.
    base: process.env.REBASE_APP_BASE ?? "/",
    server: {
        port: 5173,
        strictPort: false,
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
        target: "es2022",
        sourcemap: true,
        chunkSizeWarningLimit: Infinity,
        rollupOptions: {
            onwarn(warning, warn) {
                if (warning.code === "MISSING_GLOBAL_NAME") return;
                if (warning.code === "INEFFECTIVE_DYNAMIC_IMPORT") return;
                warn(warning);
            },
            output: {
                manualChunks(id) {
                    // Heavy vendor libraries — split into individually cached chunks
                    if (id.includes("exceljs")) return "vendor-exceljs";
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
                    if (id.includes("packages/app/")) return "rebase-core";

                    // Split admin into sub-chunks to stay under size limits
                    if (id.includes("packages/admin/src/editor/")) return "rebase-admin-editor";
                    if (id.includes("packages/admin/src/collection_editor/")) return "rebase-admin-collection-editor";
                    if (id.includes("packages/admin/src/data_import/")) return "rebase-admin-data-import";
                    if (id.includes("packages/admin/src/data_export/")) return "rebase-admin-data-export";
                    if (id.includes("packages/admin/src/form/")) return "rebase-admin-form";
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
        visualizer({ filename: "stats.json",
template: "raw-data" })
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
            "react": path.resolve(__dirname, "./node_modules/react"),
            "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
            ...workspaceSourceAliases(),
            // Subpath exports are not covered by the package-name aliases above.
            "@rebasepro/ui/index.css": path.resolve(__dirname, "../../packages/ui/index.css"),
            "config": path.resolve(__dirname, "../config")
        }
    }
})
