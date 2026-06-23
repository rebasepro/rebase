import path from "path";
import { defineConfig } from "vite";

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
            name: "Rebase CLI",
            formats: ["es"],
            fileName: () => "index.es.js"
        },
        minify: false,
        target: "ESNEXT",
        sourcemap: true,
        rollupOptions: {
            external: isExternal,
            onwarn(warning, warn) {
                if (warning.code === "MISSING_GLOBAL_NAME") return;
                if (warning.code === "INEFFECTIVE_DYNAMIC_IMPORT") return;
                if (warning.code === "EMPTY_IMPORT_META") return;
                warn(warning);
            }
        }
    },
        resolve: {
        alias: {
            "@rebasepro/server-core": path.resolve(__dirname, "../server-core/src"),
            "@rebasepro/sdk-generator": path.resolve(__dirname, "../sdk-generator/src"),
            "@rebasepro/types": path.resolve(__dirname, "../types/src")
        }
    },
    plugins: []
}));
