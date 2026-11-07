import path from "path";

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Stage one: the view as ONE self-contained HTML document.
 *
 * A host renders a view in a sandboxed iframe whose CSP allows no network by
 * default, so nothing may be fetched — not a script, not a stylesheet, not a
 * lazy chunk. The bundle's script and stylesheet are inlined into the page
 * here, and the second stage (`vite.config.ts`) inlines the page into
 * `dist/index.js`.
 */
function inlineIntoHtml(): Plugin {
    return {
        name: "rebase-inline-into-html",
        enforce: "post",
        generateBundle(_options, bundle) {
            for (const page of Object.values(bundle)) {
                if (page.type !== "asset" || !page.fileName.endsWith(".html")) continue;
                let html = String(page.source);
                for (const [fileName, file] of Object.entries(bundle)) {
                    if (file.type === "chunk" && fileName.endsWith(".js")) {
                        const tag = new RegExp(`<script[^>]*src="[^"]*${escapeRegExp(fileName)}"[^>]*></script>`);
                        const code = file.code
                            // `</script` inside the code would close the tag early.
                            .replace(/<\/script/gi, "<\\/script")
                            // The preload helper's placeholder, which a build
                            // with no chunks to preload leaves unreplaced.
                            .replace(/__VITE_PRELOAD__/g, "void 0");
                        html = html.replace(tag, () => `<script type="module">${code}</script>`);
                        delete bundle[fileName];
                    } else if (file.type === "asset" && fileName.endsWith(".css")) {
                        const tag = new RegExp(`<link[^>]*href="[^"]*${escapeRegExp(fileName)}"[^>]*>`);
                        html = html.replace(tag, () => `<style>${String(file.source)}</style>`);
                        delete bundle[fileName];
                    }
                }
                page.source = html;
            }
        }
    };
}

/**
 * What the admin panel loads lazily and a view does without.
 *
 * With every chunk inlined, an `import()` is no longer a fetch on demand but
 * bytes in the document, so these would be a megabyte and a half the view
 * never uses: the whole Lucide map (an icon a collection names by string —
 * the view shows none), every date-fns locale but the default, and the admin
 * panel's translations (the view is in English). Each becomes an empty
 * module, which every one of those loaders already treats as "not there".
 *
 * And the collection toolbar's import and export: both work on files, and a
 * view has none to read, nor anywhere to save one. Their buttons draw nothing.
 */
function withoutLazyExtras(): Plugin {
    return {
        name: "rebase-without-lazy-extras",
        enforce: "pre",
        load(id) {
            if (/\/icons\/lucide_icon_map\.[jt]s$/.test(id)) return "export const icons = {};";
            if (/\/date-fns\/locale\/(?!en-US)[^/]+\.js$/.test(id)) return "export {};";
            if (/\/app\/src\/locales\/(?!en\.)[a-z]+\.ts$/.test(id)) return "export {};";
            if (/\/cms\/src\/data_import\/import\/ImportCollectionAction\.tsx$/.test(id)) {
                return "export const ImportCollectionAction = () => null, PropertySelectEntry = () => null, ImportDataPreview = () => null;";
            }
            if (/\/cms\/src\/data_export\/export\/ExportCollectionAction\.tsx$/.test(id)) {
                return "export const ExportCollectionAction = () => null;";
            }
            return undefined;
        }
    };
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PACKAGES = path.resolve(import.meta.dirname, "..");

export default defineConfig({
    root: path.resolve(import.meta.dirname, "views"),
    base: "./",
    plugins: [withoutLazyExtras(), react(), tailwindcss(), inlineIntoHtml()],
    resolve: {
        alias: [
            // Every workspace package from its source, so the build needs no
            // other package built first and the module graph holds one copy
            // of each — the admin panel's contexts are matched by identity.
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
