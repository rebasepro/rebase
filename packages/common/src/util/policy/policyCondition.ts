import {
    isPolicyExpressionKind,
    isPolicyShorthand,
    policy,
    type PolicyCondition,
    type PolicyExpression,
    type PolicyShorthand
} from "@rebasepro/types";

/**
 * Where a condition sits, for the messages {@link policyConditionToExpression}
 * refuses one with: the table, when known, and which clause.
 */
export interface PolicyConditionSite {
    table?: string;
    clause?: "condition" | "check";
}

/**
 * The {@link PolicyExpression} a rule's `condition` / `check` stands for.
 *
 * An expression is returned as it is — the same object, so a rule written in
 * the long form compiles exactly as it always has. A {@link PolicyShorthand}
 * is desugared, its columns in sorted order (so the SQL, like the policy
 * name, does not depend on the order the keys were written in):
 *
 * - `{ col: value }` → `policy.compare(policy.field("col"), "eq", policy.literal(value))`
 * - `{ col: null }`  → `policy.raw("{col} IS NULL")` — no comparison is ever
 *   true against NULL, so `IS NULL` is the only spelling that means it. Being
 *   `raw`, it is server-authoritative: the JavaScript evaluator answers
 *   `"unknown"` for it, which enforcement callers resolve fail-closed.
 * - several keys → `policy.and(...)` of the above.
 *
 * Refused, with the table and clause named: an object with a `kind` key that
 * no expression node has (a column called `kind`, or a misspelt node — the
 * two cannot be told apart, so neither is guessed), an empty object (an AND
 * of nothing is `true`, which would grant every row), and a value that is not
 * a string, finite number, boolean or `null`.
 */
export function policyConditionToExpression(condition: PolicyCondition, site: PolicyConditionSite = {}): PolicyExpression {
    if (isPolicyShorthand(condition)) return shorthandToExpression(condition, site);
    if (isPolicyExpressionKind(condition.kind)) return condition;
    throw new Error(describeInvalidCondition(condition, site));
}

/**
 * The columns a {@link PolicyShorthand} condition / check names, sorted — or
 * an empty list for anything else. What a compiler checks against the table.
 */
export function policyShorthandColumns(condition: PolicyCondition | undefined): string[] {
    return isPolicyShorthand(condition) ? Object.keys(condition).sort() : [];
}

function shorthandToExpression(shorthand: PolicyShorthand, site: PolicyConditionSite): PolicyExpression {
    const terms = Object.keys(shorthand).sort().map((column): PolicyExpression => {
        const value = shorthand[column];
        if (value !== null) return policy.compare(policy.field(column), "eq", policy.literal(value));
        // `raw` resolves `{column}` through the table's property → column
        // mapping, as a field operand does; the placeholder only reads a word.
        if (!/^\w+$/.test(column)) {
            throw new Error(
                `${where(site)} says \`${JSON.stringify(column)}: null\`, and a shorthand can only test a column ` +
                "whose key is a plain identifier for NULL. Write the test as raw SQL: " +
                "`policy.raw(\"<column> IS NULL\")`."
            );
        }
        return policy.raw(`{${column}} IS NULL`);
    });
    return terms.length === 1 ? terms[0] : policy.and(...terms);
}

const isShorthandValue = (value: unknown): boolean =>
    value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));

function where(site: PolicyConditionSite): string {
    const clause = `\`${site.clause ?? "condition"}\``;
    return site.table ? `A rule on "${site.table}" with a ${clause}` : `A rule's ${clause}`;
}

function describeInvalidCondition(condition: unknown, site: PolicyConditionSite): string {
    if (typeof condition !== "object" || condition === null || Array.isArray(condition)) {
        return `${where(site)} is ${JSON.stringify(condition)}, which is neither a policy expression nor a ` +
            "shorthand object such as `{ status: \"published\" }`.";
    }
    const entries = Object.entries(condition);
    if (entries.length === 0) {
        return `${where(site)} is \`{}\`. A shorthand with no column matches every row; write ` +
            "`policy.true()` if that is meant, or name the columns to match.";
    }
    if ("kind" in condition) {
        return `${where(site)} has \`kind: ${JSON.stringify(condition.kind)}\`, which is ` +
            "no policy expression. If it means a column called `kind`, a shorthand cannot say so — `kind` is how " +
            "an expression is recognised — so write it longhand: " +
            "`policy.compare(policy.field(\"kind\"), \"eq\", policy.literal(…))`.";
    }
    const bad = entries.find(([, value]) => !isShorthandValue(value));
    const column = bad?.[0] ?? entries[0][0];
    return `${where(site)} gives the column "${column}" the value ${JSON.stringify(bad?.[1])}. A shorthand ` +
        "compares each column with a string, a number, a boolean or `null`; write anything else as a policy " +
        "expression.";
}
