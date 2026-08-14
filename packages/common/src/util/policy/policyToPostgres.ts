import { ANONYMOUS_USER_IDS, CollectionConfig, PolicyExpression, PolicyOperand, PolicyCompareOperator, Property, ExistsInPolicyExpression, RLS_ROLES_SQL, RLS_UID_SQL, rewriteLegacyRlsFunctions } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";
import { getTableName } from "../relations";

/**
 * Options for {@link policyToPostgres}.
 */
export interface PolicyCompileOptions {
    /**
     * Resolve a collection by slug. Required to compile
     * {@link ExistsInPolicyExpression} (`policy.existsIn`) — the compiler needs
     * the joined collection to derive its table name / schema. When omitted, the
     * join table falls back to a snake_cased slug.
     */
    resolveCollection?: (slug: string) => CollectionConfig | undefined;
}

/**
 * The lexical scope threaded through compilation. It changes when we descend
 * into an `existsIn` subquery: inside it, `field` refers to the joined table
 * (aliased) while `outerField` refers to the outer RLS row (table-qualified).
 */
interface CompileScope {
    /** Collection whose columns a bare `field` operand resolves against. */
    fieldCollection?: CollectionConfig;
    /** SQL prefix for `field` operands (`""` at top level, `"alias".` in a subquery). */
    fieldPrefix: string;
    /** The outer RLS collection, for `outerField` operands. */
    outerCollection?: CollectionConfig;
    /** SQL prefix for `outerField` operands (`""` at top level, `"schema"."table".` in a subquery). */
    outerPrefix: string;
    resolveCollection?: (slug: string) => CollectionConfig | undefined;
    /** Monotonic counter for generating unique subquery aliases. */
    alias: { n: number };
}

/**
 * Compiles a {@link PolicyExpression} to a PostgreSQL boolean SQL string,
 * suitable for a `USING (...)` / `WITH CHECK (...)` clause.
 *
 * This is one of the two consumers of the shared policy model (the other being
 * {@link evaluatePolicy}); the Postgres schema generators call it so that DDL
 * and the admin UI derive from the exact same expression.
 */
export function policyToPostgres(expr: PolicyExpression, collection?: CollectionConfig, options?: PolicyCompileOptions): string {
    return compile(expr, {
        fieldCollection: collection,
        fieldPrefix: "",
        outerCollection: collection,
        outerPrefix: "",
        resolveCollection: options?.resolveCollection,
        alias: { n: 0 }
    });
}

function compile(expr: PolicyExpression, scope: CompileScope): string {
    switch (expr.kind) {
        case "true":
            return "true";
        case "false":
            return "false";
        case "and":
            return expr.operands.length === 0
                ? "true"
                : expr.operands.map(o => `(${compile(o, scope)})`).join(" AND ");
        case "or":
            return expr.operands.length === 0
                ? "false"
                : expr.operands.map(o => `(${compile(o, scope)})`).join(" OR ");
        case "not":
            return `NOT (${compile(expr.operand, scope)})`;
        case "compare": {
            // `rebase.uid()` returns text; cast the column side so uuid / integer
            // id columns compare cleanly instead of failing with
            // "operator does not exist: uuid = text" at CREATE POLICY time.
            const castForAuthUid = (operand: PolicyOperand, sqlText: string, other: PolicyOperand): string =>
                other.kind === "authUid" && (operand.kind === "field" || operand.kind === "outerField")
                    ? `(${sqlText})::text`
                    : sqlText;
            const leftSql = castForAuthUid(expr.left, operandToSql(expr.left, scope), expr.right);
            const rightSql = castForAuthUid(expr.right, operandToSql(expr.right, scope), expr.left);
            return `${leftSql} ${COMPARE_SQL[expr.op]} ${rightSql}`;
        }
        case "rolesOverlap":
            return `string_to_array(${RLS_ROLES_SQL}, ',') && ${rolesArraySql(expr.roles)}`;
        case "rolesContain":
            return `string_to_array(${RLS_ROLES_SQL}, ',') @> ${rolesArraySql(expr.roles)}`;
        case "authenticated":
            // `IS NOT NULL` alone is a tautology on the user path: every
            // user-context request sets `app.uid`, and an anonymous one sets
            // it to a sentinel. Excluding the sentinels is what makes this mean
            // "signed in" rather than "anyone at all".
            //
            // Every sentinel, not just the current one. This clause is written
            // into the database and outlives the server that generated it: a
            // policy compiled here may be enforced against an older server that
            // still reports `'anon'`, which is exactly how excluding one
            // spelling turned this helper into a grant. See ANONYMOUS_USER_IDS.
            return `${RLS_UID_SQL} IS NOT NULL AND ${RLS_UID_SQL} NOT IN (${ANONYMOUS_USER_IDS.map(quoteLiteral).join(", ")})`;
        case "serverContext":
            // Only the built-in server flows leave `app.uid` unset.
            return `${RLS_UID_SQL} IS NULL`;
        case "existsIn":
            return compileExistsIn(expr, scope);
        case "raw": {
            // A project written against a pre-1.0 release may still spell the
            // helpers `auth.uid()`. Rewritten rather than rejected: the rule
            // means exactly the same thing, the developer cannot be expected to
            // have read a changelog mid-deploy, and the alternative is a policy
            // that compiles cleanly and then denies every row at runtime because
            // it calls a function that no longer exists.
            //
            // The counterpart is `warnOnLegacyRlsFunctions`, which says so once
            // at boot with the file to edit — silence here would leave the old
            // spelling working forever and make the migration permanent.
            const sqlText = rewriteLegacyRlsFunctions(expr.sql);

            // Full-power escape hatch: `{column}` denotes a column of the outer
            // RLS row. It must be table-qualified, not bare: raw SQL may open its
            // own subquery over the same table, and there a bare name binds to the
            // inner scope, collapsing `m.x = {x}` into the tautology `m.x = m.x`.
            return sqlText.replace(/\{(\w+)\}/g, (_, col) =>
                `${outerQualifier(scope)}${resolveColumnName(col, scope.outerCollection)}`);
        }
    }
}

/**
 * Compiles `existsIn` to a correlated `EXISTS (SELECT 1 FROM <join> WHERE ...)`.
 * Inside the subquery, `field` operands bind to the aliased join table and
 * `outerField` operands bind to the (table-qualified) outer RLS row.
 */
function compileExistsIn(expr: ExistsInPolicyExpression, scope: CompileScope): string {
    const join = scope.resolveCollection?.(expr.collection);
    const joinTable = join ? getTableName(join) : toSnakeCase(expr.collection);
    const joinSchema = schemaOf(join) ?? schemaOf(scope.outerCollection) ?? "public";
    const alias = `_ex${scope.alias.n++}`;

    // `outerField` inside the subquery must be qualified with the outer table,
    // otherwise a bare column name would bind to the joined table instead.
    const outerPrefix = outerQualifier(scope);

    const innerScope: CompileScope = {
        fieldCollection: join,
        fieldPrefix: `"${alias}".`,
        outerCollection: scope.outerCollection,
        outerPrefix,
        resolveCollection: scope.resolveCollection,
        alias: scope.alias
    };
    return `EXISTS (SELECT 1 FROM "${joinSchema}"."${joinTable}" "${alias}" WHERE ${compile(expr.where, innerScope)})`;
}

const COMPARE_SQL: Record<PolicyCompareOperator, string> = {
    eq: "=",
    neq: "!=",
    lt: "<",
    lte: "<=",
    gt: ">",
    gte: ">="
};

function operandToSql(operand: PolicyOperand, scope: CompileScope): string {
    switch (operand.kind) {
        case "field":
            return `${scope.fieldPrefix}${resolveColumnName(operand.name, scope.fieldCollection)}`;
        case "outerField":
            return `${scope.outerPrefix}${resolveColumnName(operand.name, scope.outerCollection)}`;
        case "literal":
            return quoteLiteral(operand.value);
        case "authUid":
            return RLS_UID_SQL;
        case "authRoles":
            return `string_to_array(${RLS_ROLES_SQL}, ',')`;
    }
}

/**
 * SQL prefix that qualifies a column of the outer RLS row (`"schema"."table".`),
 * or `""` when the collection is unknown.
 */
function outerQualifier(scope: CompileScope): string {
    const table = scope.outerCollection ? getTableName(scope.outerCollection) : undefined;
    if (!table) return "";
    return `"${schemaOf(scope.outerCollection) ?? "public"}"."${table}".`;
}

function schemaOf(collection?: CollectionConfig): string | undefined {
    return (collection as { schema?: string } | undefined)?.schema || undefined;
}

function resolveColumnName(propName: string, collection?: CollectionConfig): string {
    const prop = collection?.properties?.[propName] as Property | undefined;
    if (prop && "columnName" in prop && typeof (prop as { columnName?: unknown }).columnName === "string") {
        return quoteColumnIdentifier((prop as { columnName: string }).columnName);
    }
    return quoteColumnIdentifier(toSnakeCase(propName));
}

/**
 * Every PostgreSQL keyword that cannot stand as a bare column reference.
 * Appendix C's two reserved categories — plain "reserved", and "reserved (can
 * be function or type name)" — since neither may name a column unquoted.
 */
const RESERVED_SQL_WORDS = new Set([
    "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "authorization",
    "binary", "both", "case", "cast", "check", "collate", "collation", "column", "concurrently",
    "constraint", "create", "cross", "current_catalog", "current_date", "current_role",
    "current_schema", "current_time", "current_timestamp", "current_user", "default", "deferrable",
    "desc", "distinct", "do", "else", "end", "except", "false", "fetch", "for", "foreign", "freeze",
    "from", "full", "grant", "group", "having", "ilike", "in", "initially", "inner", "intersect",
    "into", "is", "isnull", "join", "lateral", "leading", "left", "like", "limit", "localtime",
    "localtimestamp", "natural", "not", "notnull", "null", "offset", "on", "only", "or", "order",
    "outer", "overlaps", "placing", "primary", "references", "returning", "right", "select",
    "session_user", "similar", "some", "symmetric", "system_user", "table", "tablesample", "then",
    "to", "trailing", "true", "union", "unique", "user", "using", "variadic", "verbose", "when",
    "where", "window", "with"
]);

/** An identifier Postgres reads back unchanged without quotes. */
const BARE_IDENTIFIER = /^[a-z_][a-z0-9_$]*$/;

/**
 * Quote a column reference when Postgres would not read the bare name as that
 * column — and only then.
 *
 * Three ways a bare name goes wrong, in ascending order of how long it takes to
 * notice:
 *
 * - **Case.** `columnName` is used verbatim, and `rebase schema introspect`
 *   populates it from a live database, so a legacy `"createdAt"` column arrives
 *   spelled exactly that way. Unquoted, Postgres folds it to `createdat` and
 *   `CREATE POLICY` fails with "column does not exist" — the collection keeps
 *   RLS enabled with no policy, which denies every row.
 * - **Syntax.** A column named `order` or `default` is a syntax error mid-clause.
 * - **Silent rebinding.** `user`, `current_user`, `session_user`, `current_date`
 *   and friends are *valid bare expressions*, so the policy compiles, applies,
 *   and is reported as a success — while comparing against the connected role
 *   or the wall clock instead of the column. Under RLS every request runs as the
 *   same `rebase_user` role, so `USING (user = rebase.uid())` is a constant: it
 *   denies everything, and its negation admits everything.
 *
 * Only the names that need it are quoted, so an ordinary snake_case policy body
 * is emitted byte-for-byte as before. That keeps generated artifacts and the
 * policies already stored in shipped databases stable — this fix reaches the
 * clauses that were broken and no others.
 */
function quoteColumnIdentifier(name: string): string {
    if (BARE_IDENTIFIER.test(name) && !RESERVED_SQL_WORDS.has(name)) return name;
    return `"${name.replace(/"/g, "\"\"")}"`;
}

function quoteLiteral(value: string | number | boolean | null): string {
    if (value === null) return "NULL";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return String(value);
    return `'${value.replace(/'/g, "''")}'`;
}

/** Sorted, single-quoted `ARRAY['a','b']` — matches the generators' output. */
function rolesArraySql(roles: readonly string[]): string {
    return `ARRAY[${[...roles].sort().map(r => `'${r}'`).join(",")}]`;
}
