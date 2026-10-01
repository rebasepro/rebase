/**
 * Database operations for API keys.
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
    ApiKeyKind,
    ApiKeyMasked,
    ApiKeyWithSecret,
    UpdateApiKeyRequest
} from "./api-key-types";
import { parseStoredPermissions, scopesFromStoredPermissions } from "./legacy-permissions";

const TABLE = "rebase.api_keys";

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
        kind: row.kind,
        key_prefix: row.key_prefix,
        scopes: row.scopes,
        roles: row.roles,
        owner_uid: row.owner_uid,
        rate_limit: row.rate_limit,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_used_at: row.last_used_at,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at
    };
}

/** A JSONB string array as the driver hands it back: parsed, or JSON text. */
function stringList(value: unknown): string[] {
    let raw = value;
    if (typeof raw === "string") {
        try {
            raw = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Parse a raw DB row into the typed `ApiKey` shape.
 */
function rowToApiKey(row: Record<string, unknown>): ApiKey {
    // A row an older runtime wrote after this one backfilled the table has
    // no scopes yet; it is read the way the backfill would write it.
    const grant = row.scopes === null || row.scopes === undefined
        ? scopesFromStoredPermissions(parseStoredPermissions(row.permissions), row.admin === true)
        : { scopes: stringList(row.scopes), roles: stringList(row.roles) };
    return {
        id: String(row.id),
        name: String(row.name),
        kind: row.kind === "personal" ? "personal" : "service",
        key_prefix: String(row.key_prefix),
        key_hash: String(row.key_hash),
        scopes: grant.scopes,
        roles: grant.roles,
        owner_uid: typeof row.owner_uid === "string" ? row.owner_uid : null,
        rate_limit: row.rate_limit !== null && row.rate_limit !== undefined
            ? Number(row.rate_limit)
            : null,
        created_by: String(row.created_by),
        created_at: new Date(String(row.created_at)).toISOString(),
        updated_at: new Date(String(row.updated_at)).toISOString(),
        last_used_at: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : null,
        expires_at: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
        revoked_at: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null
    };
}

// ─── Public API ──────────────────────────────────────────────────────

/** What a new key row is made of, already validated by the route that asked. */
export interface NewApiKey {
    name: string;
    kind: ApiKeyKind;
    scopes: string[];
    /** RLS roles beside `service`. Always empty for a personal key. */
    roles: string[];
    /** The account a personal key acts as. */
    owner_uid: string | null;
    rate_limit: number | null;
    expires_at: string | null;
}

/** Which keys a listing returns. */
export type ApiKeyFilter =
    | { kind: "service" }
    | { kind: "personal"; owner_uid: string };

export interface ApiKeyStore {
    /** Ensure the `rebase.api_keys` table exists. Called once on startup. */
    ensureTable(): Promise<void>;

    /** Create a new API key. Returns the full plaintext key exactly once. */
    createApiKey(key: NewApiKey, createdBy: string): Promise<ApiKeyWithSecret>;

    /** Look up an API key by its SHA-256 hash. Returns `null` if not found. */
    findByKeyHash(hash: string): Promise<ApiKey | null>;

    /** List keys (masked, never includes hash), newest first. */
    listApiKeys(filter: ApiKeyFilter): Promise<ApiKeyMasked[]>;

    /** Get a single API key by ID (masked). */
    getApiKeyById(id: string): Promise<ApiKeyMasked | null>;

    /** Update name, scopes, roles, rate_limit, or expires_at. */
    updateApiKey(id: string, updates: UpdateApiKeyRequest): Promise<ApiKeyMasked | null>;

    /**
     * Soft-delete: set `revoked_at` to now. With `owner_uid`, only that
     * account's personal key is revoked — the answer is false for anyone
     * else's, so a route can 404 without saying whether the id exists.
     */
    revokeApiKey(id: string, owner_uid?: string): Promise<boolean>;

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

    /**
     * Give every row stored before scopes existed the scopes it now holds.
     *
     * Idempotent and race-safe: a row is only written while its `scopes` is
     * still NULL, so two instances backfilling together write the same value
     * once. The `permissions` and `admin` columns are left as they are, so a
     * runtime that predates scopes still reads its own keys after a rollback.
     */
    async function backfillScopes(): Promise<void> {
        const rows = await exec(`SELECT id, permissions, admin FROM ${TABLE} WHERE scopes IS NULL`);
        for (const row of rows) {
            const { scopes, roles } = scopesFromStoredPermissions(
                parseStoredPermissions(row.permissions),
                row.admin === true
            );
            await exec(
                `UPDATE ${TABLE} SET scopes = $1::jsonb, roles = $2::jsonb WHERE id = $3 AND scopes IS NULL`,
                { params: [JSON.stringify(scopes), JSON.stringify(roles), row.id] }
            );
        }
        if (rows.length > 0) {
            logger.info(`[api-key-store] Gave ${rows.length} stored API key(s) their scopes.`);
        }
    }

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
                    kind TEXT NOT NULL DEFAULT 'service',
                    key_prefix TEXT NOT NULL,
                    key_hash TEXT NOT NULL UNIQUE,
                    scopes JSONB,
                    roles JSONB NOT NULL DEFAULT '[]'::jsonb,
                    owner_uid TEXT,
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

            // The columns a table created before scopes lacks. Idempotent and
            // raced like the rest — two instances running them together can
            // deadlock on the table's catalog lock, which `ensureObject` retries.
            await ddl.ensureObject(`Adding ${TABLE}.kind`, `
                ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'service'
            `);
            await ddl.ensureObject(`Adding ${TABLE}.scopes`, `
                ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS scopes JSONB
            `);
            await ddl.ensureObject(`Adding ${TABLE}.roles`, `
                ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS roles JSONB NOT NULL DEFAULT '[]'::jsonb
            `);
            await ddl.ensureObject(`Adding ${TABLE}.owner_uid`, `
                ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS owner_uid TEXT
            `);
            await ddl.ensureObject("Creating idx_api_keys_owner", `
                CREATE INDEX IF NOT EXISTS idx_api_keys_owner
                ON ${TABLE}(owner_uid) WHERE owner_uid IS NOT NULL
            `);

            // Keyed on what exists, not on who created it, so an instance that
            // lost any race above still takes the table off the end-user role.
            if (!await ddl.isReadable(TABLE)) {
                logger.error(
                    `❌ [api-key-store] ${TABLE} is unavailable — every API-key authenticated ` +
                    "request will be rejected on this instance, and the table could not be " +
                    "taken back off the end-user role."
                );
                return;
            }

            // This table holds key hashes and the scopes each grants, and it
            // has no RLS — it is not a collection. The Postgres driver grants
            // the authenticated role DML on everything in `rebase`, including
            // tables (like this one) created after that grant ran, so the
            // privilege has to come back off. Without it a user-context query
            // that reached this table could mint itself a key. A security
            // control, so it is re-applied by every instance on every boot.
            await ddl.step("Revoking end-user access to api_keys", () =>
                exec(revokeInternalTableSql("rebase", "api_keys")));

            // Only a table that has the old columns has rows to backfill.
            const legacyColumns = await exec(
                `SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'rebase' AND table_name = 'api_keys' AND column_name = 'permissions'`
            );
            if (legacyColumns.length > 0) {
                await ddl.step("Backfilling API key scopes", backfillScopes);
            }

            logger.debug("✅ API keys table ready");
        },

        // ── Create ──────────────────────────────────────────────────
        async createApiKey(key: NewApiKey, createdBy: string): Promise<ApiKeyWithSecret> {
            const plaintext = generateApiKey();
            const hash = hashKey(plaintext);
            const prefix = keyPrefix(plaintext);

            const rows = await exec(
                `INSERT INTO ${TABLE} (name, kind, key_prefix, key_hash, scopes, roles, owner_uid, rate_limit, created_by, expires_at)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
                 RETURNING *`,
                { params: [
                    key.name,
                    key.kind,
                    prefix,
                    hash,
                    JSON.stringify(key.scopes),
                    JSON.stringify(key.kind === "personal" ? [] : key.roles),
                    key.owner_uid,
                    key.rate_limit,
                    createdBy,
                    key.expires_at
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

        // ── List (masked) ───────────────────────────────────────────
        async listApiKeys(filter: ApiKeyFilter): Promise<ApiKeyMasked[]> {
            const rows = filter.kind === "personal"
                ? await exec(
                    `SELECT * FROM ${TABLE}
                     WHERE kind = 'personal' AND owner_uid = $1
                     ORDER BY created_at DESC`,
                    { params: [filter.owner_uid] }
                )
                : await exec(`
                    SELECT * FROM ${TABLE}
                    WHERE kind = 'service'
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
            if (updates.scopes !== undefined) {
                setClauses.push(`scopes = $${paramIdx++}::jsonb`);
                params.push(JSON.stringify(updates.scopes));
            }
            if (updates.roles !== undefined) {
                setClauses.push(`roles = $${paramIdx++}::jsonb`);
                params.push(JSON.stringify(updates.roles));
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
                 WHERE id = $${paramIdx} AND kind = 'service'
                 RETURNING *`,
                { params }
            );

            if (rows.length === 0) return null;
            return toMasked(rowToApiKey(rows[0]));
        },

        // ── Revoke (soft-delete) ────────────────────────────────────
        async revokeApiKey(id: string, owner_uid?: string): Promise<boolean> {
            const rows = owner_uid === undefined
                ? await exec(
                    `UPDATE ${TABLE}
                     SET revoked_at = NOW(), updated_at = NOW()
                     WHERE id = $1 AND kind = 'service' AND revoked_at IS NULL
                     RETURNING id`,
                    { params: [id] }
                )
                : await exec(
                    `UPDATE ${TABLE}
                     SET revoked_at = NOW(), updated_at = NOW()
                     WHERE id = $1 AND kind = 'personal' AND owner_uid = $2 AND revoked_at IS NULL
                     RETURNING id`,
                    { params: [id, owner_uid] }
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
