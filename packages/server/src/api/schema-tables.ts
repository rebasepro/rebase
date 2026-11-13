import { createHash } from "node:crypto";
import {
    isRedactedSecurityRule,
    scopeGrants,
    scopeGrantsAny,
    scopeTargets,
    type ColumnDescriptor,
    type JunctionPolicyDescriptor,
    type PolicyDescriptor,
    type RedactedSecurityRule,
    type RelationDescriptor,
    type RlsDescriptor,
    type SecurityOperation,
    type SecurityRule,
    type TableDescriptor
} from "@rebasepro/types";
import {
    canReadWithAccess,
    compileTableRulePolicies,
    junctionPolicyTable,
    policyTableFromDescriptor,
    policyTableResolver,
    resolveTableJunctions,
    tableEffectiveRules,
    tableInjectedRules,
    tableJunctionRules,
    type CompiledRulePolicy,
    type FieldViewer,
    type PolicyTable
} from "@rebasepro/common";
import { logger } from "../utils/logger";

/**
 * The one serializer of a backend's tables for a caller.
 *
 * `GET /api/schema/tables` serves it over HTTP, `/api/meta/contract` serves
 * its admin-level view, and the MCP surface builds its views from it — three
 * consumers, one definition of what each caller may learn about the schema.
 *
 * Fail closed, per caller:
 *
 * | Field | Who sees it |
 * |---|---|
 * | a `private` column or relation | nobody, administrators included |
 * | a column or relation the caller fails `access.read` for | dropped (`access` itself is kept on what remains) |
 * | a `belongsTo`'s foreign-key column | its own rules when declared in `columns`; withheld with the relation when derived from it |
 * | a relation whose target table the caller is not served | dropped |
 * | a table | administrators and `schema:read` holders: every one; any other person (`schemaTables.persons: "granted"`, the default): those some rule could grant their roles something on (see {@link tableReachable}), every one with `persons: "all"`; a credential (API key, token): the tables its `data:*` scopes name, or all with `schema:read`; an anonymous caller (public opt-in): those with a public `select` rule |
 * | structured `rls.rules` | everyone served the table; a non-privileged person under `"granted"` only the rules that can apply to their roles (see {@link ruleAppliesTo}), the rest dropped |
 * | raw SQL in a rule (`using`, `withCheck`, a `policy.raw` node) | administrators and `schema:read` holders; everyone else gets a {@link RedactedSecurityRule} |
 * | `rls.policies`, `rls.junctions` (compiled policies) | administrators and `schema:read` holders |
 * | `view.query`, `indexes` | administrators and `schema:read` holders |
 * | `auth.roles`, `auth.scopes` (labels) | administrators, `schema:read` and `users:read` holders |
 * | `hooks`, column `transforms`, `auth.hooks` | everyone served the table but a non-privileged person under `"granted"` and an anonymous caller (presence flags; code never leaves the server, and the panel reads none of them) |
 * | `metadata`, `softDelete`, `tenant`, `history`, `search` | everyone served the table: the panel renders and gates from them (`metadata` is public to the callers served the table by definition) |
 *
 * @module
 */

/**
 * Who is asking.
 *
 * - `anonymous` — nobody signed in; served only when the backend opts in
 *   (`schemaTables: { public: true }`).
 * - `person` — a signed-in user, or the service key: holds what their roles
 *   hold. With `schema:read` (administrators) every table; otherwise the
 *   tables some rule could grant their roles something on, or every table
 *   when the backend says `schemaTables: { persons: "all" }`.
 * - `credential` — an API key, an MCP or platform token: holds exactly the
 *   scopes it was granted, and sees only the tables they name.
 *
 * @group Schema
 */
export interface SchemaCaller {
    kind: "anonymous" | "person" | "credential";
    /** The application roles columns' `access.read` is judged against. */
    roles: readonly string[];
    /** Every scope the caller holds (for a person: what their roles hold). */
    scopes: readonly string[];
}

/**
 * What a caller is served: the redaction {@link serializeTables} applies.
 * Two callers with the same view receive the same body.
 *
 * @group Schema
 */
export interface SchemaView {
    /** Raw SQL, compiled policies, view queries and indexes. */
    privileged: boolean;
    /** The auth table's role and scope labels. */
    accountLabels: boolean;
    /** The roles columns and relations are judged against. */
    viewer: FieldViewer;
    /**
     * Which tables. `granted`: those some rule could grant the viewer's roles
     * something on ({@link tableReachable}), with only the rules that can
     * apply to them ({@link ruleAppliesTo}).
     */
    tables: { kind: "all" } | { kind: "only"; slugs: readonly string[] } | { kind: "public" } | { kind: "granted" };
}

/**
 * What a signed-in person without `schema:read` is described:
 *
 * - `"granted"` (the default) — the tables some rule could grant their roles
 *   something on, each with only the rules that can apply to them;
 * - `"all"` — every table, with every rule (raw SQL still redacted): what
 *   every signed-in caller was served before this option existed.
 *
 * @group Schema
 */
export type SchemaTablesPersons = "granted" | "all";

/**
 * Options of {@link schemaViewFor}.
 *
 * @group Schema
 */
export interface SchemaViewOptions {
    /** `schemaTables.persons` — see {@link SchemaTablesPersons}. Default `"granted"`. */
    persons?: SchemaTablesPersons;
}

/**
 * Why a caller is served nothing.
 *
 * @group Schema
 */
export type SchemaRefusal = { refused: "scope"; message: string };

const DATA_SCOPES = ["data:read", "data:write", "data:delete"] as const;

/**
 * The view a caller is served, or why it is refused.
 *
 * A credential needs `schema:read` or a `data:*` scope: a key minted for
 * storage or functions alone has no business reading the schema.
 *
 * @group Schema
 */
export function schemaViewFor(caller: SchemaCaller, options: SchemaViewOptions = {}): SchemaView | SchemaRefusal {
    if (caller.kind === "anonymous") {
        return { privileged: false, accountLabels: false, viewer: { roles: [] }, tables: { kind: "public" } };
    }
    const scopes = caller.scopes;
    const privileged = scopeGrants(scopes, "schema:read");
    const accountLabels = privileged || scopeGrants(scopes, "users:read");
    const viewer: FieldViewer = { roles: [...caller.roles] };
    if (privileged) return { privileged, accountLabels, viewer, tables: { kind: "all" } };
    if (caller.kind === "person") {
        return { privileged, accountLabels, viewer, tables: { kind: options.persons === "all" ? "all" : "granted" } };
    }
    if (!DATA_SCOPES.some(scope => scopeGrantsAny(scopes, scope))) {
        return {
            refused: "scope",
            message: "This credential holds neither `schema:read` nor a `data:*` scope, so it may not read the schema. " +
                "Grant it `schema:read`, or the `data:read:<table>` scopes of the tables it works with."
        };
    }
    const slugs = new Set<string>();
    for (const scope of DATA_SCOPES) {
        const targets = scopeTargets(scopes, scope);
        if (targets === "all") return { privileged, accountLabels, viewer, tables: { kind: "all" } };
        for (const target of targets) slugs.add(target);
    }
    return { privileged, accountLabels, viewer, tables: { kind: "only", slugs: [...slugs].sort() } };
}

/** The view `/api/meta/contract` serves: every table, as an administrator sees it. */
export const ADMIN_SCHEMA_VIEW: SchemaView = Object.freeze({
    privileged: true,
    accountLabels: true,
    viewer: Object.freeze({ roles: Object.freeze(["admin"]) }),
    tables: Object.freeze({ kind: "all" as const })
});

/**
 * A short, stable digest of everything the redaction depends on: two callers
 * with the same key are served byte-identical bodies. Part of the `ETag`.
 *
 * @group Schema
 */
export function schemaViewKey(view: SchemaView): string {
    const identity = {
        p: view.privileged,
        a: view.accountLabels,
        r: [...new Set(view.viewer.roles ?? [])].sort(),
        t: view.tables.kind === "only" ? view.tables.slugs : view.tables.kind
    };
    return createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 16);
}

// ── Compiled policies ────────────────────────────────────────────────────────

/**
 * The compiled policies of one table, and of the junctions of its
 * `manyToMany` relations.
 *
 * @group Schema
 */
export interface TablePolicies {
    policies: PolicyDescriptor[];
    junctions: JunctionPolicyDescriptor[];
}

/** The planner's options: this runtime switches admin requests to `rebase_admin`. */
const COMPILE_OPTIONS = { adminRole: true, adminRequestRole: true } as const;

function asPolicy(compiled: CompiledRulePolicy, injected: boolean, rule: number | undefined): PolicyDescriptor {
    return {
        name: compiled.name,
        operation: compiled.operation,
        mode: compiled.mode,
        roles: [...compiled.roles],
        using: compiled.using,
        withCheck: compiled.withCheck,
        // An admin-request companion is Rebase's, whatever rule it rides on.
        injected: injected || compiled.adminRequestTarget === true,
        ...(rule !== undefined && compiled.adminRequestTarget !== true ? { rule } : {})
    };
}

/**
 * Compile the policies of every table — what the schema planner writes into
 * Postgres and the Studio's RLS editor compares the live database against —
 * from the same `compileTableRulePolicies` / `tableEffectiveRules` the planner
 * reads, keyed by slug.
 *
 * Reads the declared tables' descriptors. Introspected tables are not among
 * them: Rebase did not generate their policies and cannot say what they are.
 *
 * A rule that cannot be compiled (an `existsIn` naming a table this backend
 * does not hold) contributes no policy and is logged; the rest still are.
 *
 * @group Schema
 */
export function compileServedPolicies(
    tables: readonly TableDescriptor[],
    describedSlugs: ReadonlySet<string>
): Map<string, TablePolicies> {
    const options = { ...COMPILE_OPTIONS, resolveTable: policyTableResolver(tables) };
    const out = new Map<string, TablePolicies>();

    const compile = (table: PolicyTable, rule: SecurityRule, injected: boolean, index: number | undefined): PolicyDescriptor[] => {
        try {
            return compileTableRulePolicies(table, rule, options).map(policy => asPolicy(policy, injected, index));
        } catch (error) {
            logger.debug("A rule could not be compiled for GET /api/schema/tables", {
                table: table.table,
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    };

    for (const descriptor of tables) {
        if (!describedSlugs.has(descriptor.slug)) continue;
        const table = policyTableFromDescriptor(descriptor);
        const explicit = table.rules.length;
        const injectedNames = new Set(tableInjectedRules(table).map(rule => rule.name));
        const policies = tableEffectiveRules(table).flatMap((rule, index) => {
            const injected = index >= explicit || (rule.name !== undefined && injectedNames.has(rule.name));
            return compile(table, rule, injected, injected ? undefined : index);
        });
        out.set(descriptor.slug, { policies, junctions: [] });
    }

    let junctions: ReturnType<typeof resolveTableJunctions>;
    try {
        junctions = resolveTableJunctions(tables);
    } catch (error) {
        logger.debug("The junction tables could not be resolved for GET /api/schema/tables", {
            error: error instanceof Error ? error.message : String(error)
        });
        return out;
    }
    for (const junction of junctions.values()) {
        const table = junctionPolicyTable(junction);
        const policies = tableJunctionRules(junction).flatMap(rule => compile(table, rule, true, undefined));
        const entry: JunctionPolicyDescriptor = { table: junction.table, schema: junction.schema, policies };
        const sides = new Set(junction.declaringSides.map(side => side.descriptor.slug));
        for (const slug of sides) {
            const served = out.get(slug);
            if (served && !served.junctions.some(existing => existing.table === entry.table)) served.junctions.push(entry);
        }
    }
    return out;
}

// ── Redaction ────────────────────────────────────────────────────────────────

/** Whether anything under `value` is a `policy.raw(…)` node. */
function containsRawNode(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(containsRawNode);
    if (typeof value !== "object" || value === null) return false;
    if ("kind" in value && value.kind === "raw") return true;
    return Object.values(value).some(containsRawNode);
}

/** Whether a rule carries SQL text anywhere: a raw clause, or a raw node inside a structured one. */
function carriesSql(rule: SecurityRule): boolean {
    return rule.using !== undefined || rule.withCheck !== undefined
        || containsRawNode(rule.condition) || containsRawNode(rule.check);
}

/**
 * A rule as a caller who may not see SQL is served it: as written when it
 * carries none, else the {@link RedactedSecurityRule} marker, keeping only
 * whom the rule concerns.
 *
 * @group Schema
 */
export function redactRule(rule: SecurityRule): SecurityRule {
    if (isRedactedSecurityRule(rule) || !carriesSql(rule)) return rule;
    const marker: RedactedSecurityRule = {
        redacted: true,
        ...(rule.operation !== undefined ? { operation: rule.operation } : {}),
        ...(rule.operations !== undefined ? { operations: [...rule.operations] } : {}),
        ...(rule.mode !== undefined ? { mode: rule.mode } : {}),
        ...(rule.roles !== undefined ? { roles: [...rule.roles] } : {}),
        ...(rule.access !== undefined ? { access: rule.access } : {})
    };
    return marker;
}

function appliesTo(rule: SecurityRule, operation: SecurityOperation): boolean {
    const operations = rule.operations && rule.operations.length > 0 ? rule.operations : [rule.operation ?? "all"];
    return operations.includes(operation) || operations.includes("all");
}

/**
 * Whether anyone, signed in or not, may read some of a table's rows: a
 * permissive `select` rule with `access: "public"`, not narrowed to roles or
 * to Postgres roles. What the anonymous view (the public opt-in) serves.
 *
 * @group Schema
 */
export function hasPublicSelectRule(table: TableDescriptor): boolean {
    if (table.kind !== "table" || table.rls.posture !== "rules") return false;
    return table.rls.rules.some(rule =>
        !isRedactedSecurityRule(rule)
        && (rule.mode ?? "permissive") === "permissive"
        && rule.access === "public"
        && (rule.roles === undefined || rule.roles.length === 0)
        && rule.pgRoles === undefined
        && appliesTo(rule, "select"));
}

/**
 * Whether a caller holding `roles` holds one of a rule's (or a view's)
 * `roles`: always when it names none, and when it names `"public"`, which the
 * policy compiler and the client evaluator both read as everyone.
 */
function holdsOneOf(named: readonly string[] | undefined, roles: readonly string[]): boolean {
    if (!named || named.length === 0) return true;
    return named.some(role => role === "public" || roles.includes(role));
}

/**
 * Whether a rule can apply to a caller holding `roles`: a rule with no
 * `roles` applies to everyone (public, authenticated, registered, owner,
 * condition and raw SQL rules alike — what they admit is decided per row),
 * one with `roles` to the holders of one of them. Restrictive rules count
 * too: they narrow what the caller is granted, and the panel gates by them.
 *
 * @group Schema
 */
export function ruleAppliesTo(rule: SecurityRule, roles: readonly string[]): boolean {
    return holdsOneOf(rule.roles, roles);
}

/**
 * Whether some rule could grant a caller holding `roles` something on a
 * table — what a person without `schema:read` is described under
 * `schemaTables.persons: "granted"`:
 *
 * - a table with a permissive rule that applies to them ({@link ruleAppliesTo});
 * - the auth table: every account reads its own row (the injected self-read);
 * - a table under the admin baseline (`"admin-only"`, or rules with
 *   `defaultPolicies`), for a caller holding `admin`;
 * - a materialized view, for a holder of one of its `view.roles`
 *   (`["admin"]` when it names none);
 * - a plain view: never. It has no rules of its own — it runs as the caller
 *   over the tables its SQL reads, which the descriptor does not list — so
 *   the conservative answer is that it reaches nobody here; `persons: "all"`
 *   or `schema:read` describes it.
 *
 * @group Schema
 */
export function tableReachable(table: TableDescriptor, roles: readonly string[]): boolean {
    if (table.kind === "view" || table.rls.posture === "view") {
        const viewRoles = table.view?.roles ?? ["admin"];
        return table.view?.materialized === true && viewRoles.length > 0 && holdsOneOf(viewRoles, roles);
    }
    if (table.auth) return true;
    if (roles.includes("admin") && (table.rls.posture === "admin-only" || table.rls.defaultPolicies)) return true;
    if (table.rls.posture !== "rules") return false;
    return table.rls.rules.some(rule => (rule.mode ?? "permissive") === "permissive" && ruleAppliesTo(rule, roles));
}

function tableServed(table: TableDescriptor, view: SchemaView): boolean {
    switch (view.tables.kind) {
        case "all":
            return true;
        case "only":
            return view.tables.slugs.includes(table.slug);
        case "public":
            return hasPublicSelectRule(table);
        case "granted":
            return tableReachable(table, view.viewer.roles ?? []);
    }
}

/**
 * The slugs of the tables a view is served — what `/api/admin/ui-config`
 * accepts a caller's preferences for.
 *
 * @group Schema
 */
export function servedTableSlugs(tables: readonly TableDescriptor[], view: SchemaView): Set<string> {
    return new Set(tables.filter(table => tableServed(table, view)).map(table => table.slug));
}

/** Whether a view withholds hook presence flags: the least-privileged views, which the panel serves. */
function withholdsHookFlags(view: SchemaView): boolean {
    return !view.privileged && (view.tables.kind === "granted" || view.tables.kind === "public");
}

function columnServed(column: ColumnDescriptor, viewer: FieldViewer): boolean {
    return column.private !== true && canReadWithAccess(column.access, viewer);
}

function servedRelation(relation: RelationDescriptor, view: SchemaView, served: ReadonlySet<string>): RelationDescriptor | undefined {
    if (relation.private === true || !canReadWithAccess(relation.access, view.viewer)) return undefined;
    if (!served.has(relation.target)) return undefined;
    if (relation.kind !== "manyToMany") return relation;
    return {
        ...relation,
        through: { ...relation.through, pivot: relation.through.pivot.filter(column => columnServed(column, view.viewer)) }
    };
}

function servedRls(rls: RlsDescriptor, view: SchemaView, policies: TablePolicies | undefined): RlsDescriptor {
    const { policies: _policies, junctions: _junctions, ...base } = rls;
    if (!view.privileged) {
        const roles = view.viewer.roles ?? [];
        const rules = view.tables.kind === "granted" ? rls.rules.filter(rule => ruleAppliesTo(rule, roles)) : rls.rules;
        return { ...base, rules: rules.map(redactRule) };
    }
    return policies ? { ...base, policies: policies.policies, junctions: policies.junctions } : base;
}

function serializeTable(
    table: TableDescriptor,
    view: SchemaView,
    served: ReadonlySet<string>,
    policies: TablePolicies | undefined
): TableDescriptor {
    const relations = table.relations
        .map(relation => servedRelation(relation, view, served))
        .filter((relation): relation is RelationDescriptor => relation !== undefined);
    const relationNames = new Set(relations.map(relation => relation.name));
    // A foreign-key column the relation derived has no rules of its own: it is
    // the relation's, and is withheld with it (as the REST read strips it).
    const withheldKeys = new Set(table.relations
        .filter(relation => relation.kind === "belongsTo"
            && (relation.private === true || !canReadWithAccess(relation.access, view.viewer)))
        .map(relation => relation.kind === "belongsTo" ? relation.localField : ""));
    const hookFlags = !withholdsHookFlags(view);
    const columns = table.columns
        .filter(column => columnServed(column, view.viewer))
        .filter(column => !(column.derived === true && withheldKeys.has(column.key)))
        .map(column => {
            let served = column;
            if (!hookFlags && served.transforms !== undefined) {
                const { transforms: _transforms, ...rest } = served;
                served = rest;
            }
            // A dropped relation is not named by the column that held its key.
            if (served.foreignKeyOf === undefined || relationNames.has(served.foreignKeyOf)) return served;
            const { foreignKeyOf: _relation, ...rest } = served;
            return rest;
        });
    const columnKeys = new Set(columns.map(column => column.key));

    const {
        columns: _columns,
        relations: _relations,
        rls,
        indexes,
        view: viewDefinition,
        auth,
        search,
        hooks,
        ...rest
    } = table;

    const searchFields = search?.fields.filter(field => {
        const path = typeof field === "string" ? field : field.path;
        return columnKeys.has(path.split(".")[0] ?? path);
    });
    let servedAuth = auth;
    if (servedAuth && !view.accountLabels) {
        const { roles: _roles, scopes: _scopes, ...unlabelled } = servedAuth;
        servedAuth = unlabelled;
    }
    if (servedAuth && !hookFlags && servedAuth.hooks !== undefined) {
        const { hooks: _authHooks, ...withoutHooks } = servedAuth;
        servedAuth = withoutHooks;
    }
    let servedView = viewDefinition;
    if (viewDefinition && !view.privileged) {
        const { query: _query, ...withoutQuery } = viewDefinition;
        servedView = withoutQuery;
    }

    return {
        ...rest,
        columns,
        relations,
        rls: servedRls(rls, view, policies),
        ...(search && searchFields && searchFields.length > 0 ? { search: { ...search, fields: searchFields } } : {}),
        ...(indexes && view.privileged ? { indexes } : {}),
        ...(servedView ? { view: servedView } : {}),
        ...(servedAuth ? { auth: servedAuth } : {}),
        ...(hooks && hookFlags ? { hooks } : {})
    };
}

/**
 * The tables a caller is served, redacted for its view (see the module
 * documentation for the table of who sees what). Pure: the same descriptors,
 * view and policies give the same body.
 *
 * @param policies The compiled policies by slug ({@link compileServedPolicies});
 *   included for a privileged view only, and only for the tables that have them.
 *
 * @group Schema
 */
export function serializeTables(
    tables: readonly TableDescriptor[],
    view: SchemaView,
    policies?: ReadonlyMap<string, TablePolicies>
): TableDescriptor[] {
    const shown = tables.filter(table => tableServed(table, view));
    const served = new Set(shown.map(table => table.slug));
    return shown.map(table => serializeTable(table, view, served, view.privileged ? policies?.get(table.slug) : undefined));
}
