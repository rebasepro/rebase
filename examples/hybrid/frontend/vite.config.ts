import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { rebaseBackendGuard, rebaseManualChunks } from "@rebasepro/app/vitePlugin";

export default defineConfig({
    // The project's .env (VITE_FIREBASE_*, and VITE_API_URL from `rebase dev`).
    envDir: path.resolve(import.meta.dirname, ".."),
    base: process.env.REBASE_APP_BASE ?? "/",
    resolve: { dedupe: ["react", "react-dom", "react-router"] },
    build: {
        outDir: "./dist",
        target: "es2022",
        chunkSizeWarningLimit: Infinity,
        rollupOptions: { output: { manualChunks: rebaseManualChunks } }
    },
    // rebaseBackendGuard: nothing in the frontend may import a value from ../backend.
    plugins: [react({}), tailwindcss(), rebaseBackendGuard()]
});
