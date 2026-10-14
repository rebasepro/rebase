import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import tailwindcss from "@tailwindcss/vite";
import { rebaseCollectionsPlugin, rebaseManualChunks } from "@rebasepro/app/vitePlugin";

export default defineConfig({
    // `import.meta.dirname`, not `__dirname`: vite 8 warns that the latter is
    // unsupported by `configLoader: "native"`, which becomes the default in a
    // future major — so every new project printed a warning telling its author
    // to fix a file they had not written yet. Available since Node 20.11, and
    // this scaffold requires 22.22.
    envDir: path.resolve(import.meta.dirname, ".."),
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
    // No `esbuild` block: Vite 8 transforms with oxc and ignores it, and
    // having one made every `rebase dev` and build print "Both esbuild and oxc
    // options were set".
    build: {
        minify: true,
        outDir: "./dist",
        // `es2022`, matching the reference app. Vite 8 minifies CSS with
        // lightningcss, whose target conversion refuses `"ESNEXT"` outright —
        // `[lightningcss minify] Unsupported target "ESNEXT"`, after a
        // successful JS transform, so the build fails at the very end.
        target: "es2022",
        sourcemap: true,
        // The admin's own chunks are already code-split and the warning names only them, never this project's code.
        chunkSizeWarningLimit: Infinity,
        rollupOptions: {
            output: {
                // How the admin's dependencies are split into cached chunks,
                // from the package rather than copied in, so an upgrade of
                // `@rebasepro/app` brings its improvements with it. Write your
                // own function here if you need to split this app's code too,
                // and return `rebaseManualChunks(id)` for the rest.
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
