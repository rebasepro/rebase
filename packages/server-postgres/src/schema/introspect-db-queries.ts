/**
 * The catalog queries introspection runs, and the shape they produce.
 *
 * These live apart from {@link ./introspect-db.ts} (the CLI entry point) on
 * purpose: the fixture-capture script and the live e2e read a database through
 * this module too, so what the tests see is what the CLI sees. A query that
 * only exists inside the CLI's `main()` can only be tested by running the CLI.
 *
 * No side effects beyond `SELECT`. Introspection reads a database it does not
 * own — it must never `ANALYZE`, create a temp table, or otherwise write.
 */
import type {
    TableRow,
    TableColumn,
    EnumValue,
    PrimaryKeyRow,
    ForeignKeyRow,
    UniqueConstraintRow,
    CheckConstraintRow,
    CommentRow,
    SchemaMetadata
} from "./introspect-db-logic";

/** The subset of `pg.Client` this module needs, so tests can pass a fake. */
export interface QueryableClient {
    query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/**
 * Base tables, excluding partitions.
 *
 * `relispartition` is the reason this reads `pg_class` rather than
 * `information_schema.tables`, which reports every partition as a base table of
 * its own. Pagila partitions `payment` by month; introspected through
 * information_schema it yields `payment` plus 26 near-identical
 * `payment_p2022_*` collections, each with its own nav entry.
 *
 * `relkind = 'p'` (the partitioned parent) is included and `'r'` partitions are
 * dropped, which is the right way round: the parent is the queryable table.
 */
export const TABLES_QUERY = `
    SELECT c.relname AS table_name,
           c.relkind = 'p' AS is_partitioned
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND c.relname NOT LIKE 'drizzle_%'
      AND c.relname NOT LIKE 'rebase_%'
    ORDER BY c.relname
`;

/**
 * Columns, with the catalog facts that say a column is not the user's to edit.
 *
 * `is_generated`/`is_identity` are read for that reason: a generated column
 * rejects any write, so a form that offers it is offering a field that always
 * errors. `character_maximum_length` is the declared `varchar(n)` bound —
 * already enforced by the database, and free to surface as validation.
 */
export const COLUMNS_QUERY = `
    SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        c.ordinal_position,
        c.is_generated,
        c.is_identity,
        c.identity_generation,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        (SELECT a.atttypmod FROM pg_attribute a
         JOIN pg_class pc ON a.attrelid = pc.oid
         WHERE pc.relname = c.table_name
           AND a.attname = c.column_name
           AND pc.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = c.table_schema)) as atttypmod
    FROM information_schema.columns c
    WHERE c.table_schema = $1
    ORDER BY c.table_name, c.ordinal_position
`;

export const ENUMS_QUERY = `
    SELECT t.typname AS enum_name,
           e.enumlabel AS enum_value,
           e.enumsortorder AS sort_order
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = $1
    ORDER BY t.typname, e.enumsortorder
`;

/**
 * Primary key columns, in key order.
 *
 * `ORDER BY k.ord` matters for composite keys: the position of a column inside
 * the key is what tells a two-column PK made of two foreign keys apart from an
 * ordinary composite key, and `= ANY(i.indkey)` (the shape this replaced)
 * returns catalog order instead.
 */
export const PRIMARY_KEYS_QUERY = `
    SELECT t.relname AS table_name,
           a.attname AS column_name
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indisprimary AND n.nspname = $1
    ORDER BY t.relname, k.ord
`;

/**
 * Foreign keys, one row per referencing column, with the delete rule.
 *
 * Read from `pg_constraint` rather than through
 * `information_schema.constraint_column_usage`, which does not preserve the
 * pairing on a composite foreign key: it reports the cross product of the
 * constraint's columns, so a two-column FK comes back as four rows, two of them
 * pairing the wrong columns. `unnest(...) WITH ORDINALITY` on both sides joined
 * on the ordinal keeps each referencing column with the column it references.
 *
 * `confdeltype` is carried because `ON DELETE CASCADE` is the schema author
 * saying, in the database, that the child cannot outlive the parent — the one
 * unambiguous declaration of ownership a schema contains.
 *
 * Constraints declared on a *partition* are attributed to the partition root,
 * because that is the table this run generates a collection for. Pagila declares
 * `payment`'s three foreign keys on each monthly partition and none on the
 * parent, so reading `pg_constraint` at face value gives the `payment`
 * collection no relations at all. `pick = 1` then keeps one row per logical key,
 * preferring the root's own constraint when it has one, so a schema that
 * declares the key on the parent *and* inherits it onto 26 partitions does not
 * yield 27 copies of the same relation.
 */
export const FOREIGN_KEYS_QUERY = `
    WITH fk AS (
        SELECT con.oid,
               con.conname,
               con.conrelid,
               con.confrelid,
               con.conkey,
               con.confkey,
               con.confdeltype,
               COALESCE(pg_partition_root(con.conrelid), con.conrelid) AS root_oid,
               row_number() OVER (
                   PARTITION BY COALESCE(pg_partition_root(con.conrelid), con.conrelid),
                                con.confrelid, con.conkey, con.confkey
                   ORDER BY (con.conrelid = COALESCE(pg_partition_root(con.conrelid), con.conrelid)) DESC,
                            con.oid
               ) AS pick
        FROM pg_constraint con
        JOIN pg_namespace n ON n.oid = con.connamespace
        WHERE con.contype = 'f' AND n.nspname = $1
    )
    SELECT root.relname AS table_name,
           sa.attname AS column_name,
           tgt.relname AS foreign_table_name,
           ta.attname AS foreign_column_name,
           fk.conname AS constraint_name,
           s.ord::int AS ordinal,
           CASE fk.confdeltype
               WHEN 'a' THEN 'NO ACTION'
               WHEN 'r' THEN 'RESTRICT'
               WHEN 'c' THEN 'CASCADE'
               WHEN 'n' THEN 'SET NULL'
               WHEN 'd' THEN 'SET DEFAULT'
           END AS delete_rule
    FROM fk
    JOIN pg_class root ON root.oid = fk.root_oid
    JOIN pg_class tgt ON tgt.oid = fk.confrelid
    CROSS JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS s(attnum, ord)
    JOIN pg_attribute sa ON sa.attrelid = fk.conrelid AND sa.attnum = s.attnum
    CROSS JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY AS f(attnum, ord)
    JOIN pg_attribute ta ON ta.attrelid = fk.confrelid AND ta.attnum = f.attnum
    WHERE fk.pick = 1 AND s.ord = f.ord
    ORDER BY root.relname, fk.conname, s.ord
`;

/**
 * Unique constraints and unique indexes, as ordered column lists.
 *
 * Indexes rather than constraints alone, because `CREATE UNIQUE INDEX` and
 * `ADD CONSTRAINT ... UNIQUE` produce the same guarantee and schemas use both.
 * Partial indexes (`indpred IS NOT NULL`) are excluded: they promise uniqueness
 * only over the rows matching their predicate, which is not the promise a
 * `validation: { unique: true }` field makes.
 */
export const UNIQUE_CONSTRAINTS_QUERY = `
    SELECT t.relname AS table_name,
           ic.relname AS constraint_name,
           -- ::text, because the driver has no parser for an array of \`name\`
           -- and hands back the raw \`{a,b}\` literal as a string. Every consumer
           -- here indexes and compares it as an array, and a string of that
           -- shape fails those silently rather than loudly.
           array_agg(a.attname::text ORDER BY k.ord) AS column_names
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indisunique
      AND NOT i.indisprimary
      AND i.indpred IS NULL
      AND n.nspname = $1
      AND NOT t.relispartition
    GROUP BY t.relname, ic.relname
    ORDER BY t.relname, ic.relname
`;

/**
 * CHECK constraints, as the source text Postgres reproduces them from.
 *
 * `pg_get_constraintdef` output is normalized by the server — the parser in
 * {@link ./introspect-db-constraints.ts} reads that normalized form, not
 * whatever the author typed.
 */
export const CHECK_CONSTRAINTS_QUERY = `
    SELECT DISTINCT
           root.relname AS table_name,
           con.conname AS constraint_name,
           pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_namespace n ON n.oid = con.connamespace
    JOIN pg_class root ON root.oid = COALESCE(pg_partition_root(con.conrelid), con.conrelid)
    WHERE con.contype = 'c'
      AND n.nspname = $1
    ORDER BY root.relname, con.conname
`;

/**
 * `COMMENT ON TABLE` / `COMMENT ON COLUMN`, which is documentation the author
 * already wrote and which nothing downstream has ever read.
 */
export const COMMENTS_QUERY = `
    SELECT t.relname AS table_name,
           a.attname AS column_name,
           d.description AS comment
    FROM pg_description d
    JOIN pg_class t ON t.oid = d.objoid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.objsubid
    WHERE n.nspname = $1
      AND t.relkind IN ('r', 'p')
      AND (d.objsubid = 0 OR a.attname IS NOT NULL)
    ORDER BY t.relname, d.objsubid
`;

/**
 * Counts a table's rows, stopping once the answer can only be "more than
 * `limit`".
 *
 * Introspection asks this to tell a small reference table from a table that
 * merely looks like one (see `classifyTables`). `reltuples` would answer for
 * free but lies on a table that has never been analyzed — which is every table
 * in a database restored from a dump, i.e. exactly the case introspection meets
 * — and reports -1 there rather than an error, so the lie is silent.
 *
 * The subquery's LIMIT caps the work at `limit + 1` rows however large the
 * table is, so this stays cheap on a table with a billion rows.
 */
export async function countRowsUpTo(
    client: QueryableClient,
    schema: string,
    table: string,
    limit: number
): Promise<number> {
    const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM (SELECT 1 FROM "${schema}"."${table}" LIMIT ${limit + 1}) probe`
    );
    return Number(rows[0]?.count ?? 0);
}

/**
 * Reads everything the generator needs, in one pass.
 *
 * `rowCounts` is deliberately absent here: it costs a query per table and only
 * a handful of tables can possibly need it. The caller fills it in for the
 * candidates `lookupCandidates()` names.
 */
export async function readSchemaMetadata(
    client: QueryableClient,
    schema: string
): Promise<SchemaMetadata> {
    // Sequential, not `Promise.all`. A `pg.Client` is a single connection with
    // one protocol stream: concurrent `query()` calls on one are queued and
    // deprecated (removed in pg@9), so the parallel version buys nothing and
    // warns while doing it.
    const tables = await client.query<TableRow>(TABLES_QUERY, [schema]);
    const columns = await client.query<TableColumn>(COLUMNS_QUERY, [schema]);
    const enumValues = await client.query<EnumValue>(ENUMS_QUERY, [schema]);
    const pks = await client.query<PrimaryKeyRow>(PRIMARY_KEYS_QUERY, [schema]);
    const fks = await client.query<ForeignKeyRow>(FOREIGN_KEYS_QUERY, [schema]);
    const uniques = await client.query<UniqueConstraintRow>(UNIQUE_CONSTRAINTS_QUERY, [schema]);
    const checks = await client.query<CheckConstraintRow>(CHECK_CONSTRAINTS_QUERY, [schema]);
    const comments = await client.query<CommentRow>(COMMENTS_QUERY, [schema]);

    // A column list scoped to the schema still names tables this run excludes —
    // views, partitions, the drizzle bookkeeping tables. Narrow every row set to
    // the tables actually being introspected so downstream code never has to
    // ask whether a table it found in `columns` really exists.
    const known = new Set(tables.rows.map((t) => t.table_name));
    const scoped = <T extends { table_name: string }>(rows: T[]) => rows.filter((r) => known.has(r.table_name));

    return {
        schema,
        tables: tables.rows,
        columns: scoped(columns.rows),
        enumValues: enumValues.rows,
        pks: scoped(pks.rows),
        // A foreign key pointing *out* of the introspected set (into another
        // schema, or at a view) cannot be turned into a relation: there is no
        // collection on the other end to link to.
        fks: scoped(fks.rows).filter((fk) => known.has(fk.foreign_table_name)),
        uniques: scoped(uniques.rows),
        checks: scoped(checks.rows),
        comments: scoped(comments.rows),
        rowCounts: {}
    };
}
