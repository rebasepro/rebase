import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import tailwindcss from "@tailwindcss/vite";
import { rebaseCollectionsPlugin, rebaseManualChunks } from "@rebasepro/app/vitePlugin";

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
                // How the admin's dependencies are split into cached chunks.
                // Sixty-five lines of rules used to be copied in here, which
                // froze them: when we found that one of them was welding 822 kB
                // of icons into the preload set, the fix reached the template
                // and nothing already generated. Edit it if you have a reason —
                // it is an ordinary function — but taking it from the package
                // means an upgrade can improve it.
                manualChunks: rebaseManualChunks
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
