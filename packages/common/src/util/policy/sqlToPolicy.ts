import { ANONYMOUS_USER_ID, ANONYMOUS_USER_IDS, LiteralPolicyOperand, PolicyExpression, policy, rewriteLegacyRlsFunctions } from "@rebasepro/types";

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
 * - `field = current_setting('app.uid')` (or the legacy `app.user_id`)
 * - `A AND B`, `A OR B` — only where the keyword is at the top level
 * - `true`
 * - `IN (...)` (as optimistic true)
 *
 * For anything it doesn't understand, it returns a `raw` expression, which
 * the evaluator treats as "unknown" (and usually optimistic true).
 *
 * **This output also round-trips back into DDL** via `policyToPostgres` (the
 * schema/policy generators), so decomposing a clause the parser only partly
 * understands is not a cosmetic mistake — it emits invalid SQL. When in doubt,
 * prefer `raw`: it is reproduced verbatim.
 */
/** True when `keyword` starts at `i` as a standalone word. */
function isKeywordAt(upper: string, i: number, keyword: string): boolean {
    if (!upper.startsWith(keyword, i)) return false;
    const before = i === 0 ? " " : upper[i - 1];
    const after = upper[i + keyword.length] ?? " ";
    return /[\s()]/.test(before) && /[\s()]/.test(after);
}

/**
 * Split `sql` on a boolean keyword, but only where it sits at paren depth 0 and
 * outside a string literal. Returns null when it never does, so the caller
 * leaves the clause alone.
 *
 * This used to be `sql.split(/ AND /i)`, which tore subqueries in half: the
 * `AND` inside
 *   `EXISTS (SELECT 1 FROM organization_members m WHERE m.org = t.org AND m.user_id = rebase.uid())`
 * split the expression, and re-emitting the halves produced
 *   `(EXISTS (...) AND m.user_id = rebase.uid())`
 * where `m` is no longer in scope — SQL that Postgres rejects outright with
 * "missing FROM-clause entry for table". Returning null instead keeps such a
 * clause as a `raw` expression, which round-trips verbatim.
 */
function splitTopLevel(sql: string, keyword: "AND" | "OR"): string[] | null {
    const upper = sql.toUpperCase();
    const parts: string[] = [];
    let depth = 0;
    let inString = false;
    let start = 0;

    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (inString) {
            if (ch === "'") {
                if (sql[i + 1] === "'") i++; // '' escapes a quote inside a literal
                else inString = false;
            }
            continue;
        }
        if (ch === "'") { inString = true; continue; }
        if (ch === "(") { depth++; continue; }
        if (ch === ")") { depth--; continue; }
        if (depth === 0 && isKeywordAt(upper, i, keyword)) {
            parts.push(sql.slice(start, i));
            i += keyword.length - 1;
            start = i + 1;
        }
    }

    if (parts.length === 0) return null;
    parts.push(sql.slice(start));
    const trimmedParts = parts.map(p => p.trim()).filter(p => p.length > 0);
    return trimmedParts.length > 1 ? trimmedParts : null;
}

/** Drop redundant wrapping parens (`(a AND b)` → `a AND b`), never `(a) AND (b)`. */
function stripOuterParens(sql: string): string {
    let s = sql.trim();
    for (;;) {
        if (!s.startsWith("(") || !s.endsWith(")")) return s;
        let depth = 0;
        let inString = false;
        let wraps = true;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (inString) {
                if (ch === "'") {
                    if (s[i + 1] === "'") i++;
                    else inString = false;
                }
                continue;
            }
            if (ch === "'") { inString = true; continue; }
            if (ch === "(") depth++;
            else if (ch === ")") {
                depth--;
                if (depth === 0 && i < s.length - 1) { wraps = false; break; }
            }
        }
        if (!wraps) return s;
        s = s.slice(1, -1).trim();
    }
}

export function sqlToPolicy(sql: string): PolicyExpression {
    // Normalised before anything else looks at it, so every pattern below only
    // has to know the current spelling. A database migrated by a pre-1.0 release
    // still holds `auth.uid()` in its policy bodies until the next push or boot
    // recompiles them — and until then the admin UI reads those bodies back
    // through here. Without this they parse as opaque `raw`, and the framework's
    // own policies get badged as hand-written drift.
    //
    // Normalising rather than accepting both spellings throughout is deliberate:
    // it also means a legacy policy that falls through to `raw` is stored in the
    // new spelling, so editing and saving one in the Studio migrates it.
    const trimmed = stripOuterParens(rewriteLegacyRlsFunctions(sql).trim());

    if (trimmed.toLowerCase() === "true") return policy.true();
    if (trimmed.toLowerCase() === "false") return policy.false();

    // Handle roles overlap (&&)
    // Matches: string_to_array(rebase.roles(), ',') && ARRAY['admin', 'editor']
    const overlapMatch = trimmed.match(/^string_to_array\s*\(\s*rebase\.roles\(\)\s*,\s*','\s*\)\s*&&\s*ARRAY\s*\[(.+)\]$/i);
    if (overlapMatch) {
        const roles = overlapMatch[1].split(",").map(s => s.trim().replace(/^'|'$/g, ""));
        return policy.rolesOverlap(roles);
    }

    // Handle roles containment (@>)
    // Matches: string_to_array(rebase.roles(), ',') @> ARRAY['admin']
    const containMatch = trimmed.match(/^string_to_array\s*\(\s*rebase\.roles\(\)\s*,\s*','\s*\)\s*@>\s*ARRAY\s*\[(.+)\]$/i);
    if (containMatch) {
        const roles = containMatch[1].split(",").map(s => s.trim().replace(/^'|'$/g, ""));
        return policy.rolesContain(roles);
    }

    // OR binds looser than AND, so it splits first.
    const orParts = splitTopLevel(trimmed, "OR");
    if (orParts) return policy.or(...orParts.map(sqlToPolicy));

    const andParts = splitTopLevel(trimmed, "AND");
    if (andParts) return policy.and(...andParts.map(sqlToPolicy));

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

    // Fallback to raw — the NORMALISED text, not the input. Storing the input
    // verbatim would mean a legacy policy read out of a database, edited in the
    // Studio and saved, writes `auth.uid()` back into the project's config: a
    // call to a function 1.0 no longer creates.
    return policy.raw(trimmed);
}

/**
 * Literals from other BaaS platforms that people compare `rebase.uid()` against
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

/**
 * `rebase.uid() IS NOT NULL` in raw SQL, the clause that is always true.
 *
 * Both schema spellings, because this runs over policy bodies read back from a
 * database, and one migrated by a pre-1.0 release still holds `auth.uid()`.
 * A security check that stops recognising a dangerous clause because the
 * framework renamed a function is a check that silently turns off.
 */
const UID_NOT_NULL = /\b(?:rebase|auth)\.uid\(\)\s+IS\s+NOT\s+NULL/i;

/**
 * Find clauses that read as "signed-in users only" but admit anonymous callers.
 *
 * Both spellings come from the same place — Supabase, where its own `auth.uid()`
 * really is NULL for an anonymous request. Rebase substitutes
 * {@link ANONYMOUS_USER_ID} instead (a blank id would read back as NULL, which
 * is how the trusted *server* context is recognised), so:
 *
 *  - `rebase.uid() IS NOT NULL` is a tautology on the user path, and
 *  - `rebase.uid() != 'anon'` excludes one spelling of anonymous and admits the
 *    other. This one is not hypothetical and was not only a foreign habit:
 *    rebase's own request path reported `'anon'` while everything that compiled
 *    or checked a policy used `'anonymous'`, so whichever literal an author
 *    picked, half the anonymous callers walked through. See
 *    {@link ANONYMOUS_USER_IDS}.
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
                        explanation: "`rebase.uid() IS NOT NULL` is true for every request that came from a client, " +
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
                        "every caller. Use `condition: policy.authenticated()` to mean \"signed in\" — it " +
                        `compiles to NOT IN (${ANONYMOUS_USER_IDS.map(v => `'${v}'`).join(", ")}), covering ` +
                        "every spelling rebase has reported rather than whichever one you remember."
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
    // current_setting('app.uid') or rebase.uid(). `app.user_id` is the
    // pre-rename spelling and stays parseable: policies are data, so a
    // database provisioned before the rename still holds rules written
    // against it, and round-tripping one must not silently drop the operand.
    if (/current_setting\s*\(\s*'app\.(uid|user_id)'\s*\)/i.test(str) || /rebase\.uid\(\)/i.test(str)) {
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
