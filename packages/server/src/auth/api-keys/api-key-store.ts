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
import { revokeInternalTableSql } from "@rebasepro/common";
import { logger } from "../../utils/logger";
import { createDdlBootstrapper } from "../../boot/ddl-bootstrap";
import type {
    ApiKey,
    ApiKeyMasked,
    ApiKeyPermission,
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
        admin: row.admin,
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
    let permissions = (row.permissions ?? []) as ApiKeyPermission[];
    if (typeof row.permissions === "string") {
        try {
            permissions = JSON.parse(row.permissions) as ApiKeyPermission[];
        } catch {
            permissions = [];
        }
    }

    return {
        id: row.id as string,
        name: row.name as string,
        key_prefix: row.key_prefix as string,
        key_hash: row.key_hash as string,
        permissions,
        admin: Boolean(row.admin),
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

    const exec = (sqlText: string, options?: { params?: unknown[] }) =>
        admin.executeSql(sqlText, options?.params ? { params: options.params } : undefined);

    const ddl = createDdlBootstrapper(exec, "api-key-store");

    return {
        // ── Schema bootstrap ────────────────────────────────────────
        async ensureTable(): Promise<void> {
            // Every statement here is idempotent, so losing the race to a peer
            // that booted at the same moment is survivable — but only if the
            // loser retries instead of abandoning everything below it. One
            // contained step each, so that a hard failure on any one of them
            // does not take the others with it. See `boot/ddl-bootstrap.ts`.
            await ddl.ensureObject("Creating schema rebase", "CREATE SCHEMA IF NOT EXISTS rebase");

            await ddl.ensureObject(`Creating ${TABLE}`, `
                CREATE TABLE IF NOT EXISTS ${TABLE} (
                    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                    name TEXT NOT NULL,
                    key_prefix TEXT NOT NULL,
                    key_hash TEXT NOT NULL UNIQUE,
                    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
                    admin BOOLEAN NOT NULL DEFAULT FALSE,
                    rate_limit INTEGER,
                    created_by TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_used_at TIMESTAMPTZ,
                    expires_at TIMESTAMPTZ,
                    revoked_at TIMESTAMPTZ
                )
            `);

            await ddl.ensureObject("Creating idx_api_keys_hash", `
                CREATE INDEX IF NOT EXISTS idx_api_keys_hash
                ON ${TABLE}(key_hash)
            `);

            await ddl.ensureObject("Creating idx_api_keys_prefix", `
                CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
                ON ${TABLE}(key_prefix)
            `);

            // Migration: add admin column to existing tables. Idempotent in the
            // same way and raced in the same way — two instances running it
            // together can deadlock on the table's catalog lock.
            await ddl.ensureObject(`Adding ${TABLE}.admin`, `
                ALTER TABLE ${TABLE}
                ADD COLUMN IF NOT EXISTS admin BOOLEAN NOT NULL DEFAULT FALSE
            `);

            // Keyed on what exists, not on who created it. The revoke below used
            // to sit at the end of one long try block, so an instance that lost
            // any race above skipped it and reported only that API keys were
            // unavailable — while the table it had just helped create stayed
            // reachable by the end-user role.
            if (!await ddl.isReadable(TABLE)) {
                logger.error(
                    `❌ [api-key-store] ${TABLE} is unavailable — every API-key authenticated ` +
                    "request will be rejected on this instance, and the table could not be " +
                    "taken back off the end-user role."
                );
                return;
            }

            // This table holds key hashes and an `admin` flag, and it has no
            // RLS — it is not a collection. The Postgres driver grants the
            // authenticated role DML on everything in `rebase`, including
            // tables (like this one) created after that grant ran, so the
            // privilege has to come back off. Without it a user-context
            // query that reached this table could mint itself an admin key.
            // A security control, so it is re-applied by every instance on
            // every boot, whatever else went wrong above.
            await ddl.step("Revoking end-user access to api_keys", () =>
                exec(revokeInternalTableSql("rebase", "api_keys")));

            logger.debug("✅ API keys table ready");
        },

        // ── Create ──────────────────────────────────────────────────
        async createApiKey(request: CreateApiKeyRequest, createdBy: string): Promise<ApiKeyWithSecret> {
            const plaintext = generateApiKey();
            const hash = hashKey(plaintext);
            const prefix = keyPrefix(plaintext);
            const permissionsJson = JSON.stringify(request.permissions);

            const rows = await exec(
                `INSERT INTO ${TABLE} (name, key_prefix, key_hash, permissions, admin, rate_limit, created_by, expires_at)
                 VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
                 RETURNING *`,
                { params: [
                    request.name,
                    prefix,
                    hash,
                    permissionsJson,
                    request.admin ?? false,
                    request.rate_limit ?? null,
                    createdBy,
                    request.expires_at ?? null
                ] }
            );

            const apiKey = rowToApiKey(rows[0]);
            return {
                ...toMasked(apiKey),
                key: plaintext
            };
        },

        // ── Lookup by hash ──────────────────────────────────────────
        async findByKeyHash(hash: string): Promise<ApiKey | null> {
            const rows = await exec(
                `SELECT * FROM ${TABLE}
                 WHERE key_hash = $1
                 LIMIT 1`,
                { params: [hash] }
            );
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
            const rows = await exec(
                `SELECT * FROM ${TABLE}
                 WHERE id = $1
                 LIMIT 1`,
                { params: [id] }
            );
            if (rows.length === 0) return null;
            return toMasked(rowToApiKey(rows[0]));
        },

        // ── Update ──────────────────────────────────────────────────
        async updateApiKey(id: string, updates: UpdateApiKeyRequest): Promise<ApiKeyMasked | null> {
            const setClauses: string[] = [];
            const params: unknown[] = [];
            let paramIdx = 1;

            if (updates.name !== undefined) {
                setClauses.push(`name = $${paramIdx++}`);
                params.push(updates.name);
            }
            if (updates.permissions !== undefined) {
                setClauses.push(`permissions = $${paramIdx++}::jsonb`);
                params.push(JSON.stringify(updates.permissions));
            }
            if (updates.admin !== undefined) {
                setClauses.push(`admin = $${paramIdx++}`);
                params.push(updates.admin);
            }
            if (updates.rate_limit !== undefined) {
                if (updates.rate_limit !== null) {
                    setClauses.push(`rate_limit = $${paramIdx++}`);
                    params.push(updates.rate_limit);
                } else {
                    setClauses.push("rate_limit = NULL");
                }
            }
            if (updates.expires_at !== undefined) {
                if (updates.expires_at !== null) {
                    setClauses.push(`expires_at = $${paramIdx++}`);
                    params.push(updates.expires_at);
                } else {
                    setClauses.push("expires_at = NULL");
                }
            }

            if (setClauses.length === 0) {
                return this.getApiKeyById(id);
            }

            setClauses.push("updated_at = NOW()");

            // The WHERE id = $N uses the next available param index
            params.push(id);

            const rows = await exec(
                `UPDATE ${TABLE}
                 SET ${setClauses.join(", ")}
                 WHERE id = $${paramIdx}
                 RETURNING *`,
                { params }
            );

            if (rows.length === 0) return null;
            return toMasked(rowToApiKey(rows[0]));
        },

        // ── Revoke (soft-delete) ────────────────────────────────────
        async revokeApiKey(id: string): Promise<boolean> {
            const rows = await exec(
                `UPDATE ${TABLE}
                 SET revoked_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND revoked_at IS NULL
                 RETURNING id`,
                { params: [id] }
            );
            return rows.length > 0;
        },

        // ── Touch last_used_at ──────────────────────────────────────
        async updateLastUsed(id: string): Promise<void> {
            try {
                await exec(
                    `UPDATE ${TABLE}
                     SET last_used_at = NOW()
                     WHERE id = $1`,
                    { params: [id] }
                );
            } catch (err) {
                // Non-blocking — don't fail requests because of a usage timestamp update
                logger.error("[api-key-store] Failed to update last_used_at", { error: err });
            }
        }
    };
}
