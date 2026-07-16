import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import * as path from "path";
import * as fs from "fs";
import fsp from "node:fs/promises";
import { responseCompression } from "./utils/compression.js";
import { logger } from "./utils/logger.js";

/**
 * Configuration for serving a Single Page Application
 */
export interface ServeSPAConfig {
    /**
     * Absolute path to the frontend build directory
     * @example path.join(__dirname, "../../frontend/dist")
     */
    frontendPath: string;

    /**
     * Base path for API routes (default: "/api")
     * Requests to this path will be passed through to API handlers
     */
    apiBasePath?: string;

    /**
     * Additional paths to exclude from SPA handling
     * These paths will be passed through to other handlers
     * @example ["/health", "/ws", "/metrics"]
     */
    excludePaths?: string[];

    /**
     * Index file to serve for SPA routes (default: "index.html")
     */
    indexFile?: string;
}

/**
 * Serve a Single Page Application from an Hono app.
 *
 * @internal Not part of the stable public API. Exported only because the
 * official app template (`packages/cli/templates/template/backend/src/index.ts`
 * and `app/backend/src/index.ts`) calls it to serve the built frontend in
 * production. Its request-handling behavior is an implementation detail and
 * may change without a major version bump.
 */
export function serveSPA<E extends import("hono").Env>(app: Hono<E>, config: ServeSPAConfig): void {
    const {
        frontendPath,
        apiBasePath = "/api",
        excludePaths = [],
        indexFile = "index.html"
    } = config;

    // Validate frontend path exists
    if (!fs.existsSync(frontendPath)) {
        logger.warn(`⚠️ Frontend build path does not exist: ${frontendPath}`);
        logger.warn("   SPA serving is disabled. Build your frontend first.");
        return;
    }

    // Compress the bundle. The API is compressed by `configureMiddlewares`, but
    // that is scoped to the API base path — static assets are served here, and
    // the JS bundle is the single largest thing most apps ship.
    //
    // Registered before serveStatic so it wraps it. `precompressed` takes
    // priority where the build emitted .br/.gz siblings: those cost no CPU and
    // give brotli, and set Content-Encoding themselves, which makes the
    // compression middleware skip them.
    app.use("/*", responseCompression());
    app.use("/*", serveStatic({
        root: path.relative(process.cwd(), frontendPath),
        precompressed: true
    }));

    // Build list of paths to exclude from SPA handling
    const allExcludePaths = [apiBasePath, ...excludePaths];

    // Cache the index.html content to avoid re-reading from disk on every navigation request.
    let cachedHtml: string | null = null;

    // SPA fallback - serve index.html for all non-excluded routes
    app.get("*", async (c, next) => {
        // Skip excluded paths (API, health checks, etc.)
        if (allExcludePaths.some(p => c.req.path.startsWith(p))) {
            return next();
        }

        const indexPath = path.join(frontendPath, indexFile);

        if (!cachedHtml) {
            try {
                cachedHtml = await fsp.readFile(indexPath, "utf-8");
            } catch {
                logger.warn(`⚠️ Index file not found: ${indexPath}`);
                return next();
            }
        }

        return c.html(cachedHtml);
    });

    logger.info(`✅ SPA serving enabled from: ${frontendPath}`);
}

