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
import { EntityCollection, isPostgresCollection, Property, NumberProperty, StringProperty, DateProperty, ArrayProperty, MapProperty, RelationProperty } from "@rebasepro/types";
import { generateSchema } from "./generate-drizzle-schema-logic";
import { generateTypedefs } from "@rebasepro/sdk-generator";
import { getTableName, resolveCollectionRelations, findRelation } from "@rebasepro/common";
import { toSnakeCase } from "@rebasepro/utils";

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
    category: "missing_table" | "missing_column" | "type_mismatch" | "missing_constraint" | "schema_stale" | "missing_enum" | "enum_value_mismatch" | "missing_foreign_key" | "sdk_stale";
    table?: string;
    column?: string;
    expected?: string;
    actual?: string;
    message: string;
    fix: string;
}

export interface DoctorReport {
    collectionsToSchema: { passed: boolean; issues: DoctorIssue[] };
    collectionsToSdk: { passed: boolean; issues: DoctorIssue[] };
    schemaToDatabase: { passed: boolean; issues: DoctorIssue[] };
    summary: { passed: number; warnings: number; errors: number };
}

// ── Column type mapping (mirrors generate-drizzle-schema-logic.ts) ───────

export function getExpectedColumnType(prop: Property): string | null {
    switch (prop.type) {
        case "string": {
            const sp = prop as StringProperty;
            if (sp.enum) return "USER-DEFINED"; // pgEnum → USER-DEFINED in information_schema
            if ("isId" in sp && sp.isId === "uuid") return "uuid";
            if (sp.columnType === "text") return "text";
            if (sp.columnType === "char") return "character";
            return "character varying";
        }
        case "number": {
            const np = prop as NumberProperty;
            if (np.columnType === "double precision") return "double precision";
            if (np.columnType === "real") return "real";
            if (np.columnType === "bigint") return "bigint";
            if (np.columnType === "serial") return "integer"; // serial is integer under the hood
            if (np.columnType === "bigserial") return "bigint";
            if (np.columnType === "integer") return "integer";
            if (np.columnType === "numeric") return "numeric";
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
        case "map":
        case "array": {
            const ap = prop as ArrayProperty | MapProperty;
            if (ap.columnType === "json") return "json";
            return "jsonb";
        }
        case "relation":
            return null; // FK columns are derived from the relation, not from the property
        case "reference":
            return "character varying"; // References default to varchar FK
        case "vector":
            return "USER-DEFINED";
        default:
            return null;
    }
}

// ── Collection loading ───────────────────────────────────────────────────

export async function loadCollections(collectionsPath: string): Promise<EntityCollection[]> {
    const resolvedPath = path.resolve(collectionsPath);
    const collections: EntityCollection[] = [];

    const stats = fs.statSync(resolvedPath);

    if (stats.isDirectory()) {
        const files = fs.readdirSync(resolvedPath);
        for (const file of files) {
            if (
                (file.endsWith(".ts") || file.endsWith(".js")) &&
                !file.includes(".test.") &&
                !file.endsWith(".d.ts") &&
                file !== "index.ts" &&
                file !== "index.js"
            ) {
                const filePath = path.join(resolvedPath, file);
                try {
                    const fileUrl = pathToFileURL(filePath).href;
                    const dynamicImport = new Function("url", "return import(url)");
                    const mod = await dynamicImport(fileUrl);
                    if (mod?.default) {
                        collections.push(mod.default);
                    }
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.error(chalk.yellow(`  ⚠ Could not load ${file}: ${message}`));
                }
            }
        }
    } else {
        const fileUrl = pathToFileURL(resolvedPath).href + `?t=${Date.now()}`;
        const dynamicImport = new Function("url", "return import(url)");
        const imported = await dynamicImport(fileUrl);
        const loaded = imported.backendCollections || imported.collections;
        if (Array.isArray(loaded)) {
            collections.push(...loaded);
        }
    }

    // Sort collections by slug alphabetically to ensure deterministic comparison
    collections.sort((a, b) => a.slug.localeCompare(b.slug));

    return collections;
}

// ── Phase 1: Collections ↔ Generated Schema ─────────────────────────────

export async function checkCollectionsVsSchema(
    collections: EntityCollection[],
    schemaFilePath: string
): Promise<{ passed: boolean; issues: DoctorIssue[] }> {
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

    // Re-generate schema in-memory and compare with file on disk
    const postgresCollections = collections.filter(isPostgresCollection);
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
    collections: EntityCollection[],
    sdkFilePath: string
): Promise<{ passed: boolean; issues: DoctorIssue[] }> {
    const issues: DoctorIssue[] = [];

    // Check if SDK file exists
    if (!fs.existsSync(sdkFilePath)) {
        issues.push({
            severity: "warning",
            category: "sdk_stale",
            message: `Generated SDK typedefs file does not exist at "${sdkFilePath}".`,
            fix: "Run `rebase generate-sdk`"
        });
        return { passed: false, issues };
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
        issues.push({
            severity: "warning",
            category: "sdk_stale",
            message: `Could not regenerate SDK types for comparison: ${message}`,
            fix: "Run `rebase generate-sdk` to verify"
        });
    }

    return { passed: issues.length === 0, issues };
}

// ── Phase 2: Collections ↔ Database ──────────────────────────────────────

interface DbColumn {
    column_name: string;
    data_type: string;
    is_nullable: string;
    udt_name: string;
}


interface DbEnumValue {
    enum_name: string;
    enum_value: string;
}

export async function checkCollectionsVsDatabase(
    collections: EntityCollection[],
    databaseUrl: string
): Promise<{ passed: boolean; issues: DoctorIssue[] }> {
    const issues: DoctorIssue[] = [];

    // Dynamic import to avoid loading pg when not needed
    const pgModule = await import("pg");
    const { Pool } = pgModule.default ?? pgModule;
    const pool = new Pool({ connectionString: databaseUrl });

    try {
        // Fetch all tables in the public schema
        const tablesResult = await pool.query<{ table_name: string }>(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
        );
        const existingTables = new Set(tablesResult.rows.map((r) => r.table_name));

        // Fetch all columns
        const columnsResult = await pool.query<DbColumn>(
            `SELECT table_name, column_name, data_type, is_nullable, udt_name
             FROM information_schema.columns
             WHERE table_schema = 'public'
             ORDER BY table_name, ordinal_position`
        );
        const columnsByTable = new Map<string, DbColumn[]>();
        for (const row of columnsResult.rows) {
            const tableName = (row as unknown as Record<string, string>).table_name;
            if (!columnsByTable.has(tableName)) {
                columnsByTable.set(tableName, []);
            }
            columnsByTable.get(tableName)!.push(row);
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

        // Fetch foreign key constraints
        const fksResult = await pool.query<{
            constraint_name: string;
            table_name: string;
            column_name: string;
            foreign_table_name: string;
            foreign_column_name: string;
        }>(
            `SELECT
                tc.constraint_name,
                tc.table_name,
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
             FROM information_schema.table_constraints AS tc
             JOIN information_schema.key_column_usage AS kcu
                 ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage AS ccu
                 ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
        );
        const fksByTable = new Map<string, typeof fksResult.rows>();
        for (const row of fksResult.rows) {
            if (!fksByTable.has(row.table_name)) {
                fksByTable.set(row.table_name, []);
            }
            fksByTable.get(row.table_name)!.push(row);
        }

        // ── Compare each collection against the database ─────────────────

        const postgresCollections = collections.filter(isPostgresCollection);

        for (const collection of postgresCollections) {
            const tableName = getTableName(collection);

            // Check table existence
            if (!existingTables.has(tableName)) {
                issues.push({
                    severity: "error",
                    category: "missing_table",
                    table: tableName,
                    message: `Table "${tableName}" does not exist in the database.`,
                    fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                });
                continue; // Skip column checks for missing tables
            }

            const dbColumns = columnsByTable.get(tableName) ?? [];
            const dbColumnMap = new Map(dbColumns.map((c) => [c.column_name, c]));

            // System columns that Rebase always creates
            const systemColumns = new Set(["id", "created_on", "updated_on"]);

            // Check properties → columns
            for (const [propName, prop] of Object.entries(collection.properties ?? {})) {
                if (prop.type === "relation") {
                    // Relation columns are derived from localKey
                    const resolvedRelations = resolveCollectionRelations(collection);
                    const relation = findRelation(resolvedRelations, (prop as RelationProperty).relationName ?? propName);
                    if (relation?.direction === "owning" && relation.cardinality === "one" && relation.localKey) {
                        const fkColName = relation.localKey;
                        if (!dbColumnMap.has(fkColName)) {
                            issues.push({
                                severity: "error",
                                category: "missing_column",
                                table: tableName,
                                column: fkColName,
                                message: `Foreign key column "${fkColName}" for relation "${propName}" is missing from table "${tableName}".`,
                                fix: "Run `rebase db push` or `rebase db generate && rebase db migrate`"
                            });
                        }

                        // Check FK constraint exists
                        const tableFks = fksByTable.get(tableName) ?? [];
                        const hasFk = tableFks.some((fk) => fk.column_name === fkColName);
                        if (dbColumnMap.has(fkColName) && !hasFk) {
                            let targetTableName = "unknown";
                            try {
                                targetTableName = getTableName(relation.target());
                            } catch { /* ignore */ }
                            issues.push({
                                severity: "warning",
                                category: "missing_foreign_key",
                                table: tableName,
                                column: fkColName,
                                message: `Column "${fkColName}" exists but has no FOREIGN KEY constraint referencing "${targetTableName}".`,
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
                        table: tableName,
                        column: colName,
                        message: `Column "${colName}" is defined in collection "${collection.slug}" but missing from table "${tableName}".`,
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
                    if (isMismatch) {
                        issues.push({
                            severity: "warning",
                            category: "type_mismatch",
                            table: tableName,
                            column: colName,
                            expected: prop.type === "vector" ? "vector" : expectedType,
                            actual: dbCol.udt_name === "vector" ? "vector" : actualType,
                            message: `Column "${colName}" in table "${tableName}": expected type "${prop.type === "vector" ? "vector" : expectedType}" but found "${dbCol.udt_name === "vector" ? "vector" : actualType}".`,
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
                                table: tableName,
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
                                    table: tableName,
                                    column: colName,
                                    expected: expectedValues.join(", "),
                                    actual: dbEnumValues.join(", "),
                                    message: `Enum values for "${colName}" in table "${tableName}" are out of sync (${parts.join("; ")}).`,
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
                if (relation.cardinality === "many" && relation.direction === "owning" && relation.through) {
                    const junctionTable = relation.through.table;
                    if (!existingTables.has(junctionTable)) {
                        issues.push({
                            severity: "error",
                            category: "missing_table",
                            table: junctionTable,
                            message: `Junction table "${junctionTable}" for many-to-many relation "${relation.relationName}" is missing.`,
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
    console.log("");
    console.log(chalk.bold("  🩺 Rebase Schema Doctor"));
    console.log(chalk.gray("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log("");

    // Phase 1
    renderPhase(
        "Collections → Generated Schema",
        report.collectionsToSchema.passed,
        report.collectionsToSchema.issues
    );

    // Phase 2
    renderPhase(
        "Collections → Database",
        report.schemaToDatabase.passed,
        report.schemaToDatabase.issues
    );

    // Phase 3
    renderPhase(
        "Collections → SDK Types",
        report.collectionsToSdk.passed,
        report.collectionsToSdk.issues
    );

    // Summary
    console.log(chalk.gray("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    const { passed, warnings, errors } = report.summary;

    const parts: string[] = [];
    parts.push(chalk.green(`${passed} passed`));
    if (warnings > 0) parts.push(chalk.yellow(`${warnings} warnings`));
    if (errors > 0) parts.push(chalk.red(`${errors} errors`));

    console.log(`  Summary: ${parts.join(", ")}`);
    console.log("");

    if (errors > 0) {
        console.log(chalk.red.bold("  ✗ Schema drift detected. Run the suggested fixes above."));
    } else if (warnings > 0) {
        console.log(chalk.yellow.bold("  ⚠ Minor issues detected. Consider running the suggested fixes."));
    } else {
        console.log(chalk.green.bold("  ✓ All schemas are in sync!"));
    }
    console.log("");
}

function renderPhase(label: string, passed: boolean, issues: DoctorIssue[]): void {
    if (passed) {
        console.log(`  ${chalk.green("✅")} ${label}: ${chalk.green("In sync")}`);
    } else {
        const errorCount = issues.filter((i) => i.severity === "error").length;
        const warnCount = issues.filter((i) => i.severity === "warning").length;
        const parts: string[] = [];
        if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
        if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
        console.log(`  ${chalk.yellow("⚠️")}  ${label}: ${chalk.yellow(parts.join(", "))}`);
    }
    console.log("");

    for (const issue of issues) {
        const severityIcon = issue.severity === "error" ? chalk.red("✗") : chalk.yellow("⚠");
        const categoryLabel = formatCategory(issue.category);
        console.log(`  ${chalk.gray("┌─")} ${severityIcon} ${chalk.bold(categoryLabel)} ${chalk.gray("─".repeat(Math.max(0, 42 - categoryLabel.length)))}`);

        if (issue.table) {
            const colPart = issue.column ? ` │ Column: ${chalk.cyan(issue.column)}` : "";
            console.log(`  ${chalk.gray("│")} Table: ${chalk.cyan(issue.table)}${colPart}`);
        }

        if (issue.expected && issue.actual) {
            console.log(`  ${chalk.gray("│")} Expected: ${chalk.green(issue.expected)} │ Actual: ${chalk.red(issue.actual)}`);
        }

        console.log(`  ${chalk.gray("│")} ${issue.message}`);
        console.log(`  ${chalk.gray("│")} Fix: ${chalk.blue(issue.fix)}`);
        console.log(`  ${chalk.gray("└" + "─".repeat(48))}`);
        console.log("");
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
        sdk_stale: "Stale SDK Types"
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
    console.log("");
    console.log(chalk.bold("  🩺 Loading collections..."));
    const collections = await loadCollections(options.collectionsPath);
    if (collections.length === 0) {
        console.error(chalk.red("  ✗ No collections found."));
        process.exit(1);
    }
    console.log(chalk.gray(`  Found ${collections.length} collection(s)`));
    console.log("");

    // Phase 1: Collections ↔ Generated Schema
    console.log(chalk.gray("  Checking Collections → Generated Schema..."));
    const collectionsToSchema = await checkCollectionsVsSchema(collections, options.schemaPath);

    // Phase 2: Collections ↔ Database (only if we have a DATABASE_URL)
    let schemaToDatabase: { passed: boolean; issues: DoctorIssue[] } = { passed: true,
issues: [] };
    if (options.databaseUrl) {
        console.log(chalk.gray("  Checking Collections → Database..."));
        schemaToDatabase = await checkCollectionsVsDatabase(collections, options.databaseUrl);
    } else {
        console.log(chalk.yellow("  ⚠ DATABASE_URL not set — skipping database comparison."));
        console.log(chalk.gray("    Set DATABASE_URL in your .env to enable full drift detection."));
    }

    // Phase 3: Collections ↔ SDK Types
    console.log(chalk.gray("  Checking Collections → SDK Types..."));
    const collectionsToSdk = await checkCollectionsVsSdk(collections, options.sdkPath);

    const allIssues = [...collectionsToSchema.issues, ...schemaToDatabase.issues, ...collectionsToSdk.issues];
    const summary = {
        passed: [collectionsToSchema, schemaToDatabase, collectionsToSdk].filter((p) => p.passed).length,
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
