import { PolicyExpression, policy } from "@rebasepro/types";

/**
 * A tiny, regex-based SQL "parser" for security rules.
 *
 * This is NOT a full SQL parser. It is designed to handle the subset of SQL
 * commonly used in `USING` and `WITH CHECK` clauses, enough to drive the
 * optimistic client-side UI decision.
 *
 * It handles:
 * - `field = 'literal'`
 * - `field != 'literal'`
 * - `field = current_setting('app.user_id')`
 * - `A AND B`
 * - `true`
 * - `IN (...)` (as optimistic true)
 *
 * For anything it doesn't understand, it returns a `raw` expression, which
 * the evaluator treats as "unknown" (and usually optimistic true).
 */
export function sqlToPolicy(sql: string): PolicyExpression {
    const trimmed = sql.trim();

    if (trimmed.toLowerCase() === "true") return policy.true();
    if (trimmed.toLowerCase() === "false") return policy.false();

    // Handle roles overlap (&&)
    // Matches: string_to_array(auth.roles(), ',') && ARRAY['admin', 'editor']
    const overlapMatch = trimmed.match(/^string_to_array\s*\(\s*auth\.roles\(\)\s*,\s*','\s*\)\s*&&\s*ARRAY\s*\[(.+)\]$/i);
    if (overlapMatch) {
        const roles = overlapMatch[1].split(",").map(s => s.trim().replace(/^'|'$/g, ""));
        return policy.rolesOverlap(roles);
    }

    // Handle roles containment (@>)
    // Matches: string_to_array(auth.roles(), ',') @> ARRAY['admin']
    const containMatch = trimmed.match(/^string_to_array\s*\(\s*auth\.roles\(\)\s*,\s*','\s*\)\s*@>\s*ARRAY\s*\[(.+)\]$/i);
    if (containMatch) {
        const roles = containMatch[1].split(",").map(s => s.trim().replace(/^'|'$/g, ""));
        return policy.rolesContain(roles);
    }

    // Handle OR
    if (trimmed.toUpperCase().includes(" OR ")) {
        const parts = trimmed.split(/ OR /i);
        return policy.or(...parts.map(sqlToPolicy));
    }

    // Handle AND (very basic split, doesn't handle nested parens properly)
    if (trimmed.toUpperCase().includes(" AND ")) {
        const parts = trimmed.split(/ AND /i);
        return policy.and(...parts.map(sqlToPolicy));
    }

    // Handle = and !=
    const match = trimmed.match(/^(.+?)\s*(!?=)\s*(.+)$/);
    if (match) {
        const [, leftStr, op, rightStr] = match;
        const left = parseOperand(leftStr.trim());
        const right = parseOperand(rightStr.trim());
        if (left && right) {
            return policy.compare(left, op === "=" ? "eq" : "neq", right);
        }
    }

    // Fallback to raw
    return policy.raw(sql);
}

function parseOperand(str: string) {
    // current_setting('app.user_id') or auth.uid()
    if (/current_setting\s*\(\s*'app\.user_id'\s*\)/i.test(str) || /auth\.uid\(\)/i.test(str)) {
        return policy.authUid();
    }

    // Literal string: 'value'
    const stringMatch = str.match(/^'(.+)'$/);
    if (stringMatch) {
        return policy.literal(stringMatch[1]);
    }

    // Bare field name
    if (/^\w+$/.test(str)) {
        return policy.field(str);
    }

    return null;
}
