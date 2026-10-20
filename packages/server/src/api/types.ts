// Every import here is `import type`, and that is enforced rather than
// stylistic: this module is the `HonoEnv` a custom function imports, so it is
// in the graph of `@rebasepro/server/functions` — the surface that must bundle
// for a runtime with no Node built-ins. A value import of `@rebasepro/types`
// would drag that package's whole runtime graph into an edge bundle for the
// sake of two interfaces. See `functions/portability.test.ts`.
import type { VectorSearchParams, IncludeSpec, LogicalCondition, FilterValues, NullsPlacement, DataDriver } from "@rebasepro/types";
import type { DecodedCursor } from "@rebasepro/common";
import type { AuthResult } from "../auth/middleware";
import type { ApiKeyMasked } from "../auth/api-keys/api-key-types";
import type { BackendServices } from "../backend/services";

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
        /** Set when the request is authenticated with an API key (`rk_`). */
        apiKey?: ApiKeyMasked;
        /**
         * What the caller may do, when its credential is narrower than its
         * person — an API key or an MCP token. Absent for a person's own
         * session, who holds what their roles hold. Read it through
         * `callerScopes` / `hasScope`, which fill in that second case.
         */
        scopes?: string[];
        /**
         * Who asked, when an administrator's request runs as another user
         * (`x-rebase-impersonate`). `user` and `driver` are then the
         * impersonated user's; this is the only place the administrator
         * remains. See `auth/impersonation.ts`.
         */
        impersonator?: { uid: string };
        /**
         * What an administrator's simulated request runs as (the RLS
         * simulator's `x-rebase-simulate-*` headers): the role label, the uid,
         * the roles, and the key when one was named. Read after the request by
         * `reportSimulatedContext`. See `auth/simulation.ts`.
         */
        simulation?: { role: string; sub: string; roles: string[]; apiKeyId?: string };
        /** Unique request correlation ID (generated or propagated from X-Request-ID header). */
        requestId?: string;
        /**
         * Aborted when a custom function's request outlasts its timeout and is
         * answered 504. Read it with `getSignal(c)` from
         * `@rebasepro/server/functions`. See `functions/request-timeout.ts`.
         */
        functionSignal?: AbortSignal;
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
        errorSummary?: { code: string; message: string; expected?: boolean };
        /**
         * Set by `requestLogger` before the handler runs, so the error handler
         * can tell whether one line per request is already guaranteed.
         *
         * A router mounted without the request logger — a project wiring routes
         * onto its own Hono app — still gets the handler's own line, because
         * there nothing else would report the failure at all.
         */
        requestLogged?: boolean;
        /**
         * The caller's `x-rebase-schema` stamp and this server's, when they
         * disagree.
         *
         * Set by `createSchemaDriftDetector` and read only by the error handler,
         * which attaches it as the cause of a 400 or 404 the request would have
         * produced anyway. Never a reason to refuse: an SDK generated against an
         * older schema is usually still compatible.
         */
        schemaDrift?: { client: string; server: string };
        /**
         * Where the route group answering this request is mounted, e.g.
         * `/api/data` or `/api/functions` — wherever the application put it.
         *
         * Set by the group's first middleware from the request itself, so a
         * group mounted at a path of the caller's choosing still knows which
         * collection a path names and which URL a function answers at. See
         * `api/mount-path.ts`.
         */
        mountPath?: string;
        /**
         * The backend answering this request: its JWT keys, access model,
         * API-key store and rate limiters.
         *
         * Set by the first middleware of every route group a backend builds,
         * so a group verifies tokens and checks scopes against its own
         * backend wherever it is mounted, and two backends mounted on one app
         * stay two. Absent on a route mounted outside any backend, where the
         * helpers that read it (`requireScope`, `callerScopes`, `requireAuth`,
         * …) answer for the process default. Set it yourself to make such a
         * route answer for a backend: `c.set("services", backend.services)`.
         */
        services?: BackendServices;
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
    orderBy?: Array<{ field: string; direction: "asc" | "desc"; nulls?: NullsPlacement }>;
    /**
     * Relations to load — names, dotted paths, or the parametrised tree.
     * See {@link IncludeSpec}.
     */
    include?: IncludeSpec;
    /**
     * Columns to return. A projection pushed into the SELECT, not a trim of
     * the response — see `FindParams.fields`.
     */
    fields?: string[];
    /** `SELECT DISTINCT` over the projection. */
    distinct?: boolean;
    /**
     * The decoded `?after=` cursor, and the sort it was produced under.
     *
     * Decoded at the parser rather than at the route so a malformed cursor is
     * one 400 in one place, and so the `orderBy` a cursor implies is settled
     * before any route reads it.
     */
    cursor?: DecodedCursor;
    /** Vector similarity search configuration */
    vectorSearch?: VectorSearchParams;
    /**
     * From `?deleted=include|only`. See `FetchCollectionProps.withDeleted` —
     * unset hides the rows a soft delete has stamped, which is the default and
     * the point of the feature.
     */
    withDeleted?: boolean | "only";
    /**
     * From `?count=exact|none` — whether a listing counts `meta.total`. See
     * `FindParams.count`. Unset is `"exact"`.
     */
    count?: "exact" | "none";
}
