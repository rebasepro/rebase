import path from "path";

import { defineConfig } from "vitest/config";

/**
 * The suite tests the views' source, never a build: `@rebasepro/ui`, the one
 * workspace package the views import, resolves to its `src`.
 */
export default defineConfig({
    resolve: {
        alias: [
            { find: /^@rebasepro\/ui$/, replacement: path.resolve(import.meta.dirname, "../ui/src/index.ts") }
        ]
    }
});
