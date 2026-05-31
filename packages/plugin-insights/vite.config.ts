// @ts-ignore
import path from "path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react"
const ReactCompilerConfig = {
    target: "18"
};
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
            name: "Rebase",
            fileName: (format) => `index.${format}.js`
        },
        target: "ESNEXT",
        minify: false,
        sourcemap: true,
        rollupOptions: {
            external: isExternal,
            output: {
                globals: {}
            }
        }
    },
    resolve: {
        alias: {
            "@rebasepro/admin": path.resolve(__dirname, "../admin/src"),
            "@rebasepro/common": path.resolve(__dirname, "../common/src"),
            "@rebasepro/core": path.resolve(__dirname, "../core/src"),
            "@rebasepro/types": path.resolve(__dirname, "../types/src"),
            "@rebasepro/ui": path.resolve(__dirname, "../ui/src")
        }
    },
    plugins: [react({
        babel: {
            plugins: [
                ["babel-plugin-react-compiler", ReactCompilerConfig]
            ]
        }
    })]
}));
