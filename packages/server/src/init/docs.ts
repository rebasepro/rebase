import { Hono } from "hono";
import { CollectionConfig } from "@rebasepro/types";
import { HonoEnv } from "../api/types";
import { logger } from "../utils/logger";

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
    if (enableSwagger === false || serverCollections.length === 0) {
        return;
    }

    const { generateOpenApiSpec } = await import("../api/openapi-generator");

    app.get(`${basePath}/docs`, (c) => {
        const spec = generateOpenApiSpec(serverCollections, {
            basePath,
            requireAuth
        });
        return c.json(spec);
    });

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
