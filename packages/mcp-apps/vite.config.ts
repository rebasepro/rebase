import path from "path";

import { defineConfig } from "vite";

/**
 * Stage two: `dist/index.js`, the module `@rebasepro/server` imports, with
 * each view's HTML (from stage one, `vite.views.config.ts`) inlined as a
 * string. The package ships nothing else: no React, no UI kit, no runtime
 * dependencies — they are all inside the HTML already.
 */
export default defineConfig({
    build: {
        lib: {
            formats: ["es"],
            entry: path.resolve(import.meta.dirname, "src/index.ts"),
            fileName: () => "index.js"
        },
        outDir: path.resolve(import.meta.dirname, "dist"),
        // Stage one's output is this stage's input.
        emptyOutDir: false,
        target: "es2022",
        minify: false
    }
});
