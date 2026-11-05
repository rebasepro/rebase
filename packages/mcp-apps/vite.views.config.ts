import path from "path";

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Stage one: each view as ONE self-contained HTML document.
 *
 * A host renders a view in a sandboxed iframe whose CSP allows no network by
 * default, so nothing may be fetched — not a script, not a stylesheet. The
 * bundle's script and stylesheet are inlined into the page here, and the
 * second stage (`vite.config.ts`) inlines the page into `dist/index.js`.
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
                        // `</script` inside the code would close the tag early.
                        const code = file.code.replace(/<\/script/gi, "<\\/script");
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

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default defineConfig({
    root: path.resolve(import.meta.dirname, "views"),
    base: "./",
    plugins: [react(), tailwindcss(), inlineIntoHtml()],
    build: {
        outDir: path.resolve(import.meta.dirname, "dist/views"),
        emptyOutDir: true,
        target: "es2022",
        modulePreload: false,
        cssCodeSplit: false,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        rollupOptions: {
            input: {
                "collection-table": path.resolve(import.meta.dirname, "views/collection-table.html")
            },
            output: { codeSplitting: false }
        }
    }
});
