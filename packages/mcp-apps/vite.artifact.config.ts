import path from "path";

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// From source: the plugin module is built after this package in a fresh checkout.
import { mcpViewWithoutLazyExtras } from "../app/src/mcp_view_build";

/**
 * EXPERIMENTAL: the script a Claude artifact loads to run a show_app app
 * (`views/artifact/entry.tsx`). One ES module with the stylesheet inside it,
 * because an artifact may load scripts from a CDN but no stylesheet. Not part
 * of `build`: `pnpm build:artifact` writes `dist/artifact/rebase-artifact.js`.
 */
const PACKAGES = path.resolve(import.meta.dirname, "..");

/** The stylesheet, put into the page by the script itself. */
function cssIntoScript(): Plugin {
    return {
        name: "rebase-artifact-css-into-script",
        enforce: "post",
        generateBundle(_options, bundle) {
            let css = "";
            for (const [fileName, file] of Object.entries(bundle)) {
                if (file.type === "asset" && fileName.endsWith(".css")) {
                    css += String(file.source);
                    delete bundle[fileName];
                }
            }
            for (const file of Object.values(bundle)) {
                if (file.type === "chunk" && file.isEntry) {
                    const code = `{const s=document.createElement("style");s.dataset.rebase="artifact";s.textContent=${JSON.stringify(css)};document.head.append(s);}\n${file.code}`;
                    // Printable ASCII only: an artifact refuses a file with U+FFFD
                    // in it, and libraries carry it, and raw control characters, in
                    // string and regex literals. An escape means the same there, one
                    // UTF-16 unit at a time; tabs and line breaks stay, as code has them.
                    file.code = code.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
                }
            }
        }
    };
}

export default defineConfig({
    plugins: [mcpViewWithoutLazyExtras(), react(), tailwindcss(), cssIntoScript()],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: {
        alias: [
            { find: /^@rebasepro\/cms\/mcp-view$/, replacement: `${PACKAGES}/cms/src/mcp_view/index.tsx` },
            { find: /^@rebasepro\/([a-z-]+)$/, replacement: `${PACKAGES}/$1/src/index.ts` },
            { find: /^react-router$/, replacement: path.resolve(PACKAGES, "cms/node_modules/react-router") }
        ],
        dedupe: ["react", "react-dom", "react-router"]
    },
    build: {
        lib: {
            formats: ["es"],
            entry: path.resolve(import.meta.dirname, "views/artifact/entry.tsx"),
            fileName: () => "rebase-artifact.js"
        },
        outDir: path.resolve(import.meta.dirname, "dist/artifact"),
        emptyOutDir: true,
        target: "es2022",
        minify: true,
        cssCodeSplit: false,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        rollupOptions: { output: { codeSplitting: false } }
    }
});
