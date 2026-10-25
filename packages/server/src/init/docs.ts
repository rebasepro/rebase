import { Hono, type MiddlewareHandler } from "hono";
import { CollectionConfig } from "@rebasepro/types";
import { HonoEnv } from "../api/types";
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

export interface OpenApiDocsOptions {
    enableSwagger: boolean | undefined;
    /**
     * The collections the REST routes were generated from — the ones whose
     * data source has a `"server"` transport — not every active collection. A
     * direct-transport collection is served by the client against its own
     * backend; documenting it here publishes a full set of CRUD paths that
     * 404, with a Try-It button next to each.
     */
    serverCollections: CollectionConfig[];
    requireAuth: boolean;
    /** The runtime's admin gate — the middlewares every admin surface sits behind — for the spec when it is not public. */
    adminGate: MiddlewareHandler<HonoEnv>[];
    /** The document builder. Only read when there are collections to document. */
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
    const { enableSwagger, serverCollections, requireAuth, adminGate, generate, unprotectedTables = [] } = options;
    if (serverCollections.length === 0) {
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
                message: "This project serves no collections yet, so there is no API to document. " +
                    noCollectionsCause(unprotectedTables),
                code: "NO_COLLECTIONS"
            }
        }, 404);
        app.get(`${basePath}/docs`, explain);
        app.get(`${basePath}/swagger`, explain);
        return;
    }

    // `false` means "do not publish this", not "do not have it".
    //
    // `resolveEnableSwagger` returns false in production whenever
    // REBASE_ENABLE_SWAGGER is unset, which is every managed tenant — so this
    // used to return early and the route did not exist at all. Rebase Cloud's
    // console has an API Explorer tab that fetches exactly this path, and it
    // therefore answered 404 for every project on the platform, permanently,
    // with no way for the operator to tell that from a project that had no API.
    //
    // A spec is a description of routes the caller can already discover by
    // reading their own collections, so the risk of publishing it is small —
    // but it is not zero, and it was a deliberate decision to keep it off the
    // public surface. Both things are satisfied by serving it to a caller who
    // proves they are an admin of this project, which is precisely who the
    // console is asking on behalf of.
    const isPublic = enableSwagger !== false;

    if (!generate) {
        throw new Error("mountOpenApiDocs: collections to document, and no document builder — pass `generate` (`await loadOpenApiGenerator()`).");
    }
    const generateSpec = generate;

    /**
     * The document, generated and encoded on the first request and served
     * as those bytes after: generating it took 39 ms of CPU and a 10.8 MB
     * string at 200 collections, per request, on a route that is public
     * whenever Swagger is on.
     *
     * Key: this mount — `serverCollections`, `basePath`, `requireAuth`. The
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
        serialized ??= new TextEncoder().encode(JSON.stringify(generateSpec(serverCollections, { basePath, requireAuth })));
        return c.body(serialized, 200, { "Content-Type": "application/json" });
    };


    if (isPublic) {
        app.get(`${basePath}/docs`, (c) => spec(c));
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
