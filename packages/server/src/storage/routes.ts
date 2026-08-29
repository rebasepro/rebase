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
import type { Stats } from "node:fs";
import { StorageController, type StorageAuthorize, type StorageAuthorizeData, type StorageOperation } from "./types";
import { LocalStorageController } from "./LocalStorageController";
import { UnknownStorageSourceError, type StorageRegistry } from "./storage-registry";
import { DEFAULT_STORAGE_SOURCE_KEY, isPublicStoragePath, type StorageSourceDefinition, type AuthAdapter } from "@rebasepro/types";
import { objectValidators, isNotModified, applyCacheHeaders, buildEntityTag } from "./cache-headers";
import { parseRange, contentRange, unsatisfiableContentRange } from "./range";
import { requireAuth as jwtRequireAuth, optionalAuth as jwtOptionalAuth, queryTokenAuth, fileTokenAuth, publicObjectAuth } from "../auth/middleware";
import { generateDownloadToken } from "../auth";
import { ApiError, errorHandler } from "../api/errors";
import { HonoEnv } from "../api/types";
import { parseTransformOptions, transformImage, isTransformableImage, TransformCache, InvalidTransformOptionsError, TransformOverloadedError, type ImageTransformOptions } from "./image-transform";
import { TusHandler } from "./tus-handler";
import { canonicalStorageKey, InvalidStorageKeyError, canonicalStorageBucket, InvalidStorageBucketError, canonicalStorageId } from "./keys";
import { compileStorageTriggers, triggerUser, type StorageTrigger, type StorageTriggerDispatcher } from "./triggers";
import {
    createDurableRenditionCache,
    isRenditionKey,
    RENDITION_PREFIX,
    type DurableRenditionCache,
    type RenditionCacheConfig
} from "./rendition-cache";

/**
 * The in-memory half of transform caching, per router (LRU, 500 entries, 1
 * hour TTL) together with the transforms currently being computed.
 *
 * The in-flight map is what stops N concurrent requests for one uncached
 * variant from running N full decode+encode pipelines: the cache alone only
 * helps the requests that arrive after the first one has finished, so a
 * thundering herd would cost N decodes. Joining the promise makes it cost one.
 *
 * Per router rather than per module. A process mounts one storage router, so
 * this changes nothing about how much is cached — but it makes the cache's
 * lifetime the router's, which is the only way a second router in the same
 * process (another instance, a restart) can be reasoned about at all. With a
 * module-level cache, a test that thinks it is asking "would another instance
 * recompute this?" is really asking the first instance's memory.
 */
interface TransformMemory {
    cache: TransformCache;
    inFlight: Map<string, Promise<{ data: Buffer; contentType: string }>>;
}

const createTransformMemory = (): TransformMemory => ({
    cache: new TransformCache(),
    inFlight: new Map()
});

/**
 * Compute a transform, or join the one already running for this key.
 *
 * `loadSource` is only called on a real miss, so the concurrent requests that
 * join an in-flight transform do not each read the source object either.
 */
async function transformOnce(
    memory: TransformMemory,
    cacheKey: string,
    options: ImageTransformOptions,
    loadSource: () => Promise<Buffer>,
    durable?: {
        cache: DurableRenditionCache;
        controller: StorageController;
        bucket: string | undefined;
    }
): Promise<{ data: Buffer; contentType: string }> {
    const cached = memory.cache.get(cacheKey);
    if (cached) return cached;

    const running = memory.inFlight.get(cacheKey);
    if (running) return running;

    const pending = (async () => {
        try {
            // The durable read joins the same in-flight promise the compute
            // does, so a burst of requests for one cold variant makes one
            // round trip to the bucket rather than one each.
            if (durable) {
                const stored = await durable.cache.get(durable.controller, cacheKey, durable.bucket);
                if (stored) {
                    memory.cache.set(cacheKey, stored.data, stored.contentType);
                    return stored;
                }
            }

            const result = await transformImage(await loadSource(), options);
            memory.cache.set(cacheKey, result.data, result.contentType);
            if (durable) {
                // Awaited: a floating promise here would outlive the request
                // and, in a serverless runtime, be frozen mid-write. The cost
                // is one PUT on a miss, which is the trade the cache is.
                await durable.cache.put(durable.controller, cacheKey, durable.bucket, result);
            }
            return result;
        } catch (err) {
            // A refusal from the transform queue is a load signal, not a bad
            // request: the caller should retry, and an operator should see the
            // status that says so. Mapped inside the shared promise so the
            // requests that joined it get the same answer.
            if (err instanceof TransformOverloadedError) {
                throw ApiError.serviceUnavailable(err.message, "TRANSFORM_OVERLOADED");
            }
            throw err;
        }
    })();
    memory.inFlight.set(cacheKey, pending);
    try {
        return await pending;
    } finally {
        memory.inFlight.delete(cacheKey);
    }
}

/**
 * Content types served inline. Everything else is handed back as
 * `application/octet-stream` with `Content-Disposition: attachment`.
 *
 * The stored content type is the *uploader's claim* — `putObject` writes
 * `file.type` from the multipart part, and TUS takes it from a request header;
 * nothing sniffs the bytes. Echoing that claim back as the response type turns
 * `/api/storage/file/*` into an HTML hosting endpoint on the API origin, and
 * where `cookieAuth` is enabled the refresh cookie is `Path=/` on exactly that
 * origin — so an uploaded page can fetch `/api/auth/refresh` same-origin and
 * read out a fresh access token, `HttpOnly` notwithstanding.
 *
 * `image/svg+xml` is deliberately absent: an SVG is a document that can carry
 * script. `text/html` and `application/xhtml+xml` are absent for the same
 * reason, and are what the attack actually uses.
 */
const INLINE_CONTENT_TYPE_PREFIXES = ["image/", "video/", "audio/"];
const INLINE_CONTENT_TYPES = new Set(["application/pdf", "text/plain"]);

/**
 * Decide what to actually serve for a stored content type.
 *
 * Returns the type to send and whether to force a download. The check is an
 * allowlist rather than a blocklist of dangerous types: the set of types a
 * browser will execute grows, and the set we want to render inline does not.
 */
export function resolveServedContentType(storedContentType: string): { contentType: string; attachment: boolean } {
    // Parameters (`; charset=utf-8`) are not part of the decision, and a
    // trailing parameter must not be a way to slip past the prefix match.
    const base = storedContentType.split(";")[0].trim().toLowerCase();

    const inline = base.includes("svg")
        ? false
        : INLINE_CONTENT_TYPES.has(base) || INLINE_CONTENT_TYPE_PREFIXES.some((p) => base.startsWith(p));

    return inline
        ? { contentType: storedContentType, attachment: false }
        : { contentType: "application/octet-stream", attachment: true };
}

export interface StorageRoutesConfig {
    /**
     * A single storage controller, for a backend with one storage source.
     * Used when no `registry` is provided.
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
    /**
     * Keep derived image renditions in the storage source instead of only in
     * this process's memory. Off unless enabled — see `rendition-cache.ts` for
     * why a read that writes to somebody's bucket is not a default.
     */
    renditionCache?: RenditionCacheConfig;
    /**
     * Run something when an object lands, or when one goes. See `triggers.ts`.
     */
    triggers?: StorageTrigger[];
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
        const canonical = canonicalStorageKey(key);
        // The rendition space is not addressable by callers, in either
        // direction. Reading one would serve a derivative of a source object
        // without the source's key ever reaching `storageAuthorize` or the
        // declarative policies — both of which reason about that key — and
        // writing one would let a caller choose what a later transform serves.
        if (isRenditionKey(canonical)) {
            throw new InvalidStorageKeyError(
                `"${RENDITION_PREFIX}" is reserved for derived image renditions and cannot be ` +
                "read or written directly."
            );
        }
        return canonical;
    } catch (err) {
        throw new ApiError(
            400,
            "INVALID_STORAGE_KEY",
            err instanceof InvalidStorageKeyError ? err.message : "Invalid storage key"
        );
    }
}

/**
 * Canonicalize a caller-supplied bucket name, answering 400 when it is not one.
 *
 * The bucket's counterpart to {@link canonicalKeyOrBadRequest}, and it exists
 * for the same reason: the value routes a write, so it has to be checked where
 * it enters rather than where it is used. Applied at every entry point a bucket
 * has — this route's multipart body, the folder route's JSON body, the
 * `?bucket=` query, and the TUS `Upload-Metadata` header.
 */
function canonicalBucketOrBadRequest(bucket: string | undefined | null): string | undefined {
    try {
        return canonicalStorageBucket(bucket);
    } catch (err) {
        throw new ApiError(
            400,
            "INVALID_STORAGE_BUCKET",
            err instanceof InvalidStorageBucketError ? err.message : "Invalid storage bucket"
        );
    }
}

/**
 * Parse image transform query parameters, answering 400 when they are out of
 * bounds rather than clamping them to something the caller did not ask for.
 */
function transformOptionsOrBadRequest(query: Record<string, string>): ImageTransformOptions | null {
    try {
        return parseTransformOptions(query);
    } catch (err) {
        throw new ApiError(
            400,
            "INVALID_TRANSFORM_OPTIONS",
            err instanceof InvalidTransformOptionsError ? err.message : "Invalid image transform options"
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

    // Built once per router. Holds only the "already warned" flag; the
    // rendition bytes live in the bucket, which is the entire point.
    const durableRenditions = config.renditionCache?.enabled ? createDurableRenditionCache() : undefined;
    const transformMemory = createTransformMemory();

    // Compiled here rather than at each call site: a malformed pattern fails
    // the boot, and a trigger that matches nothing because of a typo is the
    // failure this feature could most easily have had.
    const fireTrigger: StorageTriggerDispatcher | undefined = config.triggers?.length
        ? compileStorageTriggers(config.triggers)
        : undefined;

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
     * Resolve the storage controller for a request, or refuse the request.
     *
     * A `storageId` that names no registered source used to fall back to the
     * default one. That is silently wrong: the `storageAuthorize` hook is asked
     * about the source the caller named while the bytes come from `(default)`,
     * so the object the hook approved is not the object the request touched —
     * and because the two sources hold the same key, the fallback returns
     * plausible bytes instead of an error.
     *
     * The caller gets one of two answers, because they are two different
     * problems with two different fixes:
     *
     * - **501** if the source *is* declared in `rebase.json` but has no
     *   credentials in this environment. It was skipped at boot rather than
     *   crash-looping the backend, but `GET /sources` still advertises it, so a
     *   client asking for it is not confused — the deployment is incomplete.
     *   501 (not 503) for the same reason the whole-storage stub uses it: this
     *   is permanent until someone configures it, and the client's offline
     *   queue retries 503 forever.
     * - **400** otherwise. The id names nothing this deployment has ever heard
     *   of, which is a caller mistake. `expected`, so one client holding a
     *   stale source name does not write a warning per request forever.
     */
    const declaredKeys = new Set((declaredSources ?? []).map((s) => s.key));

    const refuseUnknownSource = (storageId: string, knownKeys: string[]): never => {
        if (declaredKeys.has(storageId)) {
            throw new ApiError(
                501,
                "STORAGE_SOURCE_NOT_CONFIGURED",
                `Storage source "${storageId}" is declared but not configured on this deployment, ` +
                "so it cannot be read from or written to. Set its credentials " +
                `(the ${storageId} suffixed environment variables) and redeploy.`
            );
        }
        throw new ApiError(
            400,
            "UNKNOWN_STORAGE_SOURCE",
            `Unknown storage source "${storageId}". ` +
            `Available: ${knownKeys.length > 0 ? knownKeys.map((k) => `"${k}"`).join(", ") : "(none)"}.`,
            undefined,
            true
        );
    };

    const resolveController = (storageId?: string | null): StorageController => {
        if (registry) {
            try {
                return registry.getOrDefault(storageId);
            } catch (err) {
                if (err instanceof UnknownStorageSourceError) {
                    return refuseUnknownSource(err.storageId, err.knownKeys);
                }
                throw err;
            }
        }
        if (controller) {
            // Single-controller backends (no registry) have exactly one source,
            // and it is the default one. Honouring a named `storageId` here
            // would be the same silent redirect by another route.
            const requested = canonicalStorageId(storageId);
            if (requested !== DEFAULT_STORAGE_SOURCE_KEY) {
                return refuseUnknownSource(requested, [DEFAULT_STORAGE_SOURCE_KEY]);
            }
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
     * (`getFullPath`) is the load-bearing defence for the *storage root*, and
     * `canonicalStorageBucket` for the bucket the caller names; this is what
     * defends the boundary the hook drew inside them.
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
        const bucket = canonicalBucketOrBadRequest(typeof body["bucket"] === "string" ? body["bucket"] : undefined);
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

        await fireTrigger?.({
            event: "finalize",
            key: finalKey,
            bucket,
            storageId: canonicalStorageId(storageId),
            size: uploadedFile.size,
            contentType: uploadedFile.type || undefined,
            user: triggerUser(c.get("user")),
            at: new Date().toISOString()
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

        const { bucket, resolvedPath } = parseBucketAndPath(filePath);
        await checkAuthorized(c, "read", resolvedPath, bucket, storageId);

        // The stored content type is the uploader's claim; never sniff past
        // what we decide to send. Set unconditionally, including on the
        // transform responses below.
        c.header("X-Content-Type-Options", "nosniff");

        // The cache key names the object, not the URL that reached it: the raw
        // wildcard admits several spellings of one object (`x.png`,
        // `default/x.png`), and it omitted the storage source entirely — two
        // sources holding the same key shared one entry.
        //
        // It names the object but not *which version* of it, which is the other
        // half: a key can be overwritten, and a rendition of the old bytes stayed
        // valid for the cache's full hour. Each call site appends the source's
        // validator below, so replacing the source changes the key rather than
        // shadowing it, and the superseded entry ages out on its own.
        const transformKeyPrefix = `${storageId || "(default)"}/${bucket}/${resolvedPath}`;

        // Whether a *shared* cache may keep this. An object under the public
        // prefix needs no credentials, so a CDN holding it is the point; any
        // other object required this caller's credentials, and `public` would
        // be permission to serve it to the next caller instead.
        const sharedCacheable = publicRead === true || isPublicStoragePath(resolvedPath);
        const cachePolicy = (maxAgeSeconds: number) => ({
            isPublic: sharedCacheable,
            maxAgeSeconds,
            staleWhileRevalidateSeconds: 86400
        });

        // Short, because the object is mutable: `putObject` on an existing key
        // is ordinary, so a long window is a window in which a replaced file is
        // invisible. The validators below make the revalidation cheap — a 304
        // and no body — which is what buys the correctness back.
        const OBJECT_MAX_AGE = 60;
        // Longer for a derived rendition: recomputing one costs a decode, a
        // resize and an encode, against a conditional request that costs a round
        // trip. Still finite, and still revalidated, for the same reason.
        const TRANSFORM_MAX_AGE = 3600;

        // Parse image transform query params (e.g. ?width=300&format=webp)
        const transformOpts = transformOptionsOrBadRequest(c.req.query() as Record<string, string>);

        // For local storage, serve the file directly from disk
        if (resolved.getType() === "local") {
            const localController = resolved as LocalStorageController;

            const absolutePath = localController.getAbsolutePath(resolvedPath, bucket ?? "default");

            // `stat` rather than `access`: it answers the same existence
            // question and also carries the size and mtime the validators are
            // built from, so this is one syscall doing two jobs rather than two
            // doing one each.
            let localStat: Stats;
            try {
                localStat = await fsp.stat(absolutePath);
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

            // Apply image transforms if requested and the file is a transformable image
            if (transformOpts && isTransformableImage(contentType)) {
                const sourceVersion = buildEntityTag(localStat.size, localStat.mtimeMs);
                const cacheKey = transformMemory.cache.buildKey(`${transformKeyPrefix}@${sourceVersion}`, transformOpts);
                const transformed = await transformOnce(
                    transformMemory,
                    cacheKey,
                    transformOpts,
                    async () => Buffer.from(await fsp.readFile(absolutePath)),
                    durableRenditions
                        ? { cache: durableRenditions, controller: resolved, bucket }
                        : undefined
                );
                const validators = objectValidators(transformed.data.byteLength, localStat.mtimeMs);
                applyCacheHeaders(c, validators, cachePolicy(TRANSFORM_MAX_AGE));
                if (isNotModified(c, validators)) return c.body(null, 304);
                c.header("Content-Type", transformed.contentType);
                return c.body(new Uint8Array(transformed.data));
            }

            const validators = objectValidators(localStat.size, localStat.mtimeMs);
            applyCacheHeaders(c, validators, cachePolicy(OBJECT_MAX_AGE));

            const served = resolveServedContentType(contentType);
            c.header("Content-Type", served.contentType);
            if (served.attachment) c.header("Content-Disposition", "attachment");

            // Advertised before the conditional check so a 304 carries it too:
            // a client revalidating a cached media file still needs to know it
            // may seek once it has one.
            c.header("Accept-Ranges", "bytes");

            // Checked after the headers are set and before the file is read:
            // the whole point is not to read or send the body.
            if (isNotModified(c, validators)) return c.body(null, 304);

            // Conditional first, then range — the order RFC 9110 requires.
            const localRange = parseRange(c.req.header("range"), localStat.size);
            if (localRange.kind === "unsatisfiable") {
                c.header("Content-Range", unsatisfiableContentRange(localStat.size));
                return c.body(null, 416);
            }

            if (localRange.kind === "range") {
                // `end` is not read here: a positioned read takes an offset and a
                // length, and `contentRange` renders the range from the spec itself.
                const { start, length } = localRange.range;
                // Only the requested slice leaves the disk. Reading the whole
                // file to answer a range would give up the reason ranges exist.
                const handle = await fsp.open(absolutePath, "r");
                try {
                    const buffer = Buffer.alloc(length);
                    await handle.read(buffer, 0, length, start);
                    c.header("Content-Range", contentRange(localRange.range, localStat.size));
                    c.header("Content-Length", String(length));
                    return c.body(new Uint8Array(buffer), 206);
                } finally {
                    await handle.close();
                }
            }

            // Declared on the full response too, not only on a 206. A player
            // sends HEAD before it seeks, and without a length it cannot work
            // out what to ask for — which makes `Accept-Ranges` above an offer
            // it has no way to take up.
            c.header("Content-Length", String(localStat.size));

            const fileContent = await fsp.readFile(absolutePath);
            return c.body(new Uint8Array(fileContent));
        }

        // For remote storage (S3, GCS, etc.), proxy the file through the backend.
        // We avoid redirecting to signed URLs because:
        //  1. Mixed-content (HTTPS page → HTTP MinIO) is blocked by browsers
        //  2. Internal IPs / VPC endpoints are unreachable from the browser
        const fileObject = await resolved.getObject(resolvedPath, bucket);
        if (!fileObject) {
            throw ApiError.notFound("File not found");
        }

        const remoteContentType = fileObject.type || "application/octet-stream";

        // Apply image transforms for remote storage too
        if (transformOpts && isTransformableImage(remoteContentType)) {
            const sourceVersion = buildEntityTag(fileObject.size, fileObject.lastModified);
            const cacheKey = transformMemory.cache.buildKey(`${transformKeyPrefix}@${sourceVersion}`, transformOpts);
            const transformed = await transformOnce(
                transformMemory,
                cacheKey,
                transformOpts,
                async () => Buffer.from(await fileObject.arrayBuffer()),
                durableRenditions
                    ? { cache: durableRenditions, controller: resolved, bucket }
                    : undefined
            );
            const validators = objectValidators(transformed.data.byteLength, fileObject.lastModified);
            applyCacheHeaders(c, validators, cachePolicy(TRANSFORM_MAX_AGE));
            if (isNotModified(c, validators)) return c.body(null, 304);
            c.header("Content-Type", transformed.contentType);
            return c.body(new Uint8Array(transformed.data));
        }

        const servedRemote = resolveServedContentType(remoteContentType);
        c.header("Content-Type", servedRemote.contentType);
        if (servedRemote.attachment) c.header("Content-Disposition", "attachment");

        const remoteValidators = objectValidators(fileObject.size, fileObject.lastModified);
        applyCacheHeaders(c, remoteValidators, cachePolicy(OBJECT_MAX_AGE));
        c.header("Accept-Ranges", "bytes");
        if (isNotModified(c, remoteValidators)) return c.body(null, 304);

        const remoteRange = parseRange(c.req.header("range"), fileObject.size);
        if (remoteRange.kind === "unsatisfiable") {
            c.header("Content-Range", unsatisfiableContentRange(fileObject.size));
            return c.body(null, 416);
        }

        const buf = await fileObject.arrayBuffer();

        if (remoteRange.kind === "range") {
            const { start, end, length } = remoteRange.range;
            // The whole object still comes from the remote store — a
            // `StorageController` has no ranged read — so this saves the
            // response body, not the upstream fetch. Worth it anyway: it is what
            // makes a player seek instead of restarting, and it is the half of
            // the cost that is on the user's connection.
            c.header("Content-Range", contentRange(remoteRange.range, fileObject.size));
            c.header("Content-Length", String(length));
            return c.body(new Uint8Array(buf.slice(start, end + 1)), 206);
        }

        c.header("Content-Length", String(fileObject.size));
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
                // Private object: mint a short-lived download token scoped to
                // this path *and to the source it was authorized against*. The
                // hook above was asked about one object; a key is only unique
                // within its own source, so a token that named the path alone
                // would spend against the same key in every other one.
                downloadConfig.metadata.token = await generateDownloadToken(scopedPath, 300, storageId);
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

        await fireTrigger?.({
            event: "delete",
            key: resolvedPath,
            bucket,
            storageId: canonicalStorageId(storageId),
            user: triggerUser(c.get("user")),
            at: new Date().toISOString()
        });

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
        // A listing is the read half of the same unvalidated parameter:
        // `?bucket=../../..` enumerated arbitrary directories on the pod,
        // including the TUS temp directory next to the buckets.
        const bucket = canonicalBucketOrBadRequest(c.req.query("bucket"));
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
        const { resolvedPath } = parseBucketAndPath(folderPath);

        // The documented `bucket` body field, read for the first time.
        //
        // The docblock above has always said `Body: { path, bucket? }`, and the
        // handler never looked at it: it took whatever `parseBucketAndPath`
        // returned, which is `"default"` for every input that is not literally
        // prefixed `default/`. So `POST /folder { path: "reports", bucket:
        // "media" }` answered 201 and created the folder in the default bucket
        // — the parameter was accepted, ignored, and the call reported success.
        //
        // `canonicalBucketOrBadRequest`'s own comment lists the entry points a
        // bucket has — "this route's multipart body, the `?bucket=` query, and
        // the TUS `Upload-Metadata` header". This body was the fourth, missing
        // from the list and from the code.
        const bucket = canonicalBucketOrBadRequest(typeof body.bucket === "string" ? body.bucket : undefined);

        if (!resolvedPath || resolvedPath.trim() === "") {
            throw ApiError.badRequest("Invalid folder path");
        }

        await checkAuthorized(c, "write", resolvedPath, bucket ?? "default", storageId);

        if (resolved.getType() === "local") {
            // For local storage, create the directory
            const localController = resolved as LocalStorageController;
            const absolutePath = localController.getAbsolutePath(resolvedPath, bucket);
            fs.mkdirSync(absolutePath, { recursive: true });
        } else {
            // For S3/GCS-compatible storage, create a zero-byte marker object with trailing slash
            const key = resolvedPath.endsWith("/") ? resolvedPath : resolvedPath + "/";
            const emptyFile = new File([], key, { type: "application/x-directory" });
            // Threaded through, like every other write in this file: the marker
            // has to land in the bucket the hook above was asked about.
            await resolved.putObject({
                file: emptyFile,
                key,
                bucket
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
        // Key, bucket and storage source all arrive already resolved:
        // `TusHandler` computes each once at creation and stores it, so what is
        // shown here is exactly what `finalize` writes. Re-deriving any of them
        // *here* would recreate the bug this closes — two call sites deriving
        // one value separately is how the check and the write came apart in the
        // first place. `storageId` used to be read from `c.req.query()` while
        // `finalize` used the `Upload-Metadata` header, so a request could name
        // the permissive source in the URL and the private one in the header.
        authorize
            ? async (c, key, bucket, storageId) => {
                await checkAuthorized(c as never, "write", key, bucket, storageId);
            }
            : undefined,
        fireTrigger
            ? async (event) => {
                await fireTrigger({
                    event: "finalize",
                    key: event.key,
                    bucket: event.bucket,
                    storageId: canonicalStorageId(event.storageId),
                    size: event.size,
                    contentType: event.contentType,
                    user: event.user,
                    at: new Date().toISOString()
                });
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
