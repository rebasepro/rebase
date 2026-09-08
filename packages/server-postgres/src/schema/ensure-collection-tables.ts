/**
 * Applying a schema plan to a database that is already running.
 *
 * ## What this module is
 *
 * A managed runtime boots someone else's compiled project against a database it
 * has never seen. Auth tables are ensured at boot already, but collection tables
 * were not created by anything: the platform ran the app and every `/api/data/*`
 * request answered 500 on a missing relation. `rebase db push` cannot help — it
 * is an Atlas-driven CLI command, and the runtime image ships no CLI.
 *
 * Two halves, and only one of them is here. *What the collections ask for* is
 * `schema/plan/plan-schema.ts`, shared with `db push` and the generated Drizzle
 * file; *what the database already has, and which of those statements are safe
 * to run against it* is `schema/plan/diff-plan.ts`. This module reads the
 * catalogue, runs the statements, and reports what happened.
 *
 * ## Why additive-only, forever
 *
 * This runs unattended, against a database with customers' data in it, with no
 * human reading a diff. So it may only ever do things that cannot lose data.
 * See `diff-plan.ts` for the whole of that argument.
 */
import {
    declaredDatabaseExtensions,
    type CollectionConfig
} from "@rebasepro/types";
import { relationalCollections } from "@rebasepro/common";
import { logger, isConcurrentDdlRace, isDuplicateObjectRace } from "@rebasepro/server";
import { SEARCH_STAMP_PREFIX } from "./search-column";
import { vectorExtensionHint } from "./vector-index";
import { planJunctionTables, quoteSqlLiteral } from "./generate-postgres-ddl-logic";
import { planSchema } from "./plan/plan-schema";
import {
    assertSafeIdentifier,
    diffPlanAgainstCatalogue,
    type ConstraintPolicy,
    type DiffOptions,
    type EnsureAction,
    type EnsurePlan,
    type ExistingSchema,
    type LegacyForeignKey,
    type OrphanedRequiredColumn,
    type SearchColumnDrift,
    type WithheldConstraint
} from "./plan/diff-plan";
import { extractCauseMessage, extractPgError } from "../utils/pg-error-utils";
import { columnTypeDriftMessage, type ColumnTypeDrift } from "./column-type-drift";

export type {
    ConstraintPolicy,
    EnsureAction,
    EnsurePlan,
    ExistingSchema,
    LegacyForeignKey,
    OrphanedRequiredColumn,
    SearchColumnDrift,
    WithheldConstraint
};

/**
 * The subset of a database handle this needs: run a statement, get rows back.
 *
 * Deliberately parameterless. Everything here is DDL or catalogue reads keyed by
 * schema name, and schema names are identifiers — they cannot be bound as
 * parameters anyway. They are validated by `assertSafeIdentifier` before they
 * reach a statement, so a config that somehow carried a quote is refused rather
 * than concatenated.
 */
export interface Queryable {
    query<T = unknown>(sql: string): Promise<{ rows: T[] }>;
}

export interface EnsureOptions extends DiffOptions {
    /**
     * Server extensions the project's databases gave Rebase leave to install —
     * `declaredDatabaseExtensions()`. Absent means none, which is a refusal and
     * is the right default for a planner given no configuration at all.
     *
     * Explicit rather than read from the resource registry in here, because the
     * planner is pure and several callers plan against fixtures: reaching for a
     * process-wide registry would make the plan depend on whatever some other
     * module happened to import. `ensureCollectionTables` is the boundary that
     * reads the world.
     */
    databaseExtensions?: readonly string[];
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

/** The schema a collection lives in, validated before it reaches any DDL. */
function schemaOf(collection: CollectionConfig): string {
    const schema = (collection as { schema?: string }).schema || "public";
    return assertSafeIdentifier(schema, "schema name");
}

/**
 * Decide what to add. Pure — the caller supplies what exists and runs the
 * result.
 *
 * A plan and a diff: the collections are read once, by `planSchema`, into the
 * same {@link SchemaPlan} `db push` renders `schema.sql` from, and the diff
 * subtracts what the database already has. Before that split this function had
 * its own reading of every `Property`, and the audit found twelve places where
 * it disagreed with the two generators — a required `author_id` that was
 * NOT NULL after a push and nullable after a boot among them, on the one path
 * with no developer in the loop.
 */
export function planCollectionSchemaEnsure(
    allCollections: CollectionConfig[],
    existing: ExistingSchema,
    options: EnsureOptions = {}
): EnsurePlan {
    const plan = planSchema(allCollections, { databaseExtensions: options.databaseExtensions });
    return diffPlanAgainstCatalogue(plan, existing, { constraints: options.constraints });
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
    // `udt_name` rather than `data_type`: `data_type` collapses every array to
    // the literal string `ARRAY` and every extension type to `USER-DEFINED`,
    // which cannot be compared with anything. `udt_name` names the actual type
    // — `int4`, `jsonb`, `_numeric`, `vector` — which is what the drift check
    // needs.
    const columnTypes = new Map<string, string>();
    // A NOT NULL column that has a DEFAULT is not a problem for a write that
    // omits it, so orphan detection needs the default as well as the nullability
    // — otherwise every `created_at DEFAULT now()` on a table whose collection
    // does not declare it would be reported as a blocker.
    const columnDefaults = new Set<string>();
    const { rows: columns } = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
        is_nullable: string;
        udt_name: string | null;
        column_default: string | null;
        numeric_precision: number | null;
        numeric_scale: number | null;
    }>(
        // `numeric_precision`/`numeric_scale` because `udt_name` is `numeric`
        // for both `NUMERIC` and `NUMERIC(10, 2)`, and a property that declares
        // a precision means it: money stored in an unbounded column keeps the
        // third decimal the rounding was supposed to remove. Only carried for
        // `numeric`, where the modifier changes what a value *is*; a `varchar`
        // width is a limit on the same family and `typesAgree` ignores it.
        `SELECT table_schema, table_name, column_name, is_nullable, udt_name, column_default,
                numeric_precision, numeric_scale
         FROM information_schema.columns
         WHERE table_schema IN (${inList})`
    );
    for (const row of columns) {
        const key = `${row.table_schema}.${row.table_name}`;
        if (!tables.has(key)) tables.set(key, new Set());
        tables.get(key)!.add(row.column_name);
        if (row.is_nullable === "NO") notNullColumns.add(`${key}.${row.column_name}`);
        if (row.udt_name) {
            const modifier = row.udt_name === "numeric" && row.numeric_precision !== null
                ? `(${row.numeric_precision},${row.numeric_scale ?? 0})`
                : "";
            columnTypes.set(`${key}.${row.column_name}`, `${row.udt_name}${modifier}`);
        }
        if (row.column_default !== null) columnDefaults.add(`${key}.${row.column_name}`);
    }

    // Trigger names, so `autoValue: "on_update"` is installed once rather than
    // re-issued on every boot. `tgisinternal` excludes the ones Postgres itself
    // creates to enforce foreign keys.
    const triggers = new Set<string>();
    const { rows: triggerRows } = await client.query<{ schema: string; table: string; name: string }>(
        `SELECT n.nspname AS schema, c.relname AS table, t.tgname AS name
         FROM pg_trigger t
         JOIN pg_class c ON t.tgrelid = c.oid
         JOIN pg_namespace n ON c.relnamespace = n.oid
         WHERE NOT t.tgisinternal AND n.nspname IN (${inList})`
    );
    for (const row of triggerRows) triggers.add(`${row.schema}.${row.table}.${row.name}`);

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

    return {
        tables, enums, constraints, columnComments, enumValues, notNullColumns, populatedTables, columnTypes,
        columnDefaults, triggers
    };
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
    log?: (message: string) => void,
    options: EnsureOptions = {}
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
    // This is the boundary, so this is where the world is read: the planner
    // itself takes the permission as an argument and never reaches for the
    // registry. By the time boot gets here `loadBundleResourceGraph` has
    // evaluated the project's `resources.ts`, so the declarations are there —
    // and a caller that already knows them can still say so.
    const plan = planCollectionSchemaEnsure(collections, existing, {
        ...options,
        databaseExtensions: options.databaseExtensions ?? declaredDatabaseExtensions()
    });
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

    // Said once per drifted column, every boot, and this is the one report here
    // that describes a system which currently *looks* healthy. Everything else
    // in this function explains a statement that did not run; this explains a
    // statement that was never planned, on a deploy that reported success, and
    // whose first symptom is a write rejected long afterwards.
    for (const drift of plan.columnTypeDrift) {
        const message = columnTypeDriftMessage(drift);
        logger.warn(`[schema] ${message}`);
        log?.(message);
    }

    // Said once per column, every boot, and it matters more than the rest here
    // because the table is not merely imperfect — it is unwritable, and the
    // error the API returns names a field the author has already deleted.
    // This is what a renamed property looks like to an additive provisioner.
    for (const orphan of plan.orphanedRequiredColumns) {
        const [schema, table] = orphan.table.split(".");
        const message =
            `"${orphan.table}"."${orphan.column}" is NOT NULL with no default, and the "${orphan.slug}" ` +
            "collection no longer declares it. Every insert will be rejected for a field you cannot set " +
            `(PG_23502, naming "${orphan.column}"). This is what a renamed property looks like: the new ` +
            "column was added, and the old one cannot be dropped unattended. Fix it with ONE of:\n" +
            `      ALTER TABLE "${schema}"."${table}" DROP COLUMN "${orphan.column}";               -- the rename is complete\n` +
            `      ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${orphan.column}" DROP NOT NULL; -- keep the data, stop requiring it\n` +
            "      ...or declare the property again, if the column is still wanted.";
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
            const message = describeDriverError(err);
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
            //
            // An index that is not UNIQUE is an optimization, and losing an
            // optimization must not cost the deployment. This was the difference
            // between a slow collection and a tenant that would not boot: on a
            // managed runtime the throw killed the process, the pod never went
            // ready, and the deploy reported a 300-second readiness timeout — for
            // an ANN index whose absence changes latency and nothing else.
            //
            // UNIQUE is excluded because it is not an optimization. It is the
            // collection declaring that two rows cannot share a value, and
            // serving without it is serving a promise the database is not
            // keeping.
            const survivable =
                action.kind === "add-constraint" ||
                action.kind === "comment-column" ||
                (action.kind === "create-index" && !/CREATE\s+UNIQUE\s+INDEX/i.test(action.sql));
            if (survivable) {
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

/**
 * What actually went wrong, rather than what the ORM said about it.
 *
 * Drizzle wraps every driver error, and its `message` is literally
 * ``Failed query: ${sql}\nparams: ${params}`` — the statement we already know,
 * and not one word of Postgres's answer. Reporting `err.message` therefore
 * produced a failure that named the statement twice and the *reason* zero
 * times, so four unrelated boot failures — a missing extension, a wrong
 * privilege, a bad index method, a constraint the rows violate — all read
 * identically to whoever had to fix them.
 *
 * Two consequences, both observed in the field before this existed:
 *
 *  1. On a managed deployment the reason never reaches anybody. Boot dies, the
 *     pod never goes ready, and the deploy reports a readiness timeout — so the
 *     one line that says why is the one line that was thrown away here.
 *  2. {@link vectorExtensionHint} matches on the error text. Against the
 *     wrapper it matched nothing, so the hint written specifically to explain a
 *     missing pgvector never fired on the path that raises it.
 *
 * `detail` and `hint` come along because they are the fields Postgres uses to
 * say which object it meant and what to do about it — `CREATE EXTENSION` names
 * the missing library there, and a rejected constraint names the row. This
 * writes into the tenant's own boot log, about the tenant's own database.
 */
export function describeDriverError(err: unknown): string {
    const pg = extractPgError(err);
    if (pg) {
        const parts = [pg.code ? `${pg.message} [${pg.code}]` : pg.message];
        if (pg.detail) parts.push(`  detail: ${pg.detail}`);
        if (pg.hint) parts.push(`  hint: ${pg.hint}`);
        return parts.join("\n");
    }
    // No SQLSTATE anywhere in the chain: not a database answer at all — a
    // socket that closed, a bug in this file. The deepest cause still beats the
    // wrapper, and the wrapper still beats nothing.
    const cause = extractCauseMessage(err);
    if (cause) return cause;
    return err instanceof Error ? err.message : String(err);
}

/** ` CONCURRENTLY ` as it appears in a rendered `CREATE [UNIQUE] INDEX`. */
const CONCURRENTLY_RE = /\sCONCURRENTLY\s/i;

/**
 * `25001 active_sql_transaction` — "cannot run inside a transaction block".
 *
 * Only ever raised here by `CREATE INDEX CONCURRENTLY`, and only when the
 * connection we were handed is inside a transaction. Deliberately narrow: it
 * decides to retry a *different* statement, so it must not fire on anything it
 * has not been reasoned about.
 */
function isTransactionBlockRefusal(err: unknown): boolean {
    return extractPgError(err)?.code === "25001";
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
    let sqlText = action.sql;
    for (let attempt = 1; ; attempt++) {
        try {
            await client.query(sqlText);
            return true;
        } catch (err) {
            // `CREATE INDEX CONCURRENTLY` is the one statement here Postgres
            // refuses inside a transaction block (25001), and whether we are in
            // one is not ours to know: the client is whatever handle the caller
            // bootstrapped with, and an application that builds its own adapter
            // can hand us a connection already inside a transaction. The plain
            // form is always correct and never refused — it takes a write lock
            // for the build, which is the cost of getting the index at all.
            if (isTransactionBlockRefusal(err) && CONCURRENTLY_RE.test(sqlText)) {
                sqlText = sqlText.replace(CONCURRENTLY_RE, " ");
                logger.warn(
                    `[schema] ${action.kind} ${action.target}: this connection is inside a transaction, ` +
                    "so the index is being built with a write lock rather than concurrently. Writes to " +
                    "this table block until it finishes."
                );
                continue;
            }
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
