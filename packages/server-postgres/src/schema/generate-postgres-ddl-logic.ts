/**
 * The SQL half of `rebase db generate`, as a plan and a renderer.
 *
 * There is no interpretation left in this file. `schema/plan/plan-schema.ts`
 * reads the collections into a {@link SchemaPlan} and `schema/plan/render-ddl.ts`
 * writes the files; what remains here is the public entry points those two are
 * reached through, plus the smaller plans (`planRelationalColumns`,
 * `planJunctionTables`, `planTablePolicies`) that other modules ask for as
 * slices of the same plan.
 *
 * It used to hold `getSqlColumnType` and a `CREATE TABLE` walk with its own
 * reading of relations, junctions, enums and search — one of three such
 * readings. See `schema/plan/types.ts` for what that cost.
 */
import { REBASE_ADMIN_REQUEST_ROLE, type CompiledTable, type SecurityRule, type TableDescriptor } from "@rebasepro/types";
import { policyTableFromDescriptor, policyTableResolver, type ResolvePolicyTable } from "@rebasepro/common";
import { compileTableSecurityRule, planSchema, quoteSqlLiteral, defaultBelongsToOnDelete } from "./plan/plan-schema";
import {
    renderDenyingPolicyStatements,
    renderPgType,
    renderPoliciesDdl,
    renderPolicyStatements,
    renderPostgresDdl,
    renderSearchDdl,
    renderTriggersDdl,
    renderViewsDdl,
    renderVectorDdl,
    searchExcludePatternsOf,
    triggerExcludePatternsOf,
    vectorExcludePatternsOf,
    type DdlRenderOptions
} from "./plan/render-ddl";
import type { ForeignKeyPlan, PolicyPlan, SchemaPlan, TablePlan } from "./plan/types";
import type { GeneratedColumnDependency } from "./generated-column-conflicts";

export { quoteSqlLiteral, defaultBelongsToOnDelete };
export type { ForeignKeyPlan };

/**
 * The individual SQL statements a single security rule compiles to: a
 * `DROP POLICY IF EXISTS` / `CREATE POLICY` pair per operation, each a complete
 * statement (terminated by `;`, no trailing newline).
 *
 * This is the primitive the boot-time RLS applier runs one statement at a time
 * (the runtime's DB handle speaks the extended query protocol, which forbids
 * multiple commands in one execute), while `db push` writes the joined string.
 *
 * `resolveTable` answers the tables a rule's `existsIn` reaches; by default
 * only the table itself.
 */
export const generatePolicyStatements = (
    table: TableDescriptor,
    rule: SecurityRule,
    resolveTable: ResolvePolicyTable = policyTableResolver([table])
): string[] =>
    compileTableSecurityRule(policyTableFromDescriptor(table), rule, resolveTable, false)
        .flatMap(policy => renderPolicyStatements({ schema: table.schema, table: table.table }, policy));

/**
 * `.rebase/sql/schema.sql` — the desired state Atlas diffs the database against.
 *
 * Synchronous. It was `async` with nothing to await, which made every caller
 * (the writer script, the doctor, the live editor, two gates) carry a promise
 * for no reason and made the one place that forgot to await it silently compare
 * `[object Promise]`.
 */
export const generatePostgresDdl = (
    tables: readonly CompiledTable[],
    options: DdlRenderOptions = {}
): string => renderPostgresDdl(planSchema(tables), options);

/** `.rebase/sql/policies.sql` — the RLS policies. Atlas has no model for a policy. */
export const generatePostgresPoliciesDdl = (tables: readonly CompiledTable[]): string =>
    renderPoliciesDdl(planSchema(tables));

/**
 * `.rebase/sql/search.sql` — everything a `search` block needs, as a file Rebase
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
export const generatePostgresSearchDdl = (tables: readonly CompiledTable[]): string =>
    renderSearchDdl(planSchema(tables));

/**
 * Glob patterns telling Atlas to leave the search column and its index alone.
 *
 * Without these, a desired state that omits search reads to Atlas as an
 * instruction to drop the column — taking the index and the whole search
 * feature with it on the next push.
 */
export const searchExcludePatterns = (tables: readonly CompiledTable[]): string[] =>
    searchExcludePatternsOf(planSchema(tables));

/**
 * `.rebase/sql/vector.sql` — the `vector` columns, their ANN indexes and, when a
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
    tables: readonly CompiledTable[],
    options: { extensions?: readonly string[] } = {}
): string => renderVectorDdl(planSchema(tables, { databaseExtensions: options.extensions }));

/** @see searchExcludePatterns */
export const vectorExcludePatterns = (tables: readonly CompiledTable[]): string[] =>
    vectorExcludePatternsOf(planSchema(tables));

/**
 * `.rebase/sql/triggers.sql` — the `BEFORE UPDATE` triggers behind
 * `autoValue: "on_update"`, and the one function they share.
 *
 * A trigger is a function plus a binding, so it is carved out of Atlas's view
 * for the first of the two reasons search is. Empty when no property declares
 * `on_update` — the caller writes no file then, and removes a stale one.
 */
export const generatePostgresTriggersDdl = (tables: readonly CompiledTable[]): string =>
    renderTriggersDdl(planSchema(tables));

/**
 * `.rebase/sql/views.sql` — the views of the collections that declare `view`,
 * which Atlas's free tier does not manage. Empty when none does — the caller
 * writes no file then, and removes a stale one.
 */
export const generatePostgresViewsDdl = (tables: readonly CompiledTable[]): string =>
    renderViewsDdl(planSchema(tables));

/** @see searchExcludePatterns */
export const triggerExcludePatterns = (tables: readonly CompiledTable[]): string[] =>
    triggerExcludePatternsOf(planSchema(tables));

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

const planOf = (tables: readonly CompiledTable[]): SchemaPlan => planSchema(tables);

/**
 * The FK columns the declared collections own — one entry per `relation`
 * (`belongsTo` side) or `reference` property.
 *
 * A view over the schema plan. It was a second walk of the collections beside
 * the `CREATE TABLE` one, which is how boot-ensure came to add every relation
 * column bare while `db push` made the same column `NOT NULL`.
 */
export const planRelationalColumns = (tables: readonly CompiledTable[]): RelationalColumnPlan[] => {
    const plan = planOf(tables);
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
export const planJunctionTables = (tables: readonly CompiledTable[]): JunctionTablePlan[] =>
    planOf(tables).tables
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

export interface TablePolicyPlan {
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
    /**
     * The same statements, grouped by policy, with each restrictive policy's
     * denying stand-in. What the boot applier's one-statement-at-a-time
     * fallback walks: it creates the restrictive gates before any grant, and
     * puts the stand-in where a gate could not be created.
     */
    policies: PolicyApplyPlan[];
}

/** One policy of a {@link TablePolicyPlan}, as the statements that make it. */
export interface PolicyApplyPlan {
    name: string;
    /** Written `TO rebase_admin` by the compiler's choice (`rls.adminPolicies`). */
    adminTarget: boolean;
    /** The `TO rebase_admin_request USING (true)` companion of an admin-only policy. */
    adminRequestTarget?: true;
    restrictive: boolean;
    /** Its `DROP POLICY IF EXISTS` / `CREATE POLICY` statements — a slice of `policyStatements`. */
    statements: string[];
    /** For a restrictive policy, the statements that make it deny every row instead. */
    denying?: string[];
}

/** What the database a boot writes the policies into can hold. */
export interface PolicyPlanOptions {
    /**
     * Whether `rebase_admin` exists. Where it cannot, a policy the compiler
     * put `TO rebase_admin` is written `TO public`. Assumed when unset.
     */
    adminRoleAvailable?: boolean;
    /**
     * The boot made `rebase_admin_request`, granted it to the admin request
     * roles alone, and checked the connection does not hold its
     * privileges. Only then are the companions planned; otherwise they
     * are left out, and the boot drops any left in the database.
     */
    adminRequestRoleAvailable?: boolean;
}

/** One policy as the boot writes it, before it is rendered to statements. */
interface WrittenPolicy {
    policy: PolicyPlan;
    /** Written `TO rebase_admin` by the compiler's choice, and not moved `TO public`. */
    adminTarget: boolean;
    /** The `TO rebase_admin_request` companion of the policy before it. */
    adminRequestTarget: boolean;
}

/** The planned tables in the order the boot writes them: collections first, then the junctions no collection declares. */
const policyTablesOf = (tables: readonly CompiledTable[]): TablePlan[] => {
    const plan = planOf(tables);
    return [
        ...plan.tables.filter(t => t.kind === "collection"),
        ...plan.tables.filter(t => t.kind === "junction")
    ];
};

/**
 * A table's policies as the boot writes them — the one reading both
 * {@link planTablePolicies} (as statements) and {@link planPolicyDefinitions}
 * (as data) render, so the two cannot describe different policies.
 */
const writtenPolicies = (table: TablePlan, options: PolicyPlanOptions): WrittenPolicy[] =>
    table.policies.flatMap((planned): WrittenPolicy[] => {
        // Where `rebase_admin` cannot exist, a policy the compiler put there
        // is written as it was before it did: `TO public`.
        const policy = options.adminRoleAvailable === false && planned.adminTarget
            ? { ...planned, roles: ["public"] }
            : planned;
        const written: WrittenPolicy = {
            policy,
            adminTarget: policy.adminTarget === true && policy.roles[0] !== "public",
            adminRequestTarget: false
        };
        // The companion goes only beside a policy actually written TO
        // rebase_admin, and never anywhere else: moved TO public, it would
        // be `USING (true)` for everyone.
        const companion = planned.adminRequestCompanion;
        if (!companion || !written.adminTarget || options.adminRequestRoleAvailable !== true) return [written];
        return [written, {
            policy: {
                ...policy,
                name: companion.name,
                mode: "permissive",
                roles: [REBASE_ADMIN_REQUEST_ROLE],
                using: companion.using,
                withCheck: companion.withCheck,
                adminTarget: undefined,
                adminRequestCompanion: undefined,
                supersedes: undefined
            },
            adminTarget: false,
            adminRequestTarget: true
        }];
    });

/**
 * The per-table RLS plan for the declared collections and their junctions, as
 * executable statements — what the managed runtime applies at boot so a freshly
 * provisioned tenant database serves data instead of 401ing every read.
 *
 * The same policies `policies.sql` carries, from the same plan, so boot and
 * `db push` produce identical RLS from identical collections.
 */
export const planTablePolicies = (
    tables: readonly CompiledTable[],
    options: PolicyPlanOptions = {}
): TablePolicyPlan[] =>
    policyTablesOf(tables).map(table => {
        const policies: PolicyApplyPlan[] = writtenPolicies(table, options).map(({ policy, adminTarget, adminRequestTarget }) => {
            const restrictive = policy.mode === "restrictive";
            return {
                name: policy.name,
                adminTarget,
                ...(adminRequestTarget ? { adminRequestTarget: true as const } : {}),
                restrictive,
                statements: renderPolicyStatements(table, policy),
                ...(restrictive ? { denying: renderDenyingPolicyStatements(table, policy) } : {})
            };
        });
        return {
            schema: table.schema,
            table: table.table,
            qualified: table.qualified,
            enableRls: `ALTER TABLE "${table.schema}"."${table.table}" ENABLE ROW LEVEL SECURITY;`,
            policyStatements: policies.flatMap(policy => policy.statements),
            policies
        };
    });

/**
 * One policy as a boot writes it, as data rather than DDL: the row
 * `pg_policies` holds for it once it is applied, plus the rule it came from.
 */
export interface PlannedPolicy {
    schema: string;
    table: string;
    name: string;
    /** `FOR …`, upper-case as `pg_policies.cmd` spells it. */
    command: "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";
    /** PERMISSIVE policies OR together; RESTRICTIVE ones AND. */
    permissive: boolean;
    /** The `TO` list; `["public"]` for every role. */
    roles: string[];
    /** The compiled `USING` clause, or null when the policy has none. */
    using: string | null;
    /** The compiled `WITH CHECK` clause, or null when the policy has none. */
    withCheck: string | null;
    /**
     * The rule it compiles from: the rule's `name`, or `#<index>` into the
     * table's rules — its declared ones first, then the ones Rebase injects.
     * An admin-request companion carries its base policy's.
     */
    ruleKey: string;
    /** Rebase added the rule (the admin baseline, the auth table's, the tenant scope), not the author. */
    injected: boolean;
    /** A junction table the planner derives for a many-to-many relation, not a declared table. */
    junction: boolean;
}

function policyCommandOf(operation: string): PlannedPolicy["command"] {
    switch (operation) {
        case "all": return "ALL";
        case "select": return "SELECT";
        case "insert": return "INSERT";
        case "update": return "UPDATE";
        case "delete": return "DELETE";
        default: throw new Error(`Internal: a policy was planned for the operation "${operation}", which is not a Postgres policy command.`);
    }
}

/**
 * Every policy a boot writes for the tables and their junctions, as data:
 * the same policies, in the same order, as {@link planTablePolicies} renders
 * to statements. For a caller that reasons about the policies rather than
 * applying them — `rebase verify` reads them to find a policy Postgres would
 * refuse to expand (42P17, "infinite recursion detected in policy").
 */
export const planPolicyDefinitions = (
    tables: readonly CompiledTable[],
    options: PolicyPlanOptions = {}
): PlannedPolicy[] =>
    policyTablesOf(tables).flatMap(table => writtenPolicies(table, options).map(({ policy }) => ({
        schema: table.schema,
        table: table.table,
        name: policy.name,
        command: policyCommandOf(policy.operation),
        permissive: policy.mode !== "restrictive",
        roles: [...policy.roles],
        using: policy.using,
        withCheck: policy.withCheck,
        ruleKey: policy.ruleKey,
        injected: policy.injected,
        junction: table.kind === "junction"
    })));

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
    tables: readonly CompiledTable[]
): GeneratedColumnDependency[] => {
    const dependencies: GeneratedColumnDependency[] = [];
    for (const table of planOf(tables).tables) {
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
