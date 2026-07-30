import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import tailwindcss from "@tailwindcss/vite";
import { rebaseCollectionsPlugin } from "@rebasepro/app/vitePlugin";

export default defineConfig({
    envDir: path.resolve(__dirname, ".."),
    // The public path this app is served under, from its `path` in rebase.json.
    // `rebase build` sets REBASE_APP_BASE; without this line an app declared at
    // "/admin" would emit assets rooted at "/" and render a blank page. The
    // build refuses to ship that — see docs/apps-and-runtimes.md §4.2.
    base: process.env.REBASE_APP_BASE ?? "/",
    // Force a single copy of React and React Router across the app and all
    // @rebasepro/* packages. Without this, a locally `link:`ed Rebase checkout
    // resolves its own copies of react-router, producing "multiple copies of
    // React" and "useBlocker must be used within a data router" errors in the
    // admin. Safe to keep for npm-installed setups too.
    resolve: {
        dedupe: [
            "react",
            "react-dom",
            "react-router",
            "@remix-run/router"
        ]
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

                    return undefined;
                }
            }
        }
    },
    optimizeDeps: { include: ["react/jsx-runtime"] },
    plugins: [
        svgr(),
        react({}),
        tailwindcss(),
        rebaseCollectionsPlugin({ collectionsDir: "../config/collections" })
    ]
});
