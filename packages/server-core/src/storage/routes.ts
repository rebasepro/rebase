/**
 * Storage REST API routes using Hono
 */

import { Hono } from "hono";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { StorageController } from "./types";
import { LocalStorageController } from "./LocalStorageController";
import { requireAuth as jwtRequireAuth, optionalAuth } from "../auth/middleware";
import { ApiError, errorHandler } from "../api/errors";
import { HonoEnv } from "../api/types";
import { parseTransformOptions, transformImage, isTransformableImage, TransformCache } from "./image-transform";
import { TusHandler } from "./tus-handler";

/** Shared image transform cache (LRU, 500 entries, 1 hour TTL). */
const transformCache = new TransformCache();

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
 * Sanitize a user-supplied storage key to prevent path traversal and other attacks.
 * Removes null bytes, ../ sequences, leading slashes, and limits length.
 */
function sanitizeStorageKey(key: string): string {
    let sanitized = key;
    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, "");
    // Remove ../ sequences (and ..\ on Windows)
    sanitized = sanitized.replace(/\.\.\/|\.\.\\/g, "");
    // Remove leading slashes
    sanitized = sanitized.replace(/^\/+/, "");
    // Limit length
    sanitized = sanitized.slice(0, 1024);
    return sanitized;
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

        const finalKey = sanitizeStorageKey(key || uploadedFile.name || "unnamed");

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
        // Allow cross-origin loading so admin frontends on different
        // ports (dev) or domains (CDN) can render images via <img>.
        c.header("Cross-Origin-Resource-Policy", "cross-origin");

        const rawPath = extractWildcardPath(c);
        if (!rawPath) {
            throw ApiError.notFound("File not found");
        }

        const filePath = decodeURIComponent(rawPath);

        // Parse image transform query params (e.g. ?width=300&format=webp)
        const transformOpts = parseTransformOptions(c.req.query() as Record<string, string>);

        // For local storage, serve the file directly from disk
        if (controller.getType() === "local") {
            const localController = controller as LocalStorageController;
            const { bucket, resolvedPath } = parseBucketAndPath(filePath);

            const absolutePath = localController.getAbsolutePath(resolvedPath, bucket);

            // Check if file exists
            try {
                await fsp.access(absolutePath);
            } catch {
                throw ApiError.notFound("File not found");
            }

            // Get content type from metadata or infer from extension
            let contentType = "application/octet-stream";
            const metadataPath = `${absolutePath}.metadata.json`;
            try {
                const metadataRaw = await fsp.readFile(metadataPath, "utf-8");
                const metadata = JSON.parse(metadataRaw);
                contentType = metadata.contentType || contentType;
            } catch {
                // Ignore metadata errors (file may not exist)
            }

            const fileContent = await fsp.readFile(absolutePath);

            // Apply image transforms if requested and the file is a transformable image
            if (transformOpts && isTransformableImage(contentType)) {
                const cacheKey = transformCache.buildKey(filePath, transformOpts);
                let cached = transformCache.get(cacheKey);
                if (!cached) {
                    cached = await transformImage(Buffer.from(fileContent), transformOpts);
                    transformCache.set(cacheKey, cached.data, cached.contentType);
                }
                c.header("Content-Type", cached.contentType);
                c.header("Cache-Control", "public, max-age=31536000, immutable");
                return c.body(new Uint8Array(cached.data));
            }

            c.header("Content-Type", contentType);
            return c.body(new Uint8Array(fileContent));
        }

        // For remote storage (S3, GCS, etc.), proxy the file through the backend.
        // We avoid redirecting to signed URLs because:
        //  1. Mixed-content (HTTPS page → HTTP MinIO) is blocked by browsers
        //  2. Internal IPs / VPC endpoints are unreachable from the browser
        const { bucket: parsedBucket, resolvedPath: parsedPath } = parseBucketAndPath(filePath);
        const fileObject = await controller.getObject(parsedPath, parsedBucket);
        if (!fileObject) {
            throw ApiError.notFound("File not found");
        }

        const remoteContentType = fileObject.type || "application/octet-stream";

        // Apply image transforms for remote storage too
        if (transformOpts && isTransformableImage(remoteContentType)) {
            const cacheKey = transformCache.buildKey(filePath, transformOpts);
            let cached = transformCache.get(cacheKey);
            if (!cached) {
                const buf = Buffer.from(await fileObject.arrayBuffer());
                cached = await transformImage(buf, transformOpts);
                transformCache.set(cacheKey, cached.data, cached.contentType);
            }
            c.header("Content-Type", cached.contentType);
            c.header("Cache-Control", "public, max-age=31536000, immutable");
            return c.body(new Uint8Array(cached.data));
        }

        c.header("Content-Type", remoteContentType);
        c.header("Cache-Control", "public, max-age=3600, immutable");
        const buf = await fileObject.arrayBuffer();
        return c.body(new Uint8Array(buf));
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
                bucket: bucket ?? (controller.getType() === "local" ? "default" : undefined),
                maxResults: maxResults ? parseInt(maxResults, 10) : undefined,
                pageToken
            }
        );

        return c.json({
            success: true,
            data: result
        });
    });

    /**
     * POST /folder - Create a new folder
     * Body: { path: string, bucket?: string }
     */
    router.post("/folder", writeAuthMiddleware, async (c) => {
        const body = await c.req.json();
        const folderPath = body.path;

        if (!folderPath || typeof folderPath !== "string") {
            throw ApiError.badRequest("Folder path is required");
        }

        const { bucket, resolvedPath } = parseBucketAndPath(folderPath);

        if (!resolvedPath || resolvedPath.trim() === "") {
            throw ApiError.badRequest("Invalid folder path");
        }

        if (controller.getType() === "local") {
            // For local storage, create the directory
            const localController = controller as LocalStorageController;
            const absolutePath = localController.getAbsolutePath(resolvedPath, bucket);
            fs.mkdirSync(absolutePath, { recursive: true });
        } else {
            // For S3-compatible storage, create a zero-byte marker object with trailing slash
            const key = resolvedPath.endsWith("/") ? resolvedPath : resolvedPath + "/";
            const emptyFile = new File([], key, { type: "application/x-directory" });
            await controller.putObject({
                file: emptyFile,
                key
            });
        }

        return c.json({
            success: true,
            message: "Folder created"
        }, 201);
    });

    // -----------------------------------------------------------------------
    // TUS Resumable Uploads
    // -----------------------------------------------------------------------

    const tusBaseDir = controller.getType() === "local"
        ? (controller as LocalStorageController).getBasePath()
        : (process.env.STORAGE_PATH || "./uploads");
    const tusHandler = new TusHandler(tusBaseDir, controller);
    tusHandler.startCleanup();

    router.options("/tus", (_c) => tusHandler.options());
    router.post("/tus", writeAuthMiddleware, async (c) => tusHandler.create(c));
    router.get("/tus/:id", readAuthMiddleware, (c) => tusHandler.head(c, c.req.param("id")));
    router.patch("/tus/:id", writeAuthMiddleware, async (c) => tusHandler.patch(c, c.req.param("id")));
    router.delete("/tus/:id", writeAuthMiddleware, async (c) => tusHandler.delete(c, c.req.param("id")));

    return router;
}
