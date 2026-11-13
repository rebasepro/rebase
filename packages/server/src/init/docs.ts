import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { TableDescriptor } from "@rebasepro/types";
import { HonoEnv } from "../api/types";
import { ApiError } from "../api/errors";
import { schemaViewFor, schemaViewKey, serializeTables, type SchemaTablesPersons, type SchemaView } from "../api/schema-tables";
import { schemaCallerOf } from "../api/schema-tables-routes";
import { logger } from "../utils/logger";
import { noCollectionsCause } from "../backend/no-collections";

/** The OpenAPI document builder, loaded on demand — see {@link loadOpenApiGenerator}. */
export type OpenApiGenerator = typeof import("../api/openapi-generator").generateOpenApiSpec;

/**
 * Load the document builder. Separate from mounting so the mount is
 * synchronous: a backend loads it once while it is built, and mounts the
 * routes wherever and as often as the application asks.
 */
export async function loadOpenApiGenerator(): Promise<OpenApiGenerator> {
    const { generateOpenApiSpec } = await import("../api/openapi-generator");
    return generateOpenApiSpec;
}

/**
 * Who the OpenAPI document is served to by default: the callers
 * `GET /schema/tables` describes the tables to, each described the same
 * tables, columns and relations (see `api/schema-tables`).
 */
export interface OpenApiDocsAudience {
    /** Identify the caller, as the schema endpoint does: no credential passes through as anonymous. */
    authenticate: MiddlewareHandler<HonoEnv>[];
    /** `false` when no authentication is configured: there is no caller to describe the tables to. */
    available: boolean;
    /** `schemaTables.public`: anonymous callers are described the tables with a public `select` rule. */
    publicTables?: boolean;
    /** `schemaTables.persons`. */
    persons?: SchemaTablesPersons;
}

export interface OpenApiDocsOptions {
    /**
     * `true` publishes the whole document to everyone (and the Swagger UI
     * outside production) — the explicit opt-in. `false` serves it behind the
     * admin gate. Unset — the default — serves it as `audience` says: to the
     * callers the schema endpoint describes the tables to, each the document
     * of the tables they are described; behind the admin gate when no
     * `audience` is given.
     */
    enableSwagger: boolean | undefined;
    /** Who the document is served to when `enableSwagger` is unset. */
    audience?: OpenApiDocsAudience;
    /**
     * The descriptors of the tables the REST routes serve, in route order.
     * Only those: documenting a table the routes do not serve publishes a full
     * set of CRUD paths that 404, with a Try-It button next to each.
     */
    serverTables: readonly TableDescriptor[];
    requireAuth: boolean;
    /** The runtime's admin gate — the middlewares every admin surface sits behind — for the spec when it is not public. */
    adminGate: MiddlewareHandler<HonoEnv>[];
    /** The document builder. Only read when there are tables to document. */
    generate: OpenApiGenerator | undefined;
    /** Whether to log where Swagger UI is. Default `true`. */
    announce?: boolean;
    /**
     * Tables the driver skipped for having row-level security disabled, which
     * the answer names when there are no collections to document.
     */
    unprotectedTables?: readonly { schema: string; table: string }[];
}

/**
 * Serve the OpenAPI document, and Swagger UI outside production when swagger is on.
 */
export function mountOpenApiDocs(app: Hono<HonoEnv>, basePath: string, options: OpenApiDocsOptions): void {
    const { enableSwagger, serverTables, requireAuth, adminGate, generate, audience, unprotectedTables = [] } = options;
    if (serverTables.length === 0) {
        // Still routed, and still a 404 — but one that says which 404 it is.
        //
        // A bare `404 Not Found` here is indistinguishable from a wrong URL, a
        // broken install, or a server that is not running, and the generated
        // headless README sends every new project straight at this path. The
        // dev banner already explains it ("no tables served yet, so no data API
        // and no docs"); this is the same sentence for anyone who arrives by
        // URL instead, and the same code and remedy `/api/data` answers with,
        // so the two surfaces cannot start disagreeing about why.
        const explain = (c: { json: (v: unknown, s: number) => Response }) => c.json({
            error: {
                message: "This project serves no tables yet, so there is no API to document. " +
                    noCollectionsCause(unprotectedTables),
                code: "NO_TABLES"
            }
        }, 404);
        app.get(`${basePath}/docs`, explain);
        app.get(`${basePath}/swagger`, explain);
        return;
    }

    // Who reads the document. It lists every served table, its columns, their
    // descriptions and enum values: what `GET /schema/tables` withholds from a
    // caller it does not describe a table to. So by default it is served to
    // the same callers, each the document of the tables that endpoint
    // describes to them (an administrator — Rebase Cloud's API Explorer — the
    // whole of it). Publishing it to everyone is the explicit
    // `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`); `false` keeps it
    // behind the admin gate. It is always ROUTED: a 404 would read as a
    // project with no API.
    const isPublic = enableSwagger === true;

    if (!generate) {
        throw new Error("mountOpenApiDocs: tables to document, and no document builder — pass `generate` (`await loadOpenApiGenerator()`).");
    }
    const generateSpec = generate;

    /**
     * The document, generated and encoded on the first request and served
     * as those bytes after: generating it took 39 ms of CPU and a 10.8 MB
     * string at 200 collections, per request, on a route that is public
     * whenever Swagger is on.
     *
     * Key: this mount — `serverTables`, `basePath`, `requireAuth`. The
     * document says nothing about the caller, so one copy serves every
     * request; whether a caller may read it is still the gate's question,
     * asked per request. Invalidation: none within the mount, because nothing
     * changes what it was given — every request already read the collections
     * the server booted with, and a live schema edit builds new collection
     * objects (copy-on-write, `applyCollectionPatch`) that reach `/api/docs`
     * through the restart that mounts it again.
     */
    let serialized: Uint8Array<ArrayBuffer> | undefined;
    const spec = (c: { body: (data: Uint8Array<ArrayBuffer>, status: 200, headers: Record<string, string>) => Response }) => {
        serialized ??= new TextEncoder().encode(JSON.stringify(generateSpec(serverTables, { basePath, requireAuth })));
        return c.body(serialized, 200, { "Content-Type": "application/json" });
    };

    if (isPublic) {
        app.get(`${basePath}/docs`, (c) => spec(c));
    } else if (enableSwagger === undefined && audience) {
        mountAudienceDocs(app, basePath, audience, (tables) => generateSpec(tables, { basePath, requireAuth }), serverTables);
    } else {
        // The gate every other admin surface sits behind, so "admin" means
        // one thing across the runtime — including that it is read from the
        // database: a demoted admin, or one who signed out everywhere, is not
        // one for the rest of their token's hour.
        app.use(`${basePath}/docs`, ...adminGate);
        app.get(`${basePath}/docs`, (c) => spec(c));
    }

    // The UI only where the spec is public, and never in production: it
    // loads scripts from a CDN. Off, the explorer is off everywhere — a UI
    // left up in development fetched a spec only an admin could read.
    if (isPublic && process.env.NODE_ENV !== "production") {
        app.get(`${basePath}/swagger`, (c) => {
            return c.html(`<!DOCTYPE html>
<html>
<head>
    <title>Rebase API Documentation</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
    <style>body{margin:0;padding:0;}</style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>SwaggerUIBundle({ url: '${basePath}/docs', dom_id: '#swagger-ui' });</script>
</body>
</html>`);
        });
        if (options.announce !== false) logger.info("Swagger UI available", { path: `${basePath}/swagger` });
    }
}

/** Distinct views whose document is cached; more than this and the cache starts over. */
const MAX_CACHED_DOCUMENTS = 64;

/**
 * `GET {basePath}/docs` for the schema endpoint's audience: the caller is
 * identified as `GET /schema/tables` identifies it, refused as it refuses
 * (401 anonymous unless `schemaTables.public`, 403 for a credential with no
 * schema or data scope, 404 without authentication), and served the document
 * of exactly the tables, columns and relations that endpoint describes to it.
 * One document per view, cached: two callers with the same view get the same
 * bytes.
 */
function mountAudienceDocs(
    app: Hono<HonoEnv>,
    basePath: string,
    audience: OpenApiDocsAudience,
    generate: (tables: readonly TableDescriptor[]) => unknown,
    serverTables: readonly TableDescriptor[]
): void {
    if (!audience.available) {
        app.get(`${basePath}/docs`, (c) => c.json({
            error: {
                code: "DOCS_UNAVAILABLE",
                message: "The API document is served to the callers GET /schema/tables describes the tables to, and no " +
                    "authentication is configured, so there is none. Configure auth, or publish the document to " +
                    "everyone with `enableSwagger: true` (REBASE_ENABLE_SWAGGER=true)."
            }
        }, 404));
        return;
    }
    const documents = new Map<string, Uint8Array<ArrayBuffer>>();
    const viewOf = (c: Context<HonoEnv>): SchemaView => {
        const caller = schemaCallerOf(c);
        if (caller.kind === "anonymous" && !audience.publicTables) {
            throw ApiError.unauthenticated("Authentication required: the API document describes the tables to signed-in callers and credentials only.");
        }
        const view = schemaViewFor(caller, { persons: audience.persons ?? "granted" });
        if ("refused" in view) throw new ApiError(403, "SCOPE_MISSING", view.message, { requiredScope: "schema:read" });
        return view;
    };
    app.use(`${basePath}/docs`, ...audience.authenticate);
    app.get(`${basePath}/docs`, (c) => {
        const view = viewOf(c);
        const key = schemaViewKey(view);
        let document = documents.get(key);
        if (!document) {
            document = new TextEncoder().encode(JSON.stringify(generate(serializeTables(serverTables, view))));
            if (documents.size >= MAX_CACHED_DOCUMENTS) documents.clear();
            documents.set(key, document);
        }
        return c.body(document, 200, {
            "Content-Type": "application/json",
            "Cache-Control": "private, no-cache",
            "Vary": "Authorization"
        });
    });
}
