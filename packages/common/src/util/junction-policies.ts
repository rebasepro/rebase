import {
    JUNCTION_PIVOT_KEY,
    PolicyExpression,
    PolicyOperand,
    SecurityRule,
    policy
} from "@rebasepro/types";
import type { ColumnDescriptor, RelationDescriptor, TableDescriptor } from "@rebasepro/types";
import { getPolicyOperations } from "@rebasepro/utils";
import { securityRuleToConditions } from "./policy/securityRuleToConditions";
import { tableDefaultPoliciesDisabled } from "./auth-default-policies";
import { claimCastOf, policyTableFromDescriptor, type PolicyColumn, type PolicyTable } from "./policy/policy-table";

/**
 * RLS derivation for many-to-many junction tables.
 *
 * A `through` relation makes the generator create a table nobody declared as a
 * collection — `posts_tags`, `user_roles`. Those tables used to be the one kind
 * of generated table with **no** RLS at all: `rebase_user` holds full DML grants,
 * so with the endpoints locked down, any signed-up user could still read or wipe
 * every edge between them. There is also nowhere in the config to write rules
 * for a junction, so the author could not even fix it by hand.
 *
 * The architecture here is that a junction's security is *derived*, never
 * hand-written:
 *
 *  1. **Locked baseline.** The same server-or-admin `default_admin` grants every
 *     collection gets, so the invariant holds again: every table the generator
 *     creates is default-deny, and rules only broaden.
 *
 *  2. **Reads follow the endpoints.** An edge is visible iff *both* endpoint
 *     rows are visible — two correlated `EXISTS` subqueries. The subqueries run
 *     under the caller's role, so each endpoint's own RLS filters them: junction
 *     visibility delegates to the endpoints' policies, whatever they become,
 *     with nothing duplicated. A public blog keeps rendering its tags; a private
 *     CRM's edges are exactly as hidden as its rows.
 *
 *  3. **Writes follow the owning side's update rules.** Linking or unlinking an
 *     edge *is* an edit of the owning row — tagging a post is editing the post —
 *     so edge writes inherit the declaring collection's explicit permissive
 *     `update` rules, each wrapped in an `EXISTS` against the owning row. Where
 *     a rule cannot be embedded faithfully (see below) it is dropped, so the
 *     failure mode is always *too locked*, never open. Explicit **restrictive**
 *     update rules are inherited as restrictive junction rules; if one of them
 *     cannot be embedded, the whole derived write grant for that side is
 *     suppressed — granting without the author's gate would be looser than the
 *     parent itself.
 *
 * **Embeddability.** A parent rule is embedded by moving its condition inside
 * `EXISTS (SELECT 1 FROM parent WHERE parent.pk = junction.fk AND <condition>)`.
 * In that scope, `field` operands bind to the parent — which is what the author
 * meant. But `outerField` operands and `{column}` placeholders in `raw` SQL bind
 * to the RLS row, which is now the junction, not the parent the author wrote
 * them against. So: `raw` anywhere disqualifies a rule; a top-level `outerField`
 * (equivalent to `field` outside a subquery) is rewritten to `field`; an
 * `outerField` inside a nested `existsIn` cannot be re-scoped and disqualifies
 * the rule.
 *
 * Injected parent defaults are never inherited — the junction's own baseline
 * already covers the server/admin plane, and an auth collection's restrictive
 * `require_admin_write` gate exists to protect privileged parent *columns*,
 * which an edge write cannot touch. Inheriting it would stop users managing
 * e.g. their own interests through a `users_interests` junction for no gain.
 *
 * Everything flows through the shared naming machinery, so the Studio
 * recognises these policies as generated instead of offering to "import" them.
 */

// Mirrors auth-default-policies: the server context or an admin.
const SERVER_OR_ADMIN_EXPR: PolicyExpression = policy.or(
    policy.serverContext(),
    policy.rolesOverlap(["admin"])
);

/** `EXISTS (SELECT 1 FROM endpoint WHERE endpoint.pk = junction.fk [AND extra])`. */
function existsEndpoint(endpoint: PolicyJunctionEndpoint, extra?: PolicyExpression): PolicyExpression {
    const correlation = policy.compare(
        policy.field(endpoint.table.idKey),
        "eq",
        policy.outerField(endpoint.junctionColumn)
    );
    return policy.existsIn({
        table: endpoint.table.slug,
        where: extra ? policy.and(correlation, extra) : correlation
    });
}

/**
 * Whether a parent-rule expression keeps its meaning when moved inside the
 * junction's `EXISTS` subquery — and the re-scoped copy if it does.
 *
 * Returns `null` when the rule cannot be embedded faithfully: `raw` SQL
 * anywhere (its `{column}` placeholders would bind to the junction), or an
 * `outerField` inside a nested `existsIn` (it would bind to the junction while
 * the author meant the parent, and no operand can express "the middle scope").
 * Top-level `outerField`s are rewritten to `field`, which is what they meant.
 */
export function embedParentExpression(expr: PolicyExpression, depth = 0): PolicyExpression | null {
    switch (expr.kind) {
        case "raw":
            return null;
        case "and":
        case "or": {
            const parts: PolicyExpression[] = [];
            for (const child of expr.operands) {
                const embedded = embedParentExpression(child, depth);
                if (!embedded) return null;
                parts.push(embedded);
            }
            return expr.kind === "and" ? policy.and(...parts) : policy.or(...parts);
        }
        case "not": {
            const embedded = embedParentExpression(expr.operand, depth);
            return embedded ? policy.not(embedded) : null;
        }
        case "existsIn": {
            const where = embedParentExpression(expr.where, depth + 1);
            return where ? policy.existsIn({ table: expr.table, where }) : null;
        }
        case "compare": {
            const left = embedOperand(expr.left, depth);
            const right = embedOperand(expr.right, depth);
            if (!left || !right) return null;
            return { ...expr, left, right };
        }
        default:
            // Leaf expressions with no field references (true, false,
            // serverContext, authenticated, rolesOverlap, rolesContain) are
            // position-independent.
            return expr;
    }
}

/** Re-scope an operand, or return `null` if its binding cannot be preserved. */
function embedOperand(operand: PolicyOperand, depth: number): PolicyOperand | null {
    if (operand.kind === "outerField") {
        // Outside a subquery, outerField ≡ field: the author meant their own
        // row, which after embedding is the EXISTS's joined table → field.
        if (depth === 0) return policy.field(operand.name);
        // Inside the author's own existsIn it meant the parent row; after
        // embedding it would bind to the junction. Not expressible.
        return null;
    }
    return operand;
}

/** Does the rule cover the `update` operation? */
function coversUpdate(rule: SecurityRule): boolean {
    return getPolicyOperations(rule).some(op => op === "update" || op === "all");
}

/**
 * One end of a junction, as the policy compiler reads it: the table, and the
 * junction column holding its key.
 *
 * @group Policies
 */
export interface PolicyJunctionEndpoint {
    table: PolicyTable;
    /** Junction column holding this endpoint's key. */
    junctionColumn: string;
}

/**
 * A junction table, as its derived rules are built from: its two endpoints
 * and every table declaring a relation through it (whose update rules the
 * edge writes inherit).
 *
 * @group Policies
 */
export interface PolicyJunction {
    /** Bare table name. */
    table: string;
    schema: string;
    /** The two endpoints, in [source, target] order of the first declaring relation. */
    endpoints: [PolicyJunctionEndpoint, PolicyJunctionEndpoint];
    /** Every table that declares a relation through this junction. */
    declaringSides: PolicyJunctionEndpoint[];
}

/**
 * The full derived policy set for a junction table: the locked server/admin
 * baseline, the endpoint-visibility read grant, inherited write grants, and
 * inherited restrictive gates. Returns `[]` when every declaring collection set
 * `disableDefaultPolicies` — the junction is then the author's to police, and
 * stays locked (RLS is still enabled) until they write policies for it.
 */
export function junctionRules(spec: PolicyJunction): SecurityRule[] {
    if (spec.declaringSides.every(side => tableDefaultPoliciesDisabled(side.table))) {
        return [];
    }

    const rules: SecurityRule[] = [];

    // 1. Locked baseline — same shape and naming as every collection's.
    rules.push({
        name: `${spec.table}_default_admin_read`,
        operations: ["select"],
        condition: SERVER_OR_ADMIN_EXPR
    });
    rules.push({
        name: `${spec.table}_default_admin_write`,
        operations: ["insert", "update", "delete"],
        condition: SERVER_OR_ADMIN_EXPR,
        check: SERVER_OR_ADMIN_EXPR
    });

    // 2. Reads follow the endpoints: the edge is visible iff both rows are.
    // The EXISTS subqueries run under the caller's role, so each endpoint's
    // own RLS applies inside them — visibility is delegated, not copied.
    rules.push({
        name: `${spec.table}_default_edge_read`,
        operations: ["select"],
        condition: policy.and(
            existsEndpoint(spec.endpoints[0]),
            existsEndpoint(spec.endpoints[1])
        )
    });

    // 3. Writes follow the owning side's explicit update rules.
    const writeGrants: PolicyExpression[] = [];
    for (const side of spec.declaringSides) {
        const updateRules = side.table.rules.filter(coversUpdate);

        const permissive = updateRules.filter(r => r.mode !== "restrictive");
        const restrictive = updateRules.filter(r => r.mode === "restrictive");

        // Embed the restrictive gates first: if any of them cannot be carried
        // over, granting writes from this side would be looser than the parent
        // itself allows — so the whole side's grant is suppressed.
        const embeddedGates: PolicyExpression[] = [];
        let gatesEmbeddable = true;
        for (const gate of restrictive) {
            const using = securityRuleToConditions(gate).usingExpr;
            const embedded = using ? embedParentExpression(using) : null;
            if (!embedded) {
                gatesEmbeddable = false;
                break;
            }
            embeddedGates.push(embedded);
        }
        if (!gatesEmbeddable) continue;

        const grants: PolicyExpression[] = [];
        for (const rule of permissive) {
            const using = securityRuleToConditions(rule).usingExpr;
            const embedded = using ? embedParentExpression(using) : null;
            if (embedded) grants.push(embedded);
        }
        if (grants.length === 0) continue;

        // "May update the owning row": any permissive grant, AND every gate.
        const condition = embeddedGates.length > 0
            ? policy.and(policy.or(...grants), ...embeddedGates)
            : policy.or(...grants);

        writeGrants.push(existsEndpoint(side, condition));
    }

    if (writeGrants.length > 0) {
        rules.push({
            name: `${spec.table}_default_edge_write`,
            operations: ["insert", "update", "delete"],
            condition: writeGrants.length === 1 ? writeGrants[0] : policy.or(...writeGrants),
            check: writeGrants.length === 1 ? writeGrants[0] : policy.or(...writeGrants)
        });
    }

    return rules;
}

// ── Junctions of compiled tables ─────────────────────────────────────────────

/** The `manyToMany` arm of {@link RelationDescriptor}. */
export type ManyToManyDescriptor = Extract<RelationDescriptor, { kind: "manyToMany" }>;

/**
 * One end of a junction of compiled tables.
 *
 * @group Policies
 */
export interface TableJunctionEndpoint {
    descriptor: TableDescriptor;
    /** Junction column holding this endpoint's key. */
    junctionColumn: string;
}

/**
 * A table that declares a `manyToMany` through the junction.
 *
 * @group Policies
 */
export interface TableJunctionSide extends TableJunctionEndpoint {
    relation: ManyToManyDescriptor;
}

/**
 * A junction table, resolved from the `manyToMany` relations of compiled
 * tables: what the schema planner creates and the policy compiler derives the
 * junction's rules for.
 *
 * @group Policies
 */
export interface TableJunction {
    /** Bare table name. */
    table: string;
    /** Always `public`: the planner creates every junction there. */
    schema: string;
    /** The two endpoints, in [source, target] order of the first declaring relation. */
    endpoints: [TableJunctionSide, TableJunctionEndpoint];
    /** Every table that declares a relation through this junction, in input order. */
    declaringSides: TableJunctionSide[];
    /**
     * The junction's own columns beyond the two keys (`pivot`), merged across
     * every declaring side. Empty when there are none.
     */
    pivot: ColumnDescriptor[];
}

/**
 * Walk every table's `manyToMany` relations and aggregate the junction tables
 * they declare, keyed by junction table. Two tables may declare one junction
 * from opposite sides (`posts.tags` and `tags.posts` through `posts_tags`);
 * both become `declaringSides`, so the derived write grants consider both.
 * A relation whose target is not among `descriptors` is skipped.
 *
 * Pass every descriptor, views included. A view declares no junction (it has
 * no table to own one, and the planner plans none for it), so its
 * `manyToMany` relations are skipped; but a view is a valid *target* — the
 * junction keys into it without a foreign key — so it must be here for the
 * table that links to it to resolve its junction. Filtering views out before
 * the call loses every junction into a view.
 *
 * Input order decides the endpoints' order and the sides' — sort by slug at
 * the boundary, as the planner does.
 *
 * @group Policies
 */
export function resolveTableJunctions(descriptors: readonly TableDescriptor[]): Map<string, TableJunction> {
    const bySlug = new Map(descriptors.map(descriptor => [descriptor.slug, descriptor]));
    const junctions = new Map<string, TableJunction>();
    for (const descriptor of descriptors) {
        if (descriptor.kind === "view") continue;
        for (const relation of descriptor.relations) {
            if (relation.kind !== "manyToMany") continue;
            const target = bySlug.get(relation.target);
            if (!target) continue;
            const raw = relation.through.table;
            // The CREATE TABLE path strips a schema prefix from the name and
            // creates in `public`; the policies target the same table.
            const table = raw.includes(".") ? raw.split(".").pop() ?? raw : raw;
            const side: TableJunctionSide = { descriptor, junctionColumn: relation.through.sourceKey, relation };
            const existing = junctions.get(table);
            if (!existing) {
                junctions.set(table, {
                    table,
                    schema: "public",
                    endpoints: [side, { descriptor: target, junctionColumn: relation.through.targetKey }],
                    declaringSides: [side],
                    pivot: mergePivot([], relation.through.pivot, table, descriptor)
                });
                continue;
            }
            // Merged whether or not this side is new: one table can reach a
            // junction under two relation names, and every column each asks
            // for has to exist.
            existing.pivot = mergePivot(existing.pivot, relation.through.pivot, table, descriptor);
            if (!existing.declaringSides.some(s => s.descriptor === descriptor)) existing.declaringSides.push(side);
        }
    }
    return junctions;
}

/**
 * Fold one side's `pivot` into the junction's, refusing a disagreement: one
 * table is created, so two descriptions of a column that are not the same
 * description have no correct answer.
 */
function mergePivot(
    into: ColumnDescriptor[],
    incoming: readonly ColumnDescriptor[],
    table: string,
    descriptor: TableDescriptor
): ColumnDescriptor[] {
    if (incoming.length === 0) return into;
    const merged = [...into];
    for (const column of incoming) {
        const already = merged.find(existing => existing.key === column.key);
        if (!already) {
            merged.push(column);
            continue;
        }
        if (JSON.stringify(already) !== JSON.stringify(column)) {
            throw new Error(
                `The junction table "${table}" is declared from more than one side, and they disagree ` +
                `about the pivot column "${column.key}": "${descriptor.slug}" describes it differently than ` +
                "another declaring table does. One table is created, so both `pivot` lists have to describe " +
                "the same column — or only one side should declare it."
            );
        }
    }
    return merged;
}

/**
 * The policy compiler's view of a junction table: its two key columns (by
 * column name, as the junction rules name them) and its pivot columns.
 *
 * @group Policies
 */
export function junctionPolicyTable(junction: TableJunction): PolicyTable {
    const columns: Record<string, PolicyColumn> = {};
    for (const endpoint of junction.endpoints) {
        columns[endpoint.junctionColumn] = { column: endpoint.junctionColumn, claimCast: "text" };
    }
    // After the keys, so a pivot column colliding with a key column cannot
    // replace it.
    for (const column of junction.pivot) {
        if (column.key === JUNCTION_PIVOT_KEY || column.key in columns) continue;
        columns[column.key] = { column: column.column, claimCast: claimCastOf(column.type) };
    }
    return {
        slug: junction.table,
        table: junction.table,
        schema: junction.schema,
        columns,
        links: {},
        idKey: "id",
        rules: [],
        auth: false
    };
}

/**
 * The derived rules of a junction of compiled tables ({@link junctionRules}).
 *
 * @group Policies
 */
export function tableJunctionRules(junction: TableJunction): SecurityRule[] {
    const endpoint = (end: TableJunctionEndpoint): PolicyJunctionEndpoint => ({
        table: policyTableFromDescriptor(end.descriptor),
        junctionColumn: end.junctionColumn
    });
    return junctionRules({
        table: junction.table,
        schema: junction.schema,
        endpoints: [endpoint(junction.endpoints[0]), endpoint(junction.endpoints[1])],
        declaringSides: junction.declaringSides.map(endpoint)
    });
}
