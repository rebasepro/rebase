/**
 * The one description of what an auth user table's columns must be.
 *
 * ## Why this exists
 *
 * Three different code paths create `rebase.users`, and before this module they
 * disagreed about it:
 *
 * | column           | `db push` (generator) | `ensureAuthTablesExist` | `ensureCollectionTables` |
 * |------------------|-----------------------|-------------------------|--------------------------|
 * | `email`          | `TEXT UNIQUE NOT NULL`| `TEXT NOT NULL` + CHECK | `TEXT` (nullable)        |
 * | `roles`          | `TEXT[]`              | `NOT NULL DEFAULT '{}'` | nullable, no default     |
 * | `email_verified` | `BOOLEAN`             | `NOT NULL DEFAULT FALSE`| nullable                 |
 * | `created_at`     | `DEFAULT now()`       | `NOT NULL DEFAULT NOW()`| no default               |
 *
 * They are all `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so
 * whichever ran first decided the table and the other two silently no-op'd.
 * Boot order therefore chose the constraints: a managed deploy (collection
 * tables first) got a users table whose `email` was nullable and whose
 * `email_verified` had no default, while the same project pushed from a
 * checkout got the strict one. In the same table, `is_anonymous` came out
 * `NOT NULL DEFAULT false` — because *that* column existed in only one of the
 * three lists, so its owner's definition won by default.
 *
 * A second consequence was drift in the other direction. The scaffold's
 * `users.ts` describes 12 columns; auth needs 14. `db push` is declarative and
 * builds its desired state from the collection alone, so the two columns only
 * auth knows about (`is_anonymous`, `tokens_valid_after`) read as unmanaged
 * drift, and a push run after the server had booted once planned to DROP them.
 *
 * Both problems are the same problem: no single place said what this table is.
 * This is that place. Every creator asks here first and only then falls back to
 * the collection's own property definitions, so a column auth owns has one
 * definition regardless of who gets there first, and a column the developer
 * added to their users collection still behaves like any other field.
 *
 * ## What belongs here
 *
 * Only columns the auth services read or write. A developer's own additions to
 * their users collection (`bio`, `stripe_customer_id`) are ordinary columns and
 * must NOT be listed — they are generated from the collection like every other
 * field, and listing them here would freeze a user's schema.
 *
 * `id` is deliberately absent: its type comes from the collection's id property
 * (uuid / increment / text) and each creator already derives it.
 *
 * Keep in step with {@link AUTH_SCHEMA_VERSION} when a change here makes an
 * older runtime unable to work against a migrated table.
 */

/**
 * A column auth owns.
 *
 * Structured rather than one SQL string because the same facts are needed in
 * three grammars — a `CREATE TABLE` column list, an `ADD COLUMN IF NOT EXISTS`,
 * and a pair of `ALTER COLUMN … SET DEFAULT` / `SET NOT NULL` reconciles for a
 * table that already exists with the wrong shape. Parsing a string back apart
 * for the third of those is how the copies drifted in the first place.
 */
export interface AuthUsersColumn {
    /** Physical column name. */
    column: string;
    /** Postgres type. */
    type: string;
    /** Default expression, verbatim, or absent for no default. */
    default?: string;
    /** Whether the column is NOT NULL. */
    notNull?: boolean;
}

/**
 * `email` is NOT NULL on purpose, and the anonymous sign-in route depends on it
 * — it synthesizes `anon_<32 hex>@anonymous.local` rather than inserting NULL.
 * The 320-char bound (RFC 5321) is a CHECK rather than a `VARCHAR(n)`, added
 * separately by `ensureAuthTablesExist` so it can be `NOT VALID` on an adopted
 * table that already holds a longer row.
 */
export const AUTH_USERS_COLUMNS: readonly AuthUsersColumn[] = [
    { column: "email", type: "TEXT", notNull: true },
    { column: "display_name", type: "TEXT" },
    { column: "photo_url", type: "TEXT" },
    { column: "roles", type: "TEXT[]", default: "'{}'", notNull: true },
    { column: "password_hash", type: "TEXT" },
    { column: "email_verified", type: "BOOLEAN", default: "FALSE", notNull: true },
    { column: "email_verification_token", type: "TEXT" },
    { column: "email_verification_sent_at", type: "TIMESTAMP WITH TIME ZONE" },
    { column: "is_anonymous", type: "BOOLEAN", default: "FALSE", notNull: true },
    { column: "metadata", type: "JSONB", default: "'{}'", notNull: true },
    { column: "tokens_valid_after", type: "TIMESTAMP WITH TIME ZONE" },
    { column: "created_at", type: "TIMESTAMP WITH TIME ZONE", default: "NOW()", notNull: true },
    { column: "updated_at", type: "TIMESTAMP WITH TIME ZONE", default: "NOW()", notNull: true }
];

const BY_COLUMN = new Map(AUTH_USERS_COLUMNS.map(c => [c.column, c]));

/** Type + inline constraints, as they appear after the column name. */
export function authUsersColumnSql(spec: AuthUsersColumn): string {
    return [
        spec.type,
        spec.default !== undefined ? `DEFAULT ${spec.default}` : "",
        spec.notNull ? "NOT NULL" : ""
    ].filter(Boolean).join(" ");
}

/**
 * The auth-owned definition for a physical column name, or `undefined` when
 * auth does not own it.
 *
 * Callers pass the RESOLVED column name (after `columnName` mapping), because
 * that is the only name the three creators agree on: the scaffold's users
 * collection spells the property `displayName` and the column `display_name`.
 */
export function authUsersColumnDefinition(column: string): string | undefined {
    const spec = BY_COLUMN.get(column);
    return spec ? authUsersColumnSql(spec) : undefined;
}

/**
 * Whether a collection is an auth collection, i.e. whether the definitions in
 * this module apply to its table at all.
 *
 * Duplicated in shape from `@rebasepro/common`'s policy defaults on purpose:
 * that one takes a `CollectionConfig`, this one is called from DDL code paths
 * that hold looser objects, and both spellings must accept `auth: true` as well
 * as `auth: { enabled: true }`.
 */
export function isAuthCollection(collection: unknown): boolean {
    const auth = (collection as { auth?: unknown } | undefined)?.auth;
    if (auth === true) return true;
    return typeof auth === "object" && auth !== null && (auth as { enabled?: unknown }).enabled === true;
}
