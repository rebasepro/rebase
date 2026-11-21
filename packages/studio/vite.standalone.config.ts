import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Builds the standalone zero-CMS Rebase Studio SPA served at `/_studio`
 * by the zero-code BaaS runtime image and `rebase dev --zero-code`.
 */
export default defineConfig({
    root: path.resolve(__dirname, "standalone"),
    base: "/_studio/",
    plugins: [
        react(),
        tailwindcss()
    ],
    build: {
        outDir: path.resolve(__dirname, "dist-standalone"),
        emptyOutDir: true,
        target: "es2022",
        sourcemap: false,
        chunkSizeWarningLimit: Infinity,
        rollupOptions: {
            onwarn(warning, warn) {
                if (warning.code === "MISSING_GLOBAL_NAME") return;
                warn(warning);
            }
        }
    },
    resolve: {
        alias: {
            "@rebasepro/app": path.resolve(__dirname, "../app/src"),
            "@rebasepro/client": path.resolve(__dirname, "../client/src"),
            "@rebasepro/cms-types": path.resolve(__dirname, "../cms-types/src"),
            "@rebasepro/common": path.resolve(__dirname, "../common/src"),
            "@rebasepro/types": path.resolve(__dirname, "../types/src"),
            "@rebasepro/ui/index.css": path.resolve(__dirname, "../ui/dist/index.css"),
            "@rebasepro/ui": path.resolve(__dirname, "../ui/src"),
            "@rebasepro/utils": path.resolve(__dirname, "../utils/src")
        }
    },
    worker: {
        format: "es"
    }
});
