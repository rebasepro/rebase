import { Hono } from "hono";
import { CollectionConfig } from "@rebasepro/types";
import { HonoEnv } from "../api/types";
import { logger } from "../utils/logger";

export async function mountOpenApiDocs(
    app: Hono<HonoEnv>,
    basePath: string,
    enableSwagger: boolean | undefined,
    activeCollections: CollectionConfig[],
    requireAuth: boolean
): Promise<void> {
    if (enableSwagger === false || activeCollections.length === 0) {
        return;
    }

    const { generateOpenApiSpec } = await import("../api/openapi-generator");

    app.get(`${basePath}/docs`, (c) => {
        const spec = generateOpenApiSpec(activeCollections, {
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
