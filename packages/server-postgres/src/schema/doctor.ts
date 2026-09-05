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
import { computeSchemaVersion, CollectionConfig, isPostgresCollectionConfig, Property, NumberProperty, StringProperty, DateProperty, ArrayProperty, MapProperty, RelationProperty, type ResolvedManyToMany, type ResolvedBelongsTo, isManyToMany } from "@rebasepro/types";
import { generateSchema } from "./generate-drizzle-schema-logic";
import { generateTypedefs } from "@rebasepro/codegen";
import { getTableName, resolveCollectionRelations, findRelation, relationalCollections } from "@rebasepro/common";
import { toSnakeCase } from "@rebasepro/utils";
import { loadCollectionsFromDirectory } from "@rebasepro/server";
// The report is CLI output, not application logging — see cli-output.ts.
import { out, outError } from "../cli-output";
import { deepestErrorMessage, diagnoseDbError, parseHostInfo } from "../cli-errors";

/**
 * Resolve the SQL column name for a property.
 * Uses the explicit `columnName` when set (e.g. from introspection),
 * falling back to `toSnakeCase(propName)` for manually-authored collections.
 */
const resolveColumnName = (propName: string, prop?: Property | null): string => {
    if (prop && "columnName" in prop && typeof prop.columnName === "string") {
        return prop.columnName;
    }
    return toSnakeCase(propName);
};

// ── Types ────────────────────────────────────────────────────────────────

export type IssueSeverity = "error" | "warning" | "info";

export interface DoctorIssue {
    severity: IssueSeverity;
    category: "missing_table" | "missing_column" | "type_mismatch" | "missing_constraint" | "schema_stale" | "missing_enum" | "enum_value_mismatch" | "missing_foreign_key" | "sdk_stale" | "sdk_not_generated" | "sdk_ungeneratable";
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

// ── Column type mapping (mirrors generate-drizzle-schema-logic.ts) ───────

export function getExpectedColumnType(prop: Property): string | null {
    switch (prop.type) {
        case "string": {
            const sp = prop as StringProperty;
            if (sp.enum) return "USER-DEFINED"; // pgEnum → USER-DEFINED in information_schema
            if ("isId" in sp && sp.isId === "uuid") return "uuid";
            if (sp.columnType === "uuid") return "uuid";
            if (sp.columnType === "char") return "character";
            if (sp.columnType === "varchar") return "character varying";
            // `text` is the default — see generate-postgres-ddl-logic.
            return "text";
        }
        case "number": {
            const np = prop as NumberProperty;
            if (np.columnType) {
                // The generator passes any columnType straight through to drizzle,
                // so mirror that rather than enumerating a subset (which reported
                // drift for anything unlisted, e.g. smallint). Serial types are
                // integers with a sequence default; information_schema reports the
                // underlying width.
                const serialWidths: Record<string, string> = {
                    serial: "integer",
                    bigserial: "bigint",
                    smallserial: "smallint"
                };
                return serialWidths[np.columnType] ?? np.columnType;
            }
            if (np.validation?.integer || ("isId" in np && np.isId)) return "integer";
            return "numeric";
        }
        case "boolean":
            return "boolean";
        case "date": {
            const dp = prop as DateProperty;
            if (dp.columnType === "date") return "date";
            if (dp.columnType === "time") return "time without time zone";
            return "timestamp with time zone";
        }
        case "array": {
            const ap = prop as ArrayProperty;
            let colType = ap.columnType;
            if (!colType && ap.of && !Array.isArray(ap.of)) {
                const ofProp = ap.of as Property;
                if (ofProp.type === "string") {
                    colType = "text[]";
                } else if (ofProp.type === "number") {
                    colType = ofProp.validation?.integer ? "integer[]" : "numeric[]";
                } else if (ofProp.type === "boolean") {
                    colType = "boolean[]";
                }
            }

            if (colType === "json") return "json";
            if (colType === "jsonb") return "jsonb";
            if (colType && colType.endsWith("[]")) return "ARRAY";
            return "jsonb";
        }
        case "map": {
            const mp = prop as MapProperty;
            if (mp.columnType === "json") return "json";
            return "jsonb";
        }
        case "relation":
            return null; // FK columns are derived from the relation, not from the property
        case "reference":
            // A reference FK follows the key it points at, and a string key is
            // `text` — see generate-postgres-ddl-logic.
            return "text";
        case "vector":
            return "USER-DEFINED";
        case "binary":
            return "bytea";
        default:
            return null;
    }
}

// ── Collection loading ───────────────────────────────────────────────────

/**
 * Re-exported so callers keep importing it from here, but the implementation is
 * now shared with the runtime and the generators — a doctor that disagreed with
 * the policy generator about which files are collections would compare the
 * wrong thing.
 */
export async function loadCollections(collectionsPath: string): Promise<CollectionConfig[]> {
    return loadCollectionsFromDirectory(collectionsPath);
}

// ── Phase 1: Collections ↔ Generated Schema ─────────────────────────────

export async function checkCollectionsVsSchema(
    collections: CollectionConfig[],
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

    // Re-generate schema in-memory and compare with file on disk. Only the
    // collections the generator itself will emit — a Firestore collection has
    // no table in the generated file and must not be reported as missing one.
    const postgresCollections = relationalCollections(collections);
    if (postgresCollections.length === 0) {
        return { passed: true,
issues };
    }

    try {
        const expectedSchema = await generateSchema(postgresCollections);
        const actualSchema = await fsPromises.readFile(schemaFilePath, "utf-8");

        // Normalize whitespace for comparison
        const normalize = (s: string) =>
            s
                .replace(/\/\/.*$/gm, "") // strip single-line comments
                .replace(/\/\*[\s\S]*?\*\//g, "") // strip multi-line comments
                .replace(/\s+/g, " ")
                .trim();

        if (normalize(expectedSchema) !== normalize(actualSchema)) {
            issues.push({
                severity: "warning",
                category: "schema_stale",
                message: "Generated schema is out of date — collection definitions have changed since last generation.",
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
    collections: CollectionConfig[],
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
            fix: "Run `rebase generate-sdk` if you want typed collection access"
        });
        return { passed: true,
issues,
notApplicable: "not generated (optional)" };
    }

    try {
        const expectedSdk = generateTypedefs(collections);
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
                message: "Generated SDK types are out of date — collection definitions have changed since last SDK generation.",
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
                message: `The typed SDK cannot be generated from these collections: ${message}`,
                fix: "Fix the collection definitions named above, then run `rebase generate-sdk`"
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
    enum_name: string;
    enum_value: string;
}

/**
 * Extensions the collections need, that the database does not have installed.
 *
 * Only `vector` today, and only because a `{ type: "vector" }` property plans a
 * column of a type that will not exist. Rebase installs it only where a project
 * has said it may (`database({ extensions: ["vector"] })`), so the absence is
 * often correct configuration and a wrong deployment — which is exactly why the
 * report has to name it rather than the first failing INSERT.
 *
 * Exported for its test.
 */
export function missingExtensionIssues(
    collections: CollectionConfig[],
    installed: ReadonlySet<string>
): DoctorIssue[] {
    const usesVector = collections.some(collection =>
        Object.values(collection.properties ?? {})
            .some(property => (property as { type?: string } | null)?.type === "vector"));

    if (!usesVector || installed.has("vector")) return [];

    return [{
        severity: "error",
        category: "missing_table",
        message: 'A collection declares a `{ type: "vector" }` property and the pgvector extension is not installed on this database.',
        fix: 'Declare it — `database({ extensions: ["vector"] })` in config/resources.ts — and use an image that ships the library '
            + "(the scaffold's pgvector/pgvector:pg18; a stock postgres:18 does not). Or install it once by hand: CREATE EXTENSION vector;"
    }];
}

/**
 * The stamp the runtime wrote, against the collections on disk.
 *
 * A stamp that disagrees means this database was provisioned from a different
 * set of collections than the ones in this checkout — a colleague's branch, an
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
    collections: CollectionConfig[]
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
    const expected = computeSchemaVersion(collections);
    if (stamped === expected) return [];

    return [{
        severity: "warning",
        category: "schema_stale",
        message: `This database was provisioned from a different set of collections (stamp ${stamped.slice(0, 12)}…, this checkout computes ${expected.slice(0, 12)}…).`,
        fix: "A hash says the two disagree, never which is ahead. Check you are pointed at the database you think you are; then `rebase db push` to bring it to these collections."
    }];
}

export async function checkCollectionsVsDatabase(
    collections: CollectionConfig[],
    databaseUrl: string
): Promise<DoctorPhase> {
    const issues: DoctorIssue[] = [];

    // Dynamic import to avoid loading pg when not needed
    const pgModule = await import("pg");
    const { Pool } = pgModule.default ?? pgModule;
    const pool = new Pool({ connectionString: databaseUrl });

    // Determine all schemas defined by the collections, plus public and rebase
    const schemas = Array.from(new Set([
        "public",
        "rebase",
        ...relationalCollections(collections)
            .filter(isPostgresCollectionConfig)
            .map(c => c.schema)
            .filter((s): s is string => !!s)
    ]));

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
        issues.push(...missingExtensionIssues(collections, installedExtensions));

        // A database provisioned from a different set of collections than the
        // ones on disk.
        //
        // The runtime stamps what it applied; nothing compared it outside boot,
        // and a stamp that disagrees is exactly the state where the rest of
        // this report is describing a schema somebody else's deploy created.
        issues.push(...await schemaStampIssues(pool, collections));

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

        // Fetch enums
        const enumsResult = await pool.query<DbEnumValue>(
            `SELECT t.typname as enum_name, e.enumlabel as enum_value
             FROM pg_type t
             JOIN pg_enum e ON t.oid = e.enumtypid
             ORDER BY t.typname, e.enumsortorder`
        );
        const enumsByName = new Map<string, string[]>();
        for (const row of enumsResult.rows) {
            if (!enumsByName.has(row.enum_name)) {
                enumsByName.set(row.enum_name, []);
            }
            enumsByName.get(row.enum_name)!.push(row.enum_value);
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

        // ── Compare each collection against the database ─────────────────

        const postgresCollections = relationalCollections(collections);

        for (const collection of postgresCollections) {
            const tableName = getTableName(collection);
            const schemaName = (collection as { schema?: string }).schema || "public";
            const fullTableName = schemaName === "public" ? tableName : `${schemaName}.${tableName}`;

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

            // System columns that Rebase always creates
            const systemColumns = new Set(["id", "created_on", "updated_on"]);

            // Check properties → columns
            for (const [propName, prop] of Object.entries(collection.properties ?? {})) {
                if (prop.type === "relation") {
                    // ResolvedRelation columns are derived from localKey
                    const resolvedRelations = resolveCollectionRelations(collection);
                    const relation = findRelation(resolvedRelations, (prop as RelationProperty).relation?.relationName ?? propName);
                    if (relation?.kind === "belongsTo") {
                        const fkColName = relation.localKey;
                        if (!dbColumnMap.has(fkColName)) {
                            issues.push({
                                severity: "error",
                                category: "missing_column",
                                table: fullTableName,
                                column: fkColName,
                                message: `Foreign key column "${fkColName}" for relation "${propName}" is missing from table "${fullTableName}".`,
                                fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                            });
                        }

                        // Check FK constraint exists
                        const tableFks = fksByTable.get(fullTableName) ?? [];
                        let targetTableName = "unknown";
                        let targetSchemaName = "public";
                        try {
                            const targetColl = relation.target();
                            targetTableName = getTableName(targetColl);
                            targetSchemaName = (targetColl as { schema?: string }).schema || "public";
                        } catch { /* ignore */ }

                        const hasFk = tableFks.some((fk) =>
                            fk.column_name === fkColName &&
                            fk.foreign_table_name === targetTableName &&
                            fk.foreign_table_schema === targetSchemaName
                        );

                        if (dbColumnMap.has(fkColName) && !hasFk) {
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
                    continue;
                }

                const colName = resolveColumnName(propName, prop);

                // Skip system columns — they're handled automatically
                if (systemColumns.has(colName)) continue;

                const dbCol = dbColumnMap.get(colName);
                if (!dbCol) {
                    issues.push({
                        severity: "error",
                        category: "missing_column",
                        table: fullTableName,
                        column: colName,
                        message: `Column "${colName}" is defined in collection "${collection.slug}" but missing from table "${fullTableName}".`,
                        fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                    });
                    continue;
                }

                // Type check
                const expectedType = getExpectedColumnType(prop);
                if (expectedType) {
                    const actualType = dbCol.data_type;
                    let isMismatch = actualType !== expectedType;
                    if (prop.type === "vector" && dbCol.udt_name !== "vector") {
                        isMismatch = true;
                    }
                    if (prop.type === "array") {
                        const ap = prop as ArrayProperty;
                        let expectedColType = ap.columnType;
                        if (!expectedColType && ap.of && !Array.isArray(ap.of)) {
                            const ofProp = ap.of as Property;
                            if (ofProp.type === "string") expectedColType = "text[]";
                            else if (ofProp.type === "number") expectedColType = ofProp.validation?.integer ? "integer[]" : "numeric[]";
                            else if (ofProp.type === "boolean") expectedColType = "boolean[]";
                        }
                        if (expectedColType && expectedColType.endsWith("[]")) {
                            if (actualType !== "ARRAY") {
                                isMismatch = true;
                            } else {
                                const expectedUdt = expectedColType === "text[]" ? "_text" :
                                                    expectedColType === "integer[]" ? "_int4" :
                                                    expectedColType === "boolean[]" ? "_bool" :
                                                    expectedColType === "numeric[]" ? "_numeric" : "";
                                if (expectedUdt && dbCol.udt_name !== expectedUdt) {
                                    isMismatch = true;
                                }
                            }
                        }
                    }
                    if (isMismatch) {
                        issues.push({
                            severity: "warning",
                            category: "type_mismatch",
                            table: fullTableName,
                            column: colName,
                            expected: prop.type === "vector" ? "vector" : expectedType,
                            actual: dbCol.udt_name === "vector" ? "vector" : actualType,
                            message: `Column "${colName}" in table "${fullTableName}": expected type "${prop.type === "vector" ? "vector" : expectedType}" but found "${dbCol.udt_name === "vector" ? "vector" : actualType}".`,
                            fix: "Review collection property type or run a migration"
                        });
                    }
                }

                // Enum value check
                if (prop.type === "string" && (prop as StringProperty).enum) {
                    const enumValues = (prop as StringProperty).enum;
                    if (enumValues) {
                        const enumName = `${tableName}_${colName}`;
                        const dbEnumValues = enumsByName.get(enumName);
                        if (!dbEnumValues) {
                            issues.push({
                                severity: "warning",
                                category: "missing_enum",
                                table: fullTableName,
                                column: colName,
                                expected: enumName,
                                message: `Enum type "${enumName}" is defined in collection but not found in the database.`,
                                fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                            });
                        } else {
                            // Compare enum values
                            const expectedValues = Array.isArray(enumValues)
                                ? enumValues.map((v) => (typeof v === "string" ? v : String(v.id)))
                                : Object.keys(enumValues);

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
                                    fix: "Run `rebase db push` to update the enum"
                                });
                            }
                        }
                    }
                }
            }

            // Also check junction tables for many-to-many relations
            const resolvedRelations = resolveCollectionRelations(collection);
            for (const relation of Object.values(resolvedRelations)) {
                if (isManyToMany(relation)) {
                    const junctionTable = relation.through.table;
                    const junctionSchema = (collection as { schema?: string }).schema || "public";
                    const fullJunctionTable = junctionSchema === "public" ? junctionTable : `${junctionSchema}.${junctionTable}`;
                    if (!existingTables.has(fullJunctionTable)) {
                        issues.push({
                            severity: "error",
                            category: "missing_table",
                            table: fullJunctionTable,
                            message: `Junction table "${fullJunctionTable}" for many-to-many relation "${relation.relationName}" is missing.`,
                            fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                        });
                    }
                }
            }
        }
    } finally {
        await pool.end();
    }

    return { passed: issues.length === 0,
issues };
}

// ── Report Rendering ─────────────────────────────────────────────────────

export function renderReport(report: DoctorReport): void {
    out();
    out(chalk.bold("  🩺 Rebase Schema Doctor"));
    out(chalk.gray("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    out();

    // Phase 1
    renderPhase("Collections → Generated Schema", report.collectionsToSchema);

    // Phase 2
    renderPhase("Collections → Database", report.schemaToDatabase);

    // Phase 3
    renderPhase("Collections → SDK Types", report.collectionsToSdk);

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
        missing_constraint: "Missing Constraint",
        schema_stale: "Stale Schema",
        missing_enum: "Missing Enum",
        enum_value_mismatch: "Enum Value Mismatch",
        missing_foreign_key: "Missing Foreign Key",
        sdk_stale: "Stale SDK Types",
        sdk_not_generated: "SDK Types Not Generated",
        sdk_ungeneratable: "SDK Cannot Be Generated"
    };
    return labels[cat];
}

// ── Main entry point ─────────────────────────────────────────────────────

export async function runDoctor(options: {
    collectionsPath: string;
    schemaPath: string;
    sdkPath: string;
    databaseUrl?: string;
}): Promise<DoctorReport> {
    out();
    out(chalk.bold("  🩺 Loading collections..."));
    const collections = await loadCollections(options.collectionsPath);
    if (collections.length === 0) {
        outError(chalk.red("  ✗ No collections found."));
        process.exit(1);
    }
    out(chalk.gray(`  Found ${collections.length} collection(s)`));
    out();

    // Phase 1: Collections ↔ Generated Schema
    out(chalk.gray("  Checking Collections → Generated Schema..."));
    const collectionsToSchema = await checkCollectionsVsSchema(collections, options.schemaPath);

    // Phase 2: Collections ↔ Database (only if we have a DATABASE_URL)
    let schemaToDatabase: DoctorPhase;
    if (options.databaseUrl) {
        out(chalk.gray("  Checking Collections → Database..."));
        try {
            schemaToDatabase = await checkCollectionsVsDatabase(collections, options.databaseUrl);
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
    out(chalk.gray("  Checking Collections → SDK Types..."));
    const collectionsToSdk = await checkCollectionsVsSdk(collections, options.sdkPath);

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
