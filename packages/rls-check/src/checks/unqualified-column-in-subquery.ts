import type { Check, DbPolicy, DbRelation, DbSnapshot, Finding } from "../types";

import { SQL_KEYWORDS, findSubqueries, isBareIdent, matchParen, tokenize, type SqlToken } from "./sql";
import { finding, hasColumn, isRebaseManagedPolicy, managedPolicyFix, qi, qrel, relationAt } from "./util";

const ID = "unqualified-column-in-subquery";

/**
 * A bare column reference inside a policy subquery that resolves to the *inner*
 * relation when the outer row was meant.
 *
 * This is the bug this whole tool exists for. Postgres resolves an unqualified
 * name against the innermost scope that has it, silently, with no warning — so
 *
 *     USING (EXISTS (SELECT 1 FROM org_members
 *                    WHERE user_id = auth.uid() AND organization_id = id))
 *
 * where the author meant `organizations.id` compares `org_members.organization_id`
 * to `org_members.id`. The correlation to the outer row disappears and the
 * predicate becomes something completely different — in the case this codebase
 * actually shipped, one that denied every row to everyone. Fail-open variants of
 * the same mistake are equally possible.
 *
 * Two deliberate restrictions keep the false-positive rate near zero:
 *
 *   - Only the subquery's *predicate* is examined. A bare name in the select
 *     list (`IN (SELECT org_id FROM members)`) is correct by construction.
 *   - The bare name has to be compared against something that could be a column.
 *     `WHERE user_id = auth.uid()` binds to the inner table on purpose, and
 *     flagging it merely because the outer table also has a `user_id` would fire
 *     on a large fraction of correct policies.
 *
 * Confidence is always heuristic, and the detail says why an absence proves
 * nothing: `pg_policies.qual` is Postgres's re-rendering of the parse tree, and
 * it normally re-qualifies references. A finding here therefore means the
 * ambiguity survived that rewrite, which is strong evidence — but a clean scan
 * is not proof that the original SQL was unambiguous.
 */
export const unqualifiedColumnInSubquery: Check = {
    id: ID,
    title: "Unqualified column inside a policy subquery",
    description:
        "A bare column name in an EXISTS/IN subquery that exists on both the inner relation and " +
        "the policy's own table, so Postgres binds it to the inner one.",

    run(snapshot: DbSnapshot): Finding[] {
        const findings: Finding[] = [];

        for (const policy of snapshot.policies) {
            if (!snapshot.schemas.includes(policy.schema)) continue;

            const outer = relationAt(snapshot, policy.schema, policy.table);
            if (!outer) continue;

            for (const clause of ["USING", "WITH CHECK"] as const) {
                const expr = clause === "USING" ? policy.using : policy.withCheck;
                if (!expr) continue;

                for (const hit of scanExpression(snapshot, outer, expr)) {
                    findings.push(buildFinding(snapshot, policy, outer, clause, hit));
                }
            }
        }

        return findings;
    }
};

interface Ambiguity {
    /** The bare name as written. */
    column: string;
    /** The relation Postgres binds it to. */
    inner: string;
    /** What it is compared against, for the report. */
    comparedTo: string;
}

interface FromItem {
    schema?: string;
    name: string;
    alias?: string;
}

const FROM_TERMINATORS = new Set([
    "where", "group", "having", "order", "limit", "offset", "union", "intersect",
    "except", "window", "fetch", "returning"
]);
const JOIN_WORDS = new Set(["join", "inner", "left", "right", "full", "outer", "cross", "natural", "lateral"]);
const COMPARISONS = new Set(["=", "<>", "!=", "<", ">", "<=", ">=", "~~", "!~", "is", "like", "ilike", "in"]);

function scanExpression(snapshot: DbSnapshot, outer: DbRelation, expr: string): Ambiguity[] {
    const tokens = tokenize(expr);
    const subqueries = findSubqueries(tokens);
    const seen = new Set<string>();
    const out: Ambiguity[] = [];

    for (const sub of subqueries) {
        // A subquery's own tokens exclude anything belonging to a subquery nested
        // inside it — those are analysed on their own pass, against their own FROM.
        const nested = subqueries.filter((s) => s !== sub && s.open > sub.open && s.close < sub.close);
        const own: number[] = [];
        for (let i = sub.open + 1; i < sub.close; i++) {
            if (nested.some((n) => i >= n.open && i <= n.close)) continue;
            own.push(i);
        }

        const from = parseFrom(tokens, own);
        if (from.length === 0) continue;

        const relations = from
            .map((item) => resolveRelation(snapshot, outer.schema, item))
            .filter((r): r is DbRelation => Boolean(r))
            // A self-reference has no "outer vs inner" distinction worth warning
            // about: the author selected from this very table, so binding to the
            // inner copy is the ordinary reading.
            .filter((r) => !(r.schema === outer.schema && r.name === outer.name));
        if (relations.length === 0) continue;

        const aliases = new Set(from.map((f) => f.alias).filter((a): a is string => Boolean(a)));

        for (const idx of predicateIndices(tokens, own)) {
            const token = tokens[idx];
            if (token.kind !== "ident" || token.quoted) continue;
            if (SQL_KEYWORDS.has(token.value) || aliases.has(token.value)) continue;
            if (!isBareIdent(tokens, idx)) continue;
            if (!hasColumn(outer, token.value)) continue;

            const inner = relations.find((r) => hasColumn(r, token.value));
            if (!inner) continue;

            const partner = comparisonPartner(tokens, own, idx);
            if (!partner) continue;

            const key = `${token.value}|${inner.schema}.${inner.name}`;
            if (seen.has(key)) continue;
            seen.add(key);

            out.push({ column: token.value, inner: `${inner.schema}.${inner.name}`, comparedTo: partner });
        }
    }

    return out;
}

/** Relation references in the subquery's FROM list, with their aliases. */
function parseFrom(tokens: SqlToken[], own: number[]): FromItem[] {
    const start = own.findIndex((i) => tokens[i].kind === "ident" && tokens[i].value === "from");
    if (start === -1) return [];

    const items: FromItem[] = [];
    let expectRelation = true;

    for (let k = start + 1; k < own.length; k++) {
        const t = tokens[own[k]];

        if (t.kind === "ident" && FROM_TERMINATORS.has(t.value)) break;
        if (t.kind === "punct" && t.value === ",") {
            expectRelation = true;
            continue;
        }
        if (t.kind === "ident" && JOIN_WORDS.has(t.value)) {
            expectRelation = true;
            continue;
        }
        // `ON <predicate>` / `USING (...)` — skip to the next join or comma.
        if (t.kind === "ident" && (t.value === "on" || t.value === "using")) {
            expectRelation = false;
            continue;
        }
        if (!expectRelation || t.kind !== "ident") continue;

        // schema.name[.…] — take the last two parts.
        const parts: string[] = [t.value];
        let k2 = k;
        while (
            tokens[own[k2 + 1]]?.kind === "punct" &&
            tokens[own[k2 + 1]]?.value === "." &&
            tokens[own[k2 + 2]]?.kind === "ident"
        ) {
            parts.push(tokens[own[k2 + 2]].value);
            k2 += 2;
        }

        const item: FromItem = parts.length > 1
            ? { schema: parts[parts.length - 2], name: parts[parts.length - 1] }
            : { name: parts[0] };

        // Optional alias, with or without AS.
        let after = tokens[own[k2 + 1]];
        if (after?.kind === "ident" && after.value === "as") {
            k2 += 1;
            after = tokens[own[k2 + 1]];
        }
        if (after?.kind === "ident" && !SQL_KEYWORDS.has(after.value) && !JOIN_WORDS.has(after.value)) {
            item.alias = after.value;
            k2 += 1;
        }

        items.push(item);
        k = k2;
        expectRelation = false;
    }

    return items;
}

/** Token indices that sit in a WHERE or JOIN … ON predicate of this subquery. */
function predicateIndices(tokens: SqlToken[], own: number[]): number[] {
    const out: number[] = [];
    let inPredicate = false;

    for (let k = 0; k < own.length; k++) {
        const t = tokens[own[k]];
        if (t.kind === "ident") {
            if (t.value === "where" || t.value === "on") {
                inPredicate = true;
                continue;
            }
            if (FROM_TERMINATORS.has(t.value) && t.value !== "where") {
                inPredicate = false;
                continue;
            }
            if (JOIN_WORDS.has(t.value)) {
                inPredicate = false;
                continue;
            }
        }
        if (inPredicate) out.push(own[k]);
    }

    return out;
}

/**
 * What the bare name is compared with, or null when it is not compared with
 * something that could be a column.
 *
 * Literals, function calls and NULL tests are excluded on purpose: those
 * predicates mean what they say when bound to the inner relation, and the outer
 * table happening to share the column name is a coincidence, not a bug.
 */
function comparisonPartner(tokens: SqlToken[], own: number[], idx: number): string | null {
    const pos = own.indexOf(idx);
    if (pos === -1) return null;

    const at = (offset: number): SqlToken | undefined => tokens[own[pos + offset]];

    let partnerStart: number;
    if (at(1)?.kind === "op" && COMPARISONS.has(at(1)!.value)) partnerStart = pos + 2;
    else if (at(1)?.kind === "ident" && COMPARISONS.has(at(1)!.value)) partnerStart = pos + 2;
    else if (at(-1)?.kind === "op" && COMPARISONS.has(at(-1)!.value)) partnerStart = pos - 2;
    else if (at(-1)?.kind === "ident" && COMPARISONS.has(at(-1)!.value)) partnerStart = pos - 2;
    else return null;

    const step = partnerStart > pos ? 1 : -1;
    const head = tokens[own[partnerStart]];
    if (!head || head.kind !== "ident") return null;
    if (head.value === "null" || head.value === "true" || head.value === "false") return null;

    // Walk the dotted name in whichever direction the partner lies.
    const parts: string[] = [head.value];
    let cursor = partnerStart;
    while (
        tokens[own[cursor + step]]?.kind === "punct" &&
        tokens[own[cursor + step]]?.value === "." &&
        tokens[own[cursor + 2 * step]]?.kind === "ident"
    ) {
        const next = tokens[own[cursor + 2 * step]].value;
        if (step > 0) parts.push(next);
        else parts.unshift(next);
        cursor += 2 * step;
    }

    // A trailing `(` makes it a function call, not a column.
    const tail = step > 0 ? tokens[own[cursor + 1]] : tokens[own[partnerStart + 1]];
    if (tail?.kind === "punct" && tail.value === "(") return null;

    return parts.join(".");
}

function resolveRelation(
    snapshot: DbSnapshot,
    policySchema: string,
    item: FromItem
): DbRelation | undefined {
    if (item.schema) return relationAt(snapshot, item.schema, item.name);

    const local = relationAt(snapshot, policySchema, item.name);
    if (local) return local;

    // Unqualified and not in the policy's schema: only accept an unambiguous hit.
    const candidates = snapshot.relations.filter(
        (r) => r.name === item.name && snapshot.schemas.includes(r.schema)
    );
    return candidates.length === 1 ? candidates[0] : undefined;
}

function buildFinding(
    snapshot: DbSnapshot,
    policy: DbPolicy,
    outer: DbRelation,
    clause: "USING" | "WITH CHECK",
    hit: Ambiguity
): Finding {
    return finding({
        id: ID,
        severity: "high",
        confidence: "heuristic",
        title:
            `Policy "${policy.name}" on ${policy.schema}.${policy.table}: does \`${hit.column}\` in ` +
            `the subquery mean ${outer.name}.${hit.column} or ${hit.inner}.${hit.column}?`,
        target: {
            schema: policy.schema,
            table: policy.table,
            policy: policy.name,
            column: hit.column
        },
        detail:
            `In the ${clause} expression, \`${hit.column}\` is written unqualified inside a subquery ` +
            `over ${hit.inner}, compared against \`${hit.comparedTo}\`. Both ${hit.inner} and ` +
            `${policy.schema}.${policy.table} have a column named \`${hit.column}\`, and Postgres ` +
            `resolves the bare name against the innermost scope that has it — so it binds to ` +
            `${hit.inner}.${hit.column}, not to the outer row. If the intent was to correlate the ` +
            `subquery with the row being checked, that correlation is not happening.\n\n` +
            `Note that \`pg_policies\` shows Postgres's own re-rendering of the policy, which usually ` +
            `re-qualifies column references. A match here means the ambiguity survived that rewrite, ` +
            `so it is strong evidence — but the absence of a match on other policies is not proof ` +
            `that they are unambiguous.`,
        impact:
            `The predicate does not mean what it reads like. Depending on the data it either matches ` +
            `far more rows than intended — exposing other users' or tenants' rows to anyone the policy ` +
            `applies to — or, if the inner comparison is never satisfiable, matches none, and the table ` +
            `silently returns empty results.`,
        fix: isRebaseManagedPolicy(snapshot, policy)
            ? managedPolicyFix(
                policy,
                `qualify every reference in the rule's condition so the binding is explicit — ` +
                `\`${hit.inner}.${hit.column}\` and \`${policy.table}.${hit.column}\` are different columns, ` +
                `and the bare name binds to the inner one`
            )
            : `-- Qualify every reference so the binding is explicit:\n` +
            `ALTER POLICY ${qi(policy.name)} ON ${qrel(policy.schema, policy.table)}\n` +
            `    ${clause === "USING" ? "USING" : "WITH CHECK"} (EXISTS (\n` +
            `        SELECT 1 FROM ${hit.inner}\n` +
            `        WHERE ${hit.inner}.${hit.comparedTo.includes(".") ? hit.comparedTo.split(".").pop() : hit.comparedTo}\n` +
            `            = ${policy.table}.${hit.column}\n` +
            `    ));\n` +
            `-- Verify the intended direction first — this rewrite assumes the outer row was meant.`
    });
}
