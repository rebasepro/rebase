import type { SecurityRule } from "../types/security_rules";
import type { TenantSource } from "../types/tenancy";

/**
 * The row-level security posture of a table. There is no default: a table
 * without one does not compile and does not boot.
 *
 * - `"admin-only"` — RLS on, and only the admin baseline policy: the `admin`
 *   role and the server's own code reach rows; every other caller gets none.
 * - `"inherit"` — the `defaultRls` exported from `backend/schema/index.ts`.
 *   Refused when that export is missing.
 * - a non-empty list of {@link SecurityRule} — the policies to generate.
 *
 * @group Schema
 */
export type RlsPosture = "admin-only" | "inherit" | readonly [SecurityRule, ...SecurityRule[]];

/**
 * What `backend/schema/index.ts` may export as `defaultRls`: the rules every
 * `rls: "inherit"` table takes.
 *
 * @group Schema
 */
export type DefaultRls = "admin-only" | readonly [SecurityRule, ...SecurityRule[]];

/**
 * One key of an index: a column, optionally with its sort order.
 *
 * @group Schema
 */
export interface TableIndexKey<Keys extends string = string> {
    /** A column key, or a `belongsTo` relation (its foreign-key column). */
    column: Keys | (string & {});
    /**
     * Sort order of this key. Ascending when omitted; `gin` and `brin` indexes
     * take none.
     */
    direction?: "asc" | "desc";
    /**
     * Where `NULL`s sort. When omitted, Postgres's own placement: last under `asc`,
     * first under `desc`.
     */
    nulls?: "first" | "last";
}

/**
 * The `WHERE` of a partial index.
 *
 * @group Schema
 */
export type TableIndexPredicate<Keys extends string = string> =
    | { column: Keys | (string & {}); op: "="; value: string | number | boolean }
    | { column: Keys | (string & {}); op: "!=" | "<" | "<=" | ">" | ">="; value: string | number }
    | { column: Keys | (string & {}); op: "is null" | "is not null" }
    | { column: Keys | (string & {}); op: "in"; value: readonly [string | number, ...(string | number)[]] }
    | { and: readonly [TableIndexPredicate<Keys>, ...TableIndexPredicate<Keys>[]] };

/**
 * An index a table declares.
 *
 * `columns` names what is indexed, in order. `reason` says which query it is
 * for: `rebase doctor` prints it beside the index's usage, the one moment
 * anyone can decide to delete one.
 *
 * @group Schema
 */
export interface TableIndex<Keys extends string = string> {
    /**
     * The index's keys, in order: a column key (or `belongsTo` relation), or a
     * `TableIndexKey` to give one a sort order. At least one.
     */
    columns: readonly [Keys | TableIndexKey<Keys>, ...(Keys | TableIndexKey<Keys>)[]];
    /** `btree` when omitted. `gin` and `brin` take no direction. */
    using?: "btree" | "gin" | "brin";
    /** A unique index (btree only). */
    unique?: boolean;
    /** Columns stored in the index without being part of its key (btree only). */
    include?: readonly (Keys | (string & {}))[];
    /** Index only the rows that match. */
    where?: TableIndexPredicate<Keys>;
    /** The query this index serves. */
    reason?: string;
}

/**
 * Scopes every row of a table to a tenant.
 *
 * @group Schema
 */
export interface TableTenant<Keys extends string = string> {
    /** The column that holds the tenant. */
    field: Keys;
    /** Where the caller's tenant comes from: a JWT claim, or a membership table. */
    from: TenantSource;
    /** Roles that see every tenant. `["admin"]` when omitted. */
    bypassRoles?: readonly string[];
}
