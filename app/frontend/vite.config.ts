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
 * was rebuilt." It was still missing `@rebasepro/cms-types`, with exactly
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
    // No `esbuild` block: Vite 8 transforms with oxc and ignores it, and
    // having one made every `rebase dev` and build print "Both esbuild and oxc
    // options were set".
    build: {
        minify: true,
        outDir: "./dist",
        target: "es2022",
        sourcemap: true,
        chunkSizeWarningLimit: Infinity,
        rollupOptions: {
            onwarn(warning, warn) {
                if (warning.code === "MISSING_GLOBAL_NAME") return;
                warn(warning);
            },
            output: {
                // `codeSplitting.groups`, not `manualChunks`: rolldown turns a
                // `manualChunks` function into exactly the second group below,
                // and the first group cannot be said with `manualChunks` at all.
                codeSplitting: {
                    groups: [
                        // The lucide icons the entry reaches through static
                        // imports, in one eager chunk of their own. `$initial`
                        // is what keeps the by-name map (an async chunk, see
                        // below) out of it. Without this group the icons that
                        // eager chunks and the map share come out as a dozen
                        // tiny eager chunks named after whichever icon sorts
                        // first, which change every time an icon is added.
                        {
                            name: "vendor-lucide",
                            test: /[\\/]node_modules[\\/]lucide-react[\\/]/,
                            tags: ["$initial"]
                        },
                        // The same for the kit and the core runtime, which this app
                        // resolves to source: what the entry reaches statically goes
                        // to one chunk each, and their lazy modules (the /debug/ui
                        // design reference, six of seven translations, the icon map)
                        // stay out, because they are not `$initial`.
                        {
                            name: "rebase-ui",
                            test: /[\\/]packages[\\/]ui[\\/]src[\\/]/,
                            tags: ["$initial"]
                        },
                        {
                            name: "rebase-core",
                            test: /[\\/]packages[\\/]app[\\/]src[\\/]/,
                            tags: ["$initial"]
                        },
                        // @rebasepro/common, utils and types: what the entry reaches
                        // statically, in one chunk. common and utils declare
                        // `"sideEffects": false`, so the modules the entry does not use
                        // stay out, and the ones it shares with lazy chunks would
                        // otherwise land in a chunk named after whichever sorted first.
                        {
                            name: "rebase-common",
                            test: /[\\/]packages[\\/](common|utils|types)[\\/]src[\\/]/,
                            tags: ["$initial"]
                        },
                        // @rebasepro/client: the same, and for the same reason.
                        // Its offline engine is fetched with `import()` when a
                        // client turns offline on; without this group the
                        // modules the entry shares with it (transport, collection
                        // client, query builder) come out as an eager chunk named
                        // after whichever of them sorts first.
                        {
                            name: "rebase-client",
                            test: /[\\/]packages[\\/]client[\\/]src[\\/]/,
                            tags: ["$initial"]
                        },
                        {
                            name(id) {
                                // Heavy vendor libraries — split into individually cached chunks.
                                //
                                // A name here says these modules travel TOGETHER. It does not
                                // say they travel late: a chunk becomes a static dependency of
                                // the entry — and so a `modulepreload` in index.html — the
                                // moment any one module in it is statically reachable. Naming
                                // a library that is only partly lazy therefore drags the lazy
                                // part onto the critical path. Read the two exceptions below
                                // before adding a line.

                                // @rollup/plugin-commonjs emits its shared helpers as two
                                // virtual modules ("\0commonjsHelpers.js" and
                                // "\0commonjs-dynamic-modules") that every CommonJS
                                // dependency reaches, the entry's included. They match no
                                // rule below, so Rollup parks them in one of the chunks
                                // that use them — and it chose `vendor-exceljs`, which
                                // meant the entry statically imported 940 kB of
                                // spreadsheet reader to get a ten-line `require` shim.
                                // Give the helpers a chunk of their own so they can never
                                // anchor a heavy one to the critical path.
                                if (id.includes("commonjsHelpers") || id.includes("commonjs-dynamic-modules")) return "vendor-commonjs-helpers";

                                if (id.includes("exceljs")) return "vendor-exceljs";
                                if (id.includes("prosemirror")) return "vendor-prosemirror";
                                if (id.includes("monaco-editor") || id.includes("@monaco-editor")) return "vendor-monaco";
                                if (id.includes("@xyflow") || id.includes("dagre")) return "vendor-xyflow";
                                if (id.includes("@dnd-kit")) return "vendor-dnd";
                                if (id.includes("prism-react-renderer")) return "vendor-prism";
                                if (id.includes("markdown-it")) return "vendor-markdown";
                                if (id.includes("react-dropzone")) return "vendor-dropzone";
                                // date-fns core only. The ~77 locales are imported one at a
                                // time by the admin's date preview; sharing a chunk name with
                                // the core would make all of them eager again.
                                if (id.includes("date-fns/locale")) return undefined;
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

                                // lucide-react has no line here on purpose. The ~130 icons
                                // the chrome imports by name are static; the by-name lookup
                                // map is fetched on demand. One chunk name cannot hold both
                                // apart, and naming it welded 822 kB of icons into the
                                // preload set. The `$initial` group above takes the static
                                // ones; the map gets its own async chunk.

                                // No `@rebasepro/*` package is named here. This app resolves
                                // them to SOURCE, so a name applies to individual modules,
                                // and a named group takes a module's dependencies with it:
                                // every lazy module of the package is welded to its static
                                // ones and preloaded on the login screen.
                                //
                                // `packages/cms` went first — split by directory "to stay
                                // under size limits", `rebase-admin-editor` came out at
                                // 506 kB eagerly preloaded, where an installed project
                                // fetches 53 kB of it on demand. `packages/ui` and
                                // `packages/app` followed: `rebase-ui` pulled the lucide map
                                // back in until it was exempted, and `rebase-core` carried
                                // the /debug/ui design reference (`App.tsx` lazy-loads it)
                                // and six translations `RebaseI18nProvider` fetches on
                                // demand — 760 kB the login screen never used. That made
                                // this build unrepresentative of every real one, which is a
                                // bad property for the app the bundle budget measures, and
                                // check-bundle-budget.mjs now refuses those modules in the
                                // eager set. The `$initial` groups above name only what the
                                // entry already reaches; each package's own code splitting
                                // survives for the rest.

                                return undefined;
                            }
                        }
                    ]
                }
            }
        }
    },
    optimizeDeps: { include: ["react/jsx-runtime", "pgsql-ast-parser"] },
    // This app bundles @rebasepro/studio from source, so the schema
    // visualizer's layout worker (`dagre-layout.worker.ts`) is built here, by
    // this config, not by the library's. Module workers, as the library builds
    // them: under Vite's `iife` default dagre's CommonJS files find no
    // `require`, fall back to reading `window`, and the worker dies on load —
    // the diagram then silently lays itself out on the main thread again.
    worker: {
        format: "es"
    },
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
            // Package-name aliases, and they cover subpaths too: Vite matches an
            // alias against the prefix up to a "/" boundary and the FIRST match
            // wins, so `@rebasepro/ui/index.css` is rewritten to
            // packages/ui/src/index.css by the `@rebasepro/ui` entry this spread
            // registers. There used to be a second entry below claiming the
            // opposite — "subpath exports are not covered" — pointing at
            // packages/ui/index.css, which does not exist. It was dead, and the
            // day a reordering made it live it would have broken dev on a
            // missing file. saas/frontend/vite.config.ts dropped the same pair.
            ...workspaceSourceAliases(),
            "config": path.resolve(__dirname, "../config")
        }
    }
})
