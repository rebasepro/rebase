import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { HonoEnv } from "../api/types";
import { responseCompression } from "../utils/compression";
import { requestId } from "../utils/request-id";
import { requestLogger } from "../utils/request-logger";
import { logger } from "../utils/logger";
import { logMiddleware } from "../api/logs-routes";

interface MiddlewareConfig {
    maxBodySize?: number;
    compression?: boolean;
    /**
     * The caller already installed a CORS middleware.
     *
     * The framework does not install one itself, so it warns when it sees no
     * sign of an origin policy. The bundle runtime always installs one, and a
     * warning that is wrong in the common case is worse than no warning — it
     * teaches people to skim past the ones that matter.
     */
    corsHandled?: boolean;
    csrf?: {
        origin: string | string[] | ((origin: string) => boolean);
    };
}

export function configureMiddlewares(
    app: Hono<HonoEnv>,
    basePath: string,
    isProduction: boolean,
    config: MiddlewareConfig
): void {
    // Request ID (correlation)
    app.use(`${basePath}/*`, requestId());

    // Response Compression — registered early so it wraps the final response of
    // every downstream handler, including error responses.
    //
    // Hono's `threshold` is deliberately not plumbed through: it only applies to
    // responses declaring a Content-Length, and `c.json()` sets none, so it
    // would silently do nothing on the very responses this exists to shrink.
    if (config.compression !== false) {
        app.use(`${basePath}/*`, responseCompression());
        logger.debug("Response compression enabled");
    }

    // Request Body Size Limit
    const maxBodySize = config.maxBodySize ?? 10 * 1024 * 1024; // 10MB default
    if (maxBodySize > 0) {
        app.use(`${basePath}/*`, bodyLimit({
            maxSize: maxBodySize,
            onError: (c) => {
                return c.json({
                    error: {
                        message: `Request body too large. Maximum size is ${Math.round(maxBodySize / 1024 / 1024)}MB.`,
                        code: "PAYLOAD_TOO_LARGE"
                    }
                }, 413);
            }
        }));
        logger.debug("Request body limit configured", { maxSizeMB: Math.round(maxBodySize / 1024 / 1024) });
    }

    // CSRF Protection (opt-in)
    if (config.csrf?.origin) {
        app.use(`${basePath}/*`, csrf({
            origin: config.csrf.origin
        }));
        logger.debug("CSRF protection enabled");
    }

    // CORS Warning. The framework does not install a CORS middleware itself —
    // that belongs to the app (the scaffolded template adds `hono/cors`). A
    // backend wired up by hand can therefore end up with no origin restriction
    // at all, which is most dangerous in production, so warn there too rather
    // than only in development.
    if (!config.corsHandled && !process.env.CORS_ORIGINS && !process.env.FRONTEND_URL) {
        logger.warn(
            (isProduction ? "[PRODUCTION] " : "") +
            "No CORS configuration detected (CORS_ORIGINS / FRONTEND_URL not set). " +
            "If your app does not install its own CORS middleware, the API may accept " +
            "requests from any origin. Set CORS_ORIGINS to restrict access."
        );
    }

    // Request Logging
    app.use(`${basePath}/*`, requestLogger());

    // Record requests into the in-memory ring buffer that backs the Studio's
    // Logs Explorer. This is a separate sink from `requestLogger` above, which
    // writes to stdout — both observe every request, neither duplicates the other.
    app.use(`${basePath}/*`, logMiddleware());
}
