/**
 * Shapes returned by Postgres introspection queries.
 *
 * These are **not** driver-agnostic and they are not a model of anything — each
 * one is the projection of a specific `SELECT` against `information_schema` or
 * `pg_policies`, which is why the fields are snake_cased and why `is_nullable`
 * is a string rather than a boolean. They describe rows, not concepts.
 *
 * They were spread across three places that had nothing to do with each other:
 * the `Table*` shapes sat in `websockets.ts`, next to the WebSocket frame types
 * they share no relationship with, and `PostgresPolicy` was declared twice — in
 * `@rebasepro/cms`'s RLS tab and again in `@rebasepro/studio`'s RLS editor,
 * the second with a comment explaining it was inline "to avoid depending on
 * @rebasepro/studio". Neither had to: this package is already a dependency of
 * both.
 *
 * Producer: `@rebasepro/server-postgres`. Consumers: the collection editor, the
 * studio schema browser, the RLS editors.
 */

/**
 * A column, as `information_schema.columns` reports it.
 * @group Models
 */
export interface TableColumnInfo {
    column_name: string;
    data_type: string;
    udt_name: string;
    /** `"YES"` or `"NO"` — `information_schema` reports this as text. */
    is_nullable: string;
    column_default: string | null;
    character_maximum_length: number | null;
    /** Enum values, populated for USER-DEFINED (enum) columns */
    enum_values?: string[];
}

/** @group Models */
export interface TableForeignKeyInfo {
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
}

/** @group Models */
export interface TableJunctionInfo {
    junction_table_name: string;
    source_column_name: string;
    target_table_name: string;
    target_column_name: string;
}

/**
 * A policy as the *table metadata* query projects it.
 *
 * Distinct from {@link PostgresPolicy}, which is the RLS editor's fuller
 * projection of `pg_policies` — this one carries only what the collection
 * editor needs to show that a table is protected.
 *
 * @group Models
 */
export interface TablePolicyInfo {
    policy_name: string;
    roles: string[];
    cmd: string;
    qual?: string;
    with_check?: string;
}

/** @group Models */
export interface TableMetadata {
    columns: TableColumnInfo[];
    foreignKeys: TableForeignKeyInfo[];
    junctions: TableJunctionInfo[];
    policies: TablePolicyInfo[];
}

/**
 * A row of `pg_policies`, as the RLS editors read it.
 *
 * Note the unseparated column names (`policyname`, `tablename`) — those are
 * Postgres's, not ours. See {@link TablePolicyInfo} for the narrower projection
 * the collection editor uses.
 *
 * @group Models
 */
export interface PostgresPolicy {
    policyname: string;
    tablename: string;
    permissive: "PERMISSIVE" | "RESTRICTIVE";
    roles: string[];
    cmd: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
    /** The `USING` clause. */
    qual: string | null;
    /** The `WITH CHECK` clause. */
    with_check: string | null;
    /**
     * Whether this policy exists in the live database, in the collection's
     * `securityRules`, or both. Computed by the editor, not by Postgres.
     */
    status?: "live" | "code_only" | "both";
}
