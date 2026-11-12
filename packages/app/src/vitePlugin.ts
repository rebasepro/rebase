
import path from "path";
import fs from "fs";
import type { Plugin, ResolvedConfig } from "vite";
export { BACKEND_GUARD_PLUGIN_NAME, rebaseBackendGuard } from "./backend_guard.ts";
export type { RebaseBackendGuardOptions } from "./backend_guard.ts";
import { MCP_VIEW_UTILITIES, mcpViewBoot, mcpViewDocument, mcpViewInlineIntoHtml, mcpViewOneChunk, mcpViewWithoutLazyExtras } from "./mcp_view_build.ts";

/**
 * How the admin's dependencies are split into cached chunks.
 *
 * This was sixty-five lines copied verbatim into every scaffold's
 * `vite.config.ts`, comments and all — which meant every project got a frozen
 * snapshot of a decision that keeps being revised. When we learned that naming
 * `lucide-react` welded 822 kB of icons into the preload set, the fix landed
 * in the template and in nothing already generated.
 *
 * A name here says these modules travel TOGETHER. It does not say they travel
 * late: a chunk becomes a static dependency of the entry — and so a
 * `modulepreload` in index.html — the moment any one module in it is
 * statically reachable. Naming a library that is only partly lazy therefore
 * drags the lazy part onto the critical path. Read the two exceptions below
 * before adding a line.
 *
 * @example
 * ```ts
 * build: { rollupOptions: { output: { manualChunks: rebaseManualChunks } } }
 * ```
 */
export function rebaseManualChunks(id: string): string | undefined {
    // @rollup/plugin-commonjs emits its shared helpers as two virtual modules
    // ("\0commonjsHelpers.js" and "\0commonjs-dynamic-modules") that every
    // CommonJS dependency reaches, the entry's included. They match no rule
    // below, so Rollup parks them in one of the chunks that use them — and it
    // chose `vendor-exceljs`, which meant the entry statically imported 940 kB
    // of spreadsheet reader to get a ten-line `require` shim. Give the helpers
    // a chunk of their own so they can never anchor a heavy one to the
    // critical path.
    if (id.includes("commonjsHelpers") || id.includes("commonjs-dynamic-modules")) return "vendor-commonjs-helpers";

    // Small libraries the entry needs, named before the heavy groups. A name
    // takes the unassigned dependencies of its modules with it, so
    // `prism-react-renderer` took `clsx` — which the kit imports statically — and
    // the entry imported 85 kB of syntax highlighter for a 633-byte helper;
    // React core landed in `vendor-dnd` the same way.
    if (/[\\/]node_modules[\\/](react|scheduler|use-sync-external-store)[\\/]/.test(id)) return "vendor-react";
    if (/[\\/]node_modules[\\/]clsx[\\/]/.test(id)) return "vendor-clsx";

    if (id.includes("exceljs")) return "vendor-exceljs";
    if (id.includes("prosemirror")) return "vendor-prosemirror";
    if (id.includes("monaco-editor") || id.includes("@monaco-editor")) return "vendor-monaco";
    if (id.includes("@xyflow") || id.includes("dagre")) return "vendor-xyflow";
    if (id.includes("@dnd-kit")) return "vendor-dnd";
    if (id.includes("prism-react-renderer")) return "vendor-prism";
    if (id.includes("markdown-it")) return "vendor-markdown";
    if (id.includes("react-dropzone")) return "vendor-dropzone";
    // date-fns core only. The ~77 locales are imported one at a time by the
    // admin's date preview; sharing a chunk name with the core would make all
    // of them eager again.
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

    // lucide-react has no line on purpose. The ~130 icons the chrome imports by
    // name are static; the by-name lookup map is fetched on demand. One chunk
    // name cannot hold both apart, and naming it welded 822 kB of icons into
    // the preload set. Left to the bundler, the map gets its own async chunk
    // and the named icons land in the chunks that import them — except the
    // few the map shares with an eager chunk, which come out as small eager
    // chunks of their own (2 of 19, under 4 kB each, in a scaffold-shaped app
    // measured 2026-10-07). Keeping those together takes a `codeSplitting`
    // group tagged `$initial`, which a manualChunks function cannot express;
    // app/frontend/vite.config.ts does it that way.

    return undefined;
}


// ─── The MCP App view ────────────────────────────────────────────────────────

/**
 * The view an MCP client like Claude shows the project's data in
 * (show_table, show_record, show_app), built from this app.
 *
 * A server serves a generic view — the admin panel with nothing of the
 * project's own, drawing the tables a tool result carries with the CMS's
 * zero-config defaults. This builds the project's: its `App` component (the
 * one `src/main.tsx` renders under its router) and its stylesheet, mounted
 * inside the view (`startMcpView` in `@rebasepro/cms/mcp-view`). That `App`
 * is the hand-off: the `tableCustomizations` it passes to `<RebaseCMS>` are
 * applied to the descriptors the result carries, exactly as on the app's own
 * page, and its custom views, entity views, fields, previews, actions,
 * plugins and slots are what Claude draws. Nothing else is declared for the
 * view: a customization the page has, the view has. Not `main.tsx` itself: a browser router cannot address a frame
 * whose document is `about:srcdoc`, and in the view `<RebaseShell>` brings a
 * router of its own. The output is one self-contained document,
 * `rebase-view.html` beside the build: a view's frame fetches nothing, so
 * every script, style and font is inside it. The backend serves it in place
 * of the generic one (`serveSPA` finds it in the frontend it serves).
 *
 * A second build, after the app's, from the same config.
 */
export interface RebaseMcpViewPluginOptions {
    /** The module that exports the app's root component, `App`. Default `src/App.tsx`. */
    app?: string;
    /** The app's stylesheet. Default `src/index.css`, where it exists. */
    styles?: string;
}

/** Set while the view's own build runs, so it does not build a view of itself. */
const MCP_VIEW_BUILD = "REBASE_MCP_VIEW_BUILD";

export function rebaseMcpViewPlugin(options: RebaseMcpViewPluginOptions = {}): Plugin {
    let config: ResolvedConfig;
    return {
        name: "rebase-mcp-view",
        apply: "build",
        configResolved(resolved) {
            config = resolved;
        },
        async closeBundle() {
            if (process.env[MCP_VIEW_BUILD] || config.build.ssr) return;
            const app = path.resolve(config.root, options.app ?? "src/App.tsx");
            if (!fs.existsSync(app)) {
                config.logger.warn(`[rebase] No MCP view: ${path.relative(config.root, app)} does not exist.`);
                return;
            }
            const styles = path.resolve(config.root, options.styles ?? "src/index.css");
            const work = fs.mkdtempSync(path.join(config.root, ".rebase-mcp-view-"));
            try {
                fs.writeFileSync(path.join(work, "index.html"), mcpViewDocument());
                fs.writeFileSync(path.join(work, "view.css"), MCP_VIEW_UTILITIES);
                fs.writeFileSync(path.join(work, "boot.tsx"), mcpViewBoot(app, fs.existsSync(styles) ? styles : undefined));
                const { build } = await import("vite");
                process.env[MCP_VIEW_BUILD] = "1";
                try {
                    await build({
                        configFile: config.configFile,
                        root: config.root,
                        mode: config.mode,
                        logLevel: "warn",
                        plugins: [mcpViewWithoutLazyExtras(), mcpViewOneChunk(), mcpViewInlineIntoHtml()],
                        build: {
                            outDir: path.join(work, "out"),
                            emptyOutDir: true,
                            copyPublicDir: false,
                            sourcemap: false,
                            modulePreload: false,
                            cssCodeSplit: false,
                            // Everything but fonts: a view's frame loads no
                            // font file, inlined or not, so they would only
                            // be megabytes the host downloads to throw away.
                            assetsInlineLimit: file => !/\.(woff2?|ttf|otf|eot)$/i.test(file),
                            rollupOptions: {
                                input: path.join(work, "index.html"),
                                output: { codeSplitting: false }
                            }
                        }
                    });
                } finally {
                    delete process.env[MCP_VIEW_BUILD];
                }
                const built = path.join(work, "out", path.relative(config.root, path.join(work, "index.html")));
                const target = path.join(config.build.outDir, "rebase-view.html");
                fs.copyFileSync(fs.existsSync(built) ? built : path.join(work, "out", "index.html"), target);
                config.logger.info(`[rebase] MCP view: ${path.relative(config.root, target)} (${Math.round(fs.statSync(target).size / 1024)} kB)`);
            } finally {
                fs.rmSync(work, { recursive: true, force: true });
            }
        }
    };
}
