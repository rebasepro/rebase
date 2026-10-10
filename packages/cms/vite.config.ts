import path from "path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react"

const isExternal = (id: string) => {
    if (id.startsWith(".") || path.isAbsolute(id)) return false;

    return true;
};

export default defineConfig(() => ({
    optimizeDeps: {
    },
    server: {
        fs: {
            allow: ["../.."]
        }
    },
    esbuild: {
        logOverride: { "this-is-undefined-in-esm": "silent" }
    },
    build: {
        lib: {
            entry: {
                index: path.resolve(__dirname, "src/index.ts"),
                editor: path.resolve(__dirname, "src/editor/index.ts"),
                collection_editor_ui: path.resolve(__dirname, "src/collection_editor_ui.ts")
            },
            name: "Rebase CMS",
            formats: ["es"],
            // One file per source module (`preserveModules` below). The three
            // entries keep the names package.json's `exports` gives them
            // (`index.js`, `editor.js`, `collection_editor_ui.js`); every other
            // module lands at its own path (`components/RebaseCMS.js`).
            fileName: (format, entryName) => `${entryName}.js`
        },
        target: "ESNEXT",
        minify: false,
        sourcemap: true,
        rollupOptions: {
            external: isExternal,
            onwarn(warning, warn) {
                if (warning.code === "MISSING_GLOBAL_NAME") return;
                warn(warning);
            },
            output: {
                // Shipped as one file, the record views, the entity form and the
                // property previews were static imports of `index.js` (the lazy
                // `import()`s in components/lazy_record_views.ts had nothing to
                // split off), so an app built on the published package preloaded
                // them on its login screen: 1.9 MB of eager JS for a scaffolded
                // admin, against 1.3 MB now. One file per module lets the app's
                // bundler keep them lazy and drop what it never imports
                // (`"sideEffects"` in package.json). Guarded by the `cms-shell`
                // target of tooling/scripts/check-bundle-budget.mjs.
                preserveModules: true,
                preserveModulesRoot: path.resolve(__dirname, "src")
            }
        }
    },
    resolve: {
        alias: {
            "@rebasepro/client": path.resolve(__dirname, "../client/src"),
            "@rebasepro/common": path.resolve(__dirname, "../common/src"),
            "@rebasepro/app": path.resolve(__dirname, "../app/src"),
            "@rebasepro/forms": path.resolve(__dirname, "../forms/src"),
            "@rebasepro/inference": path.resolve(__dirname, "../inference/src"),
            "@rebasepro/types": path.resolve(__dirname, "../types/src"),
            "@rebasepro/ui": path.resolve(__dirname, "../ui/src")
        }
    },
    plugins: [
        react()
    ],
    css: {
        preprocessorOptions: {
            scss: {
                api: "modern-compiler",
                silenceDeprecations: ["mixed-decls", "color-functions", "global-builtin", "import", "legacy-js-api", "slash-div"]
            }
        }
    }
}));
