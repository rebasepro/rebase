/**
 * The SQL half of `rebase db generate`, as a plan and a renderer.
 *
 * There is no interpretation left in this file. `schema/plan/plan-schema.ts`
 * reads the collections into a {@link SchemaPlan} and `schema/plan/render-ddl.ts`
 * writes the files; what remains here is the public entry points those two are
 * reached through, plus the smaller plans (`planRelationalColumns`,
 * `planJunctionTables`, `planCollectionPolicies`) that other modules ask for as
 * slices of the same plan.
 *
 * It used to hold `getSqlColumnType` and a `CREATE TABLE` walk with its own
 * reading of relations, junctions, enums and search — one of three such
 * readings. See `schema/plan/types.ts` for what that cost.
 */
import { CollectionConfig, SecurityRule, isPostgresCollectionConfig } from "@rebasepro/types";
import { getTableName } from "@rebasepro/common";
import { planSchema, compileSecurityRule, quoteSqlLiteral, defaultBelongsToOnDelete } from "./plan/plan-schema";
import {
    renderPgType,
    renderPoliciesDdl,
    renderPolicyStatements,
    renderPostgresDdl,
    renderSearchDdl,
    renderTriggersDdl,
    renderVectorDdl,
    searchExcludePatternsOf,
    triggerExcludePatternsOf,
    vectorExcludePatternsOf,
    type DdlRenderOptions
} from "./plan/render-ddl";
import type { ForeignKeyPlan, SchemaPlan } from "./plan/types";
import type { GeneratedColumnDependency } from "./generated-column-conflicts";

export { quoteSqlLiteral, defaultBelongsToOnDelete };
export type { ForeignKeyPlan };

type ResolveCollection = (slug: string) => CollectionConfig | undefined;

/**
 * The individual SQL statements a single security rule compiles to: a
 * `DROP POLICY IF EXISTS` / `CREATE POLICY` pair per operation, each a complete
 * statement (terminated by `;`, no trailing newline).
 *
 * This is the primitive the boot-time RLS applier runs one statement at a time
 * (the runtime's DB handle speaks the extended query protocol, which forbids
 * multiple commands in one execute), while `db push` writes the joined string.
 */
export const generatePolicyStatements = (
    collection: CollectionConfig,
    rule: SecurityRule,
    resolveCollection: ResolveCollection
): string[] => {
    const table = {
        schema: isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public",
        table: getTableName(collection)
    };
    return compileSecurityRule(collection, rule, resolveCollection, false)
        .flatMap(policy => renderPolicyStatements(table, policy));
};

/**
 * `drizzle/schema.sql` — the desired state Atlas diffs the database against.
 *
 * Synchronous. It was `async` with nothing to await, which made every caller
 * (the writer script, the doctor, the live editor, two gates) carry a promise
 * for no reason and made the one place that forgot to await it silently compare
 * `[object Promise]`.
 */
export const generatePostgresDdl = (
    allCollections: CollectionConfig[],
    options: DdlRenderOptions = {}
): string => renderPostgresDdl(planSchema(allCollections), options);

/** `drizzle/policies.sql` — the RLS policies. Atlas has no model for a policy. */
export const generatePostgresPoliciesDdl = (allCollections: CollectionConfig[]): string =>
    renderPoliciesDdl(planSchema(allCollections));

/**
 * `drizzle/search.sql` — everything a `search` block needs, as a file Rebase
 * applies itself.
 *
 * Search is one of the parts of the schema Atlas does not own, for two
 * independent reasons and either alone would be enough:
 *
 * 1. Its free tier refuses to *parse* a desired-state file that so much as
 *    contains a function — "functions and procedures are available to
 *    logged-in users only". A generated `tsvector` column cannot avoid one:
 *    `unaccent` is STABLE and jsonb flattening needs a set-returning function,
 *    so both have to be wrapped in an IMMUTABLE helper to be legal in a
 *    generated column at all.
 * 2. Even with the file accepted, Atlas *wipes* the dev database it diffs
 *    against, so a helper seeded there beforehand is gone by the time the plan
 *    is analysed. There is no hook to reinstate it.
 *
 * Empty when nothing opted in — the caller writes no file then.
 */
export const generatePostgresSearchDdl = (allCollections: CollectionConfig[]): string =>
    renderSearchDdl(planSchema(allCollections));

/**
 * Glob patterns telling Atlas to leave the search column and its index alone.
 *
 * Without these, a desired state that omits search reads to Atlas as an
 * instruction to drop the column — taking the index and the whole search
 * feature with it on the next push.
 */
export const searchExcludePatterns = (allCollections: CollectionConfig[]): string[] =>
    searchExcludePatternsOf(planSchema(allCollections));

/**
 * `drizzle/vector.sql` — the `vector` columns, their ANN indexes and, when a
 * database declared it, the extension.
 *
 * Vector is out of Atlas's hands for a narrower reason than search: not that
 * Atlas refuses to parse the file, but that it cannot *execute* it. To compute
 * a desired state Atlas materialises `schema.sql` in a dev database, that
 * database is created empty, and Atlas empties it again at the start of every
 * run — so `VECTOR(384)` resolves against a database that structurally cannot
 * have pgvector, and every push dies with `type "vector" does not exist`.
 */
export const generatePostgresVectorDdl = (
    allCollections: CollectionConfig[],
    options: { extensions?: readonly string[] } = {}
): string => renderVectorDdl(planSchema(allCollections, { databaseExtensions: options.extensions }));

/** @see searchExcludePatterns */
export const vectorExcludePatterns = (allCollections: CollectionConfig[]): string[] =>
    vectorExcludePatternsOf(planSchema(allCollections));

/**
 * `drizzle/triggers.sql` — the `BEFORE UPDATE` triggers behind
 * `autoValue: "on_update"`, and the one function they share.
 *
 * A trigger is a function plus a binding, so it is carved out of Atlas's view
 * for the first of the two reasons search is. Empty when no property declares
 * `on_update` — the caller writes no file then, and removes a stale one.
 */
export const generatePostgresTriggersDdl = (allCollections: CollectionConfig[]): string =>
    renderTriggersDdl(planSchema(allCollections));

/** @see searchExcludePatterns */
export const triggerExcludePatterns = (allCollections: CollectionConfig[]): string[] =>
    triggerExcludePatternsOf(planSchema(allCollections));

// ── Slices of the plan other modules ask for ─────────────────────────────────

/** A column a `relation` or `reference` property owns on its own table. */
export interface RelationalColumnPlan {
    schema: string;
    /** Bare table name, no schema prefix. */
    table: string;
    column: string;
    /** Postgres type, exactly as the DDL renderer declares it. */
    type: string;
    /** `validation.required` on the property that owns the link. */
    required: boolean;
    /**
     * True when a declared property emits this column and the relation
     * contributes only the constraint — `postId` with `columnName: "post_id"`
     * beside a `belongsTo` on `post_id`.
     */
    columnOwnedByProperty?: boolean;
    /** Absent when the target collection is not part of this bundle. */
    foreignKey?: ForeignKeyPlan;
    /**
     * What this column would have been called before `generateForeignKeyName`
     * learned to singularize. Carried so the boot-time ensure can notice a
     * database provisioned under the old rule; never used to name anything.
     */
    legacyColumn?: string;
}

/** The table behind a many-to-many `through` relation. */
export interface JunctionTablePlan {
    schema: string;
    /** Bare table name, no schema prefix. */
    table: string;
    columns: { name: string; type: string; legacyName?: string }[];
    /** Both endpoint columns plus the composite primary key. */
    createTable: string;
    foreignKeys: ForeignKeyPlan[];
}

const planOf = (collections: CollectionConfig[]): SchemaPlan => planSchema(collections);

/**
 * The FK columns the declared collections own — one entry per `relation`
 * (`belongsTo` side) or `reference` property.
 *
 * A view over the schema plan. It was a second walk of the collections beside
 * the `CREATE TABLE` one, which is how boot-ensure came to add every relation
 * column bare while `db push` made the same column `NOT NULL`.
 */
export const planRelationalColumns = (allCollections: CollectionConfig[]): RelationalColumnPlan[] => {
    const plan = planOf(allCollections);
    const out: RelationalColumnPlan[] = [];
    for (const table of plan.tables) {
        if (table.kind !== "collection") continue;
        for (const column of table.columns) {
            if (column.source.kind !== "relation" && column.source.kind !== "reference") continue;
            out.push({
                schema: table.schema,
                table: table.table,
                column: column.column,
                type: renderPgType(column.type),
                required: !column.nullable,
                columnOwnedByProperty: column.columnOwnedByProperty,
                legacyColumn: column.legacyColumn,
                foreignKey: column.foreignKey
            });
        }
    }
    return out;
};

/**
 * The junction tables a bundle's many-to-many relations imply.
 *
 * Derived from the same plan the derived RLS comes from, so a table created
 * here always has policies planned for it — a junction with row-level security
 * left off is readable and writable by every signed-in user.
 */
export const planJunctionTables = (allCollections: CollectionConfig[]): JunctionTablePlan[] =>
    planOf(allCollections).tables
        .filter(table => table.kind === "junction")
        .map(table => ({
            schema: table.schema,
            table: table.table,
            columns: table.columns.map(c => ({
                name: c.column,
                type: renderPgType(c.type),
                legacyName: c.legacyColumn
            })),
            createTable:
                `CREATE TABLE IF NOT EXISTS "${table.schema}"."${table.table}" (` +
                table.columns.map(c => `"${c.column}" ${renderPgType(c.type)} NOT NULL`).join(", ") +
                `, PRIMARY KEY (${table.primaryKey.map(c => `"${c}"`).join(", ")}));`,
            foreignKeys: table.columns.map(c => c.foreignKey).filter((fk): fk is ForeignKeyPlan => fk !== undefined)
        }));

export interface CollectionPolicyPlan {
    /** The table's schema (e.g. `public`, `rebase`). */
    schema: string;
    /** The bare table name, no schema prefix. */
    table: string;
    /** `schema.table` — matches the keys `readExistingSchema` returns. */
    qualified: string;
    /** `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` — locked by default. */
    enableRls: string;
    /** `DROP POLICY IF EXISTS` / `CREATE POLICY` statements, in order. */
    policyStatements: string[];
}

/**
 * The per-table RLS plan for the declared collections and their junctions, as
 * executable statements — what the managed runtime applies at boot so a freshly
 * provisioned tenant database serves data instead of 401ing every read.
 *
 * The same policies `policies.sql` carries, from the same plan, so boot and
 * `db push` produce identical RLS from identical collections.
 */
export const planCollectionPolicies = (allCollections: CollectionConfig[]): CollectionPolicyPlan[] => {
    const plan = planOf(allCollections);
    // Collections first, then the junctions no collection declares.
    const ordered = [
        ...plan.tables.filter(t => t.kind === "collection"),
        ...plan.tables.filter(t => t.kind === "junction")
    ];
    return ordered.map(table => ({
        schema: table.schema,
        table: table.table,
        qualified: table.qualified,
        enableRls: `ALTER TABLE "${table.schema}"."${table.table}" ENABLE ROW LEVEL SECURITY;`,
        policyStatements: table.policies.flatMap(policy => renderPolicyStatements(table, policy))
    }));
};

/**
 * The `generated column → column it reads` edges a project's `search` blocks
 * imply, derived from the collections alone.
 *
 * The same edges `queryGeneratedColumnDependencies` reads out of `pg_depend`,
 * but available where no database is: `rebase db generate` writes a migration
 * that will run somewhere else, later, against a database it cannot inspect.
 * A spec's `fields[].column` is the physical column each search field starts
 * at, which is exactly what the generated expression depends on.
 */
export const searchColumnDependencies = (
    allCollections: CollectionConfig[]
): GeneratedColumnDependency[] => {
    const dependencies: GeneratedColumnDependency[] = [];
    for (const table of planOf(allCollections).tables) {
        const spec = table.search;
        if (!spec) continue;
        const generated = [spec.column, ...(spec.fuzzy ? [spec.fuzzy.column] : [])];
        const sources = new Set(spec.fields.map(field => field.column));
        for (const column of generated) {
            for (const dependsOn of sources) {
                dependencies.push({ schema: table.schema, table: table.table, column, dependsOn });
            }
        }
    }
    return dependencies;
};
