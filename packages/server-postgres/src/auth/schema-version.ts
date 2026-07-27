import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig } from "@rebasepro/types";

/**
 * The auth schema version this runtime expects to find in the database.
 *
 * Bump this whenever a migration in `ensureAuthTablesExist` makes the schema
 * unreadable by the runtime that came before it — that is, whenever a *previous*
 * version's auth queries would break against the migrated shape. Additive
 * changes (a new nullable column nobody older references) do not need a bump.
 *
 * History. Note that 1 is a label for an era, not a value any database holds:
 * stamping did not exist then, so an era-1 database reads as unstamped
 * (`null`), and 2 is the first version ever actually written. The numbering
 * starts at 2 only because two schema eras already existed when it was
 * introduced; it could just as well have started at 1. It is not worth
 * renumbering now — deployed databases already carry 2, and lowering the
 * constant would make them look newer than the runtime and refuse the boot.
 *
 *   1 — Device-session refresh tokens. A row *was* a session, identified by
 *       `unique_device_session UNIQUE (uid, user_agent, ip_address)`, and
 *       `createToken` upserted with `ON CONFLICT (uid, user_agent, ip_address)`.
 *   2 — Session-scoped, rotation-safe refresh tokens: `session_id`, `revoked`,
 *       `rotated_at`, `session_started_at`, and `unique_device_session`
 *       dropped because two live tokens of one session share all three columns.
 *
 * The 1 → 2 migration is why this file exists. Dropping the constraint is
 * one-way: a version-1 runtime deployed afterwards boots perfectly, logs
 * `✅ Auth tables ready` (its `CREATE TABLE IF NOT EXISTS` never revisits the
 * existing table, so it cannot re-add the constraint), answers `/health` with
 * 200 — and then fails every single login and refresh with SQLSTATE 42P10,
 * because its `ON CONFLICT` names a constraint that no longer exists. A silent
 * total auth outage behind a green health check. The stamp below turns that
 * into a boot refusal.
 */
export const AUTH_SCHEMA_VERSION = 2;

/** Key under which the version is stored in the auth schema's meta table. */
const VERSION_KEY = "auth_schema_version";

/**
 * Columns `refresh_tokens` must have for the current runtime's auth write path
 * to work. Checked by the health probe so a database that drifted *below* this
 * runtime is reported as unhealthy rather than discovered one failed login at a
 * time. Kept in step with the migration in `ensureAuthTablesExist`.
 */
const REQUIRED_REFRESH_TOKEN_COLUMNS = ["session_id", "revoked", "rotated_at", "session_started_at"];

/**
 * A constraint whose *presence* means the database is still at version 1, in a
 * shape this runtime's rotation logic cannot write to: it makes two live tokens
 * of one rotating session collide.
 */
const RETIRED_REFRESH_TOKEN_CONSTRAINT = "unique_device_session";

/**
 * Thrown when the database was migrated by a runtime newer than this one.
 *
 * Distinct class rather than a bare `Error` because `ensureAuthTablesExist`
 * wraps its migrations in a catch that deliberately swallows failures and
 * continues — every other problem there is better survived than crashed on.
 * This one is not, so the catch rethrows on this type specifically.
 */
export class AuthSchemaVersionError extends Error {
    readonly databaseVersion: number;
    readonly runtimeVersion: number;

    constructor(databaseVersion: number, runtimeVersion: number) {
        super(
            `Auth schema version mismatch: the database is at version ${databaseVersion}, ` +
            `but this runtime understands version ${runtimeVersion}.\n\n` +
            "A newer version of the framework has already migrated this database. Running this " +
            "older runtime against it would boot cleanly and then fail every login and token " +
            "refresh, because the auth schema it expects no longer exists.\n\n" +
            "Refusing to start. Deploy a framework version at or above the one that migrated " +
            "this database, or restore the database from a backup taken before the upgrade."
        );
        this.name = "AuthSchemaVersionError";
        this.databaseVersion = databaseVersion;
        this.runtimeVersion = runtimeVersion;
    }
}

/**
 * The schema the auth tables live in, derived exactly as `ensureAuthTablesExist`
 * derives it. Shared so the two cannot drift: a stamp written to one schema and
 * read from another would read as "never stamped" forever.
 */
export function resolveAuthSchema(collection?: CollectionConfig): string {
    if (!collection) return "rebase";
    const usersSchema = ("schema" in collection && typeof collection.schema === "string")
        ? collection.schema
        : "public";
    return usersSchema === "public" ? "rebase" : usersSchema;
}

/**
 * Read the stamped version, or `null` when the database has never been stamped.
 *
 * `null` is not an error and must not be treated as one: every database
 * provisioned before this file existed is unstamped, and so is every fresh one.
 * Uses `to_regclass` rather than selecting straight from the table so a missing
 * schema or table is a `null` rather than a thrown 42P01.
 */
export async function readAuthSchemaVersion(
    db: NodePgDatabase,
    authSchema: string
): Promise<number | null> {
    const qualified = `"${authSchema}"."schema_meta"`;
    const exists = await db.execute(sql`SELECT to_regclass(${qualified}) IS NOT NULL AS present`);
    if (!(exists.rows[0] as { present: boolean } | undefined)?.present) return null;

    const result = await db.execute(sql`
        SELECT value FROM ${sql.raw(qualified)} WHERE key = ${VERSION_KEY}
    `);
    const raw = (result.rows[0] as { value: string } | undefined)?.value;
    if (raw === undefined) return null;

    const parsed = Number.parseInt(raw, 10);
    // A meta row we cannot parse is treated as unstamped rather than as version
    // 0: refusing to boot over a garbled string would be a worse failure than
    // the drift it is meant to catch.
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Refuse to run against a database a newer runtime has already migrated.
 *
 * Deliberately one-directional. A database *older* than this runtime is the
 * normal upgrade path — the migrations in `ensureAuthTablesExist` are about to
 * bring it forward, so it is not an error. Only the reverse is unrecoverable.
 */
export async function assertAuthSchemaCompatible(
    db: NodePgDatabase,
    authSchema: string
): Promise<void> {
    const databaseVersion = await readAuthSchemaVersion(db, authSchema);
    if (databaseVersion !== null && databaseVersion > AUTH_SCHEMA_VERSION) {
        throw new AuthSchemaVersionError(databaseVersion, AUTH_SCHEMA_VERSION);
    }
}

/**
 * Record that this runtime's migrations have been applied.
 *
 * Called at the end of `ensureAuthTablesExist`, so a boot that failed partway
 * through leaves the older stamp in place and the next boot migrates again.
 */
export async function stampAuthSchemaVersion(
    db: NodePgDatabase,
    authSchema: string
): Promise<void> {
    const qualified = `"${authSchema}"."schema_meta"`;
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.raw(qualified)} (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        )
    `);
    await db.execute(sql`
        INSERT INTO ${sql.raw(qualified)} (key, value)
        VALUES (${VERSION_KEY}, ${String(AUTH_SCHEMA_VERSION)})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `);
}

/** What {@link probeAuthSchema} found. */
export interface AuthSchemaProbeResult {
    /** False when this runtime cannot be trusted to serve auth against this database. */
    healthy: boolean;
    /** The stamped version, or `null` on a database that predates stamping. */
    databaseVersion: number | null;
    /** {@link AUTH_SCHEMA_VERSION}. */
    runtimeVersion: number;
    /** Human-readable descriptions of each mismatch found. Empty when healthy. */
    problems: string[];
}

/**
 * Check that the auth schema is one this runtime can actually write to.
 *
 * Two independent checks, because either alone has a blind spot:
 *
 *  - The **stamp** catches a runtime older than the database. It is the precise
 *    signal, but it is blind on every database provisioned before stamping
 *    existed — which today is all of them.
 *  - The **structure** catches a database older than the runtime, and works on
 *    unstamped databases. It is what makes this useful immediately rather than
 *    one upgrade cycle from now.
 *
 * Never throws: a probe that fails to run reports unhealthy with the reason, so
 * a broken check surfaces as a degraded health response rather than a 500 from
 * the health endpoint itself.
 */
export async function probeAuthSchema(
    db: NodePgDatabase,
    authSchema: string
): Promise<AuthSchemaProbeResult> {
    const problems: string[] = [];
    let databaseVersion: number | null = null;

    try {
        databaseVersion = await readAuthSchemaVersion(db, authSchema);
        if (databaseVersion !== null && databaseVersion > AUTH_SCHEMA_VERSION) {
            problems.push(
                `database is at auth schema version ${databaseVersion}, this runtime understands ` +
                `${AUTH_SCHEMA_VERSION} — it was migrated by a newer framework version`
            );
        }

        const refreshTokens = `"${authSchema}"."refresh_tokens"`;
        const present = await db.execute(sql`SELECT to_regclass(${refreshTokens}) IS NOT NULL AS present`);
        if (!(present.rows[0] as { present: boolean } | undefined)?.present) {
            // Not a problem in itself: auth may simply not be configured on this
            // deployment, and the table is created on demand at boot when it is.
            return { healthy: problems.length === 0, databaseVersion, runtimeVersion: AUTH_SCHEMA_VERSION, problems };
        }

        const columns = await db.execute(sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = ${authSchema} AND table_name = 'refresh_tokens'
        `);
        const found = new Set((columns.rows as { column_name: string }[]).map(row => row.column_name));
        const missing = REQUIRED_REFRESH_TOKEN_COLUMNS.filter(column => !found.has(column));
        if (missing.length > 0) {
            problems.push(
                `refresh_tokens is missing ${missing.join(", ")} — the auth migrations have not been ` +
                "applied to this database, so token rotation will fail"
            );
        }

        const retired = await db.execute(sql`
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = ${authSchema}
              AND t.relname = 'refresh_tokens'
              AND c.conname = ${RETIRED_REFRESH_TOKEN_CONSTRAINT}
        `);
        if (retired.rows.length > 0) {
            problems.push(
                `refresh_tokens still carries ${RETIRED_REFRESH_TOKEN_CONSTRAINT} — concurrent token ` +
                "rotation for one session will fail on it"
            );
        }
    } catch (error: unknown) {
        problems.push(
            `auth schema probe failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    return {
        healthy: problems.length === 0,
        databaseVersion,
        runtimeVersion: AUTH_SCHEMA_VERSION,
        problems
    };
}
