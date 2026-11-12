/**
 * Rebase Schema Doctor — Three-way schema drift detection.
 *
 * Compares:
 *  1. Collection definitions → Generated Drizzle schema (staleness check)
 *  2. Collection definitions → Live PostgreSQL database (structural drift)
 *
 * Run via:  rebase doctor
 */
import { promises as fsPromises } from "fs";
import * as fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import chalk from "chalk";
import { DEFAULT_DATA_SOURCE_KEY, LEGACY_SCHEMA_VERSION_PREFIX, type ColumnDescriptor, type ColumnType, type CompiledTable, type TableDescriptor } from "@rebasepro/types";
import { generateSchema } from "./generate-drizzle-schema-logic";
import { compareGeneratedDeclarations, describeDeclarationDifferences } from "./generated-schema-staleness";
import { describeSchemaDifference, readGeneratedSchemaDrift, type SchemaDifference } from "./generated-schema-diff";
import { pgTypeOf, planSchema } from "./plan/plan-schema";
import { renderPgType } from "./plan/render-ddl";
import type { PgType, SchemaPlan, TablePlan } from "./plan/types";
import { generateTypedefs } from "@rebasepro/codegen";
import { relationsOfKind, resolveTableJunctions, sortTablesBySlug } from "@rebasepro/common";
import { toPostgresIdentifier } from "@rebasepro/utils";
import { defaultDatabaseSchemaVersion, loadTableSchema } from "./load-tables";
import { lowerCompiledTables } from "./lowered-tables";
import { describeMismatch } from "@rebasepro/server";
// The report is CLI output, not application logging — see cli-output.ts.
import { out, outError } from "../cli-output";
import { deepestErrorMessage, diagnoseDbError, parseHostInfo } from "../cli-errors";

// ── Types ────────────────────────────────────────────────────────────────

export type IssueSeverity = "error" | "warning" | "info";

export interface DoctorIssue {
    severity: IssueSeverity;
    category: "missing_table" | "missing_column" | "type_mismatch" | "nullability_mismatch" | "extra_column" | "missing_constraint" | "primary_key_mismatch" | "schema_stale" | "missing_enum" | "enum_value_mismatch" | "missing_foreign_key" | "orphaned_junction" | "sdk_stale" | "sdk_not_generated" | "sdk_ungeneratable";
    table?: string;
    column?: string;
    expected?: string;
    actual?: string;
    message: string;
    fix: string;
}

export interface DoctorPhase {
    passed: boolean;
    issues: DoctorIssue[];
    /**
     * Why this phase never ran, when it did not.
     *
     * A check that did not happen is a third state, not a passing one. While a
     * skipped phase initialised to `{ passed: true, issues: [] }` it rendered as
     * `✅ Collections → Database: In sync` and counted towards
     * `✓ All schemas are in sync!` — so a project whose connection string was
     * spelled `POSTGRES_URL`, or a CI job that never exported one, got two green
     * ticks and exit 0 against a database with no tables in it.
     */
    skipped?: string;
    /**
     * Why this phase had nothing to compare against, when it had nothing.
     *
     * Distinct from `skipped`, which means "the check could not run, and that
     * is probably worth fixing". This one means "the artifact is optional and
     * you have not asked for it": no drift is possible, so the run is still a
     * clean bill of health.
     *
     * It exists because the alternative was a contradiction. The typed-SDK
     * phase returned `{ passed: true }` when `generated/sdk/database.types.ts`
     * did not exist, so a fresh project's report read
     * `✅ Collections → SDK Types: In sync` directly above
     * `ℹ Typed SDK not generated (optional).` — one line calling a file
     * synchronised and the next saying it is absent. "In sync" is a claim about
     * a comparison, and no comparison happened.
     */
    notApplicable?: string;
    /**
     * The phase was skipped by a fault rather than by a choice.
     *
     * `skipped` covers both: "no DATABASE_URL, so nothing to compare against"
     * is a local situation a developer may be perfectly happy with, and "the
     * DATABASE_URL you set refuses connections" is not. The report renders them
     * the same way — a check that did not run is a check that did not run — but
     * the exit code must not, or `rebase doctor` in CI goes green against a
     * database it never reached.
     */
    blocked?: boolean;
}

export interface DoctorReport {
    collectionsToSchema: DoctorPhase;
    collectionsToSdk: DoctorPhase;
    schemaToDatabase: DoctorPhase;
    summary: { passed: number; skipped: number; notApplicable: number; warnings: number; errors: number };
}

// ── Column type mapping ──────────────────────────────────────────────────

/**
 * How `information_schema.columns.data_type` spells a planned column type.
 *
 * The catalogue's names are its own — `character varying`, not `varchar`;
 * `ARRAY` for every array whatever its element; `USER-DEFINED` for an enum, a
 * `vector`, and anything else identified by name rather than by shape. So the
 * translation has to exist somewhere. What must *not* exist twice is the step
 * before it: which column a property compiles to.
 *
 * This function was that second step — a fourth copy of the property switch,
 * kept "in sync" with the generators by a comment, and already out of step
 * (`geopoint` answered `null` here, so the one type that was genuinely
 * unpersistable was the one the doctor never checked). It reads the schema plan
 * now.
 */
const INFORMATION_SCHEMA_NAMES: Record<Exclude<PgType["kind"], "custom">, string> = {
    text: "text",
    varchar: "character varying",
    char: "character",
    uuid: "uuid",
    // A `CREATE TYPE … AS ENUM` is a name, not a shape.
    enum: "USER-DEFINED",
    smallint: "smallint",
    integer: "integer",
    bigint: "bigint",
    // A serial is an integer with a sequence default; the catalogue reports the
    // underlying width and nothing about the sequence.
    smallserial: "smallint",
    serial: "integer",
    bigserial: "bigint",
    real: "real",
    doublePrecision: "double precision",
    numeric: "numeric",
    boolean: "boolean",
    timestamptz: "timestamp with time zone",
    date: "date",
    time: "time without time zone",
    json: "json",
    jsonb: "jsonb",
    // pgvector's type, like every extension type.
    vector: "USER-DEFINED",
    bytea: "bytea",
    tsvector: "USER-DEFINED",
    array: "ARRAY"
};

/**
 * {@link INFORMATION_SCHEMA_NAMES} for any planned type, or `null` for a
 * `col.custom()` type: its `data_type` is whatever the catalogue calls that
 * type (`inet`, `int4range`, `USER-DEFINED` for PostGIS), so the boot diff
 * compares it against `format_type` instead, and the doctor has nothing to add.
 */
const informationSchemaName = (type: PgType): string | null =>
    type.kind === "custom" ? null : INFORMATION_SCHEMA_NAMES[type.kind];

/**
 * The planned Postgres type of a column of `table`, through the planner's own
 * `pgTypeOf` — or `undefined` for a type the planner refuses (an array of
 * documents, an enum with no labels), which is a problem the doctor's other
 * phases report with a message, not a type mismatch to invent one for.
 */
function plannedColumnType(table: Pick<TableDescriptor, "schema" | "table" | "slug">, column: Pick<ColumnDescriptor, "key" | "column" | "type">): PgType | undefined {
    try {
        return pgTypeOf(column.type, {
            schema: table.schema,
            table: table.table,
            owner: table.slug,
            propName: column.key,
            column: column.column
        });
    } catch {
        return undefined;
    }
}

/**
 * The `data_type` the database should report for a column of this type, or
 * `null` when there is nothing to compare: a `col.custom()` type (the boot diff
 * compares it by `format_type`), or a type the planner refuses outright.
 */
export function expectedDataType(type: ColumnType): string | null {
    // The site only names an enum's type, and `data_type` never says the name.
    const planned = plannedColumnType({ schema: "public", table: "__doctor__", slug: "__doctor__" }, { key: "column", column: "column", type });
    return planned ? informationSchemaName(planned) : null;
}

/**
 * `information_schema.columns.udt_name` of a native array of this element
 * type — the array's `data_type` is `ARRAY` whatever it holds, so the element
 * is told apart here. `undefined` for an element this does not name.
 */
const ARRAY_UDT_NAMES: Partial<Record<PgType["kind"], string>> = {
    text: "_text",
    varchar: "_varchar",
    char: "_bpchar",
    uuid: "_uuid",
    smallint: "_int2",
    integer: "_int4",
    bigint: "_int8",
    real: "_float4",
    doublePrecision: "_float8",
    numeric: "_numeric",
    boolean: "_bool",
    timestamptz: "_timestamptz",
    date: "_date",
    time: "_time"
};

// ── Phase 1: Collections ↔ Generated Schema ─────────────────────────────

export async function checkCollectionsVsSchema(
    tables: readonly CompiledTable[],
    schemaFilePath: string
): Promise<DoctorPhase> {
    const issues: DoctorIssue[] = [];

    // Check if schema file exists
    if (!fs.existsSync(schemaFilePath)) {
        issues.push({
            severity: "error",
            category: "schema_stale",
            message: "Generated schema file does not exist.",
            fix: "Run `rebase schema generate`"
        });
        return { passed: false,
issues };
    }

    // Re-generate schema in-memory and compare with file on disk.
    if (tables.length === 0) {
        return { passed: true,
issues };
    }

    try {
        // Declaration by declaration, not byte by byte. The generated file is a
        // flat list of `export const`s, each the rendering of one piece of the
        // schema plan, so comparing them says *which* table or enum moved —
        // which is what the reader is about to go looking for — and ignores the
        // formatting and commentary the renderer is free to vary on its own.
        const differences = compareGeneratedDeclarations(
            generateSchema(tables),
            await fsPromises.readFile(schemaFilePath, "utf-8")
        );

        if (differences.length > 0) {
            issues.push({
                severity: "warning",
                category: "schema_stale",
                message: "Generated schema is out of date — table definitions have changed since last generation. "
                    + `Differs in: ${describeDeclarationDifferences(differences)}.`,
                fix: "Run `rebase schema generate`"
            });
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        issues.push({
            severity: "warning",
            category: "schema_stale",
            message: `Could not regenerate schema for comparison: ${message}`,
            fix: "Run `rebase schema generate` to verify"
        });
    }

    return { passed: issues.length === 0,
issues };
}

export async function checkCollectionsVsSdk(
    /** The tables' compiled descriptors — what `rebase generate-sdk` generates from. */
    descriptors: readonly TableDescriptor[],
    sdkFilePath: string
): Promise<DoctorPhase> {
    const issues: DoctorIssue[] = [];

    // The typed SDK is opt-in — nothing in a scaffolded project imports it until
    // you choose to. A project that never generated one isn't drifting, so report
    // it as information rather than a warning; otherwise `doctor` can never come
    // back clean on a fresh project and users learn to ignore its output.
    if (!fs.existsSync(sdkFilePath)) {
        issues.push({
            severity: "info",
            category: "sdk_not_generated",
            message: "Typed SDK not generated (optional).",
            fix: "Run `rebase generate-sdk` if you want typed table access"
        });
        return { passed: true,
issues,
notApplicable: "not generated (optional)" };
    }

    try {
        const expectedSdk = generateTypedefs(descriptors);
        const actualSdk = await fsPromises.readFile(sdkFilePath, "utf-8");

        // Normalize whitespace for comparison
        const normalize = (s: string) =>
            s
                .replace(/\/\/.*$/gm, "") // strip single-line comments
                .replace(/\/\*[\s\S]*?\*\//g, "") // strip multi-line comments
                .replace(/\s+/g, " ")
                .trim();

        if (normalize(expectedSdk) !== normalize(actualSdk)) {
            issues.push({
                severity: "warning",
                category: "sdk_stale",
                message: "Generated SDK types are out of date — table definitions have changed since last SDK generation.",
                fix: "Run `rebase generate-sdk`"
            });
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        // A `CodegenError` is not "the comparison did not run" — it is the
        // schema saying it cannot produce a valid typed client at all, most
        // often two slugs collapsing onto one accessor. Reporting that as a
        // warning about staleness described the wrong problem and pointed at a
        // command that would fail the same way.
        if (err instanceof Error && err.name === "CodegenError") {
            issues.push({
                severity: "error",
                category: "sdk_ungeneratable",
                message: `The typed SDK cannot be generated from these tables: ${message}`,
                fix: "Fix the table definitions named above, then run `rebase generate-sdk`"
            });
        } else {
            issues.push({
                severity: "warning",
                category: "sdk_stale",
                message: `Could not regenerate SDK types for comparison: ${message}`,
                fix: "Run `rebase generate-sdk` to verify"
            });
        }
    }

    return { passed: issues.length === 0,
issues };
}

// ── Phase 2: Collections ↔ Database ──────────────────────────────────────

interface DbColumn {
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    udt_name: string;
}


interface DbEnumValue {
    enum_schema: string;
    enum_name: string;
    enum_value: string;
}

/**
 * Extensions the tables need, that the database does not have installed.
 *
 * Only `vector` today, and only because a `col.vector()` column plans a
 * column of a type that will not exist. Rebase installs it only where a project
 * has said it may (`database({ extensions: ["vector"] })`), so the absence is
 * often correct configuration and a wrong deployment — which is exactly why the
 * report has to name it rather than the first failing INSERT.
 *
 * Exported for its test.
 */
export function missingExtensionIssues(
    tables: readonly TableDescriptor[],
    installed: ReadonlySet<string>
): DoctorIssue[] {
    const usesVector = tables.some(table => table.columns.some(column => column.type.kind === "vector"));

    if (!usesVector || installed.has("vector")) return [];

    return [{
        severity: "error",
        category: "missing_table",
        message: 'A table declares a vector column (`col.vector(...)`) and the pgvector extension is not installed on this database.',
        fix: 'Declare it — `database({ extensions: ["vector"] })` in config/resources.ts — and use an image that ships the library '
            + "(the scaffold's pgvector/pgvector:pg18; a stock postgres:18 does not). Or install it once by hand: CREATE EXTENSION vector;"
    }];
}

/**
 * The stamp the runtime wrote, against the tables on disk (their compiled
 * descriptors, which is what the stamp is computed over).
 *
 * A stamp that disagrees means this database was provisioned from a different
 * set of tables than the ones in this checkout — a colleague's branch, an
 * older deploy, a tenant somebody else migrated. Everything else in this report
 * is then describing a schema somebody else created, which is worth knowing
 * before acting on any of it.
 *
 * A warning, not an error, and never a direction: the stamp is a hash, so it
 * can say the two disagree and never which is ahead. `null` — never stamped —
 * is not a finding: every database provisioned before the stamp existed reads
 * that way, and so does every fresh one.
 */
export async function schemaStampIssues(
    pool: { query<T>(text: string): Promise<{ rows: T[] }> },
    /** The version this checkout computes — `defaultDatabaseSchemaVersion`, what a boot and a push stamp. */
    expected: string
): Promise<DoctorIssue[]> {
    let stamped: string | null = null;
    try {
        // `to_regclass` so a missing schema or table is a null rather than a
        // thrown 42P01 — the commonest state on a fresh database is neither.
        const present = await pool.query<{ present: boolean }>(
            `SELECT to_regclass('"rebase"."schema_meta"') IS NOT NULL AS present`
        );
        if (!present.rows[0]?.present) return [];
        const row = await pool.query<{ value: string }>(
            `SELECT value FROM "rebase"."schema_meta" WHERE key = 'collections_schema_version' LIMIT 1`
        );
        stamped = row.rows[0]?.value ?? null;
    } catch {
        // The stamp is a diagnostic, not a gate. A database that will not
        // answer this question has bigger problems, and they are reported by
        // the checks around this one.
        return [];
    }

    if (!stamped) return [];
    if (stamped === expected) return [];

    // A stamp from a runtime before 0.31 hashed collections, never tables: it
    // differs from every version this release computes and says nothing about
    // drift. Explained in the server's own words, once, with the restamp.
    if (stamped.startsWith(LEGACY_SCHEMA_VERSION_PREFIX)) {
        return [{
            severity: "warning",
            category: "schema_stale",
            message: describeMismatch(stamped, expected),
            fix: "Run `rebase db push` (or boot the process that owns the schema) once to restamp it."
        }];
    }

    return [{
        severity: "warning",
        category: "schema_stale",
        message: `This database was provisioned from a different set of tables (stamp ${stamped}, this checkout computes ${expected}).`,
        fix: "A hash says the two disagree, never which is ahead. Check you are pointed at the database you think you are; then `rebase db push` to bring it to these tables."
    }];
}

/** `"public"."posts"` — quoted, for a statement the reader will paste. */
const quotedTable = (schema: string, table: string): string => `"${schema}"."${table}"`;

/**
 * What to do about a column whose type is not the one the collection plans.
 *
 * Both ways out, because the doctor cannot know which side is right: the
 * property moved, or the database did. Putting the property back always clears
 * the finding; converting the column clears it when every value converts.
 */
export function typeMismatchFix(
    schema: string,
    table: string,
    column: string,
    actual: string,
    planned: PgType | undefined
): string {
    const back = `Either put the property back to the column's type (${actual}), or`;
    if (!planned) return `${back} run a migration that converts the column.`;
    const type = renderPgType(planned);
    return `${back} convert the column when you can watch it (every value must convert): `
        + `ALTER TABLE ${quotedTable(schema, table)} ALTER COLUMN "${column}" TYPE ${type} USING "${column}"::${type};`;
}

/**
 * The table's primary key against the one the collection reads it by.
 *
 * Rebase addresses a row by the key the plan names — the `isId` property, or
 * the implicit `id` — so a table keyed on other columns, or on none, serves
 * reads and writes against a key that does not hold. An error, because that is
 * what it is at runtime.
 */
export function primaryKeyIssues(tablePlan: TablePlan, dbPk: string[], displayName: string): DoctorIssue[] {
    const expected = tablePlan.primaryKey;
    const same = dbPk.length === expected.length && [...dbPk].sort().join("\u0000") === [...expected].sort().join("\u0000");
    if (same) return [];
    const table = quotedTable(tablePlan.schema, tablePlan.table);
    const keyList = expected.map(c => `"${c}"`).join(", ");
    if (dbPk.length === 0) {
        return [{
            severity: "error",
            category: "primary_key_mismatch",
            table: displayName,
            expected: expected.join(", "),
            actual: "(none)",
            message: `Table "${displayName}" has no primary key; the table definition reads its rows by ${keyList}.`,
            fix: `ALTER TABLE ${table} ADD PRIMARY KEY (${keyList});`
        }];
    }
    // Several `isId` properties are one composite key, so a table keyed on
    // several columns is matched by marking each of them — and only them.
    const only = expected.some(column => !dbPk.includes(column)) ? "only " : "";
    const fix = dbPk.length === 1
        ? `Mark ${only}the property for column "${dbPk[0]}" with \`isId\` — the table is keyed on it — or re-key the table on ${keyList}.`
        : `Mark ${only}the properties for columns ${dbPk.map(c => `"${c}"`).join(", ")} with \`isId\` — together they are `
            + `the table's composite key — or re-key the table on ${keyList}.`;
    return [{
        severity: "error",
        category: "primary_key_mismatch",
        table: displayName,
        expected: expected.join(", "),
        actual: dbPk.join(", "),
        message: `Table "${displayName}" is keyed on (${dbPk.join(", ")}), but the table definition reads its rows by ${keyList}.`,
        fix
    }];
}

/**
 * A junction's two key columns: present, typed like the keys they point at,
 * and the table keyed on the pair. Order is not compared — boot and `db push`
 * have built the key in both orders, and either one serves the same rows.
 */
export function junctionKeyIssues(
    junctionPlan: TablePlan,
    dbColumns: DbColumn[],
    dbPk: string[],
    displayName: string
): DoctorIssue[] {
    const issues: DoctorIssue[] = [];
    const byName = new Map(dbColumns.map(c => [c.column_name, c]));
    for (const column of junctionPlan.columns) {
        const dbCol = byName.get(column.column);
        if (!dbCol) {
            issues.push({
                severity: "error",
                category: "missing_column",
                table: displayName,
                column: column.column,
                message: `Junction table "${displayName}" has no "${column.column}" column.`,
                fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
            });
            continue;
        }
        const expected = informationSchemaName(column.type);
        if (expected !== null && dbCol.data_type !== expected) {
            issues.push({
                severity: "warning",
                category: "type_mismatch",
                table: displayName,
                column: column.column,
                expected,
                actual: dbCol.data_type,
                message: `Junction column "${column.column}" in "${displayName}" is ${dbCol.data_type}, but the key it points at is ${expected}.`,
                fix: typeMismatchFix(junctionPlan.schema, junctionPlan.table, column.column, dbCol.data_type, column.type)
            });
        }
    }
    issues.push(...primaryKeyIssues(junctionPlan, dbPk, displayName));
    return issues;
}

/** A table as the other issues name it: bare in `public`, `schema.table` elsewhere. */
function displayTableOf(difference: SchemaDifference, tables: readonly TableDescriptor[]): string {
    const schema = difference.collection ? tables.find(t => t.slug === difference.collection)?.schema : undefined;
    return schema && schema !== "public" ? `${schema}.${difference.table}` : difference.table;
}

/** Which of the doctor's own categories already says what a boot difference says. */
const COVERING_CATEGORY: Record<SchemaDifference["kind"], DoctorIssue["category"]> = {
    "missing-table": "missing_table",
    "missing-column": "missing_column",
    type: "type_mismatch",
    nullability: "nullability_mismatch",
    "extra-column": "extra_column"
};

/** What to do about one boot difference, said the way the boot warning says it. */
function generatedDriftFix(difference: SchemaDifference): string {
    const regenerate = " If backend/schema changed since schema.generated.ts was written, run `rebase schema generate` first.";
    switch (difference.kind) {
        case "nullability":
            return difference.generated === "NOT NULL"
                ? "`rebase db push` applies it; a NOT NULL needs every row filled first (UPDATE the empty ones, or give "
                    + "the property a default). Boot adds one only with a new column on an empty table." + regenerate
                : "`rebase db push` drops the NOT NULL, which boot never does. If the column should stay required, "
                    + "mark the property `validation: { required: true }`." + regenerate;
        case "extra-column":
            return "Boot never drops a column, so its data is still there. `rebase db push` removes it (it asks first, "
                + "since that deletes the data), or a migration does (`rebase db generate`). If a property should still "
                + "read it, declare it again." + regenerate;
        case "type":
            return "`rebase db push` converts it (it asks first when values may not convert), or a migration does." + regenerate;
        case "missing-column":
            return "`rebase db push` adds it." + regenerate;
        case "missing-table":
            return "Run `rebase db push` or `rebase db generate && rebase db migrate`";
    }
}

/**
 * Boot's drift warnings, as doctor issues — one per difference, in boot's own
 * words ({@link describeSchemaDifference}), and a warning, as boot raises them.
 *
 * Except where an issue the collections-side checks above already raised says
 * the same thing: a missing table, a missing column or a type mismatch on the
 * same column. Nullability and columns no collection declares are boot's alone;
 * the doctor never compared them, which is how it came to say "In sync" beside
 * a boot that had just warned about both.
 */
export function generatedSchemaDriftIssues(
    differences: SchemaDifference[],
    already: DoctorIssue[],
    tables: readonly TableDescriptor[]
): DoctorIssue[] {
    const bare = (table: string | undefined) => table?.split(".").pop();
    const covered = (difference: SchemaDifference) => already.some(issue =>
        issue.category === COVERING_CATEGORY[difference.kind]
        && bare(issue.table) === difference.table
        && (difference.kind === "missing-table" || issue.column === difference.column));

    return differences.filter(difference => !covered(difference)).map(difference => ({
        severity: "warning",
        category: COVERING_CATEGORY[difference.kind],
        table: displayTableOf(difference, tables),
        ...(difference.column ? { column: difference.column } : {}),
        ...(difference.generated ? { expected: difference.generated } : {}),
        ...(difference.live ? { actual: difference.live } : {}),
        message: describeSchemaDifference(difference),
        fix: generatedDriftFix(difference)
    }));
}

/**
 * The tables the default database holds — the filter boot applies before it
 * reads the catalogue, for the same reason: a table routed to
 * `database("analytics")` has no table here.
 */
function defaultDatabaseTables(tables: readonly CompiledTable[]): CompiledTable[] {
    return tables.filter(t => !t.descriptor.database || t.descriptor.database === DEFAULT_DATA_SOURCE_KEY);
}

export async function checkCollectionsVsDatabase(
    tables: readonly CompiledTable[],
    databaseUrl: string,
    options: {
        /**
         * The `tables` export of `schema.generated.ts`, for boot's own drift
         * comparison. Without it the doctor compares the collections alone.
         */
        generated?: Record<string, unknown>;
        /**
         * The schema version this checkout computes
         * (`defaultDatabaseSchemaVersion`), to compare against the stamp the
         * runtime or a push wrote. Without it that one check is not made.
         */
        schemaVersion?: string;
    } = {}
): Promise<DoctorPhase> {
    const issues: DoctorIssue[] = [];
    const descriptors = tables.map(table => table.descriptor);
    const bySlug = new Map(descriptors.map(descriptor => [descriptor.slug, descriptor]));

    // Dynamic import to avoid loading pg when not needed
    const pgModule = await import("pg");
    const { Pool } = pgModule.default ?? pgModule;
    const pool = new Pool({ connectionString: databaseUrl });

    // Every schema a table is declared in, plus public and rebase
    const schemas = Array.from(new Set(["public", "rebase", ...descriptors.map(d => d.schema)]));

    try {
        // Fetch all tables in the defined schemas
        const tablesResult = await pool.query<{ table_schema: string; table_name: string }>(
            `SELECT table_schema, table_name 
             FROM information_schema.tables 
             WHERE table_schema = ANY($1) AND table_type = 'BASE TABLE'`,
            [schemas]
        );
        const existingTables = new Set(tablesResult.rows.map((r) =>
            r.table_schema === "public" ? r.table_name : `${r.table_schema}.${r.table_name}`
        ));
        // Views and materialized views, for the collections that serve one.
        const viewsResult = await pool.query<{ table_schema: string; table_name: string }>(
            `SELECT n.nspname AS table_schema, c.relname AS table_name
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = ANY($1) AND c.relkind IN ('v', 'm')`,
            [schemas]
        );
        const existingViews = new Set(viewsResult.rows.map((r) =>
            r.table_schema === "public" ? r.table_name : `${r.table_schema}.${r.table_name}`
        ));

        // An extension the collections need and the database does not have.
        //
        // The symptom without this is `type "vector" does not exist` on the
        // first write to a table that looks perfectly well-formed in the
        // report: the column is planned, the extension is not, and the two
        // facts live in different places. Extensions are opt-in by design —
        // installing one needs an image that ships the library and a role
        // allowed to install it — so this reports, it does not install.
        const extensionsResult = await pool.query<{ extname: string }>("SELECT extname FROM pg_extension");
        const installedExtensions = new Set(extensionsResult.rows.map(r => r.extname));
        issues.push(...missingExtensionIssues(descriptors, installedExtensions));

        // A database provisioned from a different set of collections than the
        // ones on disk.
        //
        // The runtime stamps what it applied; nothing compared it outside boot,
        // and a stamp that disagrees is exactly the state where the rest of
        // this report is describing a schema somebody else's deploy created.
        if (options.schemaVersion !== undefined) issues.push(...await schemaStampIssues(pool, options.schemaVersion));

        // Fetch all columns in the defined schemas
        const columnsResult = await pool.query<DbColumn>(
            `SELECT table_schema, table_name, column_name, data_type, is_nullable, udt_name
             FROM information_schema.columns
             WHERE table_schema = ANY($1)
             ORDER BY table_schema, table_name, ordinal_position`,
            [schemas]
        );
        const columnsByTable = new Map<string, DbColumn[]>();
        for (const row of columnsResult.rows) {
            const tableSchema = row.table_schema;
            const tableName = row.table_name;
            const key = tableSchema === "public" ? tableName : `${tableSchema}.${tableName}`;
            if (!columnsByTable.has(key)) {
                columnsByTable.set(key, []);
            }
            columnsByTable.get(key)!.push(row);
        }

        // Fetch enums, keyed `schema.name`. A type is found in the schema the
        // planner put it in, and nowhere else — a same-named type in another
        // schema is somebody else's, and the column does not use it.
        const enumsResult = await pool.query<DbEnumValue>(
            `SELECT n.nspname AS enum_schema, t.typname AS enum_name, e.enumlabel AS enum_value
             FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             JOIN pg_enum e ON t.oid = e.enumtypid
             ORDER BY n.nspname, t.typname, e.enumsortorder`
        );
        const enumsByName = new Map<string, string[]>();
        for (const row of enumsResult.rows) {
            const key = `${row.enum_schema}.${row.enum_name}`;
            if (!enumsByName.has(key)) {
                enumsByName.set(key, []);
            }
            enumsByName.get(key)!.push(row.enum_value);
        }

        // Every table's primary key, its columns in key order.
        const pksResult = await pool.query<{ table_schema: string; table_name: string; columns: string[] }>(
            `SELECT n.nspname AS table_schema, c.relname AS table_name,
                    array_agg(a.attname::text ORDER BY array_position(i.indkey::int2[], a.attnum)) AS columns
             FROM pg_index i
             JOIN pg_class c ON c.oid = i.indrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey::int2[])
             WHERE i.indisprimary AND n.nspname = ANY($1)
             GROUP BY n.nspname, c.relname`,
            [schemas]
        );
        const pksByTable = new Map<string, string[]>();
        for (const row of pksResult.rows) {
            pksByTable.set(row.table_schema === "public" ? row.table_name : `${row.table_schema}.${row.table_name}`, row.columns);
        }

        // Fetch foreign key constraints in the defined schemas
        const fksResult = await pool.query<{
            constraint_name: string;
            table_schema: string;
            table_name: string;
            column_name: string;
            foreign_table_schema: string;
            foreign_table_name: string;
            foreign_column_name: string;
        }>(
            `SELECT
                tc.constraint_name,
                tc.table_schema,
                tc.table_name,
                kcu.column_name,
                ccu.table_schema AS foreign_table_schema,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
             FROM information_schema.table_constraints AS tc
             JOIN information_schema.key_column_usage AS kcu
                 ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage AS ccu
                 ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ANY($1)`,
            [schemas]
        );
        const fksByTable = new Map<string, typeof fksResult.rows>();
        for (const row of fksResult.rows) {
            const tableSchema = row.table_schema;
            const tableName = row.table_name;
            const key = tableSchema === "public" ? tableName : `${tableSchema}.${tableName}`;
            if (!fksByTable.has(key)) {
                fksByTable.set(key, []);
            }
            fksByTable.get(key)!.push(row);
        }

        // ── Compare each table against the database ──────────────────────

        // Where boot and `db push` create each junction table.
        const junctions = resolveTableJunctions(sortTablesBySlug(tables).map(t => t.descriptor).filter(d => d.kind !== "view"));

        // What push and boot build, read once. The key and the junction checks
        // compare against it rather than against a fifth reading of the
        // columns. A configuration the planner refuses has no plan; the other
        // phases name that problem, and these checks stand down.
        let plan: SchemaPlan | undefined;
        try {
            plan = planSchema(tables);
        } catch {
            plan = undefined;
        }
        const tablePlans = new Map<string, TablePlan>((plan?.tables ?? []).map(t => [t.qualified, t]));
        const checkedJunctions = new Set<string>();

        for (const descriptor of descriptors) {
            const tableName = descriptor.table;
            const schemaName = descriptor.schema;
            const fullTableName = schemaName === "public" ? tableName : `${schemaName}.${tableName}`;

            // A view is Rebase's to create from its query; there are no
            // columns of its own to check against the definition.
            if (descriptor.kind === "view") {
                if (!existingViews.has(fullTableName)) {
                    issues.push({
                        severity: "error",
                        category: "missing_table",
                        table: fullTableName,
                        message: `View "${fullTableName}" does not exist in the database.`,
                        fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                    });
                }
                continue;
            }

            // Check table existence
            if (!existingTables.has(fullTableName)) {
                issues.push({
                    severity: "error",
                    category: "missing_table",
                    table: fullTableName,
                    message: `Table "${fullTableName}" does not exist in the database.`,
                    fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                });
                continue; // Skip column checks for missing tables
            }

            const dbColumns = columnsByTable.get(fullTableName) ?? [];
            const dbColumnMap = new Map(dbColumns.map((c) => [c.column_name, c]));

            // The key. It used to be skipped outright — `id` sat in a list of
            // "system columns" — so a key whose type or whose columns had
            // drifted reported "In sync".
            const tablePlan = tablePlans.get(`${schemaName}.${tableName}`);
            if (tablePlan) {
                issues.push(...primaryKeyIssues(tablePlan, pksByTable.get(fullTableName) ?? [], fullTableName));
            }

            // A `belongsTo`: its foreign-key column, and the constraint on it.
            for (const relation of relationsOfKind(descriptor, "belongsTo")) {
                const fkColName = relation.localKey;
                if (!dbColumnMap.has(fkColName)) {
                    issues.push({
                        severity: "error",
                        category: "missing_column",
                        table: fullTableName,
                        column: fkColName,
                        message: `Foreign key column "${fkColName}" for relation "${relation.name}" is missing from table "${fullTableName}".`,
                        fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                    });
                    continue;
                }
                // A link written without a constraint (`constraint: false`) has none to find.
                if (!relation.constraint) continue;

                const target = bySlug.get(relation.target);
                const targetTableName = target?.table ?? "unknown";
                const targetSchemaName = target?.schema ?? "public";
                const hasFk = (fksByTable.get(fullTableName) ?? []).some((fk) =>
                    fk.column_name === fkColName &&
                    fk.foreign_table_name === targetTableName &&
                    fk.foreign_table_schema === targetSchemaName
                );
                if (!hasFk) {
                    issues.push({
                        severity: "warning",
                        category: "missing_foreign_key",
                        table: fullTableName,
                        column: fkColName,
                        message: `Column "${fkColName}" exists but has no FOREIGN KEY constraint referencing "${targetSchemaName === "public" ? targetTableName : `${targetSchemaName}.${targetTableName}`}".`,
                        fix: "Run `rebase db push` or add the constraint manually"
                    });
                }
            }

            // Columns. A foreign-key column is typed by the key it points at,
            // and checked with its relation above.
            for (const column of descriptor.columns) {
                if (column.foreignKeyOf !== undefined) continue;
                const colName = column.column;

                const dbCol = dbColumnMap.get(colName);
                if (!dbCol) {
                    issues.push({
                        severity: "error",
                        category: "missing_column",
                        table: fullTableName,
                        column: colName,
                        message: `Column "${colName}" is defined in table "${descriptor.slug}" (backend/schema) but missing from table "${fullTableName}".`,
                        fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                    });
                    continue;
                }

                const planned = plannedColumnType(descriptor, column);
                if (!planned) continue;

                // Type check
                const expectedType = informationSchemaName(planned);
                if (expectedType) {
                    const actualType = dbCol.data_type;
                    let isMismatch = actualType !== expectedType;
                    if (planned.kind === "vector" && dbCol.udt_name !== "vector") isMismatch = true;
                    if (planned.kind === "array" && actualType === "ARRAY") {
                        const expectedUdt = ARRAY_UDT_NAMES[planned.of.kind];
                        if (expectedUdt && dbCol.udt_name !== expectedUdt) isMismatch = true;
                    }
                    if (isMismatch) {
                        const expectedLabel = planned.kind === "vector" ? "vector" : expectedType;
                        const actualLabel = dbCol.udt_name === "vector" ? "vector" : actualType;
                        issues.push({
                            severity: "warning",
                            category: "type_mismatch",
                            table: fullTableName,
                            column: colName,
                            expected: expectedLabel,
                            actual: actualLabel,
                            message: `Column "${colName}" in table "${fullTableName}": expected type "${expectedLabel}" but found "${actualLabel}".`,
                            fix: typeMismatchFix(schemaName, tableName, colName, actualType,
                                tablePlan?.columns.find(c => c.column === colName)?.type ?? planned)
                        });
                    }
                }

                // Enum value check
                if (planned.kind === "enum") {
                    // The planner's name, cut to the 63 bytes Postgres keeps,
                    // in the schema the planner put it in.
                    const enumName = toPostgresIdentifier(planned.name);
                    const enumSchema = planned.schema;
                    const dbEnumValues = enumsByName.get(`${enumSchema}.${enumName}`);
                    if (!dbEnumValues) {
                        issues.push({
                            severity: "warning",
                            category: "missing_enum",
                            table: fullTableName,
                            column: colName,
                            expected: enumName,
                            message: `Enum type "${enumSchema}"."${enumName}" is defined in backend/schema but not found in the database.`,
                            fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                        });
                    } else {
                        const expectedValues = planned.labels;
                        const missing = expectedValues.filter((v) => !dbEnumValues.includes(v));
                        const extra = dbEnumValues.filter((v) => !expectedValues.includes(v));

                        if (missing.length > 0 || extra.length > 0) {
                            const parts: string[] = [];
                            if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
                            if (extra.length > 0) parts.push(`extra in DB: ${extra.join(", ")}`);
                            issues.push({
                                severity: "warning",
                                category: "enum_value_mismatch",
                                table: fullTableName,
                                column: colName,
                                expected: expectedValues.join(", "),
                                actual: dbEnumValues.join(", "),
                                message: `Enum values for "${colName}" in table "${fullTableName}" are out of sync (${parts.join("; ")}).`,
                                fix: extra.length > 0 && missing.length === 0
                                    // A push cannot remove a label (no ALTER TYPE … DROP VALUE), so it was never the remedy for these.
                                    ? `PostgreSQL cannot drop an enum label, so \`rebase db push\` leaves ${extra.join(", ")} in place. Harmless unless something still writes it; to retire it, UPDATE its rows to another value, then rewrite the type in a migration (\`rebase db generate\`: CREATE TYPE …, ALTER TABLE … TYPE … USING, DROP TYPE) and \`rebase db migrate\``
                                    : "Run `rebase db push` to add the missing labels" + (extra.length > 0 ? `; it cannot remove ${extra.join(", ")} (PostgreSQL has no ALTER TYPE … DROP VALUE) — retire those with a migration that rewrites the type` : "")
                            });
                        }
                    }
                }
            }

            // Junction tables for many-to-many relations — where boot and
            // `db push` create them (`resolveTableJunctions`), under the name
            // with any schema prefix removed.
            for (const relation of relationsOfKind(descriptor, "manyToMany")) {
                const junctionTable = relation.through.table.split(".").pop() ?? relation.through.table;
                const junctionSchema = junctions.get(junctionTable)?.schema ?? "public";
                const fullJunctionTable = junctionSchema === "public" ? junctionTable : `${junctionSchema}.${junctionTable}`;
                if (!existingTables.has(fullJunctionTable)) {
                    issues.push({
                        severity: "error",
                        category: "missing_table",
                        table: fullJunctionTable,
                        message: `Junction table "${fullJunctionTable}" for many-to-many relation "${relation.name}" is missing.`,
                        fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                    });
                } else if (!checkedJunctions.has(fullJunctionTable)) {
                    // Both sides declare the same junction; it is checked once.
                    checkedJunctions.add(fullJunctionTable);
                    const junctionPlan = tablePlans.get(`${junctionSchema}.${junctionTable}`);
                    if (junctionPlan) {
                        issues.push(...junctionKeyIssues(
                            junctionPlan,
                            columnsByTable.get(fullJunctionTable) ?? [],
                            pksByTable.get(fullJunctionTable) ?? [],
                            fullJunctionTable
                        ));
                    }
                }
            }
        }

        if (plan) {
            issues.push(...orphanedJunctionIssues(plan, columnsByTable, pksByTable, fksByTable));
        }

        // The question boot asks, through boot's code: `schema.generated.ts`
        // against the catalogue. Last, so the differences the checks above
        // already named are not named twice.
        if (options.generated) {
            const differences = await readGeneratedSchemaDrift({
                client: pool,
                generated: options.generated,
                // TRANSITIONAL until generated-schema-diff reads tables (B-PLAN-5 step 2).
                collections: lowerCompiledTables(defaultDatabaseTables(tables)),
                defaultSchema: "public"
            });
            issues.push(...generatedSchemaDriftIssues(differences, issues, descriptors));
        }
    } finally {
        await pool.end();
    }

    // An `info` note — the orphaned junction — does not make the phase fail.
    return { passed: !issues.some(issue => issue.severity !== "info"),
issues };
}

/**
 * A `public` table in the junction shape that no collection declares.
 *
 * The shape is the planner's: exactly two columns, together the primary key,
 * each a single-column foreign key to a collection's table. Renaming or
 * removing a many-to-many leaves such a table behind — push and boot only
 * create — with every link row still in it and nothing reading it.
 *
 * Info, never more: the table may be data somebody still wants. The remedy is
 * shown, never run.
 */
export function orphanedJunctionIssues(
    plan: SchemaPlan,
    columnsByTable: Map<string, { column_name: string }[]>,
    pksByTable: Map<string, string[]>,
    fksByTable: Map<string, { constraint_name: string; column_name: string; foreign_table_schema: string; foreign_table_name: string }[]>
): DoctorIssue[] {
    const declared = new Set(plan.tables.map(table => table.qualified));
    const collectionTables = new Set(plan.tables.filter(table => table.kind === "collection").map(table => table.qualified));
    const issues: DoctorIssue[] = [];
    for (const [table, columns] of columnsByTable) {
        // Keys are bare for `public` and `schema.table` elsewhere.
        if (table.includes(".") || declared.has(`public.${table}`)) continue;
        // Two columns and a two-column key: the key is those two columns.
        if (columns.length !== 2 || (pksByTable.get(table) ?? []).length !== 2) continue;

        const byConstraint = new Map<string, { column: string; target: string }[]>();
        for (const fk of fksByTable.get(table) ?? []) {
            const target = `${fk.foreign_table_schema}.${fk.foreign_table_name}`;
            byConstraint.set(fk.constraint_name, [...(byConstraint.get(fk.constraint_name) ?? []), { column: fk.column_name, target }]);
        }
        const links = [...byConstraint.values()];
        if (links.length !== 2 || links.some(link => link.length !== 1)) continue;
        if (new Set(links.map(([link]) => link.column)).size !== 2) continue;
        if (!links.every(([link]) => collectionTables.has(link.target))) continue;

        const targets = links.map(([link]) => link.target.replace(/^public\./, ""));
        issues.push({
            severity: "info",
            category: "orphaned_junction",
            table,
            message: `Table "${table}" links "${targets[0]}" and "${targets[1]}" like a many-to-many junction, but no table declares it — left behind by a renamed or removed relation?`,
            fix: `DROP TABLE "public"."${table}";`
        });
    }
    return issues;
}

// ── Report Rendering ─────────────────────────────────────────────────────

export function renderReport(report: DoctorReport): void {
    out();
    out(chalk.bold("  🩺 Rebase Schema Doctor"));
    out(chalk.gray("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    out();

    // Phase 1
    renderPhase("Tables → Generated Schema", report.collectionsToSchema);

    // Phase 2
    renderPhase("Tables → Database", report.schemaToDatabase);

    // Phase 3
    renderPhase("Tables → SDK Types", report.collectionsToSdk);

    // Summary
    out(chalk.gray("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    const { passed, skipped, notApplicable, warnings, errors } = report.summary;

    const parts: string[] = [];
    parts.push(chalk.green(`${passed} passed`));
    if (skipped > 0) parts.push(chalk.yellow(`${skipped} skipped`));
    if (notApplicable > 0) parts.push(chalk.gray(`${notApplicable} not applicable`));
    if (warnings > 0) parts.push(chalk.yellow(`${warnings} warnings`));
    if (errors > 0) parts.push(chalk.red(`${errors} errors`));

    out(`  Summary: ${parts.join(", ")}`);
    out();

    if (errors > 0) {
        out(chalk.red.bold("  ✗ Schema drift detected. Run the suggested fixes above."));
    } else if (warnings > 0) {
        out(chalk.yellow.bold("  ⚠ Minor issues detected. Consider running the suggested fixes."));
    } else if (skipped > 0) {
        // Never "all schemas are in sync" off the back of a check that did not
        // run: a clean bill of health has to come from measurement.
        out(chalk.yellow.bold(`  ⚠ Nothing wrong in the checks that ran, but ${skipped} did not run — this is not a clean bill of health.`));
    } else {
        out(chalk.green.bold("  ✓ All schemas are in sync!"));
    }
    out();
}

function renderPhase(label: string, phase: DoctorPhase): void {
    // A phase that never ran gets its own marker and its reason. It is neither
    // "In sync" nor a drift report; conflating it with the former is what let
    // doctor certify a database it had not opened.
    if (phase.skipped) {
        out(`  ${chalk.yellow("⏭")}  ${label}: ${chalk.yellow(`skipped (${phase.skipped})`)}`);
        out();
        return;
    }

    // Nothing to compare against. Its own marker, and only the remedy under it
    // — the phase header already carries the reason, so re-printing the note
    // would say the same thing twice. See DoctorPhase.notApplicable.
    if (phase.notApplicable) {
        out(`  ${chalk.gray("➖")} ${label}: ${chalk.gray(phase.notApplicable)}`);
        for (const issue of phase.issues.filter((i) => i.severity === "info")) {
            out(`     ${chalk.gray(issue.fix)}`);
        }
        out();
        return;
    }

    const issues = phase.issues;
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warnCount = issues.filter((i) => i.severity === "warning").length;
    const infoIssues = issues.filter((i) => i.severity === "info");

    // Informational notes don't make a phase unhealthy, so key the header off
    // real problems rather than `phase.passed` alone.
    if (errorCount === 0 && warnCount === 0) {
        out(`  ${chalk.green("✅")} ${label}: ${chalk.green("In sync")}`);
    } else {
        const parts: string[] = [];
        if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
        if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
        out(`  ${chalk.yellow("⚠️")}  ${label}: ${chalk.yellow(parts.join(", "))}`);
    }
    out();

    // Notes render as a quiet one-liner, not a full drift box.
    for (const issue of infoIssues) {
        const fixPart = issue.fix ? chalk.gray(` — ${issue.fix}`) : "";
        out(`  ${chalk.gray("ℹ")} ${chalk.gray(issue.message)}${fixPart}`);
        out();
    }

    for (const issue of issues.filter((i) => i.severity !== "info")) {
        const severityIcon = issue.severity === "error" ? chalk.red("✗") : chalk.yellow("⚠");
        const categoryLabel = formatCategory(issue.category);
        out(`  ${chalk.gray("┌─")} ${severityIcon} ${chalk.bold(categoryLabel)} ${chalk.gray("─".repeat(Math.max(0, 42 - categoryLabel.length)))}`);

        if (issue.table) {
            const colPart = issue.column ? ` │ Column: ${chalk.cyan(issue.column)}` : "";
            out(`  ${chalk.gray("│")} Table: ${chalk.cyan(issue.table)}${colPart}`);
        }

        if (issue.expected && issue.actual) {
            out(`  ${chalk.gray("│")} Expected: ${chalk.green(issue.expected)} │ Actual: ${chalk.red(issue.actual)}`);
        }

        out(`  ${chalk.gray("│")} ${issue.message}`);
        out(`  ${chalk.gray("│")} Fix: ${chalk.blue(issue.fix)}`);
        out(`  ${chalk.gray("└" + "─".repeat(48))}`);
        out();
    }
}

function formatCategory(cat: DoctorIssue["category"]): string {
    const labels: Record<DoctorIssue["category"], string> = {
        missing_table: "Missing Table",
        missing_column: "Missing Column",
        type_mismatch: "Type Mismatch",
        nullability_mismatch: "Nullability Mismatch",
        extra_column: "Extra Column",
        missing_constraint: "Missing Constraint",
        primary_key_mismatch: "Primary Key Mismatch",
        schema_stale: "Stale Schema",
        missing_enum: "Missing Enum",
        enum_value_mismatch: "Enum Value Mismatch",
        missing_foreign_key: "Missing Foreign Key",
        orphaned_junction: "Orphaned Junction Table",
        sdk_stale: "Stale SDK Types",
        sdk_not_generated: "SDK Types Not Generated",
        sdk_ungeneratable: "SDK Cannot Be Generated"
    };
    return labels[cat];
}

// ── Main entry point ─────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

/**
 * The `tables` export of `schema.generated.ts`, imported as boot imports it.
 *
 * Nothing, and no error, when the file is not there: phase 1 reports that, and
 * boot then has nothing to compare either.
 */
async function loadGeneratedTables(schemaPath: string): Promise<{ tables?: Record<string, unknown>; error?: string }> {
    if (!fs.existsSync(schemaPath)) return {};
    try {
        const module: unknown = await import(pathToFileURL(schemaPath).href);
        return isRecord(module) && isRecord(module.tables) ? { tables: module.tables } : {};
    } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}

export async function runDoctor(options: {
    schemaDir: string;
    schemaPath: string;
    sdkPath: string;
    databaseUrl?: string;
}): Promise<DoctorReport> {
    out();
    out(chalk.bold("  🩺 Loading tables..."));
    // The loader every door uses (`loadTableSchema`): a doctor that disagreed with
    // the policy generator about which tables exist would compare the wrong
    // thing. A schema that does not compile is fatal here as everywhere.
    const loaded = await loadTableSchema(options.schemaDir);
    const { descriptors, tables } = loaded;
    if (tables.length === 0) {
        outError(chalk.red(`  ✗ No tables found in ${options.schemaDir} (its index.ts exports none).`));
        process.exit(1);
    }
    out(chalk.gray(`  Found ${tables.length} table(s)`));
    out();

    // Phase 1: Collections ↔ Generated Schema
    out(chalk.gray("  Checking Tables → Generated Schema..."));
    const collectionsToSchema = await checkCollectionsVsSchema(tables, options.schemaPath);

    // Phase 2: Collections ↔ Database (only if we have a DATABASE_URL)
    let schemaToDatabase: DoctorPhase;
    if (options.databaseUrl) {
        out(chalk.gray("  Checking Tables → Database..."));
        try {
            const generated = await loadGeneratedTables(options.schemaPath);
            schemaToDatabase = await checkCollectionsVsDatabase(tables, options.databaseUrl, {
                generated: generated.tables,
                schemaVersion: defaultDatabaseSchemaVersion(loaded)
            });
            if (generated.error) {
                // Boot imports this module too, and would stop on it.
                schemaToDatabase.issues.push({
                    severity: "warning",
                    category: "schema_stale",
                    message: `schema.generated.ts could not be loaded, so it was not compared against the database as boot compares it: ${generated.error}`,
                    fix: "Run `rebase schema generate`, then `rebase doctor` again"
                });
                schemaToDatabase.passed = false;
            }
        } catch (err: unknown) {
            // A database that cannot be reached used to end the whole run: the
            // error escaped `runDoctor` and the CLI's last-resort catch printed
            // a stack. So the two phases that need no database — the generated
            // schema and the SDK types, both of which are read off disk — never
            // ran, and the one command whose job is to say what is wrong said
            // only "Doctor failed" over a drizzle stack trace.
            const banner = diagnoseDbError(err, options.databaseUrl);
            if (banner) outError(banner);
            const reason = deepestErrorMessage(err)
                ?? (err instanceof Error ? err.message : String(err));
            schemaToDatabase = {
                passed: false,
                issues: [],
                skipped: `could not reach ${parseHostInfo(options.databaseUrl)} — ${reason}`,
                blocked: true
            };
        }
    } else {
        // Not `{ passed: true }`: see DoctorPhase.skipped.
        schemaToDatabase = { passed: false,
issues: [],
skipped: "DATABASE_URL not set" };
        out(chalk.yellow("  ⚠ DATABASE_URL not set — skipping database comparison."));
        out(chalk.gray("    Set DATABASE_URL in your .env to enable full drift detection."));
    }

    // Phase 3: Collections ↔ SDK Types
    out(chalk.gray("  Checking Tables → SDK Types..."));
    const collectionsToSdk = await checkCollectionsVsSdk(descriptors, options.sdkPath);

    const phases = [collectionsToSchema, schemaToDatabase, collectionsToSdk];
    const allIssues = phases.flatMap((p) => p.issues);
    const summary = {
        // A skipped phase is not a passing one, however few issues it collected.
        // Nor is one with nothing to compare against: "passed" would put a
        // never-generated SDK in the same column as a verified one.
        passed: phases.filter((p) => p.passed && !p.skipped && !p.notApplicable).length,
        skipped: phases.filter((p) => p.skipped).length,
        notApplicable: phases.filter((p) => p.notApplicable && !p.skipped).length,
        warnings: allIssues.filter((i) => i.severity === "warning").length,
        errors: allIssues.filter((i) => i.severity === "error").length
    };

    const report: DoctorReport = { collectionsToSchema,
collectionsToSdk,
schemaToDatabase,
summary };
    renderReport(report);

    return report;
}
