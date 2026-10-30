import path from "path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isExternal = (id: string) => {
    if (id.startsWith(".") || path.isAbsolute(id)) return false;
    return true;
};

/**
 * Three entries, built side by side: the admin plugin (`.`), and the two
 * headless halves a backend loads — `./config` from a collection file,
 * `./server` from a function file. Everything that is not this package's own
 * source stays external, so the backend halves carry no React.
 */
export default defineConfig(() => ({
    build: {
        lib: {
            formats: ["es"],
            entry: {
                index: path.resolve(__dirname, "src/index.ts"),
                config: path.resolve(__dirname, "src/config/index.ts"),
                server: path.resolve(__dirname, "src/server/index.ts")
            },
            fileName: (format, name) => `${name}.${format}.js`
        },
        target: "ESNEXT",
        minify: false,
        sourcemap: true,
        rollupOptions: {
            external: isExternal
        }
    },
    plugins: [react()]
}));
