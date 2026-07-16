import {
    CollectionConfig,
    PolicyExpression,
    PolicyOperand,
    Relation,
    SecurityRule,
    isPostgresCollectionConfig,
    policy
} from "@rebasepro/types";
import { getPolicyOperations } from "@rebasepro/utils";
import { getTableName } from "./relations";
import { resolveCollectionRelations } from "./relations";
import { securityRuleToConditions } from "./policy/securityRuleToConditions";

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

/** One side of a junction: the collection and the FK column pointing at it. */
export interface JunctionEndpoint {
    collection: CollectionConfig;
    /** Junction column holding this endpoint's key. */
    junctionColumn: string;
}

/** A collection that declares the `through` relation (owns the edge semantics). */
export interface JunctionDeclaringSide extends JunctionEndpoint {
    relation: Relation;
}

export interface JunctionSpec {
    /** Bare table name (schema stripped). */
    table: string;
    /** Schema the junction is created in — mirrors the CREATE TABLE path. */
    schema: string;
    /** The two endpoints, in [source, target] order of the first declaring relation. */
    endpoints: [JunctionEndpoint, JunctionEndpoint];
    /** Every collection that declares a relation through this table. */
    declaringSides: JunctionDeclaringSide[];
}

// Mirrors auth-default-policies: the server context or an admin.
const SERVER_OR_ADMIN_EXPR: PolicyExpression = policy.or(
    policy.serverContext(),
    policy.rolesOverlap(["admin"])
);

/**
 * Walk every collection's resolved relations and aggregate the junction tables
 * they declare. Two collections may declare the same junction from opposite
 * sides (posts→tags and tags→posts through `posts_tags`); both become
 * `declaringSides` of one spec, so derived write grants consider both.
 */
export function resolveJunctionSpecs(collections: CollectionConfig[]): Map<string, JunctionSpec> {
    const specs = new Map<string, JunctionSpec>();

    for (const collection of collections) {
        const resolved = resolveCollectionRelations(collection);
        for (const relation of Object.values(resolved)) {
            if (!relation.through) continue;

            const targetCollection: CollectionConfig | undefined =
                typeof relation.target === "function" ? relation.target() : undefined;
            if (!targetCollection) continue;

            const rawName = relation.through.table;
            // The CREATE TABLE path strips a schema prefix from the name but
            // still creates in "public"; the policies must target the same
            // table, so mirror that behaviour exactly.
            const table = rawName.includes(".") ? rawName.split(".").pop()! : rawName;
            const schema = "public";

            const source: JunctionDeclaringSide = {
                collection,
                junctionColumn: relation.through.sourceColumn,
                relation
            };
            const target: JunctionEndpoint = {
                collection: targetCollection,
                junctionColumn: relation.through.targetColumn
            };

            const existing = specs.get(table);
            if (!existing) {
                specs.set(table, {
                    table,
                    schema,
                    endpoints: [source, target],
                    declaringSides: [source]
                });
            } else if (!existing.declaringSides.some(s => s.collection === collection)) {
                existing.declaringSides.push(source);
            }
        }
    }

    return specs;
}

/**
 * A synthetic CollectionConfig standing in for the junction during policy
 * compilation and naming. Its two FK columns carry explicit `columnName`s so
 * `outerField` operands resolve to the exact columns the CREATE TABLE emitted,
 * whatever their casing.
 */
export function getJunctionCollectionConfig(spec: JunctionSpec): CollectionConfig {
    const properties: Record<string, unknown> = {};
    for (const endpoint of spec.endpoints) {
        properties[endpoint.junctionColumn] = {
            type: "string",
            columnName: endpoint.junctionColumn
        };
    }
    return {
        slug: spec.table,
        name: spec.table,
        table: spec.table,
        schema: spec.schema,
        properties
    } as unknown as CollectionConfig;
}

/** The property marked as the row id (falls back to `id`). */
function getIdPropertyName(collection: CollectionConfig): string {
    for (const [name, prop] of Object.entries(collection.properties ?? {})) {
        if (prop && typeof prop === "object" && "isId" in prop && (prop as { isId?: unknown }).isId) {
            return name;
        }
    }
    return "id";
}

/** `EXISTS (SELECT 1 FROM endpoint WHERE endpoint.pk = junction.fk [AND extra])`. */
function existsEndpoint(endpoint: JunctionEndpoint, extra?: PolicyExpression): PolicyExpression {
    const correlation = policy.compare(
        policy.field(getIdPropertyName(endpoint.collection)),
        "eq",
        policy.outerField(endpoint.junctionColumn)
    );
    return policy.existsIn({
        collection: endpoint.collection.slug,
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
            return where ? policy.existsIn({ collection: expr.collection, where }) : null;
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
 * The full derived policy set for a junction table: the locked server/admin
 * baseline, the endpoint-visibility read grant, inherited write grants, and
 * inherited restrictive gates. Returns `[]` when every declaring collection set
 * `disableDefaultPolicies` — the junction is then the author's to police, and
 * stays locked (RLS is still enabled) until they write policies for it.
 */
export function getJunctionSecurityRules(spec: JunctionSpec): SecurityRule[] {
    if (spec.declaringSides.every(side => side.collection.disableDefaultPolicies)) {
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
        const explicitRules = (isPostgresCollectionConfig(side.collection)
            ? side.collection.securityRules
            : undefined) ?? [];
        const updateRules = explicitRules.filter(coversUpdate);

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
