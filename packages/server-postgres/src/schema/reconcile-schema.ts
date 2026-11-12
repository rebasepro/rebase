/**
 * The reviewed half of schema-as-code: what boot will not do.
 *
 * Boot is additive (`ConstraintPolicy` in `plan/diff-plan.ts`). It creates
 * tables, columns, enum values and indexes, and it never relaxes a constraint
 * or drops a column, because an unattended boot runs against customer data
 * with nobody reading a diff. That leaves two states a table change can
 * reach and nothing in the platform can leave:
 *
 * - **A column made nullable.** The column stays NOT NULL. Boot reports the
 *   drift on every start and applies nothing.
 * - **A column removed.** The column stays, with its data. If it was NOT NULL
 *   with no default, every insert through the API now fails on a field nobody
 *   can send (`orphanedRequiredColumns`).
 *
 * This plans both, for a person to read. It relaxes every column the
 * tables declare nullable and the database still requires — the
 * `drop-not-null` actions the live editor's `converge` policy already plans —
 * and it lists every column no table declares. An undeclared column that
 * blocks inserts (NOT NULL, no default) is relaxed too, unless it is being
 * dropped: that keeps its data and makes the table writable again, which is
 * the one thing a removed column must not prevent. It drops only the columns
 * the caller names, one by one: removing a column is not consent to destroy
 * the column's data, so the drop is a separate, explicit act.
 *
 * Pure, given the database's catalogue. `readReconcileFacts` reads it and
 * counts the rows each drop destroys, which is the number someone confirming
 * a drop needs to see.
 */
import { createHash } from "node:crypto";

import type { CompiledTable, SchemaReconcileColumn, SchemaReconcilePlan } from "@rebasepro/types";

import { planSchema } from "./plan/plan-schema";
import { diffPlanAgainstCatalogue, type ExistingSchema } from "./plan/diff-plan";
import { readSchemaFactsFor, type Queryable } from "./ensure-collection-tables";
import type { TablePlan } from "./plan/types";

export interface ReconcileOptions {
    /** Undeclared columns to drop, as `<table slug>.<column>`. */
    drop?: string[];
}

/** The table, quoted for SQL. Names come from the catalogue and the plan, both already validated. */
const relation = (table: TablePlan): string => `"${table.schema}"."${table.table}"`;

/** Every column a declared table carries that it does not declare. */
function undeclaredColumns(
    tables: TablePlan[],
    existing: ExistingSchema
): Array<SchemaReconcileColumn & { tablePlan: TablePlan }> {
    const found: Array<SchemaReconcileColumn & { tablePlan: TablePlan }> = [];
    for (const table of tables) {
        const live = existing.tables.get(table.qualified);
        if (!live) continue;
        // The same reading of "declared" as boot's orphan check: a column, or
        // the legacy name a rename is carrying it from.
        const declared = new Set<string>();
        for (const column of table.columns) {
            declared.add(column.column);
            if (column.legacyColumn) declared.add(column.legacyColumn);
        }
        for (const column of [...live].sort()) {
            if (declared.has(column)) continue;
            const key = `${table.qualified}.${column}`;
            found.push({
                collection: table.slug!,
                table: table.qualified,
                column,
                blocksInserts: existing.notNullColumns?.has(key) === true && existing.columnDefaults?.has(key) !== true,
                tablePlan: table
            });
        }
    }
    return found;
}

export function planSchemaReconcile(
    compiledTables: readonly CompiledTable[],
    existing: ExistingSchema,
    options: ReconcileOptions = {}
): SchemaReconcilePlan {
    const plan = planSchema(compiledTables);
    const tables = plan.tables.filter(table => table.kind === "collection" && table.slug);

    // Relaxing comes from the converge diff rather than a second reading of
    // nullability here, so this and the live editor cannot disagree about
    // which columns are optional. Only its `drop-not-null` actions: anything
    // additive in that diff is boot's to do, and boot does it.
    const converge = diffPlanAgainstCatalogue(plan, existing, { constraints: "converge" });
    const relaxed: SchemaReconcilePlan["relaxed"] = [];
    const relaxStatements: string[] = [];
    for (const action of converge.actions) {
        if (action.kind !== "drop-not-null") continue;
        const table = tables.find(t => action.target.startsWith(`${t.qualified}.`));
        if (!table) continue;
        relaxed.push({ collection: table.slug!, table: table.qualified, column: action.target.slice(table.qualified.length + 1) });
        relaxStatements.push(action.sql);
    }

    const undeclared = undeclaredColumns(tables, existing);
    const problems: string[] = [];
    const dropped: Array<SchemaReconcileColumn & { tablePlan: TablePlan }> = [];
    for (const request of new Set(options.drop ?? [])) {
        const dot = request.indexOf(".");
        const slug = dot > 0 ? request.slice(0, dot) : "";
        const column = dot > 0 ? request.slice(dot + 1) : "";
        if (!slug || !column) {
            problems.push(`"${request}" is not <table>.<column>.`);
            continue;
        }
        const table = tables.find(t => t.slug === slug);
        if (!table) {
            problems.push(`"${request}": no table "${slug}".`);
            continue;
        }
        const match = undeclared.find(u => u.collection === slug && u.column === column);
        if (match) {
            dropped.push(match);
            continue;
        }
        // Refused rather than ignored, and never dropped: a declared column is
        // one the table still reads and writes.
        problems.push(table.columns.some(c => c.column === column)
            ? `"${request}": the "${slug}" table still declares "${column}". Remove the column, deploy, then drop it.`
            : `"${request}": "${table.qualified}" has no column "${column}".`);
    }

    // An undeclared column every insert fails on, and that is not being
    // dropped: stop requiring it. Its data stays where it is.
    for (const column of undeclared) {
        if (!column.blocksInserts || dropped.includes(column)) continue;
        relaxed.push({ collection: column.collection, table: column.table, column: column.column, undeclared: true });
        relaxStatements.push(`ALTER TABLE ${relation(column.tablePlan)} ALTER COLUMN "${column.column}" DROP NOT NULL;`);
    }

    const statements = [
        ...relaxStatements,
        ...dropped.map(d => `ALTER TABLE ${relation(d.tablePlan)} DROP COLUMN "${d.column}";`)
    ];
    const strip = ({ tablePlan: _table, ...column }: SchemaReconcileColumn & { tablePlan: TablePlan }): SchemaReconcileColumn => column;
    return {
        relaxed,
        undeclared: undeclared.map(strip),
        dropped: dropped.map(strip),
        statements,
        problems,
        digest: reconcileDigest(statements)
    };
}

/**
 * The identity of a plan: its statements, in order. A caller applies only on
 * the digest it was shown, so the statements that run are the ones read.
 */
export function reconcileDigest(statements: string[]): string {
    return createHash("sha256").update(statements.join("\n")).digest("hex").slice(0, 16);
}

/**
 * Plan against a live database, with the row counts a drop destroys.
 *
 * The count is the column's non-null values. It is what turns "drop
 * songbuzz_voice_cache.wav" into "drop 12,408 recordings", which is the
 * sentence a person should be agreeing to.
 */
export async function readReconcileFacts(
    client: Queryable,
    tables: readonly CompiledTable[],
    options: ReconcileOptions = {}
): Promise<SchemaReconcilePlan> {
    const existing = await readSchemaFactsFor(client, tables);
    const plan = planSchemaReconcile(tables, existing, options);
    for (const column of plan.dropped) {
        const [schema, table] = column.table.split(".");
        const { rows } = await client.query<{ n: string | number }>(
            `SELECT count(*) AS n FROM "${schema}"."${table}" WHERE "${column.column}" IS NOT NULL`
        );
        column.rowsWithValue = Number(rows[0]?.n ?? 0);
    }
    return plan;
}
