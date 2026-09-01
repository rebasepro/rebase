/**
 * Admin routes for managing Service API Keys.
 *
 * Mounted under `/api/admin/api-keys` with `requireAuth` + `requireAdmin`.
 * All routes return masked keys (never the hash). The full plaintext key
 * is returned exactly once in the POST response.
 *
 * @module
 */

import { Hono, type MiddlewareHandler } from "hono";
import { ApiError, errorHandler } from "../../api/errors";
import { createRequireAuth, requireAdmin } from "../middleware";
import type { HonoEnv } from "../../api/types";
import type { ApiKeyStore } from "./api-key-store";
import type { CreateApiKeyRequest, UpdateApiKeyRequest, ApiKeyPermission } from "./api-key-types";

export interface ApiKeyRouteOptions {
    store: ApiKeyStore;
    serviceKey?: string;
}

/**
 * Validate that a permissions array is well-formed.
 */
function validatePermissions(permissions: unknown): permissions is ApiKeyPermission[] {
    if (!Array.isArray(permissions)) return false;
    for (const perm of permissions) {
        if (typeof perm !== "object" || perm === null) return false;
        if (typeof perm.collection !== "string" || perm.collection.length === 0) return false;
        if (!Array.isArray(perm.operations) || perm.operations.length === 0) return false;
        const validOps = new Set(["read", "write", "delete"]);
        for (const op of perm.operations) {
            if (!validOps.has(op)) return false;
        }
    }
    return true;
}

/**
 * Refuse API-key-authenticated requests to the key-management routes.
 *
 * `createApiKeyPreAuth` runs in front of every `/admin/*` router so that keys
 * created with `admin: true` genuinely reach the admin surfaces — their
 * documented behaviour, and the right behaviour everywhere except here.
 * Applied to *this* router it means an admin key can mint a second admin key,
 * widen its own grants through `PUT /:id`, or revoke the keys other
 * integrations run on. Revoking the original key undoes none of that, because
 * the keys it minted are ordinary rows with no link back to it.
 *
 * So key management is reserved for callers that are not themselves an API
 * key: a human admin's session, or the service key.
 *
 * Reads are refused alongside writes. The list response enumerates every key's
 * name, prefix, permission set and admin flag — reconnaissance for exactly the
 * escalation above — and "an API key never touches API keys" is a rule with no
 * edges left to get wrong.
 */
const rejectApiKeyAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    if (c.get("apiKey")) {
        // Names where the service key comes from, because "use the service key"
        // sent readers looking for something they had no way to obtain: it is
        // injected by the platform, so it is not in their config, and it is
        // reserved, so `env set` refuses it. A recommendation that cannot be
        // followed is worse than no recommendation — it reads as a broken
        // account rather than a missing step.
        throw ApiError.forbidden(
            "API keys cannot manage API keys. Authenticate as an admin user, or use the service key — " +
            "REBASE_SERVICE_KEY in this server's environment, or `rebase cloud env reveal REBASE_SERVICE_KEY` " +
            "on Rebase Cloud.",
            "API_KEY_SELF_MANAGEMENT_FORBIDDEN"
        );
    }
    return next();
};

/**
 * Create admin routes for API key management.
 */
export function createApiKeyRoutes(options: ApiKeyRouteOptions): Hono<HonoEnv> {
    const { store, serviceKey } = options;
    const router = new Hono<HonoEnv>();

    router.onError(errorHandler);

    // Apply auth middleware (service-key-aware)
    router.use("/*", createRequireAuth({ serviceKey }));
    // Before requireAdmin, so a non-admin key gets the reason it was refused
    // rather than a generic "needs admin" that implies a wider key would work.
    router.use("/*", rejectApiKeyAuth);
    router.use("/*", requireAdmin);

    // GET / — List all API keys (masked)
    router.get("/", async (c) => {
        const keys = await store.listApiKeys();
        return c.json({ keys });
    });

    // POST / — Create a new API key
    router.post("/", async (c) => {
        const body = await c.req.json() as Record<string, unknown>;
        const { name, permissions, admin, rate_limit, expires_at } = body;

        if (!name || typeof name !== "string" || name.trim().length === 0) {
            throw ApiError.badRequest("Name is required", "INVALID_INPUT");
        }

        if (!validatePermissions(permissions)) {
            throw ApiError.badRequest(
                "Permissions must be an array of { collection: string, operations: ('read' | 'write' | 'delete')[] }",
                "INVALID_INPUT"
            );
        }

        if (admin !== undefined && typeof admin !== "boolean") {
            throw ApiError.badRequest("admin must be a boolean", "INVALID_INPUT");
        }

        if (rate_limit !== undefined && rate_limit !== null) {
            if (typeof rate_limit !== "number" || rate_limit < 1 || !Number.isInteger(rate_limit)) {
                throw ApiError.badRequest("rate_limit must be a positive integer or null", "INVALID_INPUT");
            }
        }

        if (expires_at !== undefined && expires_at !== null) {
            const parsed = new Date(expires_at as string);
            if (isNaN(parsed.getTime())) {
                throw ApiError.badRequest("expires_at must be a valid ISO-8601 date", "INVALID_INPUT");
            }
            if (parsed <= new Date()) {
                throw ApiError.badRequest("expires_at must be in the future", "INVALID_INPUT");
            }
        }

        const user = c.get("user");
        const createdBy = (user && typeof user === "object" && "uid" in user)
            ? (user.uid as string)
            : "unknown";

        const request: CreateApiKeyRequest = {
            name: name.trim(),
            permissions: permissions as ApiKeyPermission[],
            admin: (admin as boolean) ?? false,
            rate_limit: (rate_limit as number | null) ?? null,
            expires_at: (expires_at as string | null) ?? null
        };

        const keyWithSecret = await store.createApiKey(request, createdBy);

        return c.json({ key: keyWithSecret }, 201);
    });

    // GET /:id — Get API key details (masked)
    router.get("/:id", async (c) => {
        const id = c.req.param("id");
        const key = await store.getApiKeyById(id);

        if (!key) {
            throw ApiError.notFound("API key not found");
        }

        return c.json({ key });
    });

    // PUT /:id — Update API key
    router.put("/:id", async (c) => {
        const id = c.req.param("id");
        const body = await c.req.json() as Record<string, unknown>;
        const { name, permissions, admin, rate_limit, expires_at } = body;

        // Validate fields if provided
        if (name !== undefined) {
            if (typeof name !== "string" || name.trim().length === 0) {
                throw ApiError.badRequest("Name must be a non-empty string", "INVALID_INPUT");
            }
        }

        if (permissions !== undefined) {
            if (!validatePermissions(permissions)) {
                throw ApiError.badRequest(
                    "Permissions must be an array of { collection: string, operations: ('read' | 'write' | 'delete')[] }",
                    "INVALID_INPUT"
                );
            }
        }

        if (admin !== undefined && typeof admin !== "boolean") {
            throw ApiError.badRequest("admin must be a boolean", "INVALID_INPUT");
        }

        if (rate_limit !== undefined && rate_limit !== null) {
            if (typeof rate_limit !== "number" || rate_limit < 1 || !Number.isInteger(rate_limit)) {
                throw ApiError.badRequest("rate_limit must be a positive integer or null", "INVALID_INPUT");
            }
        }

        if (expires_at !== undefined && expires_at !== null) {
            const parsed = new Date(expires_at as string);
            if (isNaN(parsed.getTime())) {
                throw ApiError.badRequest("expires_at must be a valid ISO-8601 date", "INVALID_INPUT");
            }
        }

        const updates: UpdateApiKeyRequest = {};
        if (name !== undefined) updates.name = (name as string).trim();
        if (permissions !== undefined) updates.permissions = permissions as ApiKeyPermission[];
        if (admin !== undefined) updates.admin = admin as boolean;
        if (rate_limit !== undefined) updates.rate_limit = rate_limit as number | null;
        if (expires_at !== undefined) updates.expires_at = expires_at as string | null;

        const key = await store.updateApiKey(id, updates);

        if (!key) {
            throw ApiError.notFound("API key not found");
        }

        return c.json({ key });
    });

    // DELETE /:id — Revoke (soft-delete)
    router.delete("/:id", async (c) => {
        const id = c.req.param("id");
        const revoked = await store.revokeApiKey(id);

        if (!revoked) {
            throw ApiError.notFound("API key not found or already revoked");
        }

        return c.json({ success: true });
    });

    return router;
}
