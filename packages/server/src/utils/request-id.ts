/**
 * X-Request-ID Middleware for Hono.
 *
 * Generates a unique request identifier (UUID v4) for every inbound
 * request, or propagates an existing `X-Request-ID` header from the
 * caller. The ID is:
 *
 * 1. Stored in the Hono context (`c.get("requestId")`)
 * 2. Echoed back on the response as `X-Request-ID`
 *
 * Downstream middleware and handlers (request logger, error handler,
 * etc.) read the ID from context to include it in log entries and
 * error responses, enabling end-to-end request tracing across services.
 *
 * @example
 * ```ts
 * import { requestId } from "@rebasepro/server";
 * app.use("/*", requestId());
 * ```
 */
import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../api/types";

export const REQUEST_ID_HEADER = "X-Request-ID";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestId(): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        const incoming = c.req.header(REQUEST_ID_HEADER);
        // `crypto` is a global on every runtime this could run on, Node
        // included since 20 — `node:crypto` bought nothing here except an
        // import that only resolves in one of them.
        const id = incoming && UUID_RE.test(incoming) ? incoming : crypto.randomUUID();

        c.set("requestId", id);

        await next();

        c.header(REQUEST_ID_HEADER, id);
    };
}
