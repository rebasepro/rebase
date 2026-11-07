import path from "path";

import { defineConfig } from "vitest/config";

const PACKAGES = path.resolve(import.meta.dirname, "..");

/**
 * The suite tests the views' source, never a build, resolved as the build
 * resolves it (`vite.views.config.ts`): every workspace package from its `src`,
 * and the admin panel's router as `@rebasepro/cms` has it.
 */
export default defineConfig({
    resolve: {
        alias: [
            { find: /^@rebasepro\/([a-z-]+)$/, replacement: `${PACKAGES}/$1/src/index.ts` },
            { find: /^react-router$/, replacement: path.resolve(PACKAGES, "cms/node_modules/react-router") }
        ],
        dedupe: ["react", "react-dom", "react-router"]
    }
});
