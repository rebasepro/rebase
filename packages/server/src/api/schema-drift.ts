import type { MiddlewareHandler } from "hono";
import { SCHEMA_VERSION_HEADER } from "@rebasepro/types";
import type { HonoEnv } from "./types";

/**
 * What a request said about the schema it was built against, and what this
 * server's schema actually is.
 *
 * Both stamps, always — "your SDK is stale" is not actionable without the two
 * numbers to compare and quote.
 */
export interface SchemaDrift {
    /** The stamp the caller's generated SDK carries. */
    client: string;
    /** The stamp this backend's collections hash to. */
    server: string;
}

/**
 * Notice that a caller was generated against an older schema than this one.
 *
 * The header has been documented for a while — "echoed by a generated SDK in
 * the `x-rebase-schema` header … so the platform can say 'this app was built
 * against an older schema' instead of failing mysteriously at the first
 * request" — and the sender became real when `generate-sdk` started emitting
 * `schema.meta.ts`. Nothing read it. A renamed column therefore answered a
 * generated client with a bare 400 naming a field the client's own types say
 * exists, which is the exact confusion the header was introduced to prevent.
 *
 * This does not refuse anything. Drift is *not* an error: an SDK a schema older
 * than the server's is usually still perfectly compatible — nothing it knows
 * about was touched — and a middleware that rejected on a version mismatch
 * would break every deploy where the backend ships before the frontend. So it
 * only records the fact, and the error handler attaches it as the cause of a
 * 400 or 404 that would have been returned anyway. A request that succeeds
 * never learns it was stale.
 *
 * `resolveServerVersion` is a thunk, called at most once: computing a stamp
 * walks and canonicalizes every collection, and a project whose bundle recorded
 * one at build time (all of them but `baas`) answers without computing at all.
 */
export function createSchemaDriftDetector(
    resolveServerVersion: () => string | undefined
): MiddlewareHandler<HonoEnv> {
    let serverVersion: string | undefined;
    let resolved = false;

    return async (c, next) => {
        const declared = c.req.header(SCHEMA_VERSION_HEADER);
        if (declared) {
            if (!resolved) {
                serverVersion = resolveServerVersion();
                resolved = true;
            }
            if (serverVersion && serverVersion !== declared) {
                c.set("schemaDrift", { client: declared,
server: serverVersion });
            }
        }
        await next();
    };
}

/*
 * `schemaDriftCause`, which turns one of these into the error cause, lives in
 * `errors.ts` rather than here. This module value-imports `@rebasepro/types`
 * for the header name, and `errors.ts` is in the graph of
 * `@rebasepro/server/functions` — the entry point that must load on a runtime
 * with no Node built-ins. See `functions/portability.test.ts`, which is what
 * says so.
 */
