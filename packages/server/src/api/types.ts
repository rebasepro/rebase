// Every import here is `import type`, and that is enforced rather than
// stylistic: this module is the `HonoEnv` a custom function imports, so it is
// in the graph of `@rebasepro/server/functions` — the surface that must bundle
// for a runtime with no Node built-ins. A value import of `@rebasepro/types`
// would drag that package's whole runtime graph into an edge bundle for the
// sake of two interfaces. See `functions/portability.test.ts`.
import type { VectorSearchParams, LogicalCondition, FilterValues, DataDriver } from "@rebasepro/types";
import type { AuthResult } from "../auth/middleware";
import type { ApiKeyMasked } from "../auth/api-keys/api-key-types";

/**
 * Hono Environment Variables
 * Passed to generic Hono<HonoEnv> to type `c.get()`
 */
export type HonoEnv = {
    Variables: {
        user?: AuthResult | { uid?: string, roles?: string[] };
        /**
         * The address a one-time-code request named, lower-cased.
         *
         * Stashed by a middleware so the per-address verification limiter has
         * something to key on: the limiter runs before the handler that parses
         * the body, and without this it would key every attempt into one global
         * bucket — a limiter in name only. See `auth/otp-routes.ts`.
         */
        otpEmail?: string;
        /**
         * The address a mail-sending auth route named, lower-cased.
         *
         * The generalisation of `otpEmail`, for the same reason and used the
         * same way: `recipientEmailLimiter` bounds how many messages one
         * MAILBOX receives, and the address it keys on lives in a body the
         * limiter runs before anyone has parsed. See `auth/rate-limiter.ts`.
         */
        recipientEmail?: string;
        driver?: DataDriver;
        /** Set when the request is authenticated via a Service API Key. */
        apiKey?: ApiKeyMasked;
        /** Unique request correlation ID (generated or propagated from X-Request-ID header). */
        requestId?: string;
        /**
         * The collection this request is about, when it is about one.
         *
         * Set by the REST generator from the first path segment, validated
         * against the collections it actually serves — so it is a slug this
         * backend knows, not whatever the caller typed. Read by the request
         * logger: "a 403 on /api/data/orders" and "a 403" are different amounts
         * of help at 3am, and the path alone does not survive being aggregated.
         */
        collection?: string;
        /**
         * What the error handler answered, for the request log line.
         *
         * The handler and the request logger both wrote a line for the same
         * failed request, each holding half of it: the handler had the code and
         * the message, the logger had the user and the latency. Neither was
         * enough, and two lines per failure is its own cost. The handler now
         * leaves what it knows here and stays quiet where the logger will
         * speak. See `utils/request-logger.ts`.
         */
        errorSummary?: { code: string; message: string };
        /**
         * Set by `requestLogger` before the handler runs, so the error handler
         * can tell whether one line per request is already guaranteed.
         *
         * A router mounted without the request logger — a project wiring routes
         * onto its own Hono app — still gets the handler's own line, because
         * there nothing else would report the failure at all.
         */
        requestLogged?: boolean;
    }
};

/**
 * Standard API response format
 */
export interface ApiResponse<T = unknown> {
    data?: T;
    error?: {
        message: string;
        code?: string;
        details?: unknown;
    };
    meta?: {
        total?: number;
        page?: number;
        limit?: number;
        hasMore?: boolean;
    };
}

/**
 * Query options for API endpoints
 */
export interface QueryOptions {
    limit?: number;
    offset?: number;
    where?: FilterValues<string>;
    logical?: LogicalCondition;
    orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;
    include?: string[];
    /** Columns to return in the response (field-level selection) */
    fields?: string[];
    /** Vector similarity search configuration */
    vectorSearch?: VectorSearchParams;
}
