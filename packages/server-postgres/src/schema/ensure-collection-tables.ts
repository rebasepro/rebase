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
import { logger, isConcurrentDdlRace, isDuplicateObjectRace } from "@rebasepro/server";
import {
    assertSearchIsPostgresOnly,
    buildSearchColumnSpec,
    searchExtensionStatements,
    searchHelperFunctions,
    searchIndexStatements,
    searchColumnStamps,
    SEARCH_STAMP_PREFIX,
    SEARCH_TEXT_FN,
    SEARCH_UNACCENT_FN,
    type SearchColumnSpec
} from "./search-column";
import {
    getSqlColumnType,
    resolveColumnName,
    isIdProperty,
    planRelationalColumns,
    planJunctionTables,
    quoteSqlLiteral
} from "./generate-postgres-ddl-logic";
import { buildVectorIndexPlan, vectorIndexStatement, type SkippedVectorIndex } from "./vector-index";
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
    /**
     * `schema.table.column` → that column's comment, for the columns that have
     * one. This is where a generated search column's fingerprint lives, so it
     * is the only evidence that a `search` block has changed since the column
     * was built. Absent is read as "no column is stamped", which plans a stamp
     * and reports nothing as drifted.
     */
    columnComments?: Map<string, string>;
    /**
     * `schema.typename` → the values that type currently holds, in order.
     *
     * Without this, an enum type that already exists is skipped whole and a
     * value added to it never reaches the database — the type is there, so
     * nothing plans anything, and the first row using the new value is rejected
     * by a constraint nobody changed. Absent is read as "the values are
     * unknown", which keeps the old skip-by-name behaviour rather than guessing.
     */
    enumValues?: Map<string, string[]>;
    /** `schema.table.column` for every column the database marks NOT NULL. */
    notNullColumns?: Set<string>;
    /**
     * Tables known to hold at least one row.
     *
     * The only thing that decides whether a NOT NULL can be added without
     * reading the data: on an empty table the constraint cannot fail, on a
     * populated one it is checked against every existing row. Absent is read as
     * "assume populated", which is the conservative direction — it withholds a
     * constraint rather than attempting one that aborts the boot.
     */
    populatedTables?: Set<string>;
}

/**
 * How far the planner may go in making the database's constraints match the
 * configuration.
 *
 * - `additive` — the boot default. Columns, tables, indexes and enum values are
 *   created; no existing column's constraints are touched. Unattended boots run
 *   against customer data with nobody reading a diff, and a database adopted by
 *   introspection legitimately carries NOT NULL on columns the generated
 *   collection leaves optional (`introspect-db-logic` withholds `required` from
 *   a column with a default or a trigger behind it). Converging there would
 *   strip real constraints on first boot.
 * - `converge` — the live schema editor. Every statement is planned, shown to
 *   the person making the change, and applied only once they confirm it. That
 *   is the context in which changing an existing column's constraints is a
 *   reviewed act rather than a surprise.
 */
export type ConstraintPolicy = "additive" | "converge";

export interface EnsureOptions {
    /** Defaults to `additive`. See {@link ConstraintPolicy}. */
    constraints?: ConstraintPolicy;
}

export interface EnsureAction {
    kind: "create-enum" | "create-table" | "add-column" | "add-constraint" | "rename-column"
        | "create-extension" | "create-function" | "create-index" | "comment-column"
        | "add-enum-value" | "set-not-null" | "drop-not-null";
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
    /**
     * Generated search columns whose `search` block has changed since they were
     * built. Reported, never planned into `actions` — see
     * {@link SearchColumnDrift} for why applying it is not this path's call.
     */
    searchDrift: SearchColumnDrift[];
    /**
     * Generated search columns that exist but carry no fingerprint — created
     * before this check existed, or by `search.sql` on an older CLI. The plan
     * stamps them so the *next* change is detectable; whether they match the
     * current block cannot be known, which is what the caller reports.
     */
    searchAdopted: { table: string; column: string }[];
    /**
     * Vector columns this plan is deliberately leaving unindexed, because
     * pgvector cannot build an ANN index that wide.
     *
     * Reported rather than thrown: the column is valid, storable and
     * searchable, and refusing the boot over it would make a working
     * configuration unbootable. Reported rather than dropped: an unindexed
     * vector column and an indexed one differ only in latency, so nothing
     * about the running system says which one you got.
     */
    vectorIndexSkipped: SkippedVectorIndex[];
    /**
     * Constraints the configuration asks for that this plan is not applying,
     * and why.
     *
     * This is the half of the feature that matters most. Every one of these was
     * previously withheld in silence: a required property arrived nullable, and
     * the only evidence was a database that disagreed with its own
     * configuration. Reporting them is what lets boot warn, the live editor
     * refuse, and the doctor explain — three surfaces that until now had nothing
     * to read.
     */
    withheldConstraints: WithheldConstraint[];
}

/** A constraint the configuration asks for that the planner is not applying. */
export interface WithheldConstraint {
    /** `schema.table.column`. */
    target: string;
    kind: "not-null";
    /**
     * Why, in a sentence that names the obstacle rather than the rule. The
     * reader is looking at a column that is nullable when they asked for
     * required, and needs to know what to do about it.
     */
    reason: string;
    /** What would make it applicable. */
    remedy: string;
}

/**
 * A generated search column built from a `search` block that has since changed.
 *
 * Reported instead of applied because the two ways to apply it are both worse
 * than stopping. `ALTER COLUMN … SET EXPRESSION` exists only on PG17+ and
 * rewrites the table either way; `DROP COLUMN` + `ADD COLUMN` rewrites it under
 * an ACCESS EXCLUSIVE lock and rebuilds the GIN index. This module runs
 * unattended against live customer data with nobody reading a diff — the same
 * reason it withholds `SET NOT NULL` from an adopted table — so a multi-minute
 * outage is not a decision it may take on its own.
 *
 * Not applying it silently is not an option either: that is the bug this
 * detection exists for. A collection that added a field, flipped `unaccent` or
 * raised a weight kept indexing the *old* set forever, and the only symptom was
 * searches returning nothing for content plainly in the row.
 */
export interface SearchColumnDrift {
    /** `schema.table`. */
    table: string;
    column: string;
    /** The fingerprint recorded on the column. */
    found: string;
    /** The fingerprint the current `search` block computes. */
    expected: string;
    /** The statements that would rebuild the column, for the operator to run. */
    rebuild: string[];
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
     * Actions that could not be applied and are non-fatal by nature.
     *
     * Two kinds qualify. A foreign key can only fail on data that already
     * violates it, and the column it would police exists either way, so the
     * collection still serves; refusing to boot over one would turn a
     * pre-existing data problem into an outage. A column comment is the search
     * fingerprint, which needs table ownership — losing it costs drift
     * detection on the next boot, not the deployment. Both are reported loudly.
     */
    failures: { kind: EnsureAction["kind"]; target: string; error: string }[];
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
    existing: ExistingSchema,
    options: EnsureOptions = {}
): EnsurePlan {
    const constraintPolicy: ConstraintPolicy = options.constraints ?? "additive";
    const withheldConstraints: WithheldConstraint[] = [];
    // Boot receives every collection the bundle declares, including the ones
    // served by another engine entirely. Creating a Postgres table for a
    // Firestore collection is not a harmless extra: the app keeps reading
    // documents from Firestore while an empty table with the same name accretes
    // policies and shows up in every drift report.
    // Before the filter, deliberately: a `search` block on a collection this
    // engine does not store would otherwise be dropped here without a word.
    assertSearchIsPostgresOnly(allCollections);

    const collections = relationalCollections(allCollections);
    const actions: EnsureAction[] = [];
    const plannedEnums = new Set<string>();

    // 1. Enum types. `CREATE TYPE` has no IF NOT EXISTS, so an existing type is
    //    skipped by name rather than guarded in SQL.
    for (const collection of collections) {
        for (const { name, values } of requiredEnums(collection)) {
            if (existing.enums.has(name) || plannedEnums.has(name)) {
                // The type is there, but that says nothing about its *values*.
                // Skipping the whole type by name is what made an added enum
                // value vanish: nothing was planned, the boot reported success,
                // and the first row using the value was rejected by a type that
                // had never heard of it. `ADD VALUE` is the one alteration
                // Postgres offers here, it is purely additive, and it is
                // idempotent with `IF NOT EXISTS`.
                //
                // `enumValues` absent means the caller built the schema by hand
                // and does not know the values; skip by name as before rather
                // than plan against a guess.
                const current = existing.enumValues?.get(name);
                if (!current || plannedEnums.has(name)) continue;
                const [schema, typeName] = name.split(".");
                for (const value of values) {
                    if (current.includes(value)) continue;
                    actions.push({
                        kind: "add-enum-value",
                        target: `${name}.${value}`,
                        // Not inside a transaction with any use of the value:
                        // Postgres refuses to read a value added by the
                        // transaction still adding it. The applier runs these
                        // one statement at a time, which is what makes it legal.
                        sql: `ALTER TYPE "${schema}"."${typeName}" ADD VALUE IF NOT EXISTS ${quoteSqlLiteral(value)};`
                    });
                }
                continue;
            }
            plannedEnums.add(name);
            const [schema, typeName] = name.split(".");
            actions.push({
                kind: "create-enum",
                target: name,
                sql: `CREATE TYPE "${schema}"."${typeName}" AS ENUM (${values.map(quoteSqlLiteral).join(", ")});`
            });
        }
    }

    // 1b. Search support, for collections that declared a `search` block.
    //
    //     Before the tables, because a generated column's expression is
    //     resolved when the column is created: a table whose search column
    //     calls `rebase_search_text` cannot be added before that function
    //     exists. Both forms are idempotent, so a boot against a database that
    //     already has them plans nothing.
    const searchSpecs = collections
        .map(c => buildSearchColumnSpec(c))
        .filter((spec): spec is SearchColumnSpec => spec !== undefined);

    const plannedExtensions = new Set<string>();
    for (const spec of searchSpecs) {
        for (const statement of searchExtensionStatements(spec)) {
            if (plannedExtensions.has(statement)) continue;
            plannedExtensions.add(statement);
            actions.push({ kind: "create-extension", target: statement.replace(/^CREATE EXTENSION IF NOT EXISTS |;$/g, ""), sql: statement });
        }
    }
    const plannedFunctions = new Set<string>();
    for (const spec of searchSpecs) {
        for (const statement of searchHelperFunctions(spec)) {
            if (plannedFunctions.has(statement)) continue;
            plannedFunctions.add(statement);
            actions.push({ kind: "create-function", target: statement.includes("unaccent") ? SEARCH_UNACCENT_FN : SEARCH_TEXT_FN, sql: statement });
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
            const hasDefault = p.type === "date" && (autoValue === "on_create" || autoValue === "on_update");
            if (hasDefault) definition += " DEFAULT now()";

            const required = p.validation?.required === true;
            const columnKey = `${key}.${column}`;
            const columnExists = existing.tables.get(key)?.has(column) === true;

            // A NOT NULL is safe exactly when it cannot fail against rows that
            // are already there, and there are three ways to know that:
            //
            //  - the table is being created by this plan (no rows yet);
            //  - the table exists and is empty;
            //  - the column arrives with a DEFAULT, which Postgres backfills
            //    into every existing row as part of ADD COLUMN.
            //
            // Anything else is checked against live data and can abort the boot,
            // which is why it used to be withheld — correctly. What was wrong was
            // withholding it in *silence*: the config said required, the column
            // came out nullable, and nothing anywhere said so.
            // `populatedTables` absent means the caller does not know, and not
            // knowing has to read as "assume rows" — the other direction emits a
            // NOT NULL that is checked against live data and aborts the boot.
            // Written as an explicit `!== undefined` because the optional-chain
            // form (`!existing.populatedTables?.has(key)`) quietly says *empty*
            // when the fact is missing, which is the wrong way to be wrong.
            const tableIsEmpty = existing.populatedTables !== undefined
                && existing.tables.has(key)
                && !existing.populatedTables.has(key);
            const notNullIsSafe = fresh || tableIsEmpty || hasDefault;

            if (required && !columnExists) {
                if (notNullIsSafe) {
                    definition += " NOT NULL";
                } else {
                    withheldConstraints.push({
                        target: columnKey,
                        kind: "not-null",
                        reason:
                            `"${column}" is required, but "${key}" already holds rows and the column ` +
                            "has no default to backfill them with, so NOT NULL would be checked " +
                            "against data that does not have a value yet.",
                        remedy:
                            "Backfill the column, then add the constraint — or give the property a " +
                            "default so every existing row gets one."
                    });
                }
            }
            addColumn(key, schema, table, column, definition);

            // The column is already there and only its constraint differs. Two
            // directions, and they are not equally safe — see `ConstraintPolicy`
            // for why neither runs at an unattended boot.
            if (columnExists && constraintPolicy === "converge") {
                const isNotNull = existing.notNullColumns?.has(columnKey) === true;
                if (required && !isNotNull) {
                    if (tableIsEmpty) {
                        actions.push({
                            kind: "set-not-null",
                            target: columnKey,
                            sql: `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" SET NOT NULL;`
                        });
                    } else {
                        withheldConstraints.push({
                            target: columnKey,
                            kind: "not-null",
                            reason:
                                `"${column}" became required, but "${key}" holds rows and any of them ` +
                                "with no value would make SET NOT NULL fail.",
                            remedy:
                                "Backfill the column first — `UPDATE … SET \"" + column +
                                "\" = … WHERE \"" + column + "\" IS NULL` — then apply this again."
                        });
                    }
                }
                if (!required && isNotNull) {
                    // Loosening never fails and never loses data. It is here
                    // rather than at boot because a database adopted by
                    // introspection carries NOT NULL on columns the generated
                    // collection deliberately leaves optional, and converging
                    // those unasked would drop constraints nobody edited.
                    actions.push({
                        kind: "drop-not-null",
                        target: columnKey,
                        sql: `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" DROP NOT NULL;`
                    });
                }
            }
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

    // 3aa. The generated search columns.
    //
    //      Adding a STORED generated column rewrites the table, which on a large
    //      one is not free — but it is the same additive shape as every other
    //      column here, and the alternative (leaving it out until someone runs a
    //      migration) is a declared `search` block that silently does nothing.
    //
    //      Changing one is not additive, and `ADD COLUMN IF NOT EXISTS` is a
    //      no-op against a column that is already there — which is why a `search`
    //      block that gained a field, flipped `unaccent` or moved a weight used
    //      to be inert forever, on every path, with nothing logged. Each column
    //      therefore carries a fingerprint of the expression it was built from
    //      (in its comment), and a mismatch is reported rather than applied.
    const searchDrift: SearchColumnDrift[] = [];
    const searchAdopted: { table: string; column: string }[] = [];
    for (const spec of searchSpecs) {
        const key = `${spec.schema}.${spec.table}`;
        const definitions: Record<string, string> = {
            [spec.column]: `tsvector GENERATED ALWAYS AS (${spec.expression}) STORED`
        };
        if (spec.fuzzy) {
            definitions[spec.fuzzy.column] = `text GENERATED ALWAYS AS (${spec.fuzzy.expression}) STORED`;
        }

        for (const stamp of searchColumnStamps(spec)) {
            const definition = definitions[stamp.column];
            const exists = existing.tables.get(key)?.has(stamp.column) === true;
            const recorded = existing.columnComments?.get(`${key}.${stamp.column}`);

            if (exists && recorded?.startsWith(SEARCH_STAMP_PREFIX) && recorded !== stamp.fingerprint) {
                searchDrift.push({
                    table: key,
                    column: stamp.column,
                    found: recorded,
                    expected: stamp.fingerprint,
                    rebuild: [
                        `ALTER TABLE "${spec.schema}"."${spec.table}" DROP COLUMN "${stamp.column}";`,
                        `ALTER TABLE "${spec.schema}"."${spec.table}" ADD COLUMN "${stamp.column}" ${definition};`,
                        stamp.sql
                    ]
                });
                // The old stamp is the only evidence of what the column holds;
                // overwriting it here would erase the drift instead of fixing it.
                continue;
            }

            addColumn(key, spec.schema, spec.table, stamp.column, definition);
            if (exists && recorded === undefined) {
                searchAdopted.push({ table: key, column: stamp.column });
            }
            if (recorded !== stamp.fingerprint) {
                actions.push({
                    kind: "comment-column",
                    target: `${key}.${stamp.column}`,
                    sql: stamp.sql
                });
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

    // 5. Search indexes, after everything — the column has to exist, and this is
    //    the one step that runs against a populated table for real work.
    //
    //    CONCURRENTLY: a plain CREATE INDEX takes a lock that blocks writes for
    //    the duration of the build, which on a live table is an outage. Each
    //    statement here is issued on its own, outside any transaction, which is
    //    the condition CONCURRENTLY requires.
    for (const spec of searchSpecs) {
        for (const statement of searchIndexStatements(spec)) {
            actions.push({
                kind: "create-index",
                target: `${spec.schema}.${spec.table}`,
                sql: statement.replace("CREATE INDEX IF NOT EXISTS", "CREATE INDEX CONCURRENTLY IF NOT EXISTS")
            });
        }
    }

    //    ANN indexes for vector columns, on the same terms: the column has to
    //    exist, the build is real work against real rows, and CONCURRENTLY is
    //    what keeps that from locking writes for its duration.
    //
    //    A column too wide for pgvector to index is reported, not planned —
    //    silence there would read as "indexed" to anyone watching the boot.
    const vectorIndexSkipped: SkippedVectorIndex[] = [];
    for (const collection of collections) {
        const plan = buildVectorIndexPlan(collection, resolveColumnName);
        for (const spec of plan.specs) {
            actions.push({
                kind: "create-index",
                target: `${spec.schema}.${spec.table}`,
                sql: vectorIndexStatement(spec).replace("CREATE INDEX IF NOT EXISTS", "CREATE INDEX CONCURRENTLY IF NOT EXISTS")
            });
        }
        vectorIndexSkipped.push(...plan.skipped);
    }

    return {
        actions,
        statements: actions.map(a => a.sql),
        legacyForeignKeys,
        searchDrift,
        searchAdopted,
        vectorIndexSkipped,
        withheldConstraints
    };
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

    const notNullColumns = new Set<string>();
    const { rows: columns } = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
        is_nullable: string;
    }>(
        `SELECT table_schema, table_name, column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema IN (${inList})`
    );
    for (const row of columns) {
        const key = `${row.table_schema}.${row.table_name}`;
        if (!tables.has(key)) tables.set(key, new Set());
        tables.get(key)!.add(row.column_name);
        if (row.is_nullable === "NO") notNullColumns.add(`${key}.${row.column_name}`);
    }

    // Which tables hold rows. This is the only fact that decides whether a
    // NOT NULL can be added without reading the data, so it is worth a query.
    //
    // `reltuples` would be cheaper and is wrong for this: it is a planner
    // estimate, it is -1 on a table that has never been analyzed, and a table
    // that was full an hour ago still reads as full after a DELETE. A wrong
    // "empty" here means a boot that aborts on a constraint violation, so the
    // estimate is not good enough. `EXISTS … LIMIT 1` stops at the first row,
    // which makes the true cost one page read per table.
    //
    // Restricted to ordinary and partitioned tables: `information_schema.columns`
    // also lists views and materialized views, and probing those runs whatever
    // query defines them.
    const populatedTables = new Set<string>();
    const { rows: realTables } = await client.query<{ schema: string; name: string }>(
        `SELECT n.nspname AS schema, c.relname AS name
         FROM pg_class c
         JOIN pg_namespace n ON c.relnamespace = n.oid
         WHERE c.relkind IN ('r', 'p') AND n.nspname IN (${inList})`
    );
    if (realTables.length > 0) {
        const probes = realTables.map(row => {
            const schema = assertSafeIdentifier(row.schema, "schema name");
            const table = assertSafeIdentifier(row.name, "table name");
            return `SELECT ${quoteSqlLiteral(`${schema}.${table}`)} AS key, ` +
                `EXISTS(SELECT 1 FROM "${schema}"."${table}" LIMIT 1) AS populated`;
        });
        const { rows: populationRows } = await client.query<{ key: string; populated: boolean }>(
            probes.join(" UNION ALL ")
        );
        for (const row of populationRows) {
            if (row.populated) populatedTables.add(row.key);
        }
    }

    const enumValues = new Map<string, string[]>();
    const { rows: enumValueRows } = await client.query<{
        schema: string;
        name: string;
        value: string;
    }>(
        // Ordered by `enumsortorder`, not by label: an enum's order is part of
        // its meaning (it is what `<` compares), and reading it back sorted
        // alphabetically would make a correct type look drifted.
        `SELECT n.nspname AS schema, t.typname AS name, e.enumlabel AS value
         FROM pg_enum e
         JOIN pg_type t ON e.enumtypid = t.oid
         JOIN pg_namespace n ON t.typnamespace = n.oid
         WHERE n.nspname IN (${inList})
         ORDER BY t.typname, e.enumsortorder`
    );
    for (const row of enumValueRows) {
        const key = `${row.schema}.${row.name}`;
        if (!enumValues.has(key)) enumValues.set(key, []);
        enumValues.get(key)!.push(row.value);
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

    // Column comments, which is where a generated search column records the
    // expression it was built from. `objsubid > 0` is what makes a row a
    // *column* comment rather than the table's own.
    const columnComments = new Map<string, string>();
    const { rows: commentRows } = await client.query<{
        schema: string;
        table: string;
        column: string;
        comment: string | null;
    }>(
        `SELECT n.nspname AS schema, c.relname AS table, a.attname AS column, d.description AS comment
         FROM pg_description d
         JOIN pg_class c ON d.objoid = c.oid
         JOIN pg_namespace n ON c.relnamespace = n.oid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
         WHERE d.objsubid > 0 AND n.nspname IN (${inList})`
    );
    for (const row of commentRows) {
        if (row.comment == null) continue;
        columnComments.set(`${row.schema}.${row.table}.${row.column}`, row.comment);
    }

    return { tables, enums, constraints, columnComments, enumValues, notNullColumns, populatedTables };
}

/**
 * What to tell an operator whose `search` block no longer matches its column.
 *
 * Every line here is doing work: naming the collection is not enough, because
 * the symptom (a search that finds nothing) points at the data, not the schema;
 * and the remediation has to be exact, because it is a table rewrite the
 * operator is being asked to schedule rather than discover.
 */
function searchDriftMessage(drift: SearchColumnDrift[]): string {
    const blocks = drift.map(d =>
        `  "${d.table}"."${d.column}" was generated from a different \`search\` block ` +
        `(recorded ${d.found}, current ${d.expected}).\n` +
        d.rebuild.map(s => `      ${s}`).join("\n")
    );
    return (
        "The `search` block changed after its generated column was created, and Postgres cannot alter a " +
        "generated expression in place.\n" +
        "Rebase will not rebuild it for you: dropping and re-adding a STORED generated column rewrites the whole " +
        "table under an ACCESS EXCLUSIVE lock and rebuilds its GIN index, which is an outage this unattended path " +
        "may not schedule on your behalf.\n" +
        "Until it is rebuilt the column keeps indexing the previous fields, weights and language — searches for " +
        "anything added since return nothing, which reads from outside as \"no such row\".\n" +
        "Run these (or revert the block to what the column was built from), then boot again:\n" +
        blocks.join("\n") +
        "\n  The GIN index is dropped with the column and recreated concurrently on the next boot."
    );
}

/**
 * The missing-pgvector explanation, appended to the error that reveals it.
 *
 * A `{ type: "vector" }` property compiles to `VECTOR(n)`, and nothing in the
 * OSS pipeline installs pgvector — not this ensure, not `db push`. Installing
 * an extension on someone's database is a decision with a deployment behind it
 * (image, superuser, cloud allow-list), so this path stays a refusal; what it
 * must not stay is a bare `type "vector" does not exist` on a crash-looping
 * pod, which names nothing the reader can act on.
 *
 * The scaffold now ships `pgvector/pgvector:pg18`, so this is reached by a
 * project pointed at a database someone else provisioned — which is exactly
 * the case where naming the extension and the image is worth the words.
 */
function vectorExtensionHint(message: string): string {
    if (!/type "(vector|halfvec|sparsevec)" does not exist/i.test(message)) return "";
    return (
        "\n  pgvector is not installed on this database, and Rebase does not install it: it is a server extension, " +
        "so it needs an image that ships it (the scaffold's `pgvector/pgvector:pg18` does; a stock `postgres:18` " +
        "does not) and a role allowed to run `CREATE EXTENSION vector;`. Install it once, then boot again. " +
        "Rebase then creates an ANN index for the column automatically — see the `index` option on the property."
    );
}

/**
 * Read what the database looks like, for the schemas a set of collections
 * lives in.
 *
 * The same read `ensureCollectionTables` does at boot, exposed on its own for
 * the callers that want to *plan* against a real database without changing it —
 * the live schema editor, which has to tell somebody what a change would do
 * before they agree to it.
 */
export async function readSchemaFactsFor(
    client: Queryable,
    collections: CollectionConfig[]
): Promise<ExistingSchema> {
    const relational = relationalCollections(collections);
    const schemas = Array.from(new Set([
        ...relational.map(schemaOf),
        ...planJunctionTables(relational).map(junction => junction.schema)
    ]));
    return readExistingSchema(client, schemas);
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
    const failures: EnsureOutcome["failures"] = [];

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

    // Before anything is applied: a `search` block that changed after its column
    // was generated cannot be honoured by an additive plan, and serving the old
    // index while the config describes a new one is the silent failure this
    // check exists to end. Refusing is the loud half — boot is fatal on purpose
    // (see `ensureCollectionSchema` in the server's boot) and the message
    // carries the exact statements that resolve it.
    if (plan.searchDrift.length > 0) {
        throw new Error(searchDriftMessage(plan.searchDrift));
    }

    // Said once per column, at the moment the stamp is applied: from here on a
    // change is detected, but whether *this* column matches the block it is
    // being stamped with is not knowable — it predates the stamp.
    for (const adopted of plan.searchAdopted) {
        const message =
            `Adopting the existing generated column "${adopted.table}"."${adopted.column}" and recording what the ` +
            "current `search` block would generate. Any later change to that block will be detected and refused; a " +
            "change made *before* this version was deployed cannot be, so if search has been missing content, " +
            `rebuild the column once: ALTER TABLE "${adopted.table.split(".").join('"."')}" DROP COLUMN "${adopted.column}"; and boot again.`;
        logger.info(`[schema] ${message}`);
        log?.(message);
    }

    // Said once per column, every boot: an unindexed vector column and an
    // indexed one behave identically apart from latency, so the only way anyone
    // learns which one they have is if the boot says so.
    for (const skip of plan.vectorIndexSkipped) {
        const message = `No ANN index on "${skip.table}"."${skip.column}": ${skip.reason}`;
        logger.warn(`[schema] ${message}`);
        log?.(message);
    }

    // Said once per column, every boot, because the alternative is what this
    // whole feature exists to end: a column the configuration calls required,
    // sitting there nullable, with every surface reporting success. The boot
    // does not fail over it — the column is usable and the data is intact — but
    // it stops being invisible.
    for (const withheld of plan.withheldConstraints) {
        const message =
            `No NOT NULL on "${withheld.target}": ${withheld.reason} ${withheld.remedy}`;
        logger.warn(`[schema] ${message}`);
        log?.(message);
    }

    if (plan.actions.length === 0) {
        log?.("Schema is up to date; nothing to create.");
        return { ...plan, failures };
    }

    for (const action of plan.actions) {
        try {
            if (await applyAction(client, action)) {
                log?.(`${action.kind}: ${action.target}`);
            } else {
                log?.(`${action.kind}: ${action.target} (already created by a peer)`);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // A foreign key is the only action that can fail on the customer's
            // data rather than on the schema. The column it polices is already
            // there, so the collection serves either way — record it and carry
            // on rather than crash-looping the deployment.
            //
            // A comment is metadata about a column that was just created
            // successfully, and it can only fail on ownership (COMMENT requires
            // owning the table, which an adopted table may not grant). Losing
            // the stamp costs drift detection on the next boot; it must not cost
            // the deployment.
            if (action.kind === "add-constraint" || action.kind === "comment-column") {
                failures.push({ kind: action.kind, target: action.target, error: message });
                continue;
            }
            throw new Error(
                `Failed to ${action.kind} ${action.target}: ${message}${vectorExtensionHint(message)}\n  ${action.sql}`
            );
        }
    }
    return { ...plan, failures };
}

/** Attempts per action, including the first. Matches the server's bootstraps. */
const DDL_ATTEMPTS = 4;

/**
 * Run one planned statement, surviving a simultaneous boot.
 *
 * Every statement in a plan is written to be idempotent, and that is not the
 * same as being safe to run concurrently: `CREATE … IF NOT EXISTS` reads the
 * catalog and then writes to it as two steps, so peers starting together both
 * see "absent" and the loser gets a duplicate key on a *catalog* index. Measured
 * against Postgres 18: five instances, 8 of 10 calls lost. `CREATE TYPE` is
 * worse, because Postgres has no `IF NOT EXISTS` for it at all.
 *
 * What made that fatal here rather than merely noisy is the loop this sits in.
 * A losing statement threw, and the throw abandoned **every remaining action in
 * the plan** — so a replica that lost one race came up missing tables it never
 * attempted, and the boot log blamed the one statement that failed.
 *
 * @returns `true` if this process applied the statement, `false` if a peer had
 *   already created the object. The distinction is only for the log; both mean
 *   the object is now there.
 * @throws the original error for anything that is not a race — a syntax error, a
 *   permission failure, a unique constraint the customer's own rows violate.
 */
async function applyAction(
    client: Queryable,
    action: EnsureAction
): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
        try {
            await client.query(action.sql);
            return true;
        } catch (err) {
            // Already there. Not "retry" — the end state this statement wanted
            // is the end state the database is in, so carry on to the next
            // action rather than spending three more attempts proving it.
            if (isDuplicateObjectRace(err)) {
                logger.debug(
                    `[schema] ${action.kind} ${action.target}: already created by another instance`
                );
                return false;
            }
            // Retryable but not yet satisfied — a deadlock between two boots
            // taking catalog locks in step. The statement did nothing; run it
            // again after a jittered pause so peers that collided once do not
            // collide again in lockstep.
            if (isConcurrentDdlRace(err) && attempt < DDL_ATTEMPTS) {
                logger.debug(
                    `[schema] ${action.kind} ${action.target}: lost a race with another instance ` +
                    `(attempt ${attempt}/${DDL_ATTEMPTS}) — retrying`
                );
                await new Promise(resolve => setTimeout(resolve, 40 * attempt * (1 + Math.random())));
                continue;
            }
            throw err;
        }
    }
}
