import { ANONYMOUS_USER_IDS, CollectionConfig, PolicyExpression, PolicyOperand, PolicyCompareOperator, Property, ResolvedRelation, ExistsInPolicyExpression, RLS_IS_ANONYMOUS_SQL, RLS_JWT_SQL, RLS_ROLES_SQL, RLS_UID_SQL, rewriteLegacyRlsFunctions } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";
import { findRelation, getTableName, resolveCollectionRelations } from "../relations";

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
            // A claim is text too, and the same mismatch applies — but here the
            // cast goes the OTHER way, onto the claim. Casting the column would
            // compile and would take the index off it, and this operand exists
            // to carry a tenancy predicate that is ANDed into every read of the
            // table. See {@link claimCastType}.
            const claimSql = (operand: PolicyOperand, other: PolicyOperand): string | undefined =>
                operand.kind === "authClaim"
                    ? authClaimSql(operand.name, claimCastType(other, scope))
                    : undefined;
            const leftSql = claimSql(expr.left, expr.right)
                ?? castForAuthUid(expr.left, operandToSql(expr.left, scope), expr.right);
            const rightSql = claimSql(expr.right, expr.left)
                ?? castForAuthUid(expr.right, operandToSql(expr.right, scope), expr.left);
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
        case "registered":
            // "Signed in" AND "not a guest". The first half is the same clause
            // `authenticated` compiles to; the second is the fact anonymous
            // sign-in used not to put anywhere the database could see, so a
            // guest and an account were one principal inside every policy.
            //
            // `rebase.is_anonymous()` defaults to false when its GUC is unset,
            // so a policy compiled here and enforced by an older server reads
            // every session as an account — which is the behaviour that
            // deployment already had, rather than a lockout.
            return `${RLS_UID_SQL} IS NOT NULL`
                + ` AND ${RLS_UID_SQL} NOT IN (${ANONYMOUS_USER_IDS.map(quoteLiteral).join(", ")})`
                + ` AND NOT ${RLS_IS_ANONYMOUS_SQL}`;
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
        case "authClaim":
            // Uncast — the shape a claim has when nothing says what it is being
            // compared against (a claim on both sides, or against a literal).
            // The `compare` arm replaces this whenever the other operand names
            // a typed column.
            return authClaimSql(operand.name, "text");
    }
}

/** Postgres types a text claim is cast to. `"text"` is the no-cast case. */
type ClaimCastType = "text" | "uuid" | "bigint" | "numeric";

/**
 * The Postgres type a claim has to be cast to, to be compared with `operand`.
 *
 * `"text"` means "no cast": a claim already is text, and a `text` / `varchar`
 * column compares with it directly and keeps using its index.
 *
 * Resolved from the *property*, and through a relation's target when the column
 * is a foreign key — a `belongsTo` tenant field is the ordinary shape, and its
 * column's type is the target collection's primary key type rather than
 * anything visible on the property itself. Unknown resolves to `"text"`, which
 * is the safe direction: a redundant `text` comparison costs nothing, while a
 * missing `uuid` cast is a `CREATE POLICY` that fails and leaves a table with
 * RLS enabled and no policy — which denies every row.
 */
function claimCastType(operand: PolicyOperand, scope: CompileScope): ClaimCastType {
    if (operand.kind !== "field" && operand.kind !== "outerField") return "text";
    const collection = operand.kind === "field" ? scope.fieldCollection : scope.outerCollection;
    return propertyClaimCastType(operand.name, collection, scope.resolveCollection);
}

/**
 * What `name` on `collection` compares against a text claim as.
 *
 * `depth` stops a `reference` cycle — two collections whose keys point at each
 * other — from recursing forever. Two hops is more than any real declaration
 * needs.
 */
function propertyClaimCastType(
    name: string,
    collection: CollectionConfig | undefined,
    resolveCollection: ((slug: string) => CollectionConfig | undefined) | undefined,
    depth = 0
): ClaimCastType {
    const prop = collection?.properties?.[name] as Property | undefined;
    if (!prop || depth > 2) return "text";

    switch (prop.type) {
        case "string": {
            const sp = prop as { isId?: unknown; columnType?: unknown; enum?: unknown };
            if (sp.enum) return "text";
            return sp.isId === "uuid" || sp.columnType === "uuid" ? "uuid" : "text";
        }
        case "number": {
            const np = prop as { columnType?: string; isId?: unknown; validation?: { integer?: boolean } };
            if (np.columnType === "numeric") return "numeric";
            if (np.columnType || np.validation?.integer || np.isId) return "bigint";
            // A `number` with no `columnType` and no `validation.integer` is
            // NUMERIC — see `numberType` in the schema planner.
            return "numeric";
        }
        case "reference":
            return primaryKeyClaimCastType(
                resolveTargetCollection((prop as { path?: string }).path, resolveCollection),
                resolveCollection,
                depth
            );
        case "relation":
            return primaryKeyClaimCastType(
                relationTarget(name, prop, collection, resolveCollection),
                resolveCollection,
                depth
            );
        default:
            return "text";
    }
}

/** The cast a column pointing at `target`'s primary key needs. */
function primaryKeyClaimCastType(
    target: CollectionConfig | undefined,
    resolveCollection: ((slug: string) => CollectionConfig | undefined) | undefined,
    depth: number
): ClaimCastType {
    if (!target) return "text";
    for (const [key, property] of Object.entries(target.properties ?? {})) {
        if (!(property as { isId?: unknown })?.isId) continue;
        return propertyClaimCastType(key, target, resolveCollection, depth + 1);
    }
    // No declared key: the implicit `id TEXT PRIMARY KEY`.
    return "text";
}

/**
 * A relation's target slug, whatever form the declaration took.
 *
 * `target` is a slug on a plain object and a thunk on a builder — the two
 * shapes `resolveRelation` normalises — and this runs on the raw property,
 * before that resolution.
 */
function relationTargetSlug(relation: { target?: unknown } | undefined): string | undefined {
    const target = relation?.target;
    if (typeof target === "string") return target;
    if (typeof target !== "function") return undefined;
    try {
        const slug = ((target as () => unknown)() as { slug?: unknown })?.slug;
        return typeof slug === "string" ? slug : undefined;
    } catch {
        // A thunk needing a registry this compilation does not have. `text` is
        // the fallback, and a fallback is not worth failing a compile over.
        return undefined;
    }
}

function resolveTargetCollection(
    slug: string | undefined,
    resolveCollection: ((slug: string) => CollectionConfig | undefined) | undefined
): CollectionConfig | undefined {
    if (!slug || !resolveCollection) return undefined;
    // A `reference` path may be nested; the collection is its last segment.
    return resolveCollection(slug) ?? resolveCollection(slug.split("/").pop() as string);
}

/**
 * `NULLIF(rebase.jwt() ->> 'name', '')`, cast to the column's type.
 *
 * Two things here are load-bearing beyond the cast:
 *
 * - **`NULLIF(…, '')`.** An absent claim already reads as NULL, but one set to
 *   the empty string does not, and `''::uuid` raises rather than denying. Both
 *   spellings of "this caller has no tenant" have to reach the comparison as
 *   NULL, which is never true and therefore never a grant.
 * - **The guard.** The cast sits inside a `CASE` that first checks the text is
 *   well-formed, because `'nonsense'::uuid` raises `invalid input syntax` — and
 *   a policy that raises does not deny a row, it fails the whole statement. A
 *   caller holding a malformed claim would get a 500 on every read of the table
 *   instead of an empty list. `CASE` rather than an `AND` guard because only
 *   `CASE` is guaranteed not to evaluate its arms out of order.
 *
 * The whole expression is STABLE (`rebase.jwt()` is), so Postgres evaluates it
 * once per query and can still use a btree index on the column it is compared
 * against — which is the entire reason the cast is on this side.
 */
function authClaimSql(name: string, cast: ClaimCastType): string {
    const claim = `NULLIF(${RLS_JWT_SQL} ->> ${quoteLiteral(name)}, '')`;
    if (cast === "text") return claim;
    return `CASE WHEN ${claim} ~ '${CLAIM_CAST_GUARDS[cast]}' THEN (${claim})::${cast} END`;
}

/**
 * The text a claim must match before it is cast, per target type.
 *
 * The `bigint` guard caps the digit run at 18 rather than matching any run of
 * digits: `'99999999999999999999'::bigint` is a range error, which fails the
 * statement exactly as the syntax error would have.
 */
const CLAIM_CAST_GUARDS: Record<Exclude<ClaimCastType, "text">, string> = {
    uuid: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    bigint: "^-?[0-9]{1,18}$",
    numeric: "^-?[0-9]+(\\.[0-9]+)?$"
};

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
    const relationColumn = belongsToColumn(propName, prop, collection);
    if (relationColumn) return quoteColumnIdentifier(relationColumn);
    return quoteColumnIdentifier(toSnakeCase(propName));
}

/**
 * The foreign key column a `relation` property addresses, when it has one.
 *
 * A `belongsTo` property is a *link*, and its column is the relation's
 * `localKey` — `org` addresses `org_id`. `toSnakeCase` cannot know that, so a
 * rule naming a relation (`ownerField: "org"`, a tenancy declaration over a
 * `belongsTo`) compiled to a comparison against a column called `org`, which
 * does not exist. `CREATE POLICY` then fails, and a table with RLS enabled and
 * no policy denies every row — the loudest possible symptom for the quietest
 * possible cause, since the rule reads exactly right.
 *
 * Only `belongsTo`. Every other kind puts its column on the target table, in a
 * junction row, or nowhere at all, and there is no column here to name.
 */
function belongsToColumn(
    propName: string,
    prop: Property | undefined,
    collection?: CollectionConfig
): string | undefined {
    if (prop?.type !== "relation") return undefined;
    const relation = resolvePropertyRelation(propName, collection);
    return relation?.kind === "belongsTo" ? relation.localKey : undefined;
}

/**
 * The resolved relation a `relation` property stands for, by the only name
 * both declarations share: the property's own key.
 *
 * A property may carry the link inline (`relation: { kind, target }`) or name
 * an entry in the collection's `relations` array — and the second form is
 * matched by the property key, so there is nothing on the property to read.
 * `resolveCollectionRelations` normalises both under that key, which is why
 * this asks it rather than reading the property.
 */
function resolvePropertyRelation(
    propName: string,
    collection: CollectionConfig | undefined
): ResolvedRelation | undefined {
    if (!collection) return undefined;
    try {
        return findRelation(resolveCollectionRelations(collection), propName);
    } catch {
        // A relation whose target is not in this bundle. The old spelling is
        // no worse than failing to compile at all.
        return undefined;
    }
}

/**
 * The collection a `relation` property points at.
 *
 * Preferred over the property's raw `target` because only the resolved
 * relation covers both declarations, and because a resolved `target()` hands
 * back the collection itself — no registry needed. The slug path stays as the
 * fallback for a `target` written as a plain string, which cannot become a
 * collection without one.
 */
function relationTarget(
    propName: string,
    prop: Property,
    collection: CollectionConfig | undefined,
    resolveCollection: ((slug: string) => CollectionConfig | undefined) | undefined
): CollectionConfig | undefined {
    const relation = resolvePropertyRelation(propName, collection);
    if (relation) {
        try {
            const target = relation.target();
            if (target) return target;
        } catch {
            // A thunk needing a registry this compilation does not have.
        }
    }
    return resolveTargetCollection(
        relationTargetSlug((prop as { relation?: { target?: unknown } }).relation),
        resolveCollection
    );
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
