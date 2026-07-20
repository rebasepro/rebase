import { VectorSearchParams, LogicalCondition, FilterValues } from "@rebasepro/types";
import type { AuthResult } from "../auth/middleware";
import { DataDriver } from "@rebasepro/types";
import type { ApiKeyMasked } from "../auth/api-keys/api-key-types";

/**
 * Hono Environment Variables
 * Passed to generic Hono<HonoEnv> to type `c.get()`
 */
export type HonoEnv = {
    Variables: {
        user?: AuthResult | { userId?: string, roles?: string[] };
        driver?: DataDriver;
        /** Set when the request is authenticated via a Service API Key. */
        apiKey?: ApiKeyMasked;
        /** Unique request correlation ID (generated or propagated from X-Request-ID header). */
        requestId?: string;
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
