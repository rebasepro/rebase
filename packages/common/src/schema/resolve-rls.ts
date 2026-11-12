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
    defaultPolicies: false | undefined,
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
        return { ok: true, rls: { posture: "admin-only", rules: [], defaultPolicies: true } };
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
            rules.push(rule);
        }
        return { ok: true, rls: { posture: "rules", rules, defaultPolicies: defaultPolicies !== false } };
    }
    return {
        ok: false,
        message:
            "the table has no usable `rls`. Every table needs an explicit row-level security posture: " +
            "`\"admin-only\"`, `\"inherit\"` (the `defaultRls` exported from backend/schema/index.ts), or a " +
            "non-empty list of rules."
    };
}
