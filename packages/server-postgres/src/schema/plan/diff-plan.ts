/**
 * The additive statements that bring a database up to a {@link SchemaPlan}.
 *
 * ## Why additive-only, forever
 *
 * This runs unattended, at boot, against a database with customers' data in it,
 * with no human reading a diff. So it may only ever do things that cannot lose
 * data: create a missing table, add a missing column, create a missing enum
 * type, add an enum value, create an index.
 *
 * It will **never** drop a table or a column, narrow a type, or alter a
 * constraint at boot. A removed field leaves its column behind; a renamed field
 * looks like an addition and the old column stays. That is the correct trade
 * for an automated path — the alternative is an unattended process that can
 * silently destroy a column. Destructive changes stay a deliberate,
 * human-reviewed migration. Because of that, this is safe to run on every boot,
 * and re-running it is a no-op.
 *
 * ## What changed when the planner arrived
 *
 * This used to read `Property` itself — its own reading of the type, of
 * `validation`, of relations, of enums — and disagreed with `db push` about all
 * of them. The audit found a required `author_id` that was NOT NULL after a
 * push and nullable after a boot, on the one path with no developer in the
 * loop. Now it reads the same {@link ColumnPlan} the DDL renderer does, so a
 * column's type, default, uniqueness and foreign key are decided once. What is
 * left here is the half that is genuinely this path's own: *what the database
 * already has*, and which of the planned constraints are safe to apply to it.
 */
import type { ColumnPlan, SchemaPlan, TablePlan } from "./types";
import { renderColumnDefinition, renderPgType } from "./render-ddl";
import { quoteSqlLiteral } from "./plan-schema";
import { SET_UPDATED_AT_FN, triggerStatements } from "./updated-at-trigger";
import {
    SEARCH_STAMP_PREFIX,
    SEARCH_TEXT_FN,
    SEARCH_UNACCENT_FN,
    searchColumnStamps,
    searchIndexStatements
} from "../search-column";
import { collectionIndexStatement, sortIndexSpecs } from "../collection-index";
import { vectorIndexStatement, type SkippedVectorIndex } from "../vector-index";
import { typesAgree, type ColumnTypeDrift } from "../column-type-drift";

/** Postgres identifiers this module is willing to interpolate. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * Validation used to run only on the names read back OUT of the catalogue,
 * which is the direction that cannot hurt anyone: those came from Postgres. The
 * names going IN — the schema and table a collection declares — were quoted and
 * concatenated on trust, and quoting is not escaping. A table named
 * `x" (id int); DROP TABLE users; --` closes the quote and the statement, and
 * the whole thing runs on the owner connection, which is the one connection in
 * the system that is exempt from every RLS policy.
 *
 * That is only a config file on a self-hosted project, where the person writing
 * it could run the SQL directly anyway. It is not only a config file where a
 * collection can be defined over the wire — the live-schema and source editors
 * both do that — and there the caller is an admin on the app, not an operator
 * of the database.
 */
export function assertSafeIdentifier(value: string, what: string): string {
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
     * one. This is where a generated search column's fingerprint lives.
     */
    columnComments?: Map<string, string>;
    /** `schema.typename` → its labels, in `enumsortorder`. */
    enumValues?: Map<string, string[]>;
    /** `schema.table.column` of every NOT NULL column. */
    notNullColumns?: Set<string>;
    /** `schema.table.column` of every column that has a DEFAULT. */
    columnDefaults?: Set<string>;
    /** `schema.table` of every table that holds at least one row. */
    populatedTables?: Set<string>;
    /**
     * `schema.table.column` → the type Postgres reports, as `udt_name` (plus a
     * modifier where one distinguishes two columns of the same family, e.g.
     * `numeric(10,2)`).
     */
    columnTypes?: Map<string, string>;
    /** `schema.table.trigger` of every trigger that already exists. */
    triggers?: Set<string>;
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
 *   the person making the change, and applied only once they confirm it.
 */
export type ConstraintPolicy = "additive" | "converge";

export interface DiffOptions {
    /** Defaults to `additive`. See {@link ConstraintPolicy}. */
    constraints?: ConstraintPolicy;
}

export interface EnsureAction {
    kind: "create-enum" | "create-table" | "add-column" | "add-constraint" | "rename-column"
        | "create-extension" | "create-function" | "create-index" | "comment-column"
        | "add-enum-value" | "set-not-null" | "drop-not-null" | "set-default" | "create-trigger";
    /** Qualified target, for logging: `public.posts` or `public.posts.title`. */
    target: string;
    sql: string;
}

/** A NOT NULL column with no default that no property declares. */
export interface OrphanedRequiredColumn {
    /** `schema.table`. */
    table: string;
    /** The column left behind. */
    column: string;
    /** The collection that no longer declares it. */
    slug: string;
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
 * unattended against live customer data with nobody reading a diff, so a
 * multi-minute outage is not a decision it may take on its own.
 *
 * Not applying it silently is not an option either: a collection that added a
 * field, flipped `unaccent` or raised a weight kept indexing the *old* set
 * forever, and the only symptom was searches returning nothing for content
 * plainly in the row.
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

export interface EnsurePlan {
    actions: EnsureAction[];
    /** Every statement, in dependency order. Empty when the schema is current. */
    statements: string[];
    /**
     * Relation columns this plan is about to create where the table already
     * carries the same column under its pre-singularization name.
     *
     * Reported rather than silently handled: the ensure is additive, so it
     * would add `category_id` beside a populated `categorie_id` and the
     * relation would then read the new, empty one. No statement fails, no table
     * is missing, and the only symptom is relations resolving to nothing.
     */
    legacyForeignKeys: LegacyForeignKey[];
    /** @see SearchColumnDrift */
    searchDrift: SearchColumnDrift[];
    /**
     * Generated search columns that exist but carry no fingerprint — created
     * before this check existed, or by `search.sql` on an older CLI. The plan
     * stamps them so the *next* change is detectable.
     */
    searchAdopted: { table: string; column: string }[];
    /**
     * Vector columns this plan is deliberately leaving unindexed, because
     * pgvector cannot build an ANN index that wide. Reported rather than
     * thrown: the column is valid, storable and searchable.
     */
    vectorIndexSkipped: SkippedVectorIndex[];
    /**
     * Constraints the configuration asks for that this plan is not applying,
     * and why. Every one of these was previously withheld in silence.
     */
    withheldConstraints: WithheldConstraint[];
    /**
     * Columns whose type in the database is in a different family from the one
     * the collection declares. Reported and never acted on — this is the one
     * divergence that presents as a *working* deploy.
     */
    columnTypeDrift: ColumnTypeDrift[];
    /**
     * Columns that are NOT NULL, have no default, and that no property declares
     * any more — so every insert through the API is rejected for a field the
     * author cannot name, because they already deleted it. This is what a
     * **rename** looks like to an additive provisioner. Reported, never acted
     * on: dropping the column is the right fix roughly always and destructive
     * exactly once, which is not a decision to take unattended.
     */
    orphanedRequiredColumns: OrphanedRequiredColumn[];
}

/** Which pass a column belongs to. The order below is the order they run in. */
const isScalarProperty = (column: ColumnPlan): boolean =>
    (column.source.kind === "property" || column.source.kind === "implicit-id") && !column.primaryKey;

export function diffPlanAgainstCatalogue(
    plan: SchemaPlan,
    existing: ExistingSchema,
    options: DiffOptions = {}
): EnsurePlan {
    const constraintPolicy: ConstraintPolicy = options.constraints ?? "additive";
    const actions: EnsureAction[] = [];
    const withheldConstraints: WithheldConstraint[] = [];
    const columnTypeDrift: ColumnTypeDrift[] = [];
    const legacyForeignKeys: LegacyForeignKey[] = [];
    const searchDrift: SearchColumnDrift[] = [];
    const searchAdopted: { table: string; column: string }[] = [];

    const collectionTables = plan.tables.filter(t => t.kind === "collection");
    const junctionTables = plan.tables.filter(t => t.kind === "junction");

    // 1. Enum types. `CREATE TYPE` has no IF NOT EXISTS, so an existing type is
    //    skipped by name rather than guarded in SQL.
    for (const enumPlan of plan.enums) {
        assertSafeIdentifier(enumPlan.schema, "schema name");
        if (existing.enums.has(enumPlan.qualified)) {
            // The type is there, but that says nothing about its *values*.
            // Skipping the whole type by name is what made an added enum value
            // vanish: nothing was planned, the boot reported success, and the
            // first row using the value was rejected by a type that had never
            // heard of it. `ADD VALUE` is the one alteration Postgres offers
            // here, it is purely additive, and it is idempotent.
            //
            // `enumValues` absent means the caller built the schema by hand and
            // does not know the values; skip by name as before.
            const current = existing.enumValues?.get(enumPlan.qualified);
            if (!current) continue;
            for (const value of enumPlan.labels) {
                if (current.includes(value)) continue;
                actions.push({
                    kind: "add-enum-value",
                    target: `${enumPlan.qualified}.${value}`,
                    // Not inside a transaction with any use of the value:
                    // Postgres refuses to read a value added by the transaction
                    // still adding it. The applier runs these one statement at a
                    // time, which is what makes it legal.
                    sql: `ALTER TYPE "${enumPlan.schema}"."${enumPlan.name}" ADD VALUE IF NOT EXISTS ${quoteSqlLiteral(value)};`
                });
            }
            continue;
        }
        actions.push({
            kind: "create-enum",
            target: enumPlan.qualified,
            sql: `CREATE TYPE "${enumPlan.schema}"."${enumPlan.name}" AS ENUM (${enumPlan.labels.map(quoteSqlLiteral).join(", ")});`
        });
    }

    // 1b. Extensions and helper functions, before the tables and columns that
    //     reference them: a generated column's expression is resolved when the
    //     column is created, so a table whose search column calls
    //     `rebase_search_text` cannot be added before that function exists.
    //     Both forms are idempotent, so a boot against a database that already
    //     has them plans nothing.
    for (const statement of plan.extensions) {
        actions.push({
            kind: "create-extension",
            target: statement.replace(/^CREATE EXTENSION IF NOT EXISTS |;$/g, ""),
            sql: statement
        });
    }
    for (const statement of plan.functions) {
        actions.push({ kind: "create-function", target: functionTarget(statement), sql: statement });
    }

    // 2. Missing tables. Only the identity column is created here; every other
    //    column is added by step 3, so a new table and an existing table that
    //    gained a field travel the exact same code path. One way to build a
    //    column means one way for it to be wrong.
    const created = new Set<string>();
    for (const table of collectionTables) {
        if (existing.tables.has(table.qualified) || created.has(table.qualified)) continue;
        created.add(table.qualified);
        const schema = assertSafeIdentifier(table.schema, "schema name");
        const name = assertSafeIdentifier(table.table, "table name");
        const id = table.columns.find(c => c.primaryKey);
        const definition = id
            ? `"${assertSafeIdentifier(id.column, "column name")}" ${renderColumnDefinition(id)}`
            : '"id" TEXT PRIMARY KEY';
        actions.push({
            kind: "create-table",
            target: table.qualified,
            sql: `CREATE TABLE IF NOT EXISTS "${schema}"."${name}" (${definition});`
        });
    }

    // 2b. Junction tables behind many-to-many relations. No collection declares
    //     them, so until they existed an m2m write had nowhere to land and the
    //     junction's derived RLS had nothing to attach to. Both columns are
    //     created here — unlike a collection table, whose CREATE declares only
    //     the identity column — because there is nothing else to them.
    for (const table of junctionTables) {
        if (existing.tables.has(table.qualified) || created.has(table.qualified)) continue;
        created.add(table.qualified);
        const columns = table.columns
            .map(c => `"${c.column}" ${renderColumnDefinition(c)}`)
            .join(", ");
        actions.push({
            kind: "create-table",
            target: table.qualified,
            sql: `CREATE TABLE IF NOT EXISTS "${table.schema}"."${table.table}" (${columns}` +
                `, PRIMARY KEY (${table.primaryKey.map(c => `"${c}"`).join(", ")}));`
        });
    }

    const addColumn = (table: TablePlan, column: string, definition: string): void => {
        if (existing.tables.get(table.qualified)?.has(column)) return;
        // Same reason as `assertSafeIdentifier` above: a column name reaching
        // here came from a property declaration, which on the editor paths came
        // over the wire. `definition` is built by the renderer from a closed set
        // of type mappings and is not caller text.
        assertSafeIdentifier(column, "column name");
        actions.push({
            kind: "add-column",
            target: `${table.qualified}.${column}`,
            sql: `ALTER TABLE "${table.schema}"."${table.table}" ADD COLUMN IF NOT EXISTS "${column}" ${definition};`
        });
    };

    /**
     * Move a column that is only missing because it was renamed.
     *
     * Returns true when it handled the column, so the caller skips the ordinary
     * ADD. Adding would be the wrong move and a quiet one: the data is in the
     * old column, `ADD COLUMN` creates the new one empty beside it, every
     * statement succeeds, and the relation reads the empty one. A rename is
     * metadata-only in Postgres, keeps the values, and carries the column's
     * indexes and constraints with it.
     */
    const renameLegacyColumn = (table: TablePlan, column: ColumnPlan): boolean => {
        const present = existing.tables.get(table.qualified);
        if (!column.legacyColumn || !present) return false;
        if (present.has(column.column) || !present.has(column.legacyColumn)) return false;
        legacyForeignKeys.push({ table: table.qualified, expected: column.column, legacy: column.legacyColumn });
        actions.push({
            kind: "rename-column",
            target: `${table.qualified}.${column.column}`,
            sql: `ALTER TABLE "${table.schema}"."${table.table}" RENAME COLUMN "${column.legacyColumn}" TO "${column.column}";`
        });
        return true;
    };

    /**
     * A `NOT NULL` is safe exactly when it cannot fail against rows that are
     * already there, and there are three ways to know that:
     *
     *  - the table is being created by this plan (no rows yet);
     *  - the table exists and is empty;
     *  - the column arrives with a DEFAULT, which Postgres backfills into every
     *    existing row as part of ADD COLUMN.
     *
     * `populatedTables` absent means the caller does not know, and not knowing
     * has to read as "assume rows" — the other direction emits a NOT NULL that
     * is checked against live data and aborts the boot. Written as an explicit
     * `!== undefined` because the optional-chain form quietly says *empty* when
     * the fact is missing, which is the wrong way to be wrong.
     */
    const tableIsEmpty = (table: TablePlan): boolean =>
        existing.populatedTables !== undefined
        && existing.tables.has(table.qualified)
        && !existing.populatedTables.has(table.qualified);

    /**
     * Plan one column, with the constraints this database can safely take.
     *
     * The definition comes from the same renderer `schema.sql` uses, minus the
     * constraints that are checked against live rows. That subtraction is the
     * whole of what this path is allowed to decide for itself.
     */
    const planColumn = (table: TablePlan, column: ColumnPlan): void => {
        const key = `${table.qualified}.${column.column}`;
        const columnExists = existing.tables.get(table.qualified)?.has(column.column) === true;
        const fresh = created.has(table.qualified);
        const empty = tableIsEmpty(table);
        const required = !column.nullable;
        const hasDefault = column.default !== undefined;

        // The column is there and holds a different kind of value than the
        // collection says it does. Reported, never altered: an unattended
        // `ALTER COLUMN … TYPE` over customer data is not a thing to do
        // quietly, and the *quiet* is what this fixes. A deploy that changed a
        // `columnType` used to report success while the column stayed as it
        // was, and the divergence surfaced later as every write failing.
        // A column whose definition is owned elsewhere (auth, or a generated
        // search column) is not compared: the declaration there is a rendered
        // string rather than a type, and auth's own reconcile owns it.
        const declaredType = renderPgType(column.type);
        const actualType = existing.columnTypes?.get(key);
        if (columnExists && !column.sqlDefinition && actualType && !typesAgree(declaredType, actualType)) {
            columnTypeDrift.push({ table: table.qualified, column: column.column, declared: declaredType, actual: actualType });
        }

        // A table this run is creating has no rows yet, so the constraints
        // `db push` writes are free to apply. On a table that already exists
        // they are not: `SET NOT NULL` is checked against live rows and a UNIQUE
        // would fail on existing duplicates. So the constraints are emitted for
        // the fresh case — which is the whole managed-runtime path, and the one
        // that diverged from `db push` — and withheld for the adopted one.
        const notNullIsSafe = fresh || empty || hasDefault;
        const applicable: ColumnPlan = {
            ...column,
            unique: column.unique && fresh,
            nullable: column.nullable || !(notNullIsSafe || columnExists)
        };
        if (required && !columnExists && !notNullIsSafe) {
            withheldConstraints.push({
                target: key,
                kind: "not-null",
                reason: column.source.kind === "relation" || column.source.kind === "reference"
                    ? `"${column.column}" is a required link, but "${table.qualified}" already holds rows and ` +
                      "the column has no default to backfill them with, so NOT NULL would be checked " +
                      "against data that does not have a value yet."
                    : `"${column.column}" is required, but "${table.qualified}" already holds rows and the column ` +
                      "has no default to backfill them with, so NOT NULL would be checked " +
                      "against data that does not have a value yet.",
                remedy: column.source.kind === "relation" || column.source.kind === "reference"
                    ? "Backfill the column, then add the constraint — or make the relation optional."
                    : "Backfill the column, then add the constraint — or give the property a " +
                      "default so every existing row gets one."
            });
        }
        addColumn(table, column.column, renderColumnDefinition(applicable));

        if (!columnExists) return;

        // ── The column is already there and only a modifier differs ──────────
        // A DEFAULT binds future writes only, so `SET DEFAULT` cannot fail and
        // cannot touch a row that already exists. That makes it the one
        // convergence this path may do unattended — and it has to, because
        // `ADD COLUMN IF NOT EXISTS` is a no-op against an existing column, so
        // a `defaultValue` added to a live collection would otherwise never
        // reach the database at all.
        if (column.default && column.default.kind !== "identity" && !column.generated) {
            const expression = column.default.kind === "sql" ? column.default.expression : column.default.sql;
            if (!existing.columnDefaults?.has(key)) {
                actions.push({
                    kind: "set-default",
                    target: key,
                    sql: `ALTER TABLE "${table.schema}"."${table.table}" ALTER COLUMN "${column.column}" SET DEFAULT ${expression};`
                });
            }
        }

        // Two directions on NOT NULL, and they are not equally safe — see
        // `ConstraintPolicy` for why neither runs at an unattended boot.
        if (constraintPolicy !== "converge") return;
        const isNotNull = existing.notNullColumns?.has(key) === true;
        if (required && !isNotNull) {
            if (empty) {
                actions.push({
                    kind: "set-not-null",
                    target: key,
                    sql: `ALTER TABLE "${table.schema}"."${table.table}" ALTER COLUMN "${column.column}" SET NOT NULL;`
                });
            } else {
                withheldConstraints.push({
                    target: key,
                    kind: "not-null",
                    reason:
                        `"${column.column}" became required, but "${table.qualified}" holds rows and any of them ` +
                        "with no value would make SET NOT NULL fail.",
                    remedy:
                        "Backfill the column first — `UPDATE … SET \"" + column.column +
                        "\" = … WHERE \"" + column.column + "\" IS NULL` — then apply this again."
                });
            }
        }
        if (!required && isNotNull) {
            // Loosening never fails and never loses data. It is here rather
            // than at boot because a database adopted by introspection carries
            // NOT NULL on columns the generated collection deliberately leaves
            // optional, and converging those unasked would drop constraints
            // nobody edited.
            actions.push({
                kind: "drop-not-null",
                target: key,
                sql: `ALTER TABLE "${table.schema}"."${table.table}" ALTER COLUMN "${column.column}" DROP NOT NULL;`
            });
        }
    };

    // 3. Scalar columns, then the auth columns the collection never mentions.
    //    The scaffold's users collection describes 12 of the 14 columns auth
    //    reads and writes, so planning only from properties left `is_anonymous`
    //    and `tokens_valid_after` to `ensureAuthTablesExist` — which does create
    //    them, but only because that function happens to run later in the same
    //    boot. Planning them here makes this path self-contained.
    for (const table of collectionTables) {
        assertSafeIdentifier(table.schema, "schema name");
        assertSafeIdentifier(table.table, "table name");
        for (const column of table.columns) {
            if (!isScalarProperty(column)) continue;
            planColumn(table, column);
        }
        for (const column of table.columns) {
            if (column.source.kind !== "auth") continue;
            addColumn(table, column.column, renderColumnDefinition(column));
        }
    }

    // 3a. The generated search columns.
    //
    //     Adding a STORED generated column rewrites the table, which on a large
    //     one is not free — but it is the same additive shape as every other
    //     column here, and the alternative (leaving it out until someone runs a
    //     migration) is a declared `search` block that silently does nothing.
    //
    //     Changing one is not additive, and `ADD COLUMN IF NOT EXISTS` is a
    //     no-op against a column that is already there — which is why a `search`
    //     block that gained a field, flipped `unaccent` or moved a weight used
    //     to be inert forever, on every path, with nothing logged. Each column
    //     carries a fingerprint of the expression it was built from, and a
    //     mismatch is reported rather than applied.
    for (const table of collectionTables) {
        if (!table.search) continue;
        const definitions = new Map(
            table.columns
                .filter(c => c.source.kind === "search")
                .map(c => [c.column, renderColumnDefinition(c)] as const)
        );
        for (const stamp of searchColumnStamps(table.search)) {
            const definition = definitions.get(stamp.column)!;
            const exists = existing.tables.get(table.qualified)?.has(stamp.column) === true;
            const recorded = existing.columnComments?.get(`${table.qualified}.${stamp.column}`);

            if (exists && recorded?.startsWith(SEARCH_STAMP_PREFIX) && recorded !== stamp.fingerprint) {
                searchDrift.push({
                    table: table.qualified,
                    column: stamp.column,
                    found: recorded,
                    expected: stamp.fingerprint,
                    rebuild: [
                        `ALTER TABLE "${table.schema}"."${table.table}" DROP COLUMN "${stamp.column}";`,
                        `ALTER TABLE "${table.schema}"."${table.table}" ADD COLUMN "${stamp.column}" ${definition};`,
                        stamp.sql
                    ]
                });
                // The old stamp is the only evidence of what the column holds;
                // overwriting it here would erase the drift instead of fixing it.
                continue;
            }

            addColumn(table, stamp.column, definition);
            if (exists && recorded === undefined) {
                searchAdopted.push({ table: table.qualified, column: stamp.column });
            }
            if (recorded !== stamp.fingerprint) {
                actions.push({ kind: "comment-column", target: `${table.qualified}.${stamp.column}`, sql: stamp.sql });
            }
        }
    }

    // 3b. A junction that already existed, but is short a column. One created
    //     above already carries both, so re-listing them would log two no-op
    //     statements and inflate the count of changes applied.
    for (const table of junctionTables) {
        if (created.has(table.qualified)) continue;
        for (const column of table.columns) {
            if (renameLegacyColumn(table, column)) continue;
            // A payload column (`through.properties`) goes through `planColumn`,
            // the same pass a collection's scalar columns take. The bare
            // `ADD COLUMN <type>` below is right for the two key columns — they
            // are NOT NULL by the composite primary key and have no default —
            // and wrong for everything else: it would drop a `defaultValue`, and
            // it would either omit a NOT NULL the collection declared or apply
            // one to a junction that already holds rows without a value to
            // backfill them. `planColumn` is the one place that decides which of
            // those is safe, and it reports the constraint it withheld.
            if (column.source.kind === "property") {
                planColumn(table, column);
                continue;
            }
            addColumn(table, column.column, renderPgType(column.type));
        }
    }

    // 3c. The columns relation and reference properties own.
    for (const table of collectionTables) {
        for (const column of table.columns) {
            if (column.source.kind !== "relation" && column.source.kind !== "reference") continue;
            // A declared property already emits this column (an explicit
            // `postId` beside the `belongsTo` that uses it); the relation
            // contributes only the constraint, below.
            if (column.columnOwnedByProperty) continue;
            if (renameLegacyColumn(table, column)) continue;
            planColumn(table, column);
        }
    }

    // 4. Foreign keys, last: the tables and columns on both ends have to exist
    //    first, and a constraint is the one thing here that can fail on data
    //    rather than on schema, so nothing else depends on it.
    const knownConstraints = existing.constraints ?? new Set<string>();
    const plannedConstraints = new Set<string>();
    for (const table of [...collectionTables, ...junctionTables]) {
        for (const column of table.columns) {
            const fk = column.foreignKey;
            if (!fk) continue;
            const name = `${fk.schema}.${fk.table}.${fk.constraintName}`;
            if (knownConstraints.has(name) || plannedConstraints.has(name)) continue;
            plannedConstraints.add(name);
            actions.push({ kind: "add-constraint", target: name, sql: `${fk.sql};` });
        }
    }

    // 5. Indexes, after everything — the column has to exist, and this is the
    //    one step that runs against a populated table for real work.
    //
    //    CONCURRENTLY: a plain CREATE INDEX takes a lock that blocks writes for
    //    the duration of the build, which on a live table is an outage. Each
    //    statement here is issued on its own, outside any transaction, which is
    //    the condition CONCURRENTLY requires.
    //
    //    ...and only on a live table. It is withheld for a table this same plan
    //    is creating: there are no rows to build from and no writer to block, so
    //    the lock CONCURRENTLY avoids is a lock nobody would have taken. Worth
    //    withholding rather than merely harmless, because CONCURRENTLY is the
    //    one index form Postgres refuses inside a transaction block.
    const concurrent = (schema: string, table: string): boolean => !created.has(`${schema}.${table}`);
    for (const table of collectionTables) {
        if (!table.search) continue;
        for (const statement of searchIndexStatements(table.search)) {
            actions.push({
                kind: "create-index",
                target: table.qualified,
                sql: concurrent(table.schema, table.table)
                    ? statement.replace("CREATE INDEX IF NOT EXISTS", "CREATE INDEX CONCURRENTLY IF NOT EXISTS")
                    : statement
            });
        }
    }

    //    ANN indexes for vector columns, on the same terms. A column too wide
    //    for pgvector to index is reported, not planned — silence there would
    //    read as "indexed" to anyone watching the boot.
    const vectorIndexSkipped: SkippedVectorIndex[] = [];
    for (const table of collectionTables) {
        if (!table.vector) continue;
        for (const spec of table.vector.specs) {
            actions.push({
                kind: "create-index",
                target: `${spec.schema}.${spec.table}`,
                sql: concurrent(spec.schema, spec.table)
                    ? vectorIndexStatement(spec).replace("CREATE INDEX IF NOT EXISTS", "CREATE INDEX CONCURRENTLY IF NOT EXISTS")
                    : vectorIndexStatement(spec)
            });
        }
        vectorIndexSkipped.push(...table.vector.skipped);
    }

    //    Declared indexes, on exactly the same terms. Boot has to emit these,
    //    not just `db push`: the managed runtime provisions at boot and never
    //    runs a push, so a push-only index would simply not exist there — and
    //    nothing would say so. `contracts/derived-names.txt` states the rule
    //    ("Both, or it is a bug") and the gate enforces it.
    //
    //    `concurrently` is a parameter rather than a string replacement on the
    //    rendered SQL: the `.replace(…)` above silently does nothing for a
    //    UNIQUE index, whose text is `CREATE UNIQUE INDEX …`.
    for (const spec of sortIndexSpecs(collectionTables.flatMap(t => t.indexes))) {
        actions.push({
            kind: "create-index",
            target: `${spec.schema}.${spec.table}`,
            sql: collectionIndexStatement(spec, {
                concurrently: concurrent(spec.schema, spec.table),
                ifNotExists: true
            })
        });
    }

    // 6. `autoValue: "on_update"` triggers. After the column, and idempotent by
    //    DROP-then-CREATE rather than `CREATE OR REPLACE TRIGGER`, which exists
    //    only on Postgres 14+.
    for (const table of collectionTables) {
        for (const trigger of table.triggers) {
            // Named after its table and column, so a trigger already in the
            // catalogue is this one — re-issuing it every boot would work and
            // would report a change on a database that has none.
            if (existing.triggers?.has(`${table.qualified}.${trigger.name}`)) continue;
            for (const statement of triggerStatements(trigger)) {
                actions.push({
                    kind: "create-trigger",
                    target: `${table.qualified}.${trigger.name}`,
                    sql: statement
                });
            }
        }
    }

    // A column the database still requires that no property declares any more.
    //
    // Computed last, over the same live snapshot the rest of the plan read, and
    // only for tables this run did not create — a table created here has exactly
    // the columns the collection asked for, so there is nothing to orphan.
    //
    // Every element of the test matters. NOT NULL, because a nullable leftover
    // accepts a write and is merely untidy. No DEFAULT, because a leftover with
    // one is filled in for you. Not declared, because that is what makes it
    // unreachable — the author has no field to send.
    const orphanedRequiredColumns: OrphanedRequiredColumn[] = [];
    if (existing.notNullColumns && existing.columnDefaults) {
        for (const table of collectionTables) {
            const live = existing.tables.get(table.qualified);
            if (!live || created.has(table.qualified)) continue;
            const declared = new Set<string>();
            for (const column of table.columns) {
                declared.add(column.column);
                if (column.legacyColumn) declared.add(column.legacyColumn);
            }
            for (const column of live) {
                const key = `${table.qualified}.${column}`;
                if (declared.has(column)) continue;
                if (!existing.notNullColumns.has(key)) continue;
                if (existing.columnDefaults.has(key)) continue;
                orphanedRequiredColumns.push({ table: table.qualified, column, slug: table.slug! });
            }
        }
    }

    return {
        actions,
        statements: actions.map(a => a.sql),
        legacyForeignKeys,
        searchDrift,
        searchAdopted,
        vectorIndexSkipped,
        withheldConstraints,
        columnTypeDrift,
        orphanedRequiredColumns
    };
}

/** What a `CREATE FUNCTION` statement is called, for the action log. */
const functionTarget = (statement: string): string => {
    if (statement.includes("set_updated_at")) return SET_UPDATED_AT_FN;
    return statement.includes("unaccent") ? SEARCH_UNACCENT_FN : SEARCH_TEXT_FN;
};
