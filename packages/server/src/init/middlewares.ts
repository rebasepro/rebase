import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { HonoEnv } from "../api/types";
import { responseCompression } from "../utils/compression";
import { requestId } from "../utils/request-id";
import { requestLogger } from "../utils/request-logger";
import { logger } from "../utils/logger";
import { logMiddleware } from "../api/logs-routes";
import { ApiError, errorHandler, honoHttpExceptionStatus } from "../api/errors";
import { RUNTIME_DEFAULT_MAX_BODY_SIZE } from "../deploy/pod-contract";
import { formatByteSize } from "../utils/byte-size";

/**
 * Whether a request is outside what CSRF protects: one that carries its own
 * credential in `Authorization`.
 *
 * CSRF is an attack on ambient credentials, the cookie a browser attaches to a
 * request another site makes it send. A page on another origin cannot set
 * `Authorization` on a request without a CORS preflight this server answers,
 * and could not know the token to put there anyway. Such a request was
 * refused anyway whenever it had no body and no `Origin` (a CLI's `DELETE`, a
 * script's bare `POST`), because `hono/csrf` reads a missing content type as a
 * form post. That broke `rebase users delete` through the Rebase Cloud
 * control plane.
 */
export function csrfDoesNotApply(authorization: string | undefined): boolean {
    return typeof authorization === "string" && authorization.trim() !== "";
}

/** A Hono `HTTPException` with this status, matched by shape too: two copies of hono can be resolved. */
function isHttpException(error: unknown, status: number): boolean {
    return (error instanceof HTTPException && error.status === status) || honoHttpExceptionStatus(error) === status;
}

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

export interface ConfiguredMiddlewares {
    /**
     * Take one path out of the global body limit, for a route that installs
     * its own.
     *
     * Two `bodyLimit`s on one path do not combine into "the inner one wins".
     * Each answers 413 on the `Content-Length` alone, so the global one, which
     * runs first, refuses everything above its size before the route's own
     * limit is consulted. A route that needs a *larger* ceiling has to be taken
     * out of the global one. Only the code that installs the replacement limit
     * should call this. Called from anywhere else, it leaves a path with no
     * limit at all.
     *
     * The path is matched exactly. A prefix would take every sibling route
     * with it.
     */
    exemptFromBodyLimit(path: string): void;
}

export function configureMiddlewares(
    app: Hono<HonoEnv>,
    basePath: string,
    isProduction: boolean,
    config: MiddlewareConfig
): ConfiguredMiddlewares {
    const carriesOwnBodyLimit = new Set<string>();

    // Request ID (correlation)
    app.use(`${basePath}/*`, requestId());

    // Response Compression — registered early so it wraps the final response of
    // every downstream handler, including error responses. Bodies under 1 KB
    // go out as they are; `responseCompression` measures the ones `c.json()`
    // leaves without a Content-Length.
    if (config.compression !== false) {
        app.use(`${basePath}/*`, responseCompression());
        logger.debug("Response compression enabled");
    }

    // Request Body Size Limit. It is registered here, before any router is
    // mounted, so the exemption set is read per request: the routes that
    // carry their own limit are mounted later and add themselves to it then.
    //
    // Only `0` (or less) turns it off. `NaN` is not greater than zero either, so
    // a size nobody could interpret — an embedder's `Number(process.env.MAX_BODY)`
    // with the variable unset — would read as "off" for every route, silently.
    // It is refused instead.
    const maxBodySize = config.maxBodySize ?? RUNTIME_DEFAULT_MAX_BODY_SIZE;
    if (!Number.isFinite(maxBodySize)) {
        throw new Error(
            `maxBodySize must be a number of bytes (e.g. 10485760), or 0 to turn the limit off; got ${maxBodySize}.`
        );
    }
    if (maxBodySize > 0) {
        const limitBody = bodyLimit({
            maxSize: maxBodySize,
            onError: (c) => errorHandler(
                new ApiError(
                    413,
                    "PAYLOAD_TOO_LARGE",
                    `Request body too large. Maximum size is ${formatByteSize(maxBodySize)}.`
                ),
                c
            ) as Response
        });
        // `c.req.path` is the path Hono routed on, already decoded, so it is
        // the same string the route's own limit is matched against.
        app.use(`${basePath}/*`, (c, next) =>
            carriesOwnBodyLimit.has(c.req.path) ? next() : limitBody(c, next));
        logger.debug("Request body limit configured", { maxSizeMB: Math.round(maxBodySize / 1024 / 1024) });
    }

    // CSRF Protection (opt-in)
    if (config.csrf?.origin) {
        // OAuth's back-channel endpoints take a form body from a client's own
        // server, on the client's origin (RFC 6749 §4.1.3), and are
        // authenticated by the code, the PKCE verifier and the client, never a
        // cookie, so there is no request a browser could be tricked into
        // forging. The check refused every one: Claude's token exchange
        // arrives with `Origin: https://claude.ai`, and no MCP client on a
        // backend with CSRF on could ever finish connecting.
        const oauthBackChannel = new Set([`${basePath}/oauth/token`, `${basePath}/oauth/revoke`]);
        const checkOrigin = csrf({ origin: config.csrf.origin });
        app.use(`${basePath}/*`, async (c, next) => {
            if (oauthBackChannel.has(c.req.path) || csrfDoesNotApply(c.req.header("authorization"))) return next();
            // The check alone, with a `next` that only records that it passed,
            // so an exception from the route itself is never read as a refusal.
            // `hono/csrf` refuses by throwing an `HTTPException(403)`, and the
            // error handler read only `statusCode`, so every refusal went out
            // as a 500 (a body-less `DELETE` from a script, 2026-11-18).
            let passed = false;
            try {
                await checkOrigin(c, async () => { passed = true; });
            } catch (error: unknown) {
                if (!isHttpException(error, 403)) throw error;
            }
            if (!passed) {
                return errorHandler(new ApiError(
                    403,
                    "CSRF_REFUSED",
                    "This request was refused: it did not come from an allowed origin. " +
                        "Send an Origin header naming one, a JSON body, or an Authorization header."
                ), c) as Response;
            }
            return next();
        });
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

    // Request Logging. Mounted under the base path, so every path it sees
    // starts with it: the health probe it skips is `${basePath}/health`, not
    // the `/health` of `requestLogger`'s default, which it never sees.
    app.use(`${basePath}/*`, requestLogger({ skip: [`${basePath}/health`, `${basePath}/favicon.ico`] }));

    // Record requests into the in-memory ring buffer that backs the Studio's
    // Logs Explorer. This is a separate sink from `requestLogger` above, which
    // writes to stdout — both observe every request, neither duplicates the other.
    //
    // The tail is excluded from its own sink. It is one long-lived request whose
    // recorded duration would be the time until the client disconnected, and it
    // is already subscribed by the time this line runs — so the first thing every
    // reader would see is itself connecting.
    app.use(`${basePath}/*`, logMiddleware({ basePath, ignorePaths: [`${basePath}/logs/stream`] }));

    return {
        exemptFromBodyLimit: (path) => {
            carriesOwnBodyLimit.add(path);
        }
    };
}
