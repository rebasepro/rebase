/**
 * Runtime introspection — builds collections in memory from the live database.
 *
 * This is what makes BaaS mode work with zero configuration: instead of loading
 * collection files from disk, the server reads `information_schema` at boot and
 * derives a collection per table, so any database is served over REST without a
 * single config file.
 *
 * Distinct from `introspect-db.ts`, which runs the same queries but emits
 * TypeScript *source* for a developer to edit and commit (declared collections). The two
 * share the mapping helpers in `introspect-db-logic.ts` so a table is described
 * the same way whether it was generated or introspected.
 */
import type { PostgresCollectionConfig } from "@rebasepro/types";

import {
    TableRow,
    TableColumn,
    EnumValue,
    PrimaryKeyRow,
    ForeignKeyRow,
    TableMeta,
    buildTablesMap,
    buildEnumMap,
    identifyJoinTables,
    singularize,
    mapPgType,
    getIconForTable
} from "./introspect-db-logic";
import { humanize } from "./introspect-db-naming";
import { firstFreeKey, toWireKey } from "@rebasepro/utils";

export interface IntrospectedSchema {
    tablesMap: Map<string, TableMeta>;
    enumMap: Map<string, string[]>;
    joinTables: Set<string>;
}

/** Whether a table carries an authorization model of its own. */
export interface TableRlsStatus {
    table: string;
    /** ALTER TABLE … ENABLE ROW LEVEL SECURITY has been run. */
    rlsEnabled: boolean;
    /** Policies attached to it. RLS enabled with none = nothing is visible. */
    policyCount: number;
}

/**
 * Read the RLS posture of each table in a schema.
 *
 * This is what decides whether baas mode may serve a table. A table with RLS
 * disabled has no authorization model: since every authenticated request runs
 * as `rebase_user`, and that role is granted DML on the schema, serving such a
 * table hands every row to every logged-in user.
 */
export async function readRlsStatus(client: Queryable, pgSchema: string): Promise<Map<string, TableRlsStatus>> {
    const { rows } = await client.query<{ table: string; rls_enabled: boolean; policy_count: string | number }>(
        `SELECT c.relname AS table,
                c.relrowsecurity AS rls_enabled,
                (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'r'`,
        [pgSchema]
    );

    return new Map(
        rows.map((r) => [
            r.table,
            { table: r.table, rlsEnabled: r.rls_enabled === true, policyCount: Number(r.policy_count ?? 0) }
        ])
    );
}

/** Minimal query surface — satisfied by pg.Client and pg.Pool alike. */
export interface Queryable {
    query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/**
 * Read tables, columns, enums, primary keys and foreign keys for a schema.
 * Mirrors the queries in introspect-db.ts.
 */
export async function introspectSchema(client: Queryable, pgSchema: string): Promise<IntrospectedSchema> {
    const { rows: tables } = await client.query<TableRow>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'
           AND table_name NOT LIKE 'drizzle_%'
           AND table_name NOT LIKE 'rebase_%'
         ORDER BY table_name`,
        [pgSchema]
    );

    const { rows: columns } = await client.query<TableColumn>(
        `SELECT
            c.table_name,
            c.column_name,
            c.data_type,
            c.udt_name,
            c.is_nullable,
            c.column_default,
            (SELECT a.atttypmod FROM pg_attribute a
             JOIN pg_class pc ON a.attrelid = pc.oid
             WHERE pc.relname = c.table_name
               AND a.attname = c.column_name
               AND pc.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = c.table_schema)) as atttypmod
         FROM information_schema.columns c
         WHERE c.table_schema = $1`,
        [pgSchema]
    );

    const { rows: enumValues } = await client.query<EnumValue>(
        `SELECT t.typname AS enum_name,
                e.enumlabel AS enum_value,
                e.enumsortorder AS sort_order
         FROM pg_type t
         JOIN pg_enum e ON t.oid = e.enumtypid
         JOIN pg_namespace n ON t.typnamespace = n.oid
         WHERE n.nspname = $1
         ORDER BY t.typname, e.enumsortorder`,
        [pgSchema]
    );

    const { rows: pks } = await client.query<PrimaryKeyRow>(
        `SELECT t.relname as table_name, a.attname as column_name
         FROM   pg_index i
         JOIN   pg_attribute a ON a.attrelid = i.indrelid
                             AND a.attnum = ANY(i.indkey)
         JOIN   pg_class t ON t.oid = i.indrelid
         JOIN   pg_namespace n ON n.oid = t.relnamespace
         WHERE  i.indisprimary AND n.nspname = $1`,
        [pgSchema]
    );

    const { rows: fks } = await client.query<ForeignKeyRow>(
        `SELECT
            tc.table_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
         FROM information_schema.table_constraints AS tc
         JOIN information_schema.key_column_usage AS kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage AS ccu
           ON ccu.constraint_name = tc.constraint_name
           AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
        [pgSchema]
    );

    const tablesMap = buildTablesMap(tables, columns, pks, fks);
    return {
        tablesMap,
        enumMap: buildEnumMap(enumValues),
        joinTables: identifyJoinTables(tablesMap)
    };
}

/** Derive the `isId` flavour for a primary-key column. */
function idKindFor(col: TableColumn, propType: string): "uuid" | "increment" | true {
    if (col.data_type.toLowerCase() === "uuid") return "uuid";
    if (propType === "number") return "increment";
    return true;
}

function buildProperties(
    meta: TableMeta,
    enumMap: Map<string, string[]>
): Record<string, Record<string, unknown>> {
    const properties: Record<string, Record<string, unknown>> = {};
    const takenKeys = new Set<string>();

    for (const col of meta.columns) {
        const isPk = meta.pks.includes(col.column_name);
        // Foreign keys surface as relations below, unless they are also part of
        // the primary key, in which case the column itself must stay.
        const isFk = meta.fks.some((fk) => fk.column_name === col.column_name);
        if (isFk && !isPk) continue;

        const enumValues = enumMap.get(col.udt_name);
        const isEnum = col.data_type === "USER-DEFINED" && enumValues !== undefined;
        const isVector = col.udt_name === "vector";
        const propType = isEnum ? "string" : isVector ? "vector" : mapPgType(col.data_type);

        const property: Record<string, unknown> = {
            name: humanize(col.column_name),
            columnName: col.column_name,
            type: propType
        };

        // The wire name, with `columnName` above carrying the column. The two
        // are different names for different things — this used to serve the
        // column, so a runtime-introspected collection answered `user_id` while
        // every authored one beside it answered `displayName`.
        //
        // `user_id` and `userId` as two real columns camel-case to one key, so
        // the first free candidate wins and the second falls back to its own
        // column name, then to a numbered tail. Never dropped, and stable for a
        // given database: columns arrive in ordinal order.
        const key = firstFreeKey([toWireKey(col.column_name), col.column_name], takenKeys);
        takenKeys.add(key);

        if (isPk) {
            property.isId = idKindFor(col, propType);
        } else if (col.is_nullable === "NO" && col.column_default === null) {
            property.validation = { required: true };
        }

        if (isEnum && enumValues) {
            property.enum = enumValues.map((value) => ({ id: value, label: humanize(value) }));
        }

        properties[key] = property;
    }

    return properties;
}

/**
 * Owning relations, derived from this table's foreign keys — the same shape
 * `generateCollectionFile` writes into a collection file: a `relation` property
 * whose nested descriptor carries `kind`, a `target` thunk and the `localKey`.
 *
 * The shape is load-bearing, not cosmetic. `resolveCollectionRelations` reads
 * relations from `property.relation` and `resolveRelation` requires `target` to
 * be a thunk; this used to emit `target`/`cardinality`/`localKey` flat on the
 * property with the slug as a bare string, which satisfies neither. Nothing
 * threw — the resolver simply skipped every such property and reported that the
 * collection had no relations. So an introspected BaaS collection had its FK
 * columns removed from `properties` (they "surface as relations") and then no
 * resolvable relation to surface as, which is why writing the FK column
 * directly came back as `has no field 'product_id'`: `assertKnownWriteFields`
 * learns that column from the resolved relation's `localKey`.
 *
 * The thunk closes over the collections being built in this same pass rather
 * than importing a module, which is what a runtime introspection has instead of
 * generated files. It is called lazily, after the map is fully populated, so a
 * table may reference one introspected later.
 */
function buildRelations(
    meta: TableMeta,
    slugByTable: Map<string, string>,
    collectionBySlug: Map<string, PostgresCollectionConfig>
): Record<string, Record<string, unknown>> {
    const relations: Record<string, Record<string, unknown>> = {};

    for (const fk of meta.fks) {
        const targetSlug = slugByTable.get(fk.foreign_table_name);
        if (!targetSlug) continue;

        // Strip the conventional _id suffix: author_id -> author
        let key = toWireKey(fk.column_name.replace(/_id$/, ""));
        if (meta.pks.includes(fk.column_name) && key === fk.column_name) {
            // The FK is also the PK and its name doesn't imply a relation (e.g.
            // "id"), so naming the relation after the column would collide with
            // the primary-key property.
            key = fk.foreign_table_name;
        }

        relations[key] = {
            name: humanize(key),
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => collectionBySlug.get(targetSlug),
                localKey: fk.column_name
            }
        };
    }

    return relations;
}

/**
 * Turn an introspected schema into collections.
 *
 * Join tables are skipped: they carry no identity of their own and exist to
 * express a many-to-many edge between two other tables.
 */
export function buildCollectionsFromSchema(
    { tablesMap, enumMap, joinTables }: IntrospectedSchema,
    pgSchema: string
): PostgresCollectionConfig[] {
    const slugByTable = new Map<string, string>();
    for (const tableName of tablesMap.keys()) {
        if (!joinTables.has(tableName)) slugByTable.set(tableName, tableName);
    }

    const collections: PostgresCollectionConfig[] = [];
    // Filled as we go; the relation thunks read it lazily, so a table may point
    // at one that has not been built yet at the moment its relation is created.
    const collectionBySlug = new Map<string, PostgresCollectionConfig>();

    for (const [tableName, meta] of tablesMap) {
        if (joinTables.has(tableName)) continue;

        const collectionName = humanize(tableName);
        const collection = {
            name: collectionName,
            singularName: singularize(collectionName),
            slug: tableName,
            table: tableName,
            schema: pgSchema,
            icon: getIconForTable(tableName),
            properties: {
                ...buildProperties(meta, enumMap),
                ...buildRelations(meta, slugByTable, collectionBySlug)
            }
        } as unknown as PostgresCollectionConfig;

        collections.push(collection);
        collectionBySlug.set(tableName, collection);
    }

    return collections;
}

/** Introspect the database and return ready-to-serve collections. */
export async function introspectCollections(
    client: Queryable,
    pgSchema: string
): Promise<PostgresCollectionConfig[]> {
    const schema = await introspectSchema(client, pgSchema);
    return buildCollectionsFromSchema(schema, pgSchema);
}
