import { isPolicyShorthand } from "@rebasepro/types";
import type { PolicyCondition, PolicyExpression, SecurityRule, TenantSource } from "@rebasepro/types";

/**
 * The legacy spellings of the rule vocabulary, rewritten as the table model
 * spells them, when a legacy collection is lifted.
 *
 * Before tables replaced collections in the backend vocabulary, two places in
 * a rule said `collection`: the join table of `policy.existsIn({ collection,
 * where })` and the membership table of `tenant.from.membership.collection`.
 * Both are `table` now. A legacy collection written against the old types,
 * or loaded from a frozen corpus, still carries the old key; lifted, it says
 * `table`, so a migrated project's source reads in the new vocabulary.
 *
 * Policy names do not move: an unnamed policy's name hashes the rule with
 * every `existsIn` node read back in its old spelling (`getPolicyNameHash`).
 * The node is rebuilt as `policy.existsIn` builds one (`kind`, `table`,
 * `where`), which is the key order that frozen spelling restores.
 *
 * @group Migration
 */
export function liftRuleSpelling(rule: SecurityRule): SecurityRule {
    if ("condition" in rule && rule.condition !== undefined && "check" in rule) {
        const condition = liftCondition(rule.condition);
        const check = rule.check === undefined ? undefined : liftCondition(rule.check);
        if (condition === rule.condition && check === rule.check) return rule;
        return { ...rule, condition, ...(check !== undefined ? { check } : {}) };
    }
    if ("condition" in rule && rule.condition !== undefined) {
        const condition = liftCondition(rule.condition);
        return condition === rule.condition ? rule : { ...rule, condition };
    }
    if ("check" in rule && rule.check !== undefined) {
        const check = liftCondition(rule.check);
        return check === rule.check ? rule : { ...rule, check };
    }
    return rule;
}

/**
 * A tenant source with a legacy `membership.collection` spelled `table`.
 *
 * @group Migration
 */
export function liftTenantSourceSpelling(source: TenantSource): TenantSource {
    if (!("membership" in source)) return source;
    const membership = source.membership;
    const legacy = "collection" in membership && typeof membership.collection === "string" ? membership.collection : undefined;
    if (legacy === undefined) return source;
    return { membership: { table: legacy, userField: membership.userField, tenantField: membership.tenantField } };
}

function liftCondition(condition: PolicyCondition): PolicyCondition {
    return isPolicyShorthand(condition) ? condition : liftExpression(condition);
}

/**
 * The expression with every legacy `existsIn` node respelled, or the same
 * object when it holds none — so a rule already in the new spelling, or with
 * no `existsIn`, is passed through untouched.
 */
function liftExpression(expr: PolicyExpression): PolicyExpression {
    switch (expr.kind) {
        case "and":
        case "or": {
            const operands = expr.operands.map(liftExpression);
            return operands.every((operand, i) => operand === expr.operands[i]) ? expr : { kind: expr.kind, operands };
        }
        case "not": {
            const operand = liftExpression(expr.operand);
            return operand === expr.operand ? expr : { kind: "not", operand };
        }
        case "existsIn": {
            const legacy = "collection" in expr && typeof expr.collection === "string" ? expr.collection : undefined;
            const where = liftExpression(expr.where);
            if (legacy === undefined && where === expr.where) return expr;
            return { kind: "existsIn", table: legacy ?? expr.table, where };
        }
        default:
            return expr;
    }
}
