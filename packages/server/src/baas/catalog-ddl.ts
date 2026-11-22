import type { SQLAdmin } from "@rebasepro/types";
import { logger } from "../utils/logger";

/** Postgres LISTEN/NOTIFY channel fired whenever DDL or catalog metadata changes. */
export const SCHEMA_CHANGE_CHANNEL = "rebase_schema_changed";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Provision the `rebase.*` BaaS system catalog tables in PostgreSQL.
 *
 * Idempotent (`CREATE TABLE IF NOT EXISTS`): safe to run on every boot when
 * `provision` is enabled, and never alters or drops existing data.
 */
export async function ensureBaasCatalogTables(admin: SQLAdmin): Promise<void> {
    await admin.executeSql(`CREATE SCHEMA IF NOT EXISTS "rebase"`);

    await admin.executeSql(`
        CREATE TABLE IF NOT EXISTS "rebase"."table_meta" (
            "schema_name" TEXT NOT NULL DEFAULT 'public',
            "table_name" TEXT NOT NULL,
            "slug" TEXT,
            "exposed" BOOLEAN NOT NULL DEFAULT true,
            "description" TEXT,
            "soft_delete_column" TEXT,
            "history_enabled" BOOLEAN NOT NULL DEFAULT false,
            "tenant_column" TEXT,
            "tenant_source" JSONB,
            "tenant_bypass_roles" TEXT[] NOT NULL DEFAULT ARRAY['admin']::text[],
            "search_config" JSONB,
            "column_access" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "column_storage" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "private_columns" TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
            "readonly_columns" TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
            "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY ("schema_name", "table_name")
        )
    `);

    await admin.executeSql(`
        CREATE TABLE IF NOT EXISTS "rebase"."storage_policies" (
            "id" TEXT PRIMARY KEY,
            "bucket" TEXT NOT NULL DEFAULT 'default',
            "name" TEXT NOT NULL,
            "path_pattern" TEXT NOT NULL,
            "operations" TEXT[] NOT NULL DEFAULT ARRAY['read', 'write', 'delete', 'list']::text[],
            "rule" JSONB NOT NULL,
            "enabled" BOOLEAN NOT NULL DEFAULT true,
            "priority" INTEGER NOT NULL DEFAULT 0,
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await admin.executeSql(`
        CREATE TABLE IF NOT EXISTS "rebase"."webhooks" (
            "id" TEXT PRIMARY KEY,
            "name" TEXT NOT NULL,
            "table_slug" TEXT NOT NULL,
            "events" TEXT[] NOT NULL,
            "url" TEXT NOT NULL,
            "secret" TEXT,
            "headers" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "enabled" BOOLEAN NOT NULL DEFAULT true,
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await admin.executeSql(`
        CREATE TABLE IF NOT EXISTS "rebase"."cron_jobs" (
            "id" TEXT PRIMARY KEY,
            "name" TEXT NOT NULL UNIQUE,
            "schedule" TEXT NOT NULL,
            "timezone" TEXT NOT NULL DEFAULT 'UTC',
            "kind" TEXT NOT NULL CHECK ("kind" IN ('http', 'sql')),
            "config" JSONB NOT NULL,
            "enabled" BOOLEAN NOT NULL DEFAULT true,
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await admin.executeSql(`
        CREATE TABLE IF NOT EXISTS "rebase"."roles" (
            "name" TEXT PRIMARY KEY,
            "description" TEXT,
            "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
            "is_default" BOOLEAN NOT NULL DEFAULT false,
            "assignable" BOOLEAN NOT NULL DEFAULT true,
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

/**
 * Best-effort installation of a PostgreSQL DDL event trigger that emits
 * `NOTIFY rebase_schema_changed` whenever DDL runs (tables, columns, indexes,
 * policies). Silently skipped if the database role lacks superuser privileges
 * (e.g. managed RDS / Cloud SQL / Neon) — in those environments `/api/admin/db/*`
 * and `POST /api/admin/schema/reload` still call {@link notifySchemaChanged}
 * directly.
 */
export async function ensureSchemaChangeEventTrigger(admin: SQLAdmin): Promise<boolean> {
    try {
        await admin.executeSql(`
            CREATE OR REPLACE FUNCTION "rebase"."notify_schema_change"()
            RETURNS event_trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                PERFORM pg_notify(
                    '${SCHEMA_CHANGE_CHANNEL}',
                    json_build_object('tag', tg_tag, 'ts', extract(epoch from now()))::text
                );
            END;
            $$
        `);
        await admin.executeSql(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_event_trigger WHERE evtname = 'rebase_schema_change_ddl'
                ) THEN
                    CREATE EVENT TRIGGER rebase_schema_change_ddl
                    ON ddl_command_end
                    WHEN TAG IN (
                        'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
                        'CREATE VIEW', 'DROP VIEW',
                        'CREATE POLICY', 'ALTER POLICY', 'DROP POLICY',
                        'CREATE INDEX', 'DROP INDEX',
                        'CREATE TYPE', 'ALTER TYPE', 'DROP TYPE'
                    )
                    EXECUTE FUNCTION "rebase"."notify_schema_change"();
                END IF;
            END;
            $$
        `);
        return true;
    } catch (err) {
        const code = isRecord(err) ? err.code : undefined;
        // 42501 = insufficient_privilege (expected on non-superuser managed PG)
        // 0A000 = feature_not_supported
        if (code === "42501" || code === "0A000") {
            logger.debug("Skipping DDL event trigger installation (database role lacks superuser privilege); live reload remains active via /api/admin/db/* and /api/admin/schema/reload.");
            return false;
        }
        logger.debug("Could not install DDL event trigger", {
            error: err instanceof Error ? err.message : String(err)
        });
        return false;
    }
}

/**
 * Broadcast a schema/catalog change notification on PostgreSQL `LISTEN/NOTIFY`
 * so peer replicas reload their schema registries immediately.
 */
export async function notifySchemaChanged(admin: SQLAdmin, reason: string): Promise<void> {
    try {
        await admin.executeSql(
            `SELECT pg_notify($1, $2)`,
            { params: [SCHEMA_CHANGE_CHANNEL, JSON.stringify({ reason, ts: Date.now() })] }
        );
    } catch (err) {
        logger.debug("Failed to broadcast schema change notification", {
            reason,
            error: err instanceof Error ? err.message : String(err)
        });
    }
}
