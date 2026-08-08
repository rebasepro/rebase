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
     * Public base path this app is served under (default: "/").
     *
     * No trailing slash unless it *is* "/". Several apps run in one process,
     * each under its own prefix — a site at "/" and an admin at "/admin" — so
     * both the asset middleware and the SPA fallback are scoped here rather
     * than claiming "/*" globally.
     *
     * The assets must have been *built* for this path too; see
     * `assertBuiltForPath` in the CLI.
     */
    basePath?: string;

    /**
     * Base path for API routes (default: "/api")
     * Requests to this path will be passed through to API handlers
     */
    apiBasePath?: string;

    /**
     * Additional paths to exclude from SPA handling
     * These paths will be passed through to other handlers
     *
     * When several apps share a process, the "/"-rooted one must list its
     * siblings here. Mount order alone is not enough: a request to "/admin/x"
     * that misses the admin's files would otherwise fall through to the root
     * app's catch-all and be answered with the *site's* index.html under the
     * admin's URL — which reads as an admin bug for a long time.
     *
     * Each entry excludes a path *segment*, not a string prefix: "/admin"
     * excludes "/admin" and "/admin/x" but not "/administrators", which is an
     * ordinary route of the app rooted at "/".
     *
     * @example ["/health", "/ws", "/metrics", "/admin"]
     */
    excludePaths?: string[];

    /**
     * Index file to serve for SPA routes (default: "index.html")
     */
    indexFile?: string;

    /**
     * Serve index.html for unmatched paths under `basePath` (default: true).
     *
     * `false` registers the asset middleware only, for a static *site* whose
     * generator emitted a real file per route.
     */
    spa?: boolean;
}

/**
 * Is `requestPath` the excluded path `prefix`, or something beneath it?
 *
 * Segment-aware on purpose. A plain `startsWith` reads "/api" as excluding
 * "/apidocs", and "/admin" as excluding "/administrators" — both ordinary
 * client-side routes of the app rooted at "/", both then answered with a 404
 * because the SPA fallback declined them and nothing else claims the path.
 * `apiBasePath` is always in the exclusion list, so this reached single-app
 * setups too, not just the multi-app ones the list was added for.
 */
function isUnderPath(requestPath: string, prefix: string): boolean {
    // "/" would exclude everything below it, which is every request.
    const trimmed = prefix.replace(/\/+$/, "");
    if (trimmed === "") return true;
    return requestPath === trimmed || requestPath.startsWith(`${trimmed}/`);
}

/**
 * Serve a Single Page Application from an Hono app.
 *
 * @internal Not part of the stable public API. Exported only because the
 * entrypoint `rebase eject` writes
 * (`packages/cli/templates/eject/backend/src/index.ts`) and `app/backend/src/index.ts`
 * call it to serve the built frontend in production — the scaffolded template
 * has no entrypoint of its own. Its request-handling behavior is an
 * implementation detail and may change without a major version bump.
 */
export function serveSPA<E extends import("hono").Env>(app: Hono<E>, config: ServeSPAConfig): void {
    const {
        frontendPath,
        apiBasePath = "/api",
        excludePaths = [],
        indexFile = "index.html",
        spa = true
    } = config;

    // "/admin/" and "/admin" must not be two different mounts.
    const rawBase = config.basePath ?? "/";
    const basePath = rawBase !== "/" ? rawBase.replace(/\/+$/, "") : "/";
    const isRoot = basePath === "/";

    // Validate frontend path exists.
    //
    // NOTE: this warns and disables itself rather than throwing, so a wrong path
    // leaves the API answering perfectly while the site 404s. Verify a mount by
    // fetching it, never by reading the logs.
    if (!fs.existsSync(frontendPath)) {
        logger.warn(`⚠️ Frontend build path does not exist: ${frontendPath}`);
        logger.warn("   SPA serving is disabled. Build your frontend first.");
        return;
    }

    // Scoped to this app's prefix. Registering at "/*" would mean one process
    // could serve exactly one SPA — and, worse, the first one registered would
    // silently answer for every app mounted after it.
    const scope = isRoot ? "/*" : `${basePath}/*`;

    // Compress the bundle. The API is compressed by `configureMiddlewares`, but
    // that is scoped to the API base path — static assets are served here, and
    // the JS bundle is the single largest thing most apps ship.
    //
    // Registered before serveStatic so it wraps it. `precompressed` takes
    // priority where the build emitted .br/.gz siblings: those cost no CPU and
    // give brotli, and set Content-Encoding themselves, which makes the
    // compression middleware skip them.
    app.use(scope, responseCompression());
    app.use(scope, serveStatic({
        root: path.relative(process.cwd(), frontendPath),
        precompressed: true,
        // The prefix is a serving concern, not a directory: `/admin/assets/x.js`
        // lives at `<adminBuild>/assets/x.js`.
        ...(isRoot ? {} : { rewriteRequestPath: (p: string) => p.slice(basePath.length) || "/" })
    }));

    if (!spa) {
        logger.info(`✅ Static serving enabled at ${basePath} from: ${frontendPath}`);
        return;
    }

    // Build list of paths to exclude from SPA handling
    const allExcludePaths = [apiBasePath, ...excludePaths];

    // Cache the index.html content to avoid re-reading from disk on every navigation request.
    let cachedHtml: string | null = null;

    // SPA fallback - serve index.html for all non-excluded routes under basePath
    app.get(scope, async (c, next) => {
        // Skip excluded paths (API, health checks, sibling apps).
        if (allExcludePaths.some(p => isUnderPath(c.req.path, p))) {
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

    logger.info(`✅ SPA serving enabled at ${basePath} from: ${frontendPath}`);
}

