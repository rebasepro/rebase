/**
 * Bringing a database up to date with a bundle's collections, additively.
 *
 * ## Why this exists
 *
 * A managed runtime boots someone else's compiled project against a database it
 * has never seen. Auth tables are ensured at boot already, but collection tables
 * were not created by anything: the platform ran the app and every `/api/data/*`
 * request answered 500 on a missing relation. `rebase db push` cannot help — it
 * is an Atlas-driven CLI command, and the runtime image ships no CLI.
 *
 * ## Why additive-only, forever
 *
 * This runs unattended, against a database with customers' data in it, with no
 * human reading a diff. So it may only ever do things that cannot lose data:
 * create a missing table, add a missing column, create a missing enum type.
 *
 * It will **never** drop a table or a column, narrow a type, or alter a
 * constraint. A removed field leaves its column behind; a renamed field looks
 * like an addition and the old column stays. That is the correct trade for an
 * automated path — the alternative is an unattended process that can silently
 * destroy a column, which is precisely the failure `db push` was hardened
 * against. Destructive changes stay a deliberate, human-reviewed migration.
 *
 * Because of that, this is safe to run on every boot, and re-running it is a
 * no-op.
 */
import { type CollectionConfig, type Property, isPostgresCollectionConfig } from "@rebasepro/types";
import { getTableName } from "@rebasepro/common";
import {
    getSqlColumnType,
    resolveColumnName,
    isIdProperty
} from "./generate-postgres-ddl-logic";

/**
 * The subset of a database handle this needs: run a statement, get rows back.
 *
 * Deliberately parameterless. Everything here is DDL or catalogue reads keyed by
 * schema name, and schema names are identifiers — they cannot be bound as
 * parameters anyway. They are validated against {@link SAFE_IDENTIFIER} before
 * they reach a statement, so a config that somehow carried a quote is refused
 * rather than concatenated.
 */
export interface Queryable {
    query<T = unknown>(sql: string): Promise<{ rows: T[] }>;
}

/** Postgres identifiers this module is willing to interpolate. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function assertSafeIdentifier(value: string, what: string): string {
    if (!SAFE_IDENTIFIER.test(value)) {
        throw new Error(`Refusing to build SQL with an unsafe ${what}: ${JSON.stringify(value)}`);
    }
    return value;
}

/** What the database currently has, as the planner needs it. */
export interface ExistingSchema {
    /** `schema.table` → set of column names. */
    tables: Map<string, Set<string>>;
    /** `schema.typename` of every enum type that already exists. */
    enums: Set<string>;
}

export interface EnsureAction {
    kind: "create-enum" | "create-table" | "add-column";
    /** Qualified target, for logging: `public.posts` or `public.posts.title`. */
    target: string;
    sql: string;
}

export interface EnsurePlan {
    actions: EnsureAction[];
    /** Every statement, in dependency order. Empty when the schema is current. */
    statements: string[];
}

function schemaOf(collection: CollectionConfig): string {
    return isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";
}

function qualified(collection: CollectionConfig): string {
    return `${schemaOf(collection)}.${getTableName(collection)}`;
}

/**
 * Enum types a collection's properties require, as `schema.typename`.
 *
 * Named exactly as the DDL generator names them (`<table>_<column>`), because
 * a column added here has to reference the same type the generator would have
 * created — a second, differently-named type for the same field would be a
 * silent schema fork.
 */
function requiredEnums(collection: CollectionConfig): { name: string; values: string[] }[] {
    const table = getTableName(collection);
    const schema = schemaOf(collection);
    const out: { name: string; values: string[] }[] = [];
    for (const [propName, prop] of Object.entries(collection.properties ?? {})) {
        const p = prop as Property;
        if (!("enum" in p) || !p.enum) continue;
        if (p.type !== "string" && p.type !== "number") continue;
        const values = (p.enum as unknown[])
            .map(entry =>
                entry && typeof entry === "object" && "id" in (entry as Record<string, unknown>)
                    ? String((entry as Record<string, unknown>).id)
                    : String(entry)
            )
            .filter(v => v.length > 0);
        if (values.length === 0) continue;
        out.push({ name: `${schema}.${table}_${resolveColumnName(propName, p)}`, values });
    }
    return out;
}

/** Single-quote escaping for an enum label. */
function quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Decide what to add. Pure — the caller supplies what exists and runs the result.
 *
 * Ordering matters and is deliberate: enum types before the tables and columns
 * that reference them, tables before the columns added to other tables (a new
 * table may be the target of a relation), and nothing is emitted twice.
 */
export function planCollectionSchemaEnsure(
    collections: CollectionConfig[],
    existing: ExistingSchema
): EnsurePlan {
    const actions: EnsureAction[] = [];
    const plannedEnums = new Set<string>();

    // 1. Enum types. `CREATE TYPE` has no IF NOT EXISTS, so an existing type is
    //    skipped by name rather than guarded in SQL.
    for (const collection of collections) {
        for (const { name, values } of requiredEnums(collection)) {
            if (existing.enums.has(name) || plannedEnums.has(name)) continue;
            plannedEnums.add(name);
            const [schema, typeName] = name.split(".");
            actions.push({
                kind: "create-enum",
                target: name,
                sql: `CREATE TYPE "${schema}"."${typeName}" AS ENUM (${values.map(quoteLiteral).join(", ")});`
            });
        }
    }

    // 2. Missing tables. Only the identity column is created here; every other
    //    column is added by step 3, so a new table and an existing table that
    //    gained a field travel the exact same code path. One way to build a
    //    column means one way for it to be wrong.
    const created = new Set<string>();
    for (const collection of collections) {
        const key = qualified(collection);
        if (existing.tables.has(key) || created.has(key)) continue;
        created.add(key);
        const schema = schemaOf(collection);
        const table = getTableName(collection);
        const idEntry = Object.entries(collection.properties ?? {}).find(([n, p]) =>
            isIdProperty(n, p as Property, collection)
        );
        const idName = idEntry ? resolveColumnName(idEntry[0], idEntry[1] as Property) : "id";
        const idProp = idEntry?.[1] as Property | undefined;
        let idDef: string;
        if (idProp?.type === "number") {
            idDef = `"${idName}" BIGSERIAL PRIMARY KEY`;
        } else if (
            idProp &&
            idProp.type === "string" &&
            (idProp as { isId?: unknown }).isId === "uuid"
        ) {
            idDef = `"${idName}" UUID PRIMARY KEY DEFAULT gen_random_uuid()`;
        } else {
            idDef = `"${idName}" TEXT PRIMARY KEY`;
        }
        actions.push({
            kind: "create-table",
            target: key,
            sql: `CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (${idDef});`
        });
    }

    // 3. Missing columns, on both brand-new and pre-existing tables.
    for (const collection of collections) {
        const key = qualified(collection);
        const schema = schemaOf(collection);
        const table = getTableName(collection);
        const present = existing.tables.get(key) ?? new Set<string>();
        for (const [propName, prop] of Object.entries(collection.properties ?? {})) {
            const p = prop as Property;
            if (isIdProperty(propName, p, collection)) continue;
            // A relation's own column is emitted by the DDL generator with a
            // foreign key; adding a bare column here would create the column
            // without the constraint and make the generator's later output
            // disagree with the database. Left to a real migration.
            if (p.type === "reference" || p.type === "relation") continue;
            const column = resolveColumnName(propName, p);
            if (present.has(column)) continue;
            const type = getSqlColumnType(propName, p, collection, collections);
            actions.push({
                kind: "add-column",
                target: `${key}.${column}`,
                // Never NOT NULL: an existing table with rows cannot take a
                // non-null column without a default, and inventing one would be
                // guessing at the customer's data.
                sql: `ALTER TABLE "${schema}"."${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type};`
            });
        }
    }

    return { actions, statements: actions.map(a => a.sql) };
}

/** Read what the database has, for the schemas the collections live in. */
export async function readExistingSchema(
    client: Queryable,
    schemas: string[]
): Promise<ExistingSchema> {
    const tables = new Map<string, Set<string>>();
    const enums = new Set<string>();
    if (schemas.length === 0) return { tables, enums };

    const inList = schemas
        .map(schema => `'${assertSafeIdentifier(schema, "schema name")}'`)
        .join(", ");

    const { rows: columns } = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
    }>(
        `SELECT table_schema, table_name, column_name
         FROM information_schema.columns
         WHERE table_schema IN (${inList})`
    );
    for (const row of columns) {
        const key = `${row.table_schema}.${row.table_name}`;
        if (!tables.has(key)) tables.set(key, new Set());
        tables.get(key)!.add(row.column_name);
    }

    const { rows: enumRows } = await client.query<{ schema: string; name: string }>(
        `SELECT n.nspname AS schema, t.typname AS name
         FROM pg_type t
         JOIN pg_namespace n ON t.typnamespace = n.oid
         WHERE t.typtype = 'e' AND n.nspname IN (${inList})`
    );
    for (const row of enumRows) enums.add(`${row.schema}.${row.name}`);

    return { tables, enums };
}

/**
 * Bring the database up to date. Returns what it did.
 *
 * Each statement runs on its own rather than in one transaction: they are all
 * independently safe and idempotent, and a single failure (an enum label that
 * cannot be added, say) should not roll back the tables that were created fine.
 * The error is surfaced with the statement that caused it.
 */
export async function ensureCollectionTables(
    client: Queryable,
    collections: CollectionConfig[],
    log?: (message: string) => void
): Promise<EnsurePlan> {
    const schemas = Array.from(new Set(collections.map(schemaOf)));
    for (const schema of schemas) {
        assertSafeIdentifier(schema, "schema name");
        if (schema !== "public") {
            await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}";`);
        }
    }

    const existing = await readExistingSchema(client, schemas);
    const plan = planCollectionSchemaEnsure(collections, existing);

    if (plan.actions.length === 0) {
        log?.("Schema is up to date; nothing to create.");
        return plan;
    }

    for (const action of plan.actions) {
        try {
            await client.query(action.sql);
            log?.(`${action.kind}: ${action.target}`);
        } catch (err) {
            throw new Error(
                `Failed to ${action.kind} ${action.target}: ` +
                `${err instanceof Error ? err.message : String(err)}\n  ${action.sql}`
            );
        }
    }
    return plan;
}
