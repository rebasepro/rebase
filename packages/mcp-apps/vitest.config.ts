import path from "path";

import { defineConfig } from "vitest/config";

const PACKAGES = path.resolve(import.meta.dirname, "..");

/**
 * The suite tests the views' source, never a build, resolved as the build
 * resolves it (`vite.views.config.ts`): every workspace package from its `src`,
 * and the admin panel's router as `@rebasepro/cms` has it.
 */
export default defineConfig({
    test: {
        // At most four workers (vitest's default is one per core); see
        // packages/server/jest.config.cjs. An explicit --maxWorkers still wins.
        maxWorkers: 4,
    },
    resolve: {
        alias: [
            // The admin's MCP view runtime whole, from source: the published
            // `@rebasepro/cms/mcp-view` subpath exports only its entry points.
            { find: /^@rebasepro\/cms\/mcp-view$/, replacement: `${PACKAGES}/cms/src/mcp_view/index.tsx` },
            { find: /^@rebasepro\/([a-z-]+)$/, replacement: `${PACKAGES}/$1/src/index.ts` },
            { find: /^react-router$/, replacement: path.resolve(PACKAGES, "cms/node_modules/react-router") }
        ],
        dedupe: ["react", "react-dom", "react-router"]
    }
});
