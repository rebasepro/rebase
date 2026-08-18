/**
 * The collections schema version, stamped into the database.
 *
 * Deliberately the same table shape, the same key/value convention and the same
 * "unstamped is null, and null is not an error" rule as `auth/schema-version.ts`.
 * They answer the same kind of question — "was this database provisioned by
 * something that agrees with me" — and inventing a second convention for the
 * second one would be a second thing to find, back up and reason about.
 *
 * It does *not* follow the auth stamp's schema. `resolveAuthSchema` tracks the
 * users collection, so a project that puts its users in a custom schema moves
 * the auth stamp with them — correct there, because that stamp describes those
 * tables. This one describes the collections as a whole and belongs with the
 * runtime's own internal state, which is always `rebase`. Usually they land in
 * the same table anyway; when they do not, that is the reason.
 *
 * The value is opaque here on purpose. It is a hash produced by
 * `computeSchemaVersion` in `@rebasepro/types`, and this module's only job is to
 * put a string in and take the same string out. Comparing them, and deciding
 * what a difference means, is `boot/schema-stamp.ts` in the runtime — where it
 * can be tested without a database.
 *
 * Unlike the auth version, this is **not** ordered. The auth stamp is an integer
 * whose comparison direction carries meaning (a database newer than the runtime
 * is unrecoverable, older is the ordinary upgrade path). A schema hash has no
 * order at all: it can say the two disagree and never which is ahead. That is a
 * deliberate limit, and the reason the runtime's response to a mismatch is to
 * describe it rather than to decide who is wrong.
 */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** Key under which the version is stored in the meta table. */
const VERSION_KEY = "collections_schema_version";

/**
 * Anything that can run SQL for us.
 *
 * Narrower than `NodePgDatabase` so the provisioning handle — which is what the
 * boot path actually has in hand — satisfies it without a cast at every call
 * site.
 */
export interface SchemaMetaQueryable {
    execute(query: unknown): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Read the stamped version, or `null` when this database has never been stamped.
 *
 * `to_regclass` rather than a plain `SELECT` so a missing schema or table is a
 * `null` instead of a thrown 42P01 — the overwhelmingly common case on a fresh
 * database is that neither exists yet, and that is not news.
 */
export async function readCollectionsSchemaVersion(
    db: SchemaMetaQueryable | NodePgDatabase,
    metaSchema: string
): Promise<string | null> {
    const qualified = `"${metaSchema}"."schema_meta"`;
    const exists = await (db as SchemaMetaQueryable).execute(
        sql`SELECT to_regclass(${qualified}) IS NOT NULL AS present`
    );
    if (!(exists.rows[0] as { present: boolean } | undefined)?.present) return null;

    const result = await (db as SchemaMetaQueryable).execute(sql`
        SELECT value FROM ${sql.raw(qualified)} WHERE key = ${VERSION_KEY}
    `);
    const raw = (result.rows[0] as { value: string } | undefined)?.value;

    // An empty string is not a version anybody computed, and treating it as one
    // would make every process disagree with the database forever. Unstamped.
    return raw === undefined || raw.trim() === "" ? null : raw;
}

/**
 * Record the version this runtime just applied.
 *
 * Creates the meta table if the auth stamp has not already — the two are
 * independent halves of one boot and either may run first, so neither can assume
 * the table is there. `CREATE TABLE IF NOT EXISTS` is not atomic against a
 * concurrent identical statement, which is exactly the race a split deployment
 * arranges; it is tolerated here for the same reason it is elsewhere in the boot
 * path, and the caller treats any failure as a warning rather than a fatal.
 */
export async function stampCollectionsSchemaVersion(
    db: SchemaMetaQueryable | NodePgDatabase,
    metaSchema: string,
    version: string
): Promise<void> {
    const qualified = `"${metaSchema}"."schema_meta"`;
    await (db as SchemaMetaQueryable).execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(metaSchema)}`);
    await (db as SchemaMetaQueryable).execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.raw(qualified)} (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        )
    `);
    await (db as SchemaMetaQueryable).execute(sql`
        INSERT INTO ${sql.raw(qualified)} (key, value)
        VALUES (${VERSION_KEY}, ${version})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `);
}
