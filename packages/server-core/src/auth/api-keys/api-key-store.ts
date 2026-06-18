/**
 * Database operations for Service API Keys.
 *
 * Uses the DataDriver's `admin.executeSql` capability (same pattern as
 * the cron-store and ensure-tables modules). All data lives in the
 * `rebase.api_keys` table.
 *
 * @module
 */

import { randomBytes, createHash } from "crypto";
import type { DataDriver } from "@rebasepro/types";
import { isSQLAdmin } from "@rebasepro/types";
import { logger } from "../../utils/logger";
import type {
    ApiKey,
    ApiKeyMasked,
    ApiKeyWithSecret,
    CreateApiKeyRequest,
    UpdateApiKeyRequest
} from "./api-key-types";

const TABLE = "rebase.api_keys";

/** Characters used to generate the random portion of an API key. */
const HEX_CHARS = "abcdef0123456789";

/**
 * Generate a plaintext API key with the `rk_live_` prefix.
 *
 * Format: `rk_live_` + 32 random hex characters.
 */
function generateApiKey(): string {
    const random = randomBytes(16).toString("hex"); // 32 hex chars
    return `rk_live_${random}`;
}

/**
 * SHA-256 hash a plaintext API key for database storage.
 */
function hashKey(plaintext: string): string {
    return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Extract the display prefix from a plaintext key (first 12 chars).
 */
function keyPrefix(plaintext: string): string {
    return plaintext.substring(0, 12);
}

/**
 * Strip the `key_hash` field and return a safe-to-expose masked key.
 */
function toMasked(row: ApiKey): ApiKeyMasked {
    return {
        id: row.id,
        name: row.name,
        key_prefix: row.key_prefix,
        permissions: row.permissions,
        rate_limit: row.rate_limit,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_used_at: row.last_used_at,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at
    };
}

/**
 * Parse a raw DB row into the typed `ApiKey` shape.
 */
function rowToApiKey(row: Record<string, unknown>): ApiKey {
    const permissions = typeof row.permissions === "string"
        ? JSON.parse(row.permissions)
        : (row.permissions ?? []);

    return {
        id: row.id as string,
        name: row.name as string,
        key_prefix: row.key_prefix as string,
        key_hash: row.key_hash as string,
        permissions,
        rate_limit: row.rate_limit !== null && row.rate_limit !== undefined
            ? Number(row.rate_limit)
            : null,
        created_by: row.created_by as string,
        created_at: new Date(row.created_at as string).toISOString(),
        updated_at: new Date(row.updated_at as string).toISOString(),
        last_used_at: row.last_used_at ? new Date(row.last_used_at as string).toISOString() : null,
        expires_at: row.expires_at ? new Date(row.expires_at as string).toISOString() : null,
        revoked_at: row.revoked_at ? new Date(row.revoked_at as string).toISOString() : null
    };
}

/**
 * Escape a string for safe inline SQL usage.
 */
function esc(value: string): string {
    return value.replace(/'/g, "''");
}

// ─── Public API ──────────────────────────────────────────────────────

export interface ApiKeyStore {
    /** Ensure the `rebase.api_keys` table exists. Called once on startup. */
    ensureTable(): Promise<void>;

    /** Create a new API key. Returns the full plaintext key exactly once. */
    createApiKey(request: CreateApiKeyRequest, createdBy: string): Promise<ApiKeyWithSecret>;

    /** Look up an API key by its SHA-256 hash. Returns `null` if not found. */
    findByKeyHash(hash: string): Promise<ApiKey | null>;

    /** List all API keys (masked, never includes hash). */
    listApiKeys(): Promise<ApiKeyMasked[]>;

    /** Get a single API key by ID (masked). */
    getApiKeyById(id: string): Promise<ApiKeyMasked | null>;

    /** Update name, permissions, rate_limit, or expires_at. */
    updateApiKey(id: string, updates: UpdateApiKeyRequest): Promise<ApiKeyMasked | null>;

    /** Soft-delete: set `revoked_at` to now. */
    revokeApiKey(id: string): Promise<boolean>;

    /** Touch `last_used_at` to the current timestamp. */
    updateLastUsed(id: string): Promise<void>;
}

/**
 * Create an `ApiKeyStore` backed by the driver's SQL admin capability.
 *
 * Returns `undefined` if the driver does not support `executeSql`.
 */
export function createApiKeyStore(driver: DataDriver): ApiKeyStore | undefined {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) {
        logger.warn("⚠️ [api-key-store] DataDriver does not support SQL admin — API keys will not be available.");
        return undefined;
    }

    const exec = admin.executeSql.bind(admin);

    return {
        // ── Schema bootstrap ────────────────────────────────────────
        async ensureTable(): Promise<void> {
            try {
                await exec("CREATE SCHEMA IF NOT EXISTS rebase");
                await exec(`
                    CREATE TABLE IF NOT EXISTS ${TABLE} (
                        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                        name TEXT NOT NULL,
                        key_prefix TEXT NOT NULL,
                        key_hash TEXT NOT NULL UNIQUE,
                        permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
                        rate_limit INTEGER,
                        created_by TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        last_used_at TIMESTAMPTZ,
                        expires_at TIMESTAMPTZ,
                        revoked_at TIMESTAMPTZ
                    )
                `);

                await exec(`
                    CREATE INDEX IF NOT EXISTS idx_api_keys_hash
                    ON ${TABLE}(key_hash)
                `);

                await exec(`
                    CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
                    ON ${TABLE}(key_prefix)
                `);

                logger.info("✅ API keys table ready");
            } catch (err) {
                logger.error("❌ Failed to create API keys table", { error: err });
                logger.warn("⚠️ Continuing without API keys support.");
            }
        },

        // ── Create ──────────────────────────────────────────────────
        async createApiKey(request: CreateApiKeyRequest, createdBy: string): Promise<ApiKeyWithSecret> {
            const plaintext = generateApiKey();
            const hash = hashKey(plaintext);
            const prefix = keyPrefix(plaintext);
            const permissionsJson = JSON.stringify(request.permissions);
            const rateLimitSql = request.rate_limit !== null && request.rate_limit !== undefined
                ? String(request.rate_limit)
                : "NULL";
            const expiresAtSql = request.expires_at
                ? `'${esc(request.expires_at)}'`
                : "NULL";

            const rows = await exec(`
                INSERT INTO ${TABLE} (name, key_prefix, key_hash, permissions, rate_limit, created_by, expires_at)
                VALUES (
                    '${esc(request.name)}',
                    '${esc(prefix)}',
                    '${esc(hash)}',
                    '${esc(permissionsJson)}'::jsonb,
                    ${rateLimitSql},
                    '${esc(createdBy)}',
                    ${expiresAtSql}
                )
                RETURNING *
            `);

            const apiKey = rowToApiKey(rows[0]);
            return {
                ...toMasked(apiKey),
                key: plaintext
            };
        },

        // ── Lookup by hash ──────────────────────────────────────────
        async findByKeyHash(hash: string): Promise<ApiKey | null> {
            const rows = await exec(`
                SELECT * FROM ${TABLE}
                WHERE key_hash = '${esc(hash)}'
                LIMIT 1
            `);
            if (rows.length === 0) return null;
            return rowToApiKey(rows[0]);
        },

        // ── List all (masked) ───────────────────────────────────────
        async listApiKeys(): Promise<ApiKeyMasked[]> {
            const rows = await exec(`
                SELECT * FROM ${TABLE}
                ORDER BY created_at DESC
            `);
            return rows.map(r => toMasked(rowToApiKey(r)));
        },

        // ── Get by ID (masked) ──────────────────────────────────────
        async getApiKeyById(id: string): Promise<ApiKeyMasked | null> {
            const rows = await exec(`
                SELECT * FROM ${TABLE}
                WHERE id = '${esc(id)}'
                LIMIT 1
            `);
            if (rows.length === 0) return null;
            return toMasked(rowToApiKey(rows[0]));
        },

        // ── Update ──────────────────────────────────────────────────
        async updateApiKey(id: string, updates: UpdateApiKeyRequest): Promise<ApiKeyMasked | null> {
            const setClauses: string[] = [];

            if (updates.name !== undefined) {
                setClauses.push(`name = '${esc(updates.name)}'`);
            }
            if (updates.permissions !== undefined) {
                setClauses.push(`permissions = '${esc(JSON.stringify(updates.permissions))}'::jsonb`);
            }
            if (updates.rate_limit !== undefined) {
                setClauses.push(
                    updates.rate_limit !== null
                        ? `rate_limit = ${updates.rate_limit}`
                        : "rate_limit = NULL"
                );
            }
            if (updates.expires_at !== undefined) {
                setClauses.push(
                    updates.expires_at !== null
                        ? `expires_at = '${esc(updates.expires_at)}'`
                        : "expires_at = NULL"
                );
            }

            if (setClauses.length === 0) {
                return this.getApiKeyById(id);
            }

            setClauses.push("updated_at = NOW()");

            const rows = await exec(`
                UPDATE ${TABLE}
                SET ${setClauses.join(", ")}
                WHERE id = '${esc(id)}'
                RETURNING *
            `);

            if (rows.length === 0) return null;
            return toMasked(rowToApiKey(rows[0]));
        },

        // ── Revoke (soft-delete) ────────────────────────────────────
        async revokeApiKey(id: string): Promise<boolean> {
            const rows = await exec(`
                UPDATE ${TABLE}
                SET revoked_at = NOW(), updated_at = NOW()
                WHERE id = '${esc(id)}' AND revoked_at IS NULL
                RETURNING id
            `);
            return rows.length > 0;
        },

        // ── Touch last_used_at ──────────────────────────────────────
        async updateLastUsed(id: string): Promise<void> {
            try {
                await exec(`
                    UPDATE ${TABLE}
                    SET last_used_at = NOW()
                    WHERE id = '${esc(id)}'
                `);
            } catch (err) {
                // Non-blocking — don't fail requests because of a usage timestamp update
                logger.error("[api-key-store] Failed to update last_used_at", { error: err });
            }
        }
    };
}
