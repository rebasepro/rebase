import path from "path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// From source: the plugin module is built after this package in a fresh checkout.
import { mcpViewInlineIntoHtml, mcpViewWithoutLazyExtras } from "../app/src/mcp_view_build";

/**
 * Stage one: the generic view as ONE self-contained HTML document — the view
 * a server serves when its project built none of its own. A host renders it
 * in a sandboxed iframe whose CSP allows no network, so every chunk is
 * inlined (and what the admin loads lazily but a view does without is left
 * out), with the same helpers a project's own view is built with
 * (`rebaseMcpViewPlugin` in `@rebasepro/app/vitePlugin`). The second stage
 * (`vite.config.ts`) inlines the page into `dist/index.js`.
 */
const PACKAGES = path.resolve(import.meta.dirname, "..");

export default defineConfig({
    root: path.resolve(import.meta.dirname, "views"),
    base: "./",
    plugins: [mcpViewWithoutLazyExtras(), react(), tailwindcss(), mcpViewInlineIntoHtml()],
    resolve: {
        alias: [
            // Every workspace package from its source, so the build needs no
            // other package built first and the module graph holds one copy
            // of each — the admin panel's contexts are matched by identity.
            // The admin's MCP view runtime whole, from source: the published
            // `@rebasepro/cms/mcp-view` subpath exports only its entry points.
            { find: /^@rebasepro\/cms\/mcp-view$/, replacement: `${PACKAGES}/cms/src/mcp_view/index.tsx` },
            { find: /^@rebasepro\/([a-z-]+)$/, replacement: `${PACKAGES}/$1/src/index.ts` },
            // The admin panel's router, as `@rebasepro/cms` resolves it.
            { find: /^react-router$/, replacement: path.resolve(PACKAGES, "cms/node_modules/react-router") }
        ],
        dedupe: ["react", "react-dom", "react-router"]
    },
    build: {
        outDir: path.resolve(import.meta.dirname, "dist/views"),
        emptyOutDir: true,
        target: "es2022",
        modulePreload: false,
        cssCodeSplit: false,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        rollupOptions: {
            input: { app: path.resolve(import.meta.dirname, "views/app.html") },
            output: { codeSplitting: false }
        }
    }
});
