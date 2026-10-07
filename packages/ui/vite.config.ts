import path from "path";
import preserveDirectives from "rollup-preserve-directives";

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

const isExternal = (id: string) => {
    if (id.startsWith(".") || path.isAbsolute(id)) return false;

    return true;
};

export default defineConfig(() => ({
    esbuild: {
        logOverride: { "this-is-undefined-in-esm": "silent" }
    },
    build: {
        lib: {
            entry: path.resolve(__dirname, "src/index.ts"),
            name: "Rebase UI",
            formats: ["es"],
            // One file per source module (`preserveModules` below), so the
            // entry is `index.es.js` — the path package.json's `exports` names
            // — and `components/Button.tsx` becomes `components/Button.es.js`.
            fileName: (format, entryName) => `${entryName}.${format}.js`
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
                // A consumer's bundler can drop a whole MODULE it does not use,
                // but inside one module it can only drop statements it can
                // prove pure — and a kit's top level is ~100 un-annotated
                // `React.memo(...)`/`forwardRef(...)` calls. Shipped as a
                // single file, `import { cls }` pulled in the whole kit
                // (925 kB minified). One module per file lets `sideEffects`
                // in package.json do its job. Guarded by
                // tooling/scripts/check-ui-dist-tree-shakes.mjs.
                preserveModules: true,
                preserveModulesRoot: path.resolve(__dirname, "src")
            }
        }
    },

    plugins: [
        preserveDirectives() as Plugin,
        react(),
        viteStaticCopy({
            targets: [
                {
                    src: path.resolve(__dirname, "src/index.css"),
                    dest: ""
                },
                {
                    // index.css does `@import "./theme.css"`, so shipping one
                    // without the other leaves published consumers with no
                    // design tokens at all.
                    src: path.resolve(__dirname, "src/theme.css"),
                    dest: ""
                }
            ]
        })
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
