import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import tailwindcss from "@tailwindcss/vite";
import { rebaseBackendGuard, rebaseManualChunks } from "@rebasepro/app/vitePlugin";

// The scaffold's admin config (packages/cli/templates/template/frontend), less
// the project MCP view, which only a project with code of its own has.
// `rebaseBackendGuard()` stays although there is nothing in ../backend to leak:
// `rebase build` refuses a frontend without it, which is the right rule.
export default defineConfig({
    envDir: path.resolve(import.meta.dirname, ".."),
    base: process.env.REBASE_APP_BASE ?? "/",
    resolve: {
        dedupe: ["react", "react-dom", "react-router", "@remix-run/router"]
    },
    build: {
        minify: true,
        outDir: "./dist",
        target: "es2022",
        // No source maps: this build is served to every stock project, and a
        // map is several megabytes per chunk that nobody debugging a stock
        // project needs from the tenant.
        sourcemap: false,
        chunkSizeWarningLimit: Infinity,
        rollupOptions: {
            output: { manualChunks: rebaseManualChunks }
        }
    },
    optimizeDeps: { include: ["react/jsx-runtime"] },
    plugins: [svgr(), react({}), tailwindcss(), rebaseBackendGuard()]
});
