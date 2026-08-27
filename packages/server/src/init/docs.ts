import { Hono } from "hono";
import { CollectionConfig } from "@rebasepro/types";
import { HonoEnv } from "../api/types";
import { logger } from "../utils/logger";
import { createRequireAuth } from "../auth/middleware";
import { requireAdmin } from "../auth";

/** Bound once the generator is imported; the route closes over it. */
let generateOpenApiSpecFn: typeof import("../api/openapi-generator").generateOpenApiSpec | null = null;

/**
 * Serve the OpenAPI document, and Swagger UI outside production.
 *
 * `serverCollections` must be the collections the REST routes were generated
 * from — the ones whose data source has a `"server"` transport — not every
 * active collection. A direct-transport collection is served by the client
 * against its own backend; documenting it here publishes a full set of CRUD
 * paths that 404, with a Try-It button next to each.
 */
export async function mountOpenApiDocs(
    app: Hono<HonoEnv>,
    basePath: string,
    enableSwagger: boolean | undefined,
    serverCollections: CollectionConfig[],
    requireAuth: boolean
): Promise<void> {
    if (serverCollections.length === 0) {
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

    const spec = (c: { json: (v: unknown) => Response }) =>
        c.json(generateOpenApiSpecFn!(serverCollections, { basePath, requireAuth }));

    const { generateOpenApiSpec } = await import("../api/openapi-generator");
    generateOpenApiSpecFn = generateOpenApiSpec;

    if (isPublic) {
        app.get(`${basePath}/docs`, (c) => spec(c));
    } else {
        // The same two middlewares every other admin surface uses, so "admin"
        // means one thing across the runtime.
        app.get(`${basePath}/docs`, createRequireAuth({}), requireAdmin, (c) => spec(c));
    }

    if (process.env.NODE_ENV !== "production") {
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
        logger.info("Swagger UI available", { path: `${basePath}/swagger` });
    }
}
