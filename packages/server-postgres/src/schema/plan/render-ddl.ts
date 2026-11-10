/**
 * The SQL files, rendered from a {@link SchemaPlan}.
 *
 * Four files, because Atlas owns exactly one of them:
 *
 * - `schema.sql` — the desired state Atlas diffs the database against.
 * - `policies.sql` — the RLS policies. Atlas has no model for a policy.
 * - `search.sql` — the generated `tsvector` column, its GIN index and the
 *   IMMUTABLE helpers its expression calls. Atlas's free tier refuses to
 *   *parse* a file containing a function, and it wipes the dev database it
 *   diffs against, so a helper seeded there is gone by the time the plan runs.
 * - `vector.sql` — the `vector` columns and their ANN indexes. Atlas cannot
 *   *execute* these: it materialises `schema.sql` in a dev database that is
 *   created empty and emptied again on every run, so `VECTOR(384)` resolves
 *   against a database that structurally cannot have pgvector.
 * - `triggers.sql` — `autoValue: "on_update"`, which is a function plus a
 *   binding, so it is out for the same reason search is.
 *
 * Everything not in `schema.sql` is excluded from Atlas's view by pattern
 * (`…ExcludePatterns` below) and applied by Rebase — at push time by the CLI,
 * at boot by the schema ensure. Without the excludes a desired state that omits
 * an object reads to Atlas as an instruction to drop it.
 */
import { REBASE_ADMIN_REQUEST_ROLE, REBASE_ADMIN_ROLE } from "@rebasepro/types";
import { adminRequestPolicyName } from "@rebasepro/utils";
import { ADMIN_POLICY_ROLE_SQL } from "../rls-bootstrap-sql";
import {
    fuzzyColumnDefinition,
    searchColumnDefinition,
    searchColumnStamps,
    searchExtensionStatements,
    searchHelperFunctions,
    searchIndexNames,
    searchIndexStatements,
    searchStampGuards
} from "../search-column";
import {
    VECTOR_EXTENSION_OPT_IN,
    vectorColumnDefinition,
    vectorDimensionGuard,
    vectorExtensionDeclared,
    vectorExtensionStatement,
    vectorIndexNames,
    vectorIndexStatements
} from "../vector-index";
import { atlasExcludePattern } from "../atlas-exclude";
import { collectionIndexStatements } from "../collection-index";
import { quoteSqlLiteral } from "./plan-schema";
import { triggerStatements } from "./updated-at-trigger";
import { VIEW_ROWS_COMMENT_PREFIX, viewRowsName } from "./view-names";
import { REBASE_USER_ROLE } from "@rebasepro/common";
import type { ColumnPlan, PgType, PolicyPlan, SchemaPlan, TablePlan, ViewPlan } from "./types";

/** What `schema.sql` may leave out, because another file owns it. */
export interface DdlRenderOptions {
    /** RLS policies. `false` puts them in `policies.sql` alone. */
    includePolicies?: boolean;
    /** The search column, its helpers and its index. See `search.sql`. */
    includeSearch?: boolean;
    /** The vector columns and their ANN indexes. See `vector.sql`. */
    includeVector?: boolean;
}

/**
 * A {@link PgType} as Postgres spells it.
 *
 * The one place. `getSqlColumnType` and `getDrizzleColumn` each carried their
 * own ladder and disagreed about `VARCHAR` widths, about `geopoint`, and about
 * whether an `increment` id honours `columnType`.
 */
export const renderPgType = (type: PgType): string => {
    switch (type.kind) {
        case "text": return "TEXT";
        case "varchar": return `VARCHAR(${type.length})`;
        case "char": return `CHAR(${type.length})`;
        case "uuid": return "UUID";
        case "enum": return `"${type.schema}"."${type.name}"`;
        case "smallint": return "SMALLINT";
        case "integer": return "INTEGER";
        case "bigint": return "BIGINT";
        case "smallserial": return "SMALLSERIAL";
        case "serial": return "SERIAL";
        case "bigserial": return "BIGSERIAL";
        case "real": return "REAL";
        case "doublePrecision": return "DOUBLE PRECISION";
        case "numeric":
            if (type.precision === undefined) return "NUMERIC";
            return type.scale === undefined
                ? `NUMERIC(${type.precision})`
                : `NUMERIC(${type.precision}, ${type.scale})`;
        case "boolean": return "BOOLEAN";
        case "timestamptz": return "TIMESTAMP WITH TIME ZONE";
        case "date": return "DATE";
        case "time": return "TIME";
        case "json": return "JSON";
        case "jsonb": return "JSONB";
        case "vector": return `VECTOR(${type.dimensions})`;
        case "bytea": return "BYTEA";
        case "tsvector": return "tsvector";
        case "array": return `${renderPgType(type.of)}[]`;
    }
};

/**
 * Everything after the column name, in one order for every SQL emitter.
 *
 * `CREATE TABLE` and `ADD COLUMN` used to assemble this separately, which is
 * how a required relation column came out `NOT NULL` after `db push` and
 * nullable after a boot-ensure. `identity` is part of the type rather than a
 * DEFAULT, which is why it is rendered here and not in the DEFAULT slot.
 */
export const renderColumnDefinition = (column: ColumnPlan): string => {
    // `auth-users-columns` is the single description of what an auth user
    // table's columns must be, and it hands over a rendered definition.
    if (column.sqlDefinition) return column.sqlDefinition;

    if (column.generated) {
        return `${renderPgType(column.type)} GENERATED ALWAYS AS (${column.generated.expression}) STORED`;
    }

    let definition = renderPgType(column.type);
    if (column.default?.kind === "identity") definition += " GENERATED BY DEFAULT AS IDENTITY";
    if (column.primaryKey) definition += " PRIMARY KEY";
    if (column.unique) definition += " UNIQUE";
    if (column.default && column.default.kind !== "identity") {
        definition += ` DEFAULT ${column.default.kind === "sql" ? column.default.expression : column.default.sql}`;
    }
    if (!column.nullable && !column.primaryKey) definition += " NOT NULL";
    return definition;
};

/**
 * `PRIMARY KEY ("a", "b")`, the clause a composite key takes inside a
 * `CREATE TABLE`. Shared by `schema.sql` and boot-ensure's `CREATE TABLE`, so
 * the two cannot list the columns differently.
 */
export const renderPrimaryKeyConstraint = (table: Pick<TablePlan, "primaryKey">): string =>
    `PRIMARY KEY (${table.primaryKey.map(c => `"${c}"`).join(", ")})`;

/** `"col" TYPE …`, as it appears inside a `CREATE TABLE`. */
const renderColumn = (column: ColumnPlan): string =>
    `"${column.column}" ${renderColumnDefinition(column)}`;

// ── Policies ─────────────────────────────────────────────────────────────────

/**
 * One policy as its `DROP` / `CREATE` pair — each a complete statement.
 *
 * This is the primitive the boot-time RLS applier runs one statement at a time
 * (the runtime's DB handle speaks the extended query protocol, which forbids
 * multiple commands in one execute), while `db push` writes the joined string.
 */
export const renderPolicyStatements = (
    table: Pick<TablePlan, "schema" | "table">,
    policy: PolicyPlan
): string[] => {
    const target = `"${table.schema}"."${table.table}"`;
    let create = `CREATE POLICY "${policy.name}" ON ${target} AS ${policy.mode.toUpperCase()} ` +
        `FOR ${policy.operation.toUpperCase()} TO ${policy.roles.map(r => `"${r}"`).join(", ")}`;
    if (policy.using) create += ` USING (${policy.using})`;
    if (policy.withCheck) create += ` WITH CHECK (${policy.withCheck})`;
    // The one policy an older naming stored this rule's operations under —
    // see `PolicyPlan.supersedes`. In the same per-table transaction, so a
    // request sees the old policy or the new ones, never neither.
    const superseded = (policy.supersedes ?? []).map(name => `DROP POLICY IF EXISTS "${name}" ON ${target};`);
    // The admin-request companion a boot may have written beside this policy
    // (`USING (true)` for every admin) goes with it unless the policy, as
    // written now, still earns one: a rule narrowed to `admin AND owner`, moved
    // TO public, or changed in any way that keeps its name must not leave
    // every admin reading every row. Here rather than in the boot alone, so
    // `db push`, a migration and a boot that provisions nothing all drop it.
    //
    // A policy that does earn one keeps it — unless the one there was written
    // for something else under the same name: a named rule moved from SELECT
    // to DELETE keeps its name, and the SELECT companion would go on admitting
    // every admin to every row nobody may read now. Dropped then, by a check in
    // the statement itself, so the DDL heals whoever runs it.
    const keepsCompanion = policy.adminRequestCompanion !== undefined && policy.roles.includes(REBASE_ADMIN_ROLE);
    const isCompanion = policy.roles.includes(REBASE_ADMIN_REQUEST_ROLE);
    const companionName = adminRequestPolicyName(policy.name);
    const companion = isCompanion
        ? []
        : keepsCompanion
            ? [mismatchedCompanionDropSql(table, companionName, policy.operation)]
            : [`DROP POLICY IF EXISTS "${companionName}" ON ${target};`];
    return [...superseded, ...companion, `DROP POLICY IF EXISTS "${policy.name}" ON ${target};`, `${create};`];
};

/**
 * Drop the companion `name` on the table unless it is exactly what a boot
 * writes for a policy of this operation: permissive, `TO rebase_admin_request`
 * alone, `FOR <operation>`, its clauses `true` or absent. One `DO` statement,
 * so it runs on a handle that refuses several commands in one string.
 */
function mismatchedCompanionDropSql(table: Pick<TablePlan, "schema" | "table">, name: string, operation: string): string {
    const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const ident = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    // One line, as every policy statement is: the boot sends a table's
    // statements joined by newlines, one per line.
    return `DO $rebase_companion$ BEGIN IF EXISTS (SELECT 1 FROM pg_policies p ` +
        `WHERE p.schemaname = ${literal(table.schema)} AND p.tablename = ${literal(table.table)} AND p.policyname = ${literal(name)} ` +
        `AND NOT (p.cmd = ${literal(operation.toUpperCase())} AND p.permissive = 'PERMISSIVE' ` +
        `AND p.roles = ARRAY[${literal(REBASE_ADMIN_REQUEST_ROLE)}]::name[] ` +
        `AND COALESCE(p.qual, 'true') = 'true' AND COALESCE(p.with_check, 'true') = 'true')) ` +
        `THEN EXECUTE ${literal(`DROP POLICY ${ident(name)} ON ${ident(table.schema)}.${ident(table.table)}`)}; END IF; END $rebase_companion$;`;
}

/**
 * A restrictive policy, under its own name, command and roles, that passes no
 * row: `USING (false)` / `WITH CHECK (false)` for the clauses its command takes.
 *
 * What the boot applier puts in place of a restrictive policy whose own
 * `CREATE` failed. A restrictive policy is a gate ANDed over every permissive
 * one, so its absence does not deny — it opens whatever the permissive policies
 * grant. Standing in for it with a gate nothing passes keeps the failure on
 * the denying side until the rule can be created.
 */
export const renderDenyingPolicyStatements = (
    table: Pick<TablePlan, "schema" | "table">,
    policy: PolicyPlan
): string[] => {
    const target = `"${table.schema}"."${table.table}"`;
    let create = `CREATE POLICY "${policy.name}" ON ${target} AS RESTRICTIVE ` +
        `FOR ${policy.operation.toUpperCase()} TO ${policy.roles.map(r => `"${r}"`).join(", ")}`;
    if (policy.operation !== "insert") create += " USING (false)";
    if (policy.operation !== "select" && policy.operation !== "delete") create += " WITH CHECK (false)";
    return [`DROP POLICY IF EXISTS "${policy.name}" ON ${target};`, `${create};`];
};

/** `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` — every generated table is locked. */
export const renderEnableRls = (table: Pick<TablePlan, "schema" | "table">): string =>
    `ALTER TABLE "${table.schema}"."${table.table}" ENABLE ROW LEVEL SECURITY;`;

const statementsToDdl = (statements: string[]): string => statements.map(s => `${s}\n`).join("");

// ── schema.sql ───────────────────────────────────────────────────────────────

export function renderPostgresDdl(plan: SchemaPlan, options: DdlRenderOptions = {}): string {
    const includePolicies = options.includePolicies !== false;
    const includeSearch = options.includeSearch !== false;
    const includeVector = options.includeVector !== false;

    let ddl = "-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.\n\n";

    // 1. Custom schemas.
    //
    // `rebase` is unconditional and load-bearing. The RLS helper functions live
    // in it, so the migration preamble creates it — which puts it in Atlas's
    // replayed state, and anything in that state but absent from this desired
    // schema gets a `DROP SCHEMA … CASCADE` planned against it. That would take
    // the auth tables.
    plan.schemas.forEach(schema => { ddl += `CREATE SCHEMA IF NOT EXISTS "${schema}";\n`; });
    if (plan.schemas.length > 0) ddl += "\n";

    // 1b. Search support, for collections that opted in.
    //
    // Extensions and helper functions come before every CREATE TABLE because a
    // generated column's expression is resolved at creation time: a table whose
    // search column calls `rebase_search_text` cannot be created before that
    // function exists. Both are `IF NOT EXISTS` / `OR REPLACE`, so a file
    // replayed against a live database is a no-op here.
    const searchTables = plan.tables.filter(t => t.search);
    if (searchTables.length > 0) {
        if (!includeSearch) {
            ddl += "-- Full-text search support lives in `search.sql`, applied separately.\n\n";
        } else {
            const extensions = Array.from(new Set(searchTables.flatMap(t => searchExtensionStatements(t.search!))));
            const helpers = Array.from(new Set(searchTables.flatMap(t => searchHelperFunctions(t.search!))));
            ddl += "-- Full-text search support (collections declaring a `search` block)\n";
            extensions.forEach(s => { ddl += `${s}\n`; });
            if (extensions.length > 0) ddl += "\n";
            helpers.forEach(s => { ddl += `${s}\n\n`; });
        }
    }

    // 1c. Vector support. Only ever a note, never a statement — unlike 1b.
    // `CREATE EXTENSION vector` is the one thing this file must never carry
    // whichever way the flag goes: Atlas rejects an extension in a desired
    // state as a paid feature.
    if (!includeVector && plan.tables.some(t => t.vectorColumns.length > 0)) {
        ddl += "-- Vector columns and their ANN indexes live in `vector.sql`, applied separately.\n\n";
    }

    // 1d. `autoValue: "on_update"`. A trigger is a function plus a binding, so
    // it is out of Atlas's sight for the reason search is — and out
    // unconditionally, because `schema.sql` has no flag that would make Atlas
    // able to read one.
    if (plan.tables.some(t => t.triggers.length > 0)) {
        ddl += "-- `autoValue: \"on_update\"` triggers live in `triggers.sql`, applied separately.\n\n";
    }

    // 2. Enum types.
    plan.enums.forEach(enumPlan => {
        ddl += `CREATE TYPE "${enumPlan.schema}"."${enumPlan.name}" AS ENUM (${enumPlan.labels.map(quoteSqlLiteral).join(", ")});\n`;
    });
    if (ddl.endsWith(";\n")) ddl += "\n";

    // 3. Tables, in the plan's order — each collection, then any junction its
    //    relations imply.
    const fkStatements: string[] = [];
    // Indexes follow the tables for the same reason the FK constraints do: the
    // table has to exist first.
    const indexStatements: string[] = [];
    // Policies are emitted after every CREATE TABLE, like the FK constraints: a
    // policy may reference other tables (a junction's derived policies always
    // reference both endpoints; `policy.existsIn` references a join table), and
    // CREATE POLICY validates those relations at creation time.
    const policyStatements: string[] = [];

    for (const table of plan.tables) {
        const emitted = table.columns.filter(column => {
            // A vector column is not Atlas's — `vector.sql` adds it. Filtered
            // here rather than upstream so the column keeps its place in the
            // generator's order when it *is* included, which is what the
            // derived-names contract renders.
            if (!includeVector && column.type.kind === "vector") return false;
            if (!includeSearch && column.source.kind === "search") return false;
            // A declared property already emits this column (an explicit
            // `postId` beside the `belongsTo` that uses it); the relation
            // contributes only the constraint.
            if (column.columnOwnedByProperty) return false;
            return true;
        });

        ddl += `CREATE TABLE "${table.schema}"."${table.table}" (\n`;
        const lines = emitted.map(column => `  ${renderColumn(column)}`);
        // A key over several columns — a junction's two endpoints, or a
        // collection with several `isId` properties — is one table constraint;
        // a single-column key is already inline on its column.
        if (table.primaryKey.length > 1) {
            lines.push(`  ${renderPrimaryKeyConstraint(table)}`);
        }
        ddl += lines.join(",\n");
        ddl += "\n);\n\n";

        for (const column of table.columns) {
            if (column.foreignKey) fkStatements.push(`${column.foreignKey.sql};`);
        }

        if (includeSearch && table.search) {
            indexStatements.push(...searchIndexStatements(table.search));
        }
        // ANN indexes are emitted with the other indexes rather than inline,
        // because `CREATE INDEX` is a statement and a column definition is not
        // — and because a column too wide for pgvector to index still needs its
        // column. Absent alongside their column when vector is carved out.
        if (includeVector && table.vector) {
            indexStatements.push(...vectorIndexStatements(table.vector));
            for (const skip of table.vector.skipped) {
                indexStatements.push(`-- No ANN index on "${skip.schema}"."${skip.table}"."${skip.column}": ${skip.reason}`);
            }
        }
        // The collection's own `indexes:` block. Last of the three index
        // producers, and the only one the developer wrote deliberately rather
        // than getting as a side effect of another feature.
        indexStatements.push(...collectionIndexStatements(table.indexes));

        if (includePolicies) {
            // No FORCE: authenticated requests run as the non-owner
            // `rebase_user` role, which plain ENABLE already binds. The owner
            // (server context) must bypass — it is the trusted plane.
            ddl += `${renderEnableRls(table)}\n`;
            ddl += "\n";
            for (const policy of table.policies) {
                policyStatements.push(statementsToDdl(renderPolicyStatements(table, policy)));
            }
        }
    }

    // Indexes before foreign keys. Today every FK targets a primary key created
    // inline, so the order is safe by accident; the moment a declared
    // `unique: true` index can back an FK target, a constraint emitted first
    // would reference an index that does not exist yet.
    if (indexStatements.length > 0) {
        ddl += "-- Indexes\n";
        ddl += indexStatements.join("\n") + "\n\n";
    }

    if (fkStatements.length > 0) {
        ddl += "-- Foreign Key Constraints\n";
        ddl += fkStatements.join("\n") + "\n\n";
    }

    if (policyStatements.length > 0) {
        ddl += "-- Row Level Security Policies\n";
        ddl += adminRolePreamble(plan);
        ddl += policyStatements.join("");
        ddl += "\n";
    }

    return ddl;
}

// ── policies.sql ─────────────────────────────────────────────────────────────

/**
 * The statement that creates `rebase_admin`, when a policy in the plan is
 * written `TO` it — so a file of policies is self-contained, as it is for the
 * RLS helpers: CREATE POLICY refuses a role that does not exist. Empty when no
 * policy names it (`rls.adminPolicies: "public"`).
 */
export function adminRolePreamble(plan: SchemaPlan): string {
    const named = plan.tables.some(table => table.policies.some(policy => policy.roles.includes(REBASE_ADMIN_ROLE)));
    return named ? `${ADMIN_POLICY_ROLE_SQL};\n\n` : "";
}

export function renderPoliciesDdl(plan: SchemaPlan): string {
    let ddl = "-- This file contains RLS policies generated by Rebase. Applied separately from migrations.\n\n";
    ddl += adminRolePreamble(plan);

    // Collections first, then the junctions no collection declares — the order
    // the boot-time applier plans them in.
    for (const table of plan.tables.filter(t => t.kind === "collection")) {
        ddl += `${renderEnableRls(table)}\n`;
        ddl += "\n";
        if (table.policies.length === 0) continue;
        let announced: string | undefined;
        for (const policy of table.policies) {
            // Say which policies the author did not write. They are permissive,
            // so they OR with the declared rules and widen the final ACL beyond
            // what `securityRules` reads like — and re-appear after any manual
            // DROP, because a push asserts the declared state. Once per *rule*:
            // one rule with four operations is one thing the author did not
            // write, not four.
            if (policy.injected && policy.ruleKey !== announced) {
                ddl += "-- Injected by Rebase (not from this collection's securityRules).\n";
                ddl += `-- Set \`disableDefaultPolicies: true\` on "${table.slug}" to drop these and own its RLS outright.\n`;
            }
            announced = policy.ruleKey;
            ddl += statementsToDdl(renderPolicyStatements(table, policy));
        }
        ddl += "\n";
    }

    for (const table of plan.tables.filter(t => t.kind === "junction")) {
        ddl += `${renderEnableRls(table)}\n`;
        ddl += "\n";
        if (table.policies.length === 0) continue;
        const declaringSlugs = (table.declaringSlugs ?? []).join('", "');
        ddl += `-- Derived by Rebase for the junction "${table.table}" (no collection declares it).\n`;
        ddl += "-- Reads require both endpoint rows to be visible; writes follow the update\n";
        ddl += `-- rules of "${declaringSlugs}". Set \`disableDefaultPolicies: true\` on the\n`;
        ddl += "-- declaring collection(s) to drop these and police the junction yourself.\n";
        for (const policy of table.policies) {
            ddl += statementsToDdl(renderPolicyStatements(table, policy));
        }
        ddl += "\n";
    }

    return ddl;
}

// ── search.sql ───────────────────────────────────────────────────────────────

export function renderSearchDdl(plan: SchemaPlan): string {
    const tables = plan.tables.filter(t => t.search);
    if (tables.length === 0) return "";

    const extensions = Array.from(new Set(tables.flatMap(t => searchExtensionStatements(t.search!))));
    const helpers = Array.from(new Set(tables.flatMap(t => searchHelperFunctions(t.search!))));

    let ddl = "-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.\n";
    ddl += "--\n";
    ddl += "-- Full-text search for the collections declaring a `search` block.\n";
    ddl += "-- Applied by Rebase, not by Atlas — see generatePostgresSearchDdl.\n\n";

    extensions.forEach(s => { ddl += `${s}\n`; });
    if (extensions.length > 0) ddl += "\n";
    helpers.forEach(s => { ddl += `${s}\n\n`; });

    for (const table of tables) {
        const spec = table.search!;
        const target = `"${table.schema}"."${table.table}"`;
        // ADD COLUMN IF NOT EXISTS rather than the inline definition the
        // CREATE TABLE would use: by the time this runs the table exists,
        // whether Atlas just created it or it has been live for a year. The
        // guard first, because `ADD COLUMN IF NOT EXISTS` is a no-op against an
        // existing column — without it the file would report success, leave the
        // old expression in place, and then stamp it as current.
        searchStampGuards(spec).forEach(s => { ddl += `${s}\n`; });
        ddl += `ALTER TABLE ${target} ADD COLUMN IF NOT EXISTS ${searchColumnDefinition(spec)};\n`;
        const fuzzy = fuzzyColumnDefinition(spec);
        if (fuzzy) ddl += `ALTER TABLE ${target} ADD COLUMN IF NOT EXISTS ${fuzzy};\n`;
        searchColumnStamps(spec).forEach(s => { ddl += `${s.sql}\n`; });
        searchIndexStatements(spec).forEach(s => { ddl += `${s}\n`; });
        ddl += "\n";
    }

    return ddl;
}

/**
 * Glob patterns telling Atlas to leave an object alone.
 *
 * Fully qualified, `schema.table.object`, matching the include list. The
 * two-part form is what Atlas wants when the connection URL scopes it to one
 * schema and is *silently ignored* otherwise: it reads `posts.search_vector` as
 * a table named `search_vector` in a schema named `posts`, matches nothing, and
 * reports no error for the pattern that never fired. Each name is spelled by
 * `atlasExcludePattern`, so one holding a `.` or glob syntax still matches.
 */
export const searchExcludePatternsOf = (plan: SchemaPlan): string[] => {
    const patterns: string[] = [];
    for (const table of plan.tables) {
        if (!table.search) continue;
        for (const column of table.columns) {
            if (column.source.kind !== "search") continue;
            patterns.push(atlasExcludePattern(table.schema, table.table, column.column));
        }
        for (const index of searchIndexNames(table.search)) {
            patterns.push(atlasExcludePattern(table.schema, table.table, index));
        }
    }
    return patterns;
};

// ── vector.sql ───────────────────────────────────────────────────────────────

export function renderVectorDdl(plan: SchemaPlan): string {
    const tables = plan.tables.filter(t => t.vectorColumns.length > 0);
    if (tables.length === 0) return "";

    let ddl = "-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.\n";
    ddl += "--\n";
    ddl += "-- Vector columns and their ANN indexes, for the collections declaring a\n";
    ddl += "-- `vector` property. Applied by Rebase, not by Atlas — see\n";
    ddl += "-- generatePostgresVectorDdl.\n\n";
    // The note is not decoration. Someone reading this file after a failed push
    // is looking for the reason the type does not exist, and "no CREATE
    // EXTENSION here" is invisible unless it is written down.
    ddl += vectorExtensionDeclared(plan.options.databaseExtensions)
        ? `${vectorExtensionStatement()}\n\n`
        : "-- pgvector is not installed from here: no database declared it. To let Rebase\n" +
          `-- install it, add ${VECTOR_EXTENSION_OPT_IN} in config/resources.ts.\n` +
          "-- Otherwise install it once by hand; the column below needs the type either way.\n\n";

    for (const table of tables) {
        const target = `"${table.schema}"."${table.table}"`;
        for (const spec of table.vectorColumns) {
            // Guard before the ADD, so a changed `dimensions` is reported
            // rather than skipped over — see `vectorDimensionGuard`.
            ddl += `${vectorDimensionGuard(spec)}\n`;
            ddl += `ALTER TABLE ${target} ADD COLUMN IF NOT EXISTS ${vectorColumnDefinition(spec)};\n`;
        }
        if (table.vector) {
            vectorIndexStatements(table.vector).forEach(s => { ddl += `${s}\n`; });
            for (const skip of table.vector.skipped) {
                ddl += `-- No ANN index on "${skip.schema}"."${skip.table}"."${skip.column}": ${skip.reason}\n`;
            }
        }
        ddl += "\n";
    }

    return ddl;
}

/** @see searchExcludePatternsOf */
export const vectorExcludePatternsOf = (plan: SchemaPlan): string[] => {
    const patterns: string[] = [];
    for (const table of plan.tables) {
        const names = [
            ...table.vectorColumns.map(spec => spec.column),
            ...(table.vector ? vectorIndexNames(table.vector) : [])
        ];
        for (const name of names) patterns.push(atlasExcludePattern(table.schema, table.table, name));
    }
    return patterns;
};

// ── triggers.sql ─────────────────────────────────────────────────────────────

/**
 * `autoValue: "on_update"`, as the file Rebase applies itself.
 *
 * Empty when nothing declares one — the caller writes no file then, and removes
 * a stale one.
 */
export function renderTriggersDdl(plan: SchemaPlan): string {
    const tables = plan.tables.filter(t => t.triggers.length > 0);
    if (tables.length === 0) return "";

    let ddl = "-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.\n";
    ddl += "--\n";
    ddl += "-- `updated_at` triggers, for the properties declaring `autoValue: \"on_update\"`,\n";
    ddl += "-- and the triggers that keep a row in its tenant.\n";
    ddl += "-- Applied by Rebase, not by Atlas — a trigger is a function plus a binding,\n";
    ddl += "-- and Atlas's free tier refuses to parse a desired state containing one.\n\n";

    for (const statement of plan.functions.filter(isTriggerFunction)) {
        ddl += `${statement}\n\n`;
    }
    for (const table of tables) {
        for (const trigger of table.triggers) {
            triggerStatements(trigger).forEach(s => { ddl += `${s}\n`; });
        }
        ddl += "\n";
    }
    return ddl;
}

const isTriggerFunction = (statement: string): boolean => statement.includes("RETURNS trigger");

/** @see searchExcludePatternsOf */
export const triggerExcludePatternsOf = (plan: SchemaPlan): string[] =>
    plan.tables.flatMap(table => table.triggers.map(t => atlasExcludePattern(table.schema, table.table, t.name)));

const quoteIdentifier = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;

/** The comment a view Rebase created carries: `rebase:view:<hash>`. */
export const viewComment = (view: ViewPlan): string => `rebase:view:${view.hash}`;

/** A dollar-quote tag the text does not contain, so the text can be quoted whole. */
function dollarTag(text: string): string {
    let tag = "$rebase_view$";
    for (let i = 1; text.includes(tag); i++) tag = `$rebase_view_${i}$`;
    return tag;
}

/**
 * The statements that create one view as planned, comment included, for
 * `EXECUTE`. A plain view runs as the caller (`security_invoker`), so the
 * policies of the tables it reads decide what each caller sees.
 *
 * A materialized view is two objects (see `view-names.ts`): its rows, stored
 * under {@link viewRowsName} with a unique index on the id columns (which
 * `REFRESH … CONCURRENTLY` needs), and the gate under the collection's name —
 * a `security_barrier` view that reads them with the owner's rights and serves
 * them to the collection's roles and to the server (no uid). It reads the
 * settings directly rather than through `rebase.roles()`, which a first boot
 * creates after the views. It carries each row's `xmin`, for `fingerprint()`;
 * the catalogue reader leaves that column out of the collection.
 */
export function viewCreateStatements(view: ViewPlan): string[] {
    const qualified = `${quoteIdentifier(view.schema)}.${quoteIdentifier(view.name)}`;
    if (!view.materialized) {
        return [
            `CREATE VIEW ${qualified} WITH (security_invoker = true) AS\n${view.query}`,
            `COMMENT ON VIEW ${qualified} IS '${viewComment(view)}'`
        ];
    }
    const stored = `${quoteIdentifier(view.schema)}.${quoteIdentifier(viewRowsName(view.name))}`;
    const roles = view.roles.map(role => `'${role.replace(/'/g, "''")}'`).join(", ");
    const statements = [`CREATE MATERIALIZED VIEW ${stored} AS\n${view.query}\nWITH DATA`];
    if (view.idColumns.length > 0) {
        statements.push(`CREATE UNIQUE INDEX ${quoteIdentifier(`${view.name}_rebase_id`)} ON ${stored} (${view.idColumns.map(quoteIdentifier).join(", ")})`);
    }
    statements.push(...view.indexes);
    statements.push(
        `COMMENT ON MATERIALIZED VIEW ${stored} IS '${VIEW_ROWS_COMMENT_PREFIX}${view.hash}'`,
        `REVOKE ALL ON ${stored} FROM PUBLIC`,
        `CREATE VIEW ${qualified} WITH (security_barrier = true) AS\n` +
        `SELECT rows.*, rows.xmin AS xmin FROM ${stored} rows\n` +
        "WHERE NULLIF(current_setting('app.uid', true), '') IS NULL\n" +
        `   OR string_to_array(COALESCE(current_setting('app.user_roles', true), ''), ',') && ARRAY[${roles || "NULL"}]::text[]`,
        `COMMENT ON VIEW ${qualified} IS '${viewComment(view)}'`
    );
    return statements;
}

/**
 * `views.sql`: the views of the collections that declare one, as the file
 * Rebase applies itself — Atlas manages no views on its free tier.
 *
 * Idempotent, in two passes. The first drops, last first, every view whose
 * comment no longer matches its plan and every view that reads one of those
 * (Postgres will not drop a view another still reads, and will not change a
 * view's columns in place); the second creates, in order, every view that is
 * not there. A view that is up to date is left alone, rows and all. A table or
 * a view Rebase did not create under the same name is refused, never dropped.
 *
 * Empty when no collection declares a view.
 */
export function renderViewsDdl(plan: SchemaPlan): string {
    if (plan.views.length === 0) return "";
    const literal = (text: string) => `'${text.replace(/'/g, "''")}'`;
    const regclass = (view: ViewPlan) => `to_regclass(${literal(`${quoteIdentifier(view.schema)}.${quoteIdentifier(view.name)}`)})`;
    const stale = (view: ViewPlan) =>
        `(${regclass(view)} IS NOT NULL AND obj_description(${regclass(view)}, 'pg_class') IS DISTINCT FROM ${literal(viewComment(view))})`;
    // Every planned view a view reads, directly or through another.
    const readsOf = (view: ViewPlan, seen = new Set<string>()): ViewPlan[] =>
        view.dependsOn.flatMap(name => {
            if (seen.has(name)) return [];
            seen.add(name);
            const target = plan.views.find(other => other.qualified === name);
            return target ? [target, ...readsOf(target, seen)] : [];
        });

    let ddl = "-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.\n";
    ddl += "--\n";
    ddl += "-- The views of the collections that declare `view`. Applied by Rebase, not by Atlas.\n\n";
    ddl += "DO $rebase_views$\nDECLARE\n    kind \"char\";\n    note text;\nBEGIN\n";
    for (const view of [...plan.views].reverse()) {
        const qualified = `${quoteIdentifier(view.schema)}.${quoteIdentifier(view.name)}`;
        const reasons = [view, ...readsOf(view)].map(stale).join("\n        OR ");
        ddl += `    SELECT c.relkind, obj_description(c.oid, 'pg_class') INTO kind, note FROM pg_class c WHERE c.oid = ${regclass(view)};\n`;
        ddl += "    IF kind IS NOT NULL AND (kind NOT IN ('v', 'm') OR note IS NULL OR note NOT LIKE 'rebase:view:%') THEN\n";
        ddl += `        RAISE EXCEPTION 'Rebase will not replace %: it is a table or a view Rebase did not create. Rename or drop it, or give the collection another table.', ${literal(view.qualified)};\n`;
        ddl += "    END IF;\n";
        ddl += `    IF ${reasons} THEN\n`;
        ddl += `        IF kind = 'm' THEN EXECUTE ${literal(`DROP MATERIALIZED VIEW ${qualified}`)}; ELSE EXECUTE ${literal(`DROP VIEW ${qualified}`)}; END IF;\n`;
        ddl += "    END IF;\n";
    }
    for (const view of plan.views) {
        const rows = `${quoteIdentifier(view.schema)}.${quoteIdentifier(viewRowsName(view.name))}`;
        ddl += `    IF ${regclass(view)} IS NULL THEN\n`;
        // A gate that is gone leaves its rows: they are this view's, recomputed below.
        if (view.materialized) {
            ddl += `        IF to_regclass(${literal(rows)}) IS NOT NULL THEN EXECUTE ${literal(`DROP MATERIALIZED VIEW ${rows}`)}; END IF;\n`;
        }
        for (const statement of viewCreateStatements(view)) {
            const tag = dollarTag(statement);
            ddl += `        EXECUTE ${tag}${statement}${tag};\n`;
        }
        if (view.materialized) {
            ddl += `        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(REBASE_USER_ROLE)}) THEN EXECUTE ${literal(`REVOKE ALL ON ${rows} FROM ${REBASE_USER_ROLE}`)}; END IF;\n`;
        }
        ddl += "    END IF;\n";
    }
    ddl += "END\n$rebase_views$;\n";
    return ddl;
}
