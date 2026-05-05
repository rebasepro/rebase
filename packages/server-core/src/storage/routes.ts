/**
 * Storage REST API routes using Hono
 */

import { Hono } from "hono";
import * as fs from "fs";
import { StorageController } from "./types";
import { LocalStorageController } from "./LocalStorageController";
import { requireAuth as jwtRequireAuth, optionalAuth } from "../auth/middleware";
import { ApiError, errorHandler } from "../api/errors";
import { HonoEnv } from "../api/types";

export interface StorageRoutesConfig {
    controller: StorageController;
    /** Base path for storage routes (default: '/api/storage') */
    basePath?: string;
    /** Require authentication for write operations (default: true) */
    requireAuth?: boolean;
    /** Allow unauthenticated read access to stored files (default: false).
     *  When false and requireAuth is true, reads also require authentication. */
    publicRead?: boolean;
}

/**
 * Extract the wildcard portion of a route path from the full request path.
 *
 * Hono's `c.req.param('*')` does not work reliably in sub-routers mounted
 * via `app.route(prefix, subRouter)`. Instead we derive the wildcard value
 * from the fully-resolved `c.req.path` and `c.req.routePath`.
 *
 * For a route `/metadata/*` mounted at `/api/storage`, a request to
 * `/api/storage/metadata/default/file.jpg` yields routePath
 * `/api/storage/metadata/*`.  We strip the prefix (everything before `/*`)
 * plus one character for the trailing `/` to obtain `default/file.jpg`.
 */
export function extractWildcardPath(c: { req: { path: string; routePath: string } }): string {
    const routePath = c.req.routePath; // e.g. "/api/storage/metadata/*"
    const prefix = routePath.replace("/*", ""); // e.g. "/api/storage/metadata"
    const fullPath = c.req.path; // e.g. "/api/storage/metadata/default/file.jpg"
    const idx = fullPath.indexOf(prefix);
    if (idx < 0) return "";
    // +1 to skip the '/' after the prefix
    return fullPath.substring(idx + prefix.length + 1);
}

/**
 * Create storage REST API routes
 */
export function createStorageRoutes(config: StorageRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    const { controller, requireAuth = true, publicRead = false } = config;

    // Use actual JWT auth middleware from auth module
    const writeAuthMiddleware = requireAuth ? jwtRequireAuth : optionalAuth;

    // For read operations: respect publicRead config.
    const readAuthMiddleware = (publicRead || !requireAuth) ? optionalAuth : jwtRequireAuth;

    /**
     * Parse bucket and path from a combined file path.
     */
    const parseBucketAndPath = (filePath: string): { bucket: string; resolvedPath: string } => {
        const parts = filePath.split("/");

        // Only recognize 'default' as an explicit bucket prefix
        if (parts.length > 1 && parts[0].toLowerCase() === "default") {
            return {
                bucket: "default",
                resolvedPath: parts.slice(1).join("/")
            };
        }

        // All other paths use 'default' bucket with the full path
        return {
            bucket: "default",
            resolvedPath: filePath
        };
    };

    /**
     * POST /upload - Upload a file
     * Body: multipart/form-data with 'file' field
     * Request body can also contain metadata keys 'metadata_*'
     */
    router.post("/upload", writeAuthMiddleware, async (c) => {
        const body = await c.req.parseBody();
        const uploadedFile = body["file"];

        if (!uploadedFile || typeof uploadedFile === "string") {
            throw ApiError.badRequest("No file provided");
        }

        const key = typeof body["key"] === "string" ? body["key"] : "";
        const bucket = typeof body["bucket"] === "string" ? body["bucket"] : undefined;

        // Backward compatibility support for older clients sending path and fileName
        const legacyPath = typeof body["path"] === "string" ? body["path"] : "";
        const legacyFileName = typeof body["fileName"] === "string" ? body["fileName"] : undefined;

        let finalKey = key;
        if (!finalKey) {
            if (legacyPath || legacyFileName) {
                const parts = [];
                if (legacyPath) parts.push(legacyPath);
                if (legacyFileName) {
                    parts.push(legacyFileName);
                } else {
                    parts.push(uploadedFile.name || "unnamed");
                }
                finalKey = parts.join("/");
            } else {
                finalKey = uploadedFile.name || "unnamed";
            }
        }

        // Extract custom metadata from request body
        const metadata: Record<string, unknown> = {};
        for (const [k, value] of Object.entries(body)) {
            if (k.startsWith("metadata_")) {
                metadata[k.replace("metadata_", "")] = value;
            }
        }

        const result = await controller.putObject({
            file: uploadedFile,
            key: finalKey,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
            bucket
        });

        return c.json({
            success: true,
            data: result
        }, 201);
    });

    /**
     * GET /file/* - Download/serve a file
     * Path: /file/{bucket}/{path} or /file/{path}
     */
    router.get("/file/*", readAuthMiddleware, async (c) => {
        const rawPath = extractWildcardPath(c);
        if (!rawPath) {
            throw ApiError.notFound("File not found");
        }

        const filePath = decodeURIComponent(rawPath);

        // For local storage, serve the file directly from disk
        if (controller.getType() === "local") {
            const localController = controller as LocalStorageController;
            const { bucket, resolvedPath } = parseBucketAndPath(filePath);

            const absolutePath = localController.getAbsolutePath(resolvedPath, bucket);

            // Check if file exists
            if (!fs.existsSync(absolutePath)) {
                throw ApiError.notFound("File not found");
            }

            // Get content type from metadata or infer from extension
            let contentType = "application/octet-stream";
            const metadataPath = `${absolutePath}.metadata.json`;
            if (fs.existsSync(metadataPath)) {
                try {
                    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
                    contentType = metadata.contentType || contentType;
                } catch {
                    // Ignore metadata errors
                }
            }

            c.header("Content-Type", contentType);
            // In a better scenario, we should pipe the stream instead of reading whole file
            const fileContent = fs.readFileSync(absolutePath);
            return c.body(new Uint8Array(fileContent));
        }

        // For remote storage (S3, GCS, etc.), redirect to a signed URL
        const downloadConfig = await controller.getSignedUrl(filePath);
        if (downloadConfig.fileNotFound || !downloadConfig.url) {
            throw ApiError.notFound("File not found");
        }

        return c.redirect(downloadConfig.url);
    });

    /**
     * GET /metadata/* - Get file metadata
     */
    router.get("/metadata/*", readAuthMiddleware, async (c) => {
        const rawPath = extractWildcardPath(c);
        if (!rawPath) {
            return c.json({
                success: true,
                data: null,
                fileNotFound: true
            }, 404);
        }

        const filePath = decodeURIComponent(rawPath);
        const { bucket, resolvedPath } = parseBucketAndPath(filePath);

        const downloadConfig = await controller.getSignedUrl(resolvedPath, bucket);

        if (downloadConfig.fileNotFound) {
            throw ApiError.notFound("File not found");
        }

        return c.json({
            success: true,
            data: downloadConfig.metadata
        });
    });

    /**
     * DELETE /file/* - Delete a file
     */
    router.delete("/file/*", writeAuthMiddleware, async (c) => {
        const rawPath = extractWildcardPath(c);
        if (!rawPath) {
            return c.json({ success: true,
message: "No file to delete" });
        }

        const filePath = decodeURIComponent(rawPath);
        const { bucket, resolvedPath } = parseBucketAndPath(filePath);

        await controller.deleteObject(resolvedPath, bucket);

        return c.json({
            success: true,
            message: "File deleted"
        });
    });

    /**
     * GET /list - List files in a path
     */
    router.get("/list", writeAuthMiddleware, async (c) => {
        // Fallback to path for backward compatibility
        const storagePrefix = c.req.query("prefix") || c.req.query("path") || "";
        const bucket = c.req.query("bucket");
        const maxResults = c.req.query("maxResults");
        const pageToken = c.req.query("pageToken");

        const result = await controller.listObjects(
            storagePrefix,
            {
                bucket,
                maxResults: maxResults ? parseInt(maxResults, 10) : undefined,
                pageToken
            }
        );

        return c.json({
            success: true,
            data: result
        });
    });

    return router;
}
