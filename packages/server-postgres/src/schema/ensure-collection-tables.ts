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
import { getTableName, relationalCollections } from "@rebasepro/common";
import { logger } from "@rebasepro/server";
import {
    getSqlColumnType,
    resolveColumnName,
    isIdProperty,
    planRelationalColumns,
    planJunctionTables,
    quoteSqlLiteral
} from "./generate-postgres-ddl-logic";
import {
    AUTH_USERS_COLUMNS,
    authUsersColumnDefinition,
    authUsersColumnSql,
    isAuthCollection
} from "./auth-users-columns";

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
    /**
     * `schema.table.constraint` of every constraint that already exists.
     *
     * Optional so a caller that only cares about tables can still build one by
     * hand; absent is read as "none known", which at worst re-attempts a
     * constraint that then fails harmlessly as a duplicate.
     */
    constraints?: Set<string>;
}

export interface EnsureAction {
    kind: "create-enum" | "create-table" | "add-column" | "add-constraint" | "rename-column";
    /** Qualified target, for logging: `public.posts` or `public.posts.title`. */
    target: string;
    sql: string;
}

export interface EnsurePlan {
    actions: EnsureAction[];
    /** Every statement, in dependency order. Empty when the schema is current. */
    statements: string[];
    /**
     * Relation columns this plan is about to create where the table already
     * carries the same column under its pre-singularization name.
     *
     * The reason this is reported rather than silently handled: the ensure is
     * additive, so it would add `category_id` beside a populated
     * `categorie_id` and the relation would then read the new, empty one. No
     * statement fails, no table is missing, and the only symptom is relations
     * resolving to nothing — which is indistinguishable from having no data.
     */
    legacyForeignKeys: LegacyForeignKey[];
}

/** A relation column whose old and new spellings both plausibly apply. */
export interface LegacyForeignKey {
    /** `schema.table`. */
    table: string;
    /** The name the current rule derives, and what this plan would create. */
    expected: string;
    /** The name the old rule derived, which the table already has. */
    legacy: string;
}

export interface EnsureOutcome extends EnsurePlan {
    /**
     * Constraints that could not be added — always non-fatal.
     *
     * A foreign key can only fail on data that already violates it, and the
     * column it would police exists either way, so the collection still serves.
     * Refusing to boot over one would turn a pre-existing data problem into an
     * outage. Reported loudly instead.
     */
    failures: { target: string; error: string }[];
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

/**
 * Decide what to add. Pure — the caller supplies what exists and runs the result.
 *
 * Ordering matters and is deliberate: enum types before the tables and columns
 * that reference them, tables before the columns added to other tables (a new
 * table may be the target of a relation), and nothing is emitted twice.
 */
export function planCollectionSchemaEnsure(
    allCollections: CollectionConfig[],
    existing: ExistingSchema
): EnsurePlan {
    // Boot receives every collection the bundle declares, including the ones
    // served by another engine entirely. Creating a Postgres table for a
    // Firestore collection is not a harmless extra: the app keeps reading
    // documents from Firestore while an empty table with the same name accretes
    // policies and shows up in every drift report.
    const collections = relationalCollections(allCollections);
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
                sql: `CREATE TYPE "${schema}"."${typeName}" AS ENUM (${values.map(quoteSqlLiteral).join(", ")});`
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
        // Derived through the generator's own type mapping, not re-decided here.
        // This branch used to emit BIGSERIAL for a numeric id while `db push`
        // emitted INTEGER GENERATED BY DEFAULT AS IDENTITY, so the same project
        // got an int8 key when the runtime brought the schema up and an int4 key
        // when a human pushed it. Two consequences, both real: node-postgres
        // hands back int8 as a *string*, so a collection declaring
        // `type: "number"` served `"1"` instead of `1` on the managed path only;
        // and every foreign key and junction column pointing at it stayed
        // INTEGER on both paths, which is a truncation waiting for the sequence
        // to pass 2^31. The agreement test now pins this.
        const idType = idProp
            ? getSqlColumnType(idEntry![0], idProp, collection, collections)
            : "TEXT";
        let idDef = `"${idName}" ${idType} PRIMARY KEY`;
        if (idProp?.type === "string" && (idProp as { isId?: unknown }).isId === "uuid") {
            idDef += " DEFAULT gen_random_uuid()";
        }
        actions.push({
            kind: "create-table",
            target: key,
            sql: `CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (${idDef});`
        });
    }

    // 2b. Junction tables behind many-to-many relations. No collection declares
    //     them, so the walk above never sees them — and until they existed, an
    //     m2m write had nowhere to land and the junction's derived RLS had
    //     nothing to attach to.
    const junctions = planJunctionTables(collections);
    for (const junction of junctions) {
        const key = `${junction.schema}.${junction.table}`;
        if (existing.tables.has(key) || created.has(key)) continue;
        created.add(key);
        actions.push({ kind: "create-table", target: key, sql: junction.createTable });
    }

    // 3. Missing columns, on both brand-new and pre-existing tables.
    const legacyForeignKeys: LegacyForeignKey[] = [];

    /**
     * Move a relation column that is only missing because it was renamed.
     *
     * Returns true when it handled the column, so the caller skips the ordinary
     * ADD. Adding here would be the wrong move and a quiet one: the data is in
     * the old column, `ADD COLUMN` creates the new one empty beside it, every
     * statement succeeds, and the relation reads the empty one. A rename is
     * metadata-only in Postgres, keeps the values, and carries the column's
     * indexes and constraints with it.
     *
     * Only ever reached when the new name is absent and the old name is
     * present, so there is nothing to overwrite and nothing to choose between.
     */
    const renameLegacyColumn = (
        key: string,
        schema: string,
        table: string,
        column: string,
        legacyName: string | undefined
    ): boolean => {
        const present = existing.tables.get(key);
        if (!legacyName || !present) return false;
        if (present.has(column) || !present.has(legacyName)) return false;

        legacyForeignKeys.push({ table: key, expected: column, legacy: legacyName });
        actions.push({
            kind: "rename-column",
            target: `${key}.${column}`,
            sql: `ALTER TABLE "${schema}"."${table}" RENAME COLUMN "${legacyName}" TO "${column}";`
        });
        return true;
    };

    const addColumn = (
        key: string,
        schema: string,
        table: string,
        column: string,
        definition: string
    ): void => {
        const present = existing.tables.get(key);
        if (present?.has(column)) return;
        actions.push({
            kind: "add-column",
            target: `${key}.${column}`,
            sql: `ALTER TABLE "${schema}"."${table}" ADD COLUMN IF NOT EXISTS "${column}" ${definition};`
        });
    };

    for (const collection of collections) {
        const key = qualified(collection);
        const schema = schemaOf(collection);
        const table = getTableName(collection);
        // A table this run is creating has no rows yet, so the constraints
        // `db push` writes are free to apply. On a table that already exists
        // they are not: `SET NOT NULL` is checked against live rows and a UNIQUE
        // would fail on existing duplicates, and this module runs unattended
        // against customer data with nobody reading a diff. So the constraints
        // are emitted for the fresh case — which is the whole managed-runtime
        // path, and the one that diverged from `db push` — and withheld for the
        // adopted one. `rebase db push` remains how an existing table gets them.
        const fresh = created.has(key);
        const auth = isAuthCollection(collection);
        for (const [propName, prop] of Object.entries(collection.properties ?? {})) {
            const p = prop as Property;
            if (isIdProperty(propName, p, collection)) continue;
            // Relation and reference columns are planned from the shared
            // relational planner below, which derives the column name, type and
            // foreign key the same way `db push` does. Deriving them here as
            // plain columns is what once produced a column with no constraint.
            if (p.type === "reference" || p.type === "relation") continue;

            const column = resolveColumnName(propName, p);
            // On an auth collection, the columns auth itself reads and writes
            // have exactly one definition, wherever the table is created from —
            // see `auth-users-columns`. Anything else on that collection is an
            // ordinary user-declared field and is generated like any other.
            const authDefinition = auth ? authUsersColumnDefinition(column) : undefined;
            if (authDefinition) {
                addColumn(key, schema, table, column, authDefinition);
                continue;
            }

            // Assembled in the generator's order — type, UNIQUE, DEFAULT,
            // NOT NULL — so the two produce byte-identical column definitions
            // and the agreement test can compare them directly instead of
            // checking that a column merely exists, which is how BIGSERIAL-vs-
            // INTEGER and every missing constraint went unnoticed.
            let definition = getSqlColumnType(propName, p, collection, collections);
            if (fresh && p.validation?.unique) definition += " UNIQUE";
            // Not gated on `fresh`: a default binds future writes only, so it is
            // safe on a live table, and a column added without it would take the
            // value the application forgot to send rather than `now()`.
            const autoValue = (p as { autoValue?: string }).autoValue;
            if (p.type === "date" && (autoValue === "on_create" || autoValue === "on_update")) {
                definition += " DEFAULT now()";
            }
            if (fresh && p.validation?.required) definition += " NOT NULL";
            addColumn(key, schema, table, column, definition);
        }

        // The auth columns the collection never mentions. The scaffold's users
        // collection describes 12 of the 14 auth reads and writes, so planning
        // only from properties left `is_anonymous` and `tokens_valid_after` to
        // `ensureAuthTablesExist` — which does create them, but only because
        // that function happens to run later in the same boot. Planning them
        // here makes this path self-contained and identical to `db push`, so
        // neither depends on the other having run.
        if (auth) {
            const declared = new Set(
                Object.entries(collection.properties ?? {})
                    .map(([name, prop]) => resolveColumnName(name, prop as Property))
            );
            for (const spec of AUTH_USERS_COLUMNS) {
                if (declared.has(spec.column)) continue;
                addColumn(key, schema, table, spec.column, authUsersColumnSql(spec));
            }
        }
    }

    // 3b. A junction that already existed, but is short a column. One created
    //     above already carries both — unlike a collection table, whose CREATE
    //     declares only the identity column — so re-listing them would log two
    //     no-op statements and inflate the count of changes applied.
    for (const junction of junctions) {
        const key = `${junction.schema}.${junction.table}`;
        if (created.has(key)) continue;
        for (const column of junction.columns) {
            if (renameLegacyColumn(key, junction.schema, junction.table, column.name, column.legacyName)) continue;
            addColumn(key, junction.schema, junction.table, column.name, column.type);
        }
    }

    // 3c. The columns relation and reference properties own.
    for (const relational of planRelationalColumns(collections)) {
        const relKey = `${relational.schema}.${relational.table}`;
        if (renameLegacyColumn(relKey, relational.schema, relational.table, relational.column, relational.legacyColumn)) continue;
        addColumn(
            relKey,
            relational.schema,
            relational.table,
            relational.column,
            relational.type
        );
    }

    // 4. Foreign keys, last: the tables and columns on both ends have to exist
    //    first, and a constraint is the one thing here that can fail on data
    //    rather than on schema, so nothing else depends on it.
    const knownConstraints = existing.constraints ?? new Set<string>();
    const plannedConstraints = new Set<string>();
    const foreignKeys = [
        ...planRelationalColumns(collections).map(r => r.foreignKey),
        ...junctions.flatMap(j => j.foreignKeys)
    ];
    for (const fk of foreignKeys) {
        if (!fk) continue;
        const name = `${fk.schema}.${fk.table}.${fk.constraintName}`;
        if (knownConstraints.has(name) || plannedConstraints.has(name)) continue;
        plannedConstraints.add(name);
        actions.push({
            kind: "add-constraint",
            target: `${fk.schema}.${fk.table}.${fk.constraintName}`,
            sql: fk.sql
        });
    }

    return { actions, statements: actions.map(a => a.sql), legacyForeignKeys };
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

    // `ADD CONSTRAINT` has no IF NOT EXISTS, so an existing foreign key is
    // skipped by name rather than guarded in SQL.
    const constraints = new Set<string>();
    const { rows: constraintRows } = await client.query<{
        schema: string;
        table: string;
        name: string;
    }>(
        `SELECT n.nspname AS schema, c.relname AS table, con.conname AS name
         FROM pg_constraint con
         JOIN pg_class c ON con.conrelid = c.oid
         JOIN pg_namespace n ON c.relnamespace = n.oid
         WHERE n.nspname IN (${inList})`
    );
    for (const row of constraintRows) constraints.add(`${row.schema}.${row.table}.${row.name}`);

    return { tables, enums, constraints };
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
): Promise<EnsureOutcome> {
    // Junctions live alongside the collections that declare them, so their
    // schema has to be read too — otherwise an existing junction reads as
    // missing and its constraints as unplanned.
    const schemas = Array.from(new Set([
        ...collections.map(schemaOf),
        ...planJunctionTables(collections).map(j => j.schema)
    ]));
    for (const schema of schemas) {
        assertSafeIdentifier(schema, "schema name");
        if (schema !== "public") {
            await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}";`);
        }
    }

    const existing = await readExistingSchema(client, schemas);
    const plan = planCollectionSchemaEnsure(collections, existing);
    const failures: { target: string; error: string }[] = [];

    // Reported, not warned: this is a rename the ensure is about to perform, and
    // the operator should be able to see in the log why a column changed name.
    // The interesting case is the one that no longer happens — before this,
    // ensure added the new column empty beside the populated old one, every
    // statement succeeded, and the relation read the empty one.
    for (const legacy of plan.legacyForeignKeys) {
        const message =
            `Renaming "${legacy.table}"."${legacy.legacy}" to "${legacy.expected}". The old name is ` +
            "the one Rebase derived for this relation before it singularized properly; the column " +
            "keeps its data, indexes and constraints. To keep the old name instead, set " +
            `\`localKey: "${legacy.legacy}"\` on the relation and this will stop.`;
        logger.info(`[schema] ${message}`);
        log?.(message);
    }

    if (plan.actions.length === 0) {
        log?.("Schema is up to date; nothing to create.");
        return { ...plan, failures };
    }

    for (const action of plan.actions) {
        try {
            await client.query(action.sql);
            log?.(`${action.kind}: ${action.target}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // A foreign key is the only action that can fail on the customer's
            // data rather than on the schema. The column it polices is already
            // there, so the collection serves either way — record it and carry
            // on rather than crash-looping the deployment.
            if (action.kind === "add-constraint") {
                failures.push({ target: action.target, error: message });
                continue;
            }
            throw new Error(
                `Failed to ${action.kind} ${action.target}: ${message}\n  ${action.sql}`
            );
        }
    }
    return { ...plan, failures };
}
