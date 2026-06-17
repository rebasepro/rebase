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
 * import { requestId } from "@rebasepro/server-core";
 * app.use("/*", requestId());
 * ```
 */
import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../api/types";

export const REQUEST_ID_HEADER = "X-Request-ID";

export function requestId(): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        const incoming = c.req.header(REQUEST_ID_HEADER);
        const id = incoming && incoming.length > 0 ? incoming : randomUUID();

        c.set("requestId", id);

        await next();

        c.header(REQUEST_ID_HEADER, id);
    };
}
