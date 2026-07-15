import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { HonoEnv } from "../api/types";
import { requestId } from "../utils/request-id";
import { requestLogger } from "../utils/request-logger";
import { logger } from "../utils/logger";

interface MiddlewareConfig {
    maxBodySize?: number;
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
        logger.info("Request body limit configured", { maxSizeMB: Math.round(maxBodySize / 1024 / 1024) });
    }

    // CSRF Protection (opt-in)
    if (config.csrf?.origin) {
        app.use(`${basePath}/*`, csrf({
            origin: config.csrf.origin
        }));
        logger.info("CSRF protection enabled");
    }

    // CORS Warning
    if (!isProduction && !process.env.CORS_ORIGINS && !process.env.FRONTEND_URL) {
        logger.warn(
            "No CORS configuration detected (CORS_ORIGINS / FRONTEND_URL not set). " +
            "The API will accept requests from any origin. " +
            "Set CORS_ORIGINS in your .env file to restrict access."
        );
    }

    // Request Logging
    app.use(`${basePath}/*`, requestLogger());
}
