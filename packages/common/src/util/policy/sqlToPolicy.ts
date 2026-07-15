import { ANONYMOUS_USER_ID, LiteralPolicyOperand, PolicyExpression, policy } from "@rebasepro/types";

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

/**
 * Literals from other BaaS platforms that people compare `auth.uid()` against
 * out of habit. Mirrors the driver's `FOREIGN_CONVENTION_ROLES` guard on
 * `pgRoles`, one surface over: the same muscle memory inside a `using:` string
 * is the more dangerous spelling, because it inverts a rule instead of
 * emptying a table.
 */
const FOREIGN_CONVENTION_UIDS: Record<string, string> = {
    anon: "Supabase",
    authenticated: "Supabase",
    service_role: "Supabase"
};

/** A clause that reads as a lockdown but admits anonymous callers. */
export interface AnonymousGrantRisk {
    /** Which spelling was found. */
    pattern: "foreign-uid-literal" | "uid-not-null";
    /** The offending fragment — the literal, or the SQL that is a tautology. */
    detail: string;
    /** Why it admits anonymous callers, and what to write instead. */
    explanation: string;
}

/** `auth.uid() IS NOT NULL` in raw SQL, the clause that is always true. */
const UID_NOT_NULL = /auth\.uid\(\)\s+IS\s+NOT\s+NULL/i;

/**
 * Find clauses that read as "signed-in users only" but admit anonymous callers.
 *
 * Both spellings come from the same place — Supabase, where `auth.uid()` really
 * is NULL for an anonymous request. Rebase substitutes
 * {@link ANONYMOUS_USER_ID} instead (a blank id would read back as NULL, which
 * is how the trusted *server* context is recognised), so:
 *
 *  - `auth.uid() IS NOT NULL` is a tautology on the user path, and
 *  - `auth.uid() != 'anon'` compares against a string no caller ever has.
 *
 * Either one turns a lockdown into a full grant, and neither looks wrong. No
 * real user id is ever one of these literals, and a user-context request is
 * never NULL, so a match is always a mistake rather than a deliberate check.
 *
 * Structured expressions are checked too, not just parsed SQL: `policy.compare`
 * can spell the same mistake.
 */
export function findAnonymousGrants(expr: PolicyExpression): AnonymousGrantRisk[] {
    const found: AnonymousGrantRisk[] = [];

    const visit = (e: PolicyExpression): void => {
        switch (e.kind) {
            case "and":
            case "or":
                e.operands.forEach(visit);
                return;
            case "not":
                visit(e.operand);
                return;
            case "existsIn":
                visit(e.where);
                return;
            case "raw":
                if (UID_NOT_NULL.test(e.sql)) {
                    found.push({
                        pattern: "uid-not-null",
                        detail: e.sql,
                        explanation: "`auth.uid() IS NOT NULL` is true for every request that came from a client, " +
                            `including anonymous ones — they carry '${ANONYMOUS_USER_ID}', not NULL. ` +
                            "Use `condition: policy.authenticated()` to mean \"signed in\"."
                    });
                }
                return;
            case "compare": {
                const literal = [e.left, e.right].find(o => o.kind === "literal") as LiteralPolicyOperand | undefined;
                const comparesUid = e.left.kind === "authUid" || e.right.kind === "authUid";
                if (!comparesUid || typeof literal?.value !== "string") return;
                const platform = FOREIGN_CONVENTION_UIDS[literal.value];
                if (!platform) return;
                found.push({
                    pattern: "foreign-uid-literal",
                    detail: literal.value,
                    explanation: `'${literal.value}' is a ${platform} convention. Rebase reports an anonymous ` +
                        `request as '${ANONYMOUS_USER_ID}', so comparing against '${literal.value}' passes for ` +
                        "every caller. Use `condition: policy.authenticated()` to mean \"signed in\"."
                });
                return;
            }
            default:
                return;
        }
    };

    visit(expr);
    return found;
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
