/**
 * Storage REST API routes using Hono
 *
 * Supports multi-backend routing via `StorageRegistry`. Each endpoint
 * accepts an optional `storageId` parameter (query string or form field)
 * to target a named storage backend. When omitted, the default backend
 * is used.
 */

import { Hono, type MiddlewareHandler } from "hono";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { StorageController, type StorageAuthorize, type StorageAuthorizeData, type StorageOperation } from "./types";
import { LocalStorageController } from "./LocalStorageController";
import type { StorageRegistry } from "./storage-registry";
import { DEFAULT_STORAGE_SOURCE_KEY, isPublicStoragePath, type StorageSourceDefinition, type AuthAdapter } from "@rebasepro/types";
import { requireAuth as jwtRequireAuth, optionalAuth as jwtOptionalAuth, queryTokenAuth, fileTokenAuth, publicObjectAuth } from "../auth/middleware";
import { generateDownloadToken } from "../auth";
import { ApiError, errorHandler } from "../api/errors";
import { HonoEnv } from "../api/types";
import { parseTransformOptions, transformImage, isTransformableImage, TransformCache } from "./image-transform";
import { TusHandler } from "./tus-handler";
import { canonicalStorageKey, InvalidStorageKeyError } from "./keys";

/** Shared image transform cache (LRU, 500 entries, 1 hour TTL). */
const transformCache = new TransformCache();

export interface StorageRoutesConfig {
    /**
     * Single storage controller (backward-compatible).
     * Used as fallback when no `registry` is provided.
     */
    controller?: StorageController;
    /**
     * Full storage registry for multi-backend routing.
     * When provided, endpoints resolve the controller from `storageId`
     * parameter. Takes precedence over `controller`.
     */
    registry?: StorageRegistry;
    /**
     * Declared storage sources, surfaced by `GET /sources` so the client can
     * bootstrap its registry. Carries the frontend `transport` (server vs
     * direct) and human-readable labels. Server-transport sources are also
     * derived from the registry; `direct` sources (e.g. Firebase Storage) only
     * exist here since the backend does not proxy them.
     */
    sources?: StorageSourceDefinition[];
    /** Base path for storage routes (default: '/api/storage') */
    basePath?: string;
    /** Require authentication for write operations (default: true) */
    requireAuth?: boolean;
    /** Allow unauthenticated read access to stored files (default: false).
     *  When false and requireAuth is true, reads also require authentication. */
    publicRead?: boolean;
    /**
     * When provided, storage routes delegate auth to this adapter instead
     * of the built-in JWT module. This mirrors how data routes use
     * `createAdapterAuthMiddleware()` and avoids the "JWT secret not
     * configured" crash when `configureJwt()` was never called.
     */
    authAdapter?: AuthAdapter;
    /**
     * Per-object access control, consulted after authentication on every
     * storage route. See `StorageAuthorize`.
     *
     * Omitted, storage behaves as before: authenticated means allowed.
     */
    authorize?: StorageAuthorize;
    /**
     * Trusted data access handed to {@link authorize} on every call.
     *
     * A function rather than a value because the admin data plane is built after
     * the storage routes are mounted; by the time a request runs it is always
     * resolved.
     */
    authorizeData?: () => StorageAuthorizeData | undefined;
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
 * Canonicalize a caller-supplied storage key, answering 400 when it names
 * something other than what it says.
 *
 * The single place a request's key becomes canonical. Every route runs its key
 * through this before anything else touches it, so the authorize hook, the
 * storage controller and the minted download token are all looking at the same
 * string — which is the only thing that makes the hook's answer meaningful.
 * See `keys.ts` for why an unacceptable key is refused rather than repaired.
 */
function canonicalKeyOrBadRequest(key: string): string {
    try {
        return canonicalStorageKey(key);
    } catch (err) {
        throw new ApiError(
            400,
            "INVALID_STORAGE_KEY",
            err instanceof InvalidStorageKeyError ? err.message : "Invalid storage key"
        );
    }
}

/**
 * Build adapter-aware auth middleware for storage routes.
 *
 * When an `AuthAdapter` is provided, token verification is delegated to the
 * adapter instead of the built-in JWT module. This mirrors how data routes
 * use `createAdapterAuthMiddleware()`, but without RLS driver scoping (storage
 * routes don't interact with the DataDriver).
 *
 * Returns both a "write" middleware (enforces auth when `requireAuth` is true)
 * and a "read" middleware (enforces auth unless `publicRead` is set).
 */
function buildAdapterAuthMiddleware(
    adapter: AuthAdapter,
    requireAuth: boolean,
    publicRead: boolean
): { writeAuthMiddleware: MiddlewareHandler<HonoEnv>; readAuthMiddleware: MiddlewareHandler<HonoEnv> } {
    /**
     * Core middleware: verifies the request via the adapter. When `enforce`
     * is true, returns 401 if no authenticated user is resolved.
     */
    const createMiddleware = (enforce: boolean): MiddlewareHandler<HonoEnv> => {
        return async (c, next) => {
            let authenticatedUser = null;
            try {
                authenticatedUser = await adapter.verifyRequest(c.req.raw);
            } catch {
                return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
            }

            if (authenticatedUser) {
                c.set("user", {
                    uid: authenticatedUser.uid,
                    email: authenticatedUser.email,
                    roles: authenticatedUser.roles
                });
            }

            // Respect a user already resolved by an upstream middleware
            // (e.g. `fileTokenAuth` for scoped `?token=` download tokens, or
            // `publicObjectAuth` for public paths). The adapter does not
            // understand these file-read tokens, so enforcing purely on
            // `authenticatedUser` would 401 an otherwise-valid file request.
            if (enforce && !authenticatedUser && !c.get("user")) {
                return c.json({ error: { message: "Unauthorized: Authentication required", code: "UNAUTHORIZED" } }, 401);
            }

            return next();
        };
    };

    return {
        writeAuthMiddleware: createMiddleware(requireAuth),
        readAuthMiddleware: createMiddleware(!publicRead && requireAuth)
    };
}

/**
 * Create storage REST API routes
 */
export function createStorageRoutes(config: StorageRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    const { controller, registry, sources: declaredSources, requireAuth = true, publicRead = false, authAdapter, authorize, authorizeData } = config;

    /**
     * Run the per-object authorization hook, if one is configured.
     *
     * Denials are 403 rather than 404: the route already established that the
     * caller is authenticated, so hiding existence buys nothing, and a
     * distinguishable status is what makes a misconfigured policy debuggable.
     * A hook that throws denies too — an ownership lookup that fails must not
     * fall open.
     */
    const checkAuthorized = async (
        c: { get: (k: "user") => { uid: string; email?: string; roles?: string[] } | undefined },
        operation: StorageOperation,
        key: string,
        bucket: string,
        storageId?: string | null
    ): Promise<void> => {
        if (!authorize) return;

        const user = c.get("user") ?? null;

        // A scoped download token *is* the authorization: it was minted by
        // `/metadata`, which ran this same hook, and it is valid only for the
        // path it was minted for. Re-running the hook here would ask the
        // synthetic token principal a question about ownership it cannot
        // answer, and would break every <img> the client already renders.
        // Public paths are declared public, so they are equally not the hook's
        // business.
        if (user?.uid === "download-token" || user?.uid === "public") return;

        let allowed: boolean;
        try {
            allowed = await authorize({
                key,
                bucket,
                operation,
                user,
                storageId: storageId ?? undefined,
                data: authorizeData?.()
            });
        } catch {
            allowed = false;
        }
        if (!allowed) {
            throw ApiError.forbidden("Not authorized for this object");
        }
    };

    /**
     * Resolve the storage controller for a request.
     * Looks up by `storageId` in the registry, falls back to the single
     * controller, and finally to the registry default.
     */
    const resolveController = (storageId?: string | null): StorageController => {
        if (registry) {
            return registry.getOrDefault(storageId);
        }
        if (controller) {
            return controller;
        }
        throw new Error("No storage controller or registry available");
    };

    /** Get the default controller (used for TUS and base-path derivation). */
    const getDefaultController = (): StorageController => {
        if (registry) return registry.getDefault();
        if (controller) return controller;
        throw new Error("No storage controller or registry available");
    };

    // ── Auth middleware selection ────────────────────────────────────────
    // When an AuthAdapter is available, delegate token verification to it
    // (mirroring the data-routes pattern). This avoids calling the JWT
    // module which may not have been configured (e.g. custom auth).
    // When no adapter is present, fall back to the built-in JWT middleware.
    const { writeAuthMiddleware, readAuthMiddleware } = authAdapter
        ? buildAdapterAuthMiddleware(authAdapter, requireAuth, publicRead)
        : {
            writeAuthMiddleware: requireAuth ? jwtRequireAuth : jwtOptionalAuth,
            readAuthMiddleware: (publicRead || !requireAuth) ? jwtOptionalAuth : jwtRequireAuth
        };

    /**
     * Parse bucket and path from a combined file path.
     *
     * The resolved path is canonicalized here — by the same function the upload
     * route applies to incoming keys — so read, delete, metadata and folder
     * routes agree with the write side about what a key means before it reaches
     * the controller, the authorize hook, or the download token it mints.
     *
     * A key that cannot be canonicalized (a real `..` segment, a null byte) is
     * a 400, not a repaired key. The `LocalStorageController` traversal guard
     * (`getFullPath`) is still the load-bearing defence for the *bucket*
     * boundary; this is what defends the boundary the hook drew inside it.
     */
    const parseBucketAndPath = (filePath: string): { bucket: string; resolvedPath: string } => {
        const parts = filePath.split("/");

        // Only recognize 'default' as an explicit bucket prefix
        if (parts.length > 1 && parts[0].toLowerCase() === "default") {
            return {
                bucket: "default",
                resolvedPath: canonicalKeyOrBadRequest(parts.slice(1).join("/"))
            };
        }

        // All other paths use 'default' bucket with the full path
        return {
            bucket: "default",
            resolvedPath: canonicalKeyOrBadRequest(filePath)
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
        const storageId = typeof body["storageId"] === "string" ? body["storageId"] : c.req.query("storageId");

        const finalKey = canonicalKeyOrBadRequest(key || uploadedFile.name || "unnamed");

        // Extract custom metadata from request body
        const metadata: Record<string, unknown> = {};
        for (const [k, value] of Object.entries(body)) {
            if (k.startsWith("metadata_")) {
                metadata[k.replace("metadata_", "")] = value;
            }
        }

        await checkAuthorized(c, "write", finalKey, bucket ?? "default", storageId);

        const resolved = resolveController(storageId);
        const result = await resolved.putObject({
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
    router.get("/file/*", fileTokenAuth, publicObjectAuth, readAuthMiddleware, async (c) => {
        // Allow cross-origin loading so admin frontends on different
        // ports (dev) or domains (CDN) can render images via <img>.
        c.header("Cross-Origin-Resource-Policy", "cross-origin");

        const rawPath = extractWildcardPath(c);
        if (!rawPath) {
            throw ApiError.notFound("File not found");
        }

        const filePath = decodeURIComponent(rawPath);
        const storageId = c.req.query("storageId");
        const resolved = resolveController(storageId);

        {
            const { bucket, resolvedPath } = parseBucketAndPath(filePath);
            await checkAuthorized(c, "read", resolvedPath, bucket, storageId);
        }

        // Parse image transform query params (e.g. ?width=300&format=webp)
        const transformOpts = parseTransformOptions(c.req.query() as Record<string, string>);

        // For local storage, serve the file directly from disk
        if (resolved.getType() === "local") {
            const localController = resolved as LocalStorageController;
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
        const fileObject = await resolved.getObject(parsedPath, parsedBucket);
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
    router.get("/metadata/*", fileTokenAuth, publicObjectAuth, readAuthMiddleware, async (c) => {
        const rawPath = extractWildcardPath(c);
        if (!rawPath) {
            return c.json({
                success: true,
                data: null,
                fileNotFound: true
            }, 404);
        }

        const filePath = decodeURIComponent(rawPath);
        const storageId = c.req.query("storageId");
        const resolved = resolveController(storageId);
        const { bucket, resolvedPath } = parseBucketAndPath(filePath);

        // The load-bearing check. This route mints the short-lived path-scoped
        // download token that `/file/*` then trusts, and it used to mint one
        // for any authenticated caller for any path — which is exactly why
        // "reject full-access JWTs on file routes" did not close the gap.
        await checkAuthorized(c, "read", resolvedPath, bucket, storageId);

        const downloadConfig = await resolved.getSignedUrl(resolvedPath, bucket);

        if (downloadConfig.fileNotFound) {
            throw ApiError.notFound("File not found");
        }

        if (downloadConfig.metadata) {
            const scopedPath = `${bucket}/${resolvedPath}`;
            if (isPublicStoragePath(scopedPath)) {
                // Public object: served token-less via a permanent URL.
                downloadConfig.metadata.public = true;
            } else {
                // Private object: mint a short-lived, path-scoped download token.
                downloadConfig.metadata.token = generateDownloadToken(scopedPath, 300);
                downloadConfig.metadata.tokenExpiresIn = 300;
            }
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
        const storageId = c.req.query("storageId");
        const resolved = resolveController(storageId);
        const { bucket, resolvedPath } = parseBucketAndPath(filePath);

        await checkAuthorized(c, "delete", resolvedPath, bucket, storageId);

        await resolved.deleteObject(resolvedPath, bucket);

        return c.json({
            success: true,
            message: "File deleted"
        });
    });

    /**
     * GET /list - List files in a path
     */
    router.get("/list", writeAuthMiddleware, async (c) => {
        // Fallback to path for backward compatibility. The prefix is
        // canonicalized like any other key: a listing is the one operation
        // where a prefix that means something other than what it says hands
        // back exactly the keys the hook meant to withhold.
        const storagePrefix = canonicalKeyOrBadRequest(c.req.query("prefix") || c.req.query("path") || "");
        const bucket = c.req.query("bucket");
        const maxResults = c.req.query("maxResults");
        const pageToken = c.req.query("pageToken");
        const storageId = c.req.query("storageId");
        const resolved = resolveController(storageId);

        // The prefix is the "object" being asked about — a listing is how you
        // discover keys you were never told, so leaving it ungated would hand
        // back exactly what per-object read control is meant to withhold.
        await checkAuthorized(c, "list", storagePrefix, bucket ?? "default", storageId);

        const result = await resolved.listObjects(
            storagePrefix,
            {
                bucket: bucket ?? (resolved.getType() === "local" ? "default" : undefined),
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
        const storageId = typeof body.storageId === "string" ? body.storageId : c.req.query("storageId");

        if (!folderPath || typeof folderPath !== "string") {
            throw ApiError.badRequest("Folder path is required");
        }

        const resolved = resolveController(storageId);
        const { bucket, resolvedPath } = parseBucketAndPath(folderPath);

        if (!resolvedPath || resolvedPath.trim() === "") {
            throw ApiError.badRequest("Invalid folder path");
        }

        await checkAuthorized(c, "write", resolvedPath, bucket, storageId);

        if (resolved.getType() === "local") {
            // For local storage, create the directory
            const localController = resolved as LocalStorageController;
            const absolutePath = localController.getAbsolutePath(resolvedPath, bucket);
            fs.mkdirSync(absolutePath, { recursive: true });
        } else {
            // For S3/GCS-compatible storage, create a zero-byte marker object with trailing slash
            const key = resolvedPath.endsWith("/") ? resolvedPath : resolvedPath + "/";
            const emptyFile = new File([], key, { type: "application/x-directory" });
            await resolved.putObject({
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

    const defaultCtrl = getDefaultController();
    const tusBaseDir = defaultCtrl.getType() === "local"
        ? (defaultCtrl as LocalStorageController).getBasePath()
        : (process.env.STORAGE_PATH || "./uploads");
    const tusHandler = new TusHandler(
        tusBaseDir,
        defaultCtrl,
        registry,
        // The key arrives already canonical: `TusHandler` canonicalizes once at
        // creation and stores the result, so the key shown here is the exact
        // key `finalize` writes. Canonicalizing again *here* would recreate the
        // bug this closes — two call sites deriving the key separately is how
        // the check and the write came apart in the first place.
        authorize
            ? async (c, key, bucket) => {
                await checkAuthorized(c as never, "write", key, bucket, c.req.query("storageId"));
            }
            : undefined
    );
    tusHandler.startCleanup();

    router.options("/tus", (_c) => tusHandler.options());
    router.post("/tus", writeAuthMiddleware, async (c) => tusHandler.create(c));
    router.get("/tus/:id", readAuthMiddleware, (c) => tusHandler.head(c, c.req.param("id")));
    router.patch("/tus/:id", writeAuthMiddleware, async (c) => tusHandler.patch(c, c.req.param("id")));
    router.delete("/tus/:id", writeAuthMiddleware, async (c) => tusHandler.delete(c, c.req.param("id")));

    // -----------------------------------------------------------------------
    // Storage Sources Discovery
    // -----------------------------------------------------------------------

    /**
     * GET /sources — list all registered storage backends.
     * The client can bootstrap its StorageSourceRegistry from this endpoint.
     */
    router.get("/sources", (c) => {
        const byKey = new Map<string, { key: string; engine: string; transport: "server" | "direct"; label?: string }>();

        // 1. Server-backed sources derived from the registry (source of truth
        //    for the actual engine type), or the single controller.
        if (registry) {
            for (const key of registry.list()) {
                byKey.set(key, {
                    key,
                    engine: registry.get(key)?.getType() ?? "unknown",
                    transport: "server",
                });
            }
        } else {
            byKey.set(DEFAULT_STORAGE_SOURCE_KEY, {
                key: DEFAULT_STORAGE_SOURCE_KEY,
                engine: defaultCtrl.getType(),
                transport: "server",
            });
        }

        // 2. Overlay declared definitions: adds `direct` sources the backend
        //    does not proxy, plus labels and explicit transport/engine.
        for (const def of declaredSources ?? []) {
            const existing = byKey.get(def.key);
            byKey.set(def.key, {
                key: def.key,
                engine: def.engine ?? existing?.engine ?? "unknown",
                transport: def.transport ?? existing?.transport ?? "server",
                label: def.label ?? existing?.label,
            });
        }

        return c.json({ success: true, data: Array.from(byKey.values()) });
    });

    return router;
}
