import type { DefaultRls, RlsDescriptor, RlsPosture, SecurityRule } from "@rebasepro/types";

/**
 * What {@link resolveRls} returns: the resolved posture, or why there is none.
 *
 * @group Schema
 */
export type RlsResolution =
    | { ok: true; rls: RlsDescriptor }
    | { ok: false; message: string };

/**
 * A table's `rls` (and `defaultPolicies`) resolved against the project's
 * `defaultRls`.
 *
 * - `"admin-only"` → `{ posture: "admin-only", rules: [], defaultPolicies: true }`.
 * - a list → `{ posture: "rules", rules, defaultPolicies }`, the rules exactly
 *   as written: a policy's name is a hash of its rule, so a rule is never
 *   reordered, copied key by key or normalized.
 * - `"inherit"` → the project's `defaultRls`, resolved the same way and marked
 *   `inherited`.
 *
 * Refused, never defaulted: a missing or empty posture, `"inherit"` without a
 * `defaultRls`, and `"admin-only"` (written or inherited) beside
 * `defaultPolicies: false`, which would leave the table readable by nobody at
 * all — not even the admins it is locked to.
 *
 * @param posture What the table wrote. Typed `unknown` because a JavaScript
 *   caller, or a cast, can hand over anything; every shape is checked here.
 *
 * @group Schema
 */
export function resolveRls(
    posture: RlsPosture | unknown,
    defaultPolicies: boolean | undefined,
    defaultRls: DefaultRls | undefined
): RlsResolution {
    if (posture === "inherit") {
        if (defaultRls === undefined) {
            return {
                ok: false,
                message:
                    "`rls: \"inherit\"` takes the project's `defaultRls`, and none was given. Export " +
                    "`defaultRls` from backend/schema/index.ts (`\"admin-only\"` or a list of rules), or write " +
                    "this table's own `rls`."
            };
        }
        const inherited = resolveRls(defaultRls, defaultPolicies, undefined);
        if (!inherited.ok) {
            return { ok: false, message: `\`rls: "inherit"\` resolves to the project's \`defaultRls\`, which is unusable: ${inherited.message}` };
        }
        return { ok: true, rls: { ...inherited.rls, inherited: true } };
    }
    if (posture === "admin-only") {
        if (defaultPolicies === false) {
            return {
                ok: false,
                message:
                    "`rls: \"admin-only\"` with `defaultPolicies: false` grants nobody anything: \"admin-only\" " +
                    "is exactly the injected admin baseline, and `defaultPolicies: false` removes it. Drop " +
                    "`defaultPolicies: false`, or replace \"admin-only\" with the rules that should apply."
            };
        }
        return { ok: true, rls: { posture: "admin-only", rules: [], defaultPolicies: true, ...(defaultPolicies === true ? { declaredDefaultPolicies: true } : {}) } };
    }
    if (Array.isArray(posture)) {
        if (posture.length === 0) {
            return {
                ok: false,
                message:
                    "`rls: []` grants nothing and says nothing. Write `rls: \"admin-only\"` to lock the table " +
                    "to admins, or list the rules that grant access."
            };
        }
        const rules: SecurityRule[] = [];
        for (const rule of posture) {
            if (typeof rule !== "object" || rule === null) {
                return { ok: false, message: "every entry of `rls` must be a security rule object." };
            }
            if ("redacted" in rule) {
                return {
                    ok: false,
                    message:
                        "an entry of `rls` carries `redacted`, the marker `GET /api/schema/tables` serves in place of a " +
                        "rule whose SQL it withheld. It describes a policy and cannot become one: write the rule itself."
                };
            }
            rules.push(rule);
        }
        return { ok: true, rls: { posture: "rules", rules, defaultPolicies: defaultPolicies !== false, ...(defaultPolicies === true ? { declaredDefaultPolicies: true } : {}) } };
    }
    return {
        ok: false,
        message:
            "the table has no usable `rls`. Every table needs an explicit row-level security posture: " +
            "`\"admin-only\"`, `\"inherit\"` (the `defaultRls` exported from backend/schema/index.ts), or a " +
            "non-empty list of rules."
    };
}

// ── Rule shape ───────────────────────────────────────────────────────────────

/** The clause keys of a rule whose combinations the `SecurityRule` union restricts. */
type RuleClauseKey = "ownerField" | "access" | "using" | "withCheck" | "condition" | "check";

/**
 * Every pair of clauses the `SecurityRule` union excludes, read off its
 * variants' `never` fields:
 *
 * - `OwnerSecurityRule`: `ownerField` excludes `access`, `using`, `withCheck`,
 *   `condition` and `check`;
 * - `PublicSecurityRule` / `AuthenticatedSecurityRule` /
 *   `RegisteredSecurityRule` / `ConditionalAccessSecurityRule` /
 *   `CheckedAccessSecurityRule`: `access` excludes `ownerField`, `using` and
 *   `withCheck` (it combines with `condition` / `check`);
 * - `StructuredSecurityRule`: `condition` / `check` exclude `ownerField`,
 *   `using` and `withCheck`;
 * - `RawSQLSecurityRule` / `RawSQLCheckOnlySecurityRule`: `using` /
 *   `withCheck` exclude `ownerField`, `access`, `condition` and `check`.
 *
 * `roles`, `mode`, `pgRoles`, `name` and `operation(s)` combine with all of
 * them (`roles` is ANDed on).
 */
const EXCLUDED_PAIRS: readonly (readonly [RuleClauseKey, RuleClauseKey])[] = [
    ["access", "ownerField"],
    ["access", "using"],
    ["access", "withCheck"],
    ["ownerField", "using"],
    ["ownerField", "withCheck"],
    ["ownerField", "condition"],
    ["ownerField", "check"],
    ["condition", "using"],
    ["condition", "withCheck"],
    ["check", "using"],
    ["check", "withCheck"]
];

const ACCESS_VALUES: readonly unknown[] = ["public", "authenticated", "registered"];
const MODE_VALUES: readonly unknown[] = ["permissive", "restrictive"];
const OPERATION_VALUES: readonly unknown[] = ["select", "insert", "update", "delete", "all"];

/** Whether a rule carries a clause: present and not `null`/`undefined` (what the policy compiler tests). */
function carries(rule: object, key: RuleClauseKey): boolean {
    const value: unknown = Reflect.get(rule, key);
    return value !== undefined && value !== null && value !== "";
}

/** The pairs of clauses a rule carries that the `SecurityRule` union excludes. */
export function excludedClausePairs(rule: object): (readonly [RuleClauseKey, RuleClauseKey])[] {
    return EXCLUDED_PAIRS.filter(([a, b]) => carries(rule, a) && carries(rule, b));
}

/** The remedy for one excluded pair: what to write instead. */
function remedyFor(a: RuleClauseKey, b: RuleClauseKey): string {
    const pair = new Set([a, b]);
    if (pair.has("access") && pair.has("ownerField")) {
        return "For rows the caller owns, write `{ ownerField }` alone. To grant the `access` callers the rows that " +
            "match a test, write `access` with a `condition` (`condition: policy.compare(policy.field(\"<column>\"), \"eq\", policy.authUid())` " +
            "is the owner test as a condition).";
    }
    if (pair.has("access")) {
        return "Raw SQL carries no `access` gate: write `access` with a structured `condition` / `check`, or put the " +
            "caller test into the SQL (`rebase.uid()`), without `access`.";
    }
    if (pair.has("ownerField")) {
        return "Write the owner test into the other clause (`policy.compare(policy.field(\"<column>\"), \"eq\", " +
            "policy.authUid())` in a `condition`, or `<column> = rebase.uid()` in raw SQL), or split it into two rules.";
    }
    return "Write the whole test in one form: a structured `condition` / `check`, or raw `using` / `withCheck`.";
}

/**
 * What is wrong with one rule's shape, independent of the table's columns:
 * clauses the `SecurityRule` union excludes from each other (see
 * {@link excludedClausePairs}), and an `access`, `mode`, `operation`,
 * `operations` or `roles` value the type does not allow.
 *
 * Refused rather than resolved: the policy compiler used to pick one clause
 * of such a rule by the order of its checks, so `{ access: "authenticated",
 * ownerField }` compiled to "every signed-in caller" and dropped the owner
 * test, and a misspelt `mode: "restricitve"` compiled to a permissive policy.
 *
 * @param label How the message names the rule (`rule #2`, `rule "owner_read"`).
 *
 * @group Schema
 */
export function ruleShapeProblems(rule: object, label: string): string[] {
    const problems: string[] = [];
    for (const [a, b] of excludedClausePairs(rule)) {
        problems.push(`${label} combines \`${a}\` with \`${b}\`, which the SecurityRule type does not allow: a policy ` +
            `cannot honour both, and a policy that honours one widens the other. ${remedyFor(a, b)}`);
    }
    const access: unknown = Reflect.get(rule, "access");
    if (access !== undefined && !ACCESS_VALUES.includes(access)) {
        problems.push(`${label} has \`access: ${JSON.stringify(access)}\`. \`access\` is "public", "authenticated" ` +
            "(any signed-in caller, guests included) or \"registered\" (a signed-in caller with an account).");
    }
    const mode: unknown = Reflect.get(rule, "mode");
    if (mode !== undefined && !MODE_VALUES.includes(mode)) {
        problems.push(`${label} has \`mode: ${JSON.stringify(mode)}\`, which would compile as "permissive". ` +
            "Write \"permissive\" (the default: any passing rule grants) or \"restrictive\" (every one must pass).");
    }
    const operation: unknown = Reflect.get(rule, "operation");
    if (operation !== undefined && !OPERATION_VALUES.includes(operation)) {
        problems.push(`${label} has \`operation: ${JSON.stringify(operation)}\`. Write one of "select", "insert", ` +
            "\"update\", \"delete\" or \"all\".");
    }
    const operations: unknown = Reflect.get(rule, "operations");
    if (operations !== undefined && (!Array.isArray(operations) || operations.some(op => !OPERATION_VALUES.includes(op)))) {
        problems.push(`${label} has \`operations: ${JSON.stringify(operations)}\`. Write a list of "select", ` +
            "\"insert\", \"update\", \"delete\" and \"all\".");
    }
    const roles: unknown = Reflect.get(rule, "roles");
    if (roles !== undefined && (!Array.isArray(roles) || roles.some(role => typeof role !== "string"))) {
        problems.push(`${label} has \`roles: ${JSON.stringify(roles)}\`. \`roles\` is a list of application role ` +
            "names, such as `[\"editor\"]`.");
    }
    return problems;
}

/**
 * What a legacy rule's clause compiled to before tables replaced collections,
 * when the policy compiler resolved the first match of `condition`, `using`,
 * `access: "public"`, `ownerField` and ignored the rest (`access:
 * "authenticated"` was no value it knew).
 */
function legacyClauseMeaning(rule: object, clause: "using" | "withCheck"): string {
    if (clause === "withCheck") {
        if (carries(rule, "check")) return "its structured `check`";
        if (carries(rule, "withCheck")) return "its raw `withCheck` SQL";
    }
    if (carries(rule, "condition")) return "its structured `condition`";
    if (carries(rule, "using")) return "its raw `using` SQL";
    if (Reflect.get(rule, "access") === "public") return "every caller (`access: \"public\"`)";
    if (carries(rule, "ownerField")) return `owner-only rows (\`${String(Reflect.get(rule, "ownerField"))} = rebase.uid()\`)`;
    return "nothing (a policy that grants no row)";
}

/**
 * Why a legacy collection rule cannot be carried to a table as written, or
 * `undefined` when it can. What `rebase migrate collections-to-tables`
 * refuses so that a migration never resolves a rule to a different clause
 * than it compiled to: every combination {@link ruleShapeProblems} refuses,
 * with what the rule meant on the previous version (whichever clause its
 * compiler checked first) and what to write to keep that.
 *
 * @group Schema
 */
export function legacyRuleRefusal(rule: object, label: string): string | undefined {
    const shape = ruleShapeProblems(rule, label);
    if (shape.length === 0) return undefined;
    const using = legacyClauseMeaning(rule, "using");
    const withCheck = legacyClauseMeaning(rule, "withCheck");
    const meant = using === withCheck
        ? `On the previous version this rule granted ${using}.`
        : `On the previous version this rule's USING granted ${using} and its WITH CHECK ${withCheck}.`;
    return `${shape.join(" ")} ${meant} Write that clause alone — \`{ ownerField }\` for owner-only rows, or ` +
        "`access` with a `condition` to grant those callers the rows that match it — and migrate again.";
}

/** The operations a legacy rule applies to — `operations` wins over `operation`, `"all"` by default. */
function legacyOperations(rule: object): string[] {
    const operations: unknown = Reflect.get(rule, "operations");
    if (Array.isArray(operations) && operations.length > 0) return operations.filter((op): op is string => typeof op === "string");
    const operation: unknown = Reflect.get(rule, "operation");
    return [typeof operation === "string" ? operation : "all"];
}

/**
 * The roles a caller who is not signed in holds: an anonymous request carries
 * `anon`, and a rule naming `public` matches every caller.
 */
const ROLES_WITHOUT_SIGN_IN = ["anon", "public"];

/**
 * How a legacy rule that is carried as written compiles to a different
 * policy than it did on the previous version, or `undefined` when it does not.
 *
 * The previous compiler read `condition`, else `using`, else `access:
 * "public"`, else `ownerField` for USING (`check`, else `withCheck`, else the
 * same for WITH CHECK), ANDed `roles` on (a restrictive rule: `NOT roles OR
 * clause`, or `NOT roles` alone), and knew no other `access` value. The
 * current one ANDs `access: "authenticated"` / `"registered"` onto every
 * clause, or makes it the clause when there is none. `"public"` meant `true`
 * on both. So, for a rule {@link legacyRuleRefusal} accepts with a gating
 * `access` (which excludes `ownerField` and raw SQL), each policy clause the
 * rule's operations need is either:
 *
 * - **a clause it had** (`condition`, or `check` for WITH CHECK): `X` became
 *   `access AND X` — a narrowing, felt by whoever passes `X` without passing
 *   `access`. With `roles`, only a role holder who fails `access` feels it: a
 *   guest under `"registered"`, or a caller not signed in holding `anon` /
 *   `public`; under `"authenticated"` with any other role, nobody;
 * - **no clause**: the previous policy had none — it granted nothing, or, for
 *   a restrictive rule, denied every caller it applied to — and now has
 *   `access`: a widening (permissive or restrictive, with or without
 *   `roles`), except a permissive role grant (`roles` alone admitted the
 *   holders), which only narrows as above.
 *
 * The verdict is per clause and the first change found is described,
 * widenings first. A policy's name never moves with this: it is a hash of the
 * rule as written. `test/schema/legacy-rule-meaning-sweep.test.ts` checks this
 * against the previous compiler over every combination of clauses.
 *
 * @group Schema
 */
export function legacyRuleMeaningChange(rule: object): string | undefined {
    const access: unknown = Reflect.get(rule, "access");
    // The previous compiler knew `"public"` (USING `true`, as now): every
    // shape it is accepted in compiles as it did.
    if (access === undefined || access === "public") return undefined;
    const rolesValue: unknown = Reflect.get(rule, "roles");
    const roles = Array.isArray(rolesValue) ? rolesValue.filter((role): role is string => typeof role === "string") : [];
    const hasRoles = roles.length > 0;
    const restrictive = Reflect.get(rule, "mode") === "restrictive";
    const hasCondition = carries(rule, "condition");
    const hasCheck = carries(rule, "check");
    const operations = legacyOperations(rule);
    const needsUsing = operations.some(op => op !== "insert");
    const needsWithCheck = operations.some(op => op !== "select" && op !== "delete");

    const accessText = `\`access: ${JSON.stringify(access)}\``;
    const signedIn = access === "registered"
        ? "every signed-in caller with an account (guests excluded)"
        : "every signed-in caller, guests included";
    const roleList = roles.map(role => JSON.stringify(role)).join(", ");
    /** A holder of the roles who fails `access`: a guest under "registered", or a caller not signed in. */
    const holderMayFail = access === "registered" || roles.some(role => ROLES_WITHOUT_SIGN_IN.includes(role));
    const failingHolders = access === "registered"
        ? (roles.some(role => ROLES_WITHOUT_SIGN_IN.includes(role)) ? "guests and callers who are not signed in" : "guests (anonymous sign-ins)")
        : "callers who are not signed in";

    /** A holder of the roles who passes `access`: anyone holding a role a signed-in caller can hold. */
    const holderMayPass = roles.some(role => role !== "anon");

    // Per clause the operations need: whether the rule had one there, and so
    // whether `access` widened it (no clause before) or narrowed it.
    const clauses = [
        ...(needsUsing ? [hasCondition] : []),
        ...(needsWithCheck ? [hasCheck || hasCondition] : [])
    ].map(had => ({
        had,
        widens: !had && (hasRoles ? restrictive && holderMayPass : true),
        narrows: hasRoles ? holderMayFail && (had || !restrictive) : had
    }));

    // Widenings first: a clause the previous policy did not have.
    if (clauses.some(({ widens }) => widens)) {
        if (restrictive && hasRoles) {
            return `This restrictive rule gates the holders of ${roleList}. The previous version did not know ` +
                `${accessText}, so it denied them every row. Carried as written it now lets ${signedIn} among them ` +
                "through. To keep denying them, drop `access` (a restrictive `{ roles }` rule alone denies its role holders).";
        }
        if (restrictive) {
            return `${accessText} was not a value the previous version knew, so this restrictive rule passed nobody: it ` +
                `denied every caller. Carried as written it now lets ${signedIn} through. To keep denying everyone, write ` +
                "the restriction as `condition: policy.false()`; to restrict to callers with an account, write `access: \"registered\"`.";
        }
        if (hasCheck && !hasCondition) {
            return `This rule has a \`check\` and no \`condition\`: on the previous version it had no USING clause and ` +
                `granted no existing row for ${operations.join("/")}. It now grants ${signedIn} every existing row. To ` +
                "keep granting no existing row, make the rule `operation: \"insert\"`; to grant some, add a `condition`.";
        }
        return `${accessText} was not a value the previous version knew, so this rule granted nothing. Carried as ` +
            `written it now admits ${signedIn}. To keep granting only callers with an account, write ` +
            "`access: \"registered\"`; to keep granting nothing, remove the rule.";
    }

    // Narrowings: `access` now ANDed onto what was there (or onto `roles`).
    if (!clauses.some(({ narrows }) => narrows)) return undefined;
    if (hasRoles && clauses.every(({ had }) => !had)) {
        return `${accessText} was not a value the previous version knew, so this rule admitted every holder of ` +
            `${roleList}. It now also requires ${signedIn}, so ${failingHolders} holding them are refused. To keep the ` +
            "old meaning, drop `access`.";
    }
    if (hasRoles) {
        return `${accessText} was ignored by the previous version, so this rule's clauses admitted every holder of ` +
            `${roleList} they matched. It now also requires ${signedIn}, so ${failingHolders} holding them are refused. ` +
            "To keep the old meaning, drop `access`.";
    }
    if (hasCondition) {
        return `${accessText} was ignored by the previous version, so this rule's \`condition\` admitted any caller, ` +
            `signed in or not. It now admits only ${signedIn} to the rows it matches. To keep the old meaning, write ` +
            "`access: \"public\"` with the same condition.";
    }
    return `${accessText} was ignored by the previous version, so any caller could insert a row matching this rule's ` +
        `\`check\`. It now admits only ${signedIn}. To keep the old meaning, write \`access: "public"\`.`;
}
