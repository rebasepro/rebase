import type { Check, DbPolicy, DbSnapshot, Finding, Severity } from "../types";
import { SEVERITIES } from "../types";

import { callerIdCall, finding, listAnd, policyTargetsExposedRole, qi, qrel } from "./util";

const ID = "policy-anonymous-tautology";

/**
 * `auth.uid() IS NOT NULL` and its relatives.
 *
 * What this expression *means* depends entirely on the stack in front of the
 * database, and getting that wrong would fire a critical finding on essentially
 * every Supabase project in existence:
 *
 *   - Supabase: `auth.uid()` reads a JWT claim and returns NULL for an anonymous
 *     caller, so the expression is a legitimate "signed in" test. Its only real
 *     failing is that it does not scope rows to their owner — worth `low`, worded
 *     as a design observation rather than a vulnerability.
 *   - Rebase / PostgREST-style stacks that coerce a missing id to a sentinel
 *     (`'anonymous'`, `''`): the expression is true for signed-out callers, so it
 *     is a straight authentication bypass. This exact policy shipped in this
 *     project and granted anonymous access for weeks.
 *   - Anything else: it comes down to whether the stack coerces, which the
 *     database cannot tell us. `medium`, and say so out loud.
 *
 * A guard that excludes the sentinel is the corrected form and clears the policy.
 * A guard that excludes *something else* is the interesting case — see
 * {@link matchTautology}.
 */
export const policyAnonymousTautology: Check = {
    id: ID,
    title: "Policy only checks that a caller id exists",
    description:
        "A policy whose expression is `auth.uid() IS NOT NULL`-shaped: it separates signed-in " +
        "from signed-out callers but scopes no rows.",

    run(snapshot: DbSnapshot): Finding[] {
        const uidCall = callerIdCall(snapshot);
        const findings: Finding[] = [];
        const { severity: baseSeverity, meaning, impactSuffix } = platformReading(snapshot.platform);

        for (const policy of snapshot.policies) {
            if (!snapshot.schemas.includes(policy.schema)) continue;
            if (!policy.permissive) continue;

            const exposed = policyTargetsExposedRole(snapshot, policy);
            if (exposed.length === 0) continue;

            const clauses: string[] = [];
            const usingMatch = matchTautology(policy.using);
            const checkMatch = matchTautology(policy.withCheck);
            if (usingMatch) clauses.push("USING");
            if (checkMatch) clauses.push("WITH CHECK");
            if (clauses.length === 0) continue;

            const shape = usingMatch?.shape ?? checkMatch?.shape ?? "the caller id";
            const decoys = [
                ...new Set([...(usingMatch?.decoyGuards ?? []), ...(checkMatch?.decoyGuards ?? [])])
            ];
            const severity = forCommand(baseSeverity, policy.command);
            const written = decoys.map((d) => `\`${shape} <> '${d}'\``);

            findings.push(
                finding({
                    id: ID,
                    severity,
                    confidence: "heuristic",
                    title:
                        decoys.length > 0
                            ? `Policy "${policy.name}" on ${policy.schema}.${policy.table} excludes ` +
                              `${listAnd(decoys.map((d) => `'${d}'`))}, which is not the anonymous sentinel`
                            : `Policy "${policy.name}" on ${policy.schema}.${policy.table} only checks ` +
                              `that ${shape} is not null`,
                    target: { schema: policy.schema, table: policy.table, policy: policy.name },
                    detail:
                        (decoys.length > 0
                            ? `The ${listAnd(clauses)} expression of this ${policy.command} policy reads as ` +
                              `"signed in": it tests that ${shape} is non-null and excludes ` +
                              `${listAnd(written)}. But the id a signed-out caller actually arrives with is ` +
                              `${listAnd(CLEARING_SENTINELS.map(describeSentinel))}, and neither is ` +
                              `${listAnd(decoys.map((d) => `'${d}'`))} — so the guard excludes nobody and the ` +
                              `null test stands on its own. `
                            : `The ${listAnd(clauses)} expression of this ${policy.command} policy tests only ` +
                              `that ${shape} is non-null. `) +
                        `It does not compare anything to a column, so every row of the table satisfies it ` +
                        `equally — the policy distinguishes signed-in from signed-out callers and nothing ` +
                        `else. ${meaning}` +
                        (policy.command === "ALL" || policy.command === "UPDATE" || policy.command === "DELETE"
                            ? ` This policy governs ${policy.command === "ALL" ? "every command, writes included" : policy.command}, ` +
                              `so the same expression decides who may change rows, not only who may read them.`
                            : ""),
                    impact:
                        `Any caller for whom ${shape} is non-null can reach every row this policy covers, ` +
                        `including rows belonging to other users or tenants. ${impactSuffix}` +
                        (decoys.length > 0
                            ? ` A policy in this shape reads as safe on review, which is why it survives: the ` +
                              `guard is present, spelled plausibly, and matches nothing.`
                            : ""),
                    fix:
                        `-- Scope the policy to the row's owner rather than to the existence of an id:\n` +
                        `ALTER POLICY ${qi(policy.name)} ON ${qrel(policy.schema, policy.table)}\n` +
                        `    USING (user_id = ${uidCall});\n` +
                        `-- If the intent really is "any signed-in user", exclude every id your stack has\n` +
                        `-- ever used for "nobody" — one literal is not enough:\n` +
                        `--     USING (${uidCall} IS NOT NULL AND ${uidCall} <> ALL (ARRAY['anonymous', 'anon']));`
                })
            );
        }

        return findings;
    }
};

/**
 * Writes are worse than reads.
 *
 * The platform decides whether this expression is a bypass at all; the command
 * decides what it costs when it is. A `FOR ALL` policy in this shape governed
 * `UPDATE` and `DELETE` on a live users table — an anonymous PATCH setting
 * `roles: ["admin"]` was reachable through it — while the same predicate under
 * `FOR SELECT` would only have leaked. One step, not two: the platform reading
 * is still the dominant term.
 */
function forCommand(base: Severity, command: DbPolicy["command"]): Severity {
    if (command !== "ALL" && command !== "UPDATE" && command !== "DELETE") return base;
    return SEVERITIES[Math.min(SEVERITIES.indexOf(base) + 1, SEVERITIES.length - 1)];
}

const describeSentinel = (s: string) => (s === "" ? "the empty string" : `'${s}'`);

function platformReading(platform: DbSnapshot["platform"]): {
    severity: Severity;
    meaning: string;
    impactSuffix: string;
} {
    switch (platform) {
        case "supabase":
            return {
                severity: "low",
                meaning:
                    `On Supabase, \`auth.uid()\` returns NULL for an anonymous request, so this is a ` +
                    `working authenticated-only check rather than a bypass. It is listed because it ` +
                    `only distinguishes signed-in from signed-out; it does not scope rows to their owner.`,
                impactSuffix:
                    `Anonymous callers are correctly excluded on Supabase, so this is a data-scoping ` +
                    `gap between signed-in users, not an anonymous-access hole.`
            };
        case "rebase":
        case "postgrest":
            return {
                severity: "critical",
                meaning:
                    `On this stack a request without a session is given a sentinel id (an 'anonymous' ` +
                    `string rather than NULL), so this expression is true for signed-out callers too — ` +
                    `it authorises everyone.`,
                impactSuffix:
                    `Because signed-out requests arrive with a sentinel id rather than NULL, this ` +
                    `includes unauthenticated callers.`
            };
        default:
            return {
                severity: "medium",
                meaning:
                    `Whether this excludes anonymous callers depends on the layer in front of the ` +
                    `database: if it leaves the setting unset for signed-out requests the expression is ` +
                    `false and this is merely loose; if it coerces them to a sentinel id (an empty ` +
                    `string or 'anonymous') the expression is true and this authorises everyone.`,
                impactSuffix:
                    `Whether unauthenticated callers are included depends on whether your stack coerces ` +
                    `a missing caller id to a sentinel value — check that before judging the severity.`
            };
    }
}

/**
 * Both schema spellings, deliberately.
 *
 * This runs over policy bodies read back from a live database, and those outlive
 * the release that wrote them: Rebase moved its helpers from `auth` to `rebase`
 * at 1.0, so a database mid-migration holds both, and a Supabase database holds
 * `auth.*` for good. A security check that stops recognising a dangerous clause
 * because a schema was renamed is a check that silently turned itself off.
 */
const CALLER_ID_CALLS: { re: RegExp; label: (m: RegExpExecArray) => string }[] = [
    { re: /(?:rebase|auth)\.uid\s*\(\s*\)/g, label: (m) => m[0].replace(/\s+/g, "") },
    { re: /auth\.role\s*\(\s*\)/g, label: () => "auth.role()" },
    { re: /(?:rebase|auth)\.roles\s*\(\s*\)/g, label: (m) => m[0].replace(/\s+/g, "") },
    { re: /(?:rebase|auth)\.jwt\s*\(\s*\)/g, label: (m) => m[0].replace(/\s+/g, "") },
    { re: /current_setting\s*\(\s*('[^']*')\s*(?:,\s*[a-z]+\s*)?\)/g, label: (m) => `current_setting(${m[1]})` }
];

/**
 * The ids that a signed-out caller can actually arrive with, so excluding one of
 * them is a real guard.
 *
 * `'anonymous'` is Rebase's `ANONYMOUS_USER_ID`; the empty string is what a
 * PostgREST-shaped stack leaves an unset claim as. Deliberately **not** the whole
 * of Rebase's `ANONYMOUS_USER_IDS`: that list also carries `'anon'`, the id the
 * request path reported before the sentinel was unified, and a policy excluding
 * only `'anon'` does not exclude anyone on any server shipping today. Treating
 * `'anon'` as clearing is exactly the mistake this check now exists to catch.
 */
const CLEARING_SENTINELS = ["anonymous", ""];

interface TautologyMatch {
    /** How to name the caller-id expression in prose, e.g. `auth.uid()`. */
    shape: string;
    /** Literals the policy excludes that exclude nobody. Empty for a bare null test. */
    decoyGuards: string[];
}

/**
 * Recognise "the policy tests that a caller id exists, and nothing that narrows
 * which rows" — and report which no-op guards it wears while doing so.
 *
 * Two rules keep this honest.
 *
 * **Every conjunct has to be accounted for.** `auth.uid() IS NOT NULL AND user_id
 * = auth.uid()` contains the shape and is a perfectly scoped policy; a substring
 * match would flag it, and flagging correct Supabase policies is the fastest way
 * to get this tool deleted. So the expression is split on `AND`, each conjunct is
 * classified, and a single conjunct this function does not recognise means it
 * stays quiet. An `OR` anywhere means the same — the shape no longer describes
 * what the policy admits.
 *
 * **A guard only clears if it excludes an id somebody can actually arrive with.**
 * The version before this one bailed on the literal string `<> 'anonymous'`, which
 * meant `<> 'anon'` fell past the bail and then failed to match the bare-null-test
 * shape, so the function returned null and the check said nothing at all. That is
 * not a near miss: it is the precise predicate that left a production `users`
 * table — password hashes included — readable by the entire internet for three and
 * a half weeks, and this tool was run against that database and reported clean.
 * A guard naming the wrong literal is now the *loudest* case, not the silent one,
 * because it is the one that survives code review.
 */
function matchTautology(clause: string | null | undefined): TautologyMatch | null {
    if (!clause) return null;

    const flat = clause
        .toLowerCase()
        // Casts first: `'anonymous'::text`, `array[...]::text[]`.
        .replace(/::\s*[a-z0-9_]+(?:\s*\[\s*\])*/g, "")
        .replace(/\s+/g, " ")
        .trim();

    for (const { re, label } of CALLER_ID_CALLS) {
        const first = new RegExp(re.source).exec(flat);
        if (!first) continue;

        const substituted = flat.replace(new RegExp(re.source, "g"), " callerid ");
        // `OR` changes what the policy admits; this shape no longer describes it.
        if (/\bor\b/.test(substituted)) return null;

        let sawNullTest = false;
        const decoys: string[] = [];
        let cleared = false;

        for (const raw of splitTopLevelAnd(substituted)) {
            const conjunct = canon(raw);
            if (conjunct === "") continue;

            if (conjunct === "callerid is not null") {
                sawNullTest = true;
                continue;
            }

            const excluded = excludedLiterals(conjunct);
            if (!excluded) return null; // something we do not understand: stay quiet
            if (excluded.some((lit) => CLEARING_SENTINELS.includes(lit))) cleared = true;
            decoys.push(...excluded);
        }

        if (!sawNullTest) continue;
        if (cleared) return null;

        return { shape: label(first), decoyGuards: [...new Set(decoys)] };
    }

    return null;
}

/**
 * Split on `AND`, counting parens.
 *
 * A plain `.split(/\band\b/)` is what the first attempt used and it does not
 * survive contact with Postgres, which reads an expression back fully
 * parenthesised: `((uid() IS NOT NULL) AND (uid() <> 'anon'))` splits into two
 * fragments with unbalanced parens, neither of which matches anything, so the
 * check goes quiet on precisely the input it exists for. Depth is tracked, quoted
 * literals are skipped so an `and` inside a string is not a separator, and each
 * part is re-split so nested conjunctions flatten.
 */
function splitTopLevelAnd(expr: string): string[] {
    const s = peel(expr);
    const parts: string[] = [];
    let depth = 0;
    let inQuote = false;
    let start = 0;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "'") {
            inQuote = !inQuote;
            continue;
        }
        if (inQuote) continue;
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (depth === 0 && s.startsWith("and", i) && isWord(s, i, 3)) {
            parts.push(s.slice(start, i));
            i += 2;
            start = i + 1;
        }
    }
    parts.push(s.slice(start));

    return parts.length === 1 ? parts : parts.flatMap(splitTopLevelAnd);
}

/** `and` as a whole word, not the tail of `brand` or the head of `android`. */
function isWord(s: string, at: number, length: number): boolean {
    const before = at === 0 ? "" : s[at - 1];
    const after = s[at + length] ?? "";
    return !/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after);
}

/** Remove balanced wrapping parens: `((x))` -> `x`, but `(a) and (b)` is left alone. */
function peel(fragment: string): string {
    let s = fragment.trim();
    while (s.startsWith("(") && s.endsWith(")") && balanced(s.slice(1, -1))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

/** Strip the noise Postgres adds when it rewrites an expression. */
function canon(fragment: string): string {
    let s = peel(
        fragment
            .replace(/\bselect\b/g, " ")
            // `( SELECT rebase.uid() AS uid)` is how a wrapped call reads back.
            .replace(/\bas [a-z0-9_]+/g, " ")
            .replace(/\s+/g, " ")
    );

    let previous: string;
    do {
        previous = s;
        s = peel(s.replace(/\(\s*(callerid)\s*\)/g, "$1").trim());
    } while (s !== previous);

    return s.replace(/\s+/g, " ").trim();
}

function balanced(s: string): boolean {
    let depth = 0;
    for (const ch of s) {
        if (ch === "(") depth++;
        else if (ch === ")" && --depth < 0) return false;
    }
    return depth === 0;
}

/**
 * The literals a conjunct excludes the caller id from, or `null` if the conjunct
 * is not an exclusion at all.
 *
 * `null` is the conservative answer and the common one: `user_id = callerid`
 * lands here and silences the whole check, which is correct, because that
 * conjunct scopes rows.
 */
function excludedLiterals(conjunct: string): string[] | null {
    let m = /^callerid (?:<>|!=) '([^']*)'$/.exec(conjunct);
    if (m) return [m[1]];

    m = /^'([^']*)' (?:<>|!=) callerid$/.exec(conjunct);
    if (m) return [m[1]];

    m = /^callerid (?:<>|!=) all \( ?array \[(.*)\] ?\)$/.exec(conjunct);
    if (m) return literalList(m[1]);

    m = /^callerid not in \((.*)\)$/.exec(conjunct);
    if (m) return literalList(m[1]);

    return null;
}

/** `'a', 'b'` -> `["a", "b"]`; `null` if any element is not a plain literal. */
function literalList(inner: string): string[] | null {
    const out: string[] = [];
    for (const part of inner.split(",")) {
        const m = /^ ?'([^']*)' ?$/.exec(part);
        if (!m) return null;
        out.push(m[1]);
    }
    return out.length > 0 ? out : null;
}
