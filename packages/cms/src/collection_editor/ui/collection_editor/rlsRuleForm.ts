import { isPolicyShorthand, isRedactedSecurityRule } from "@rebasepro/types";
import type {
    AuthenticatedSecurityRule,
    CheckedAccessSecurityRule,
    ConditionalAccessSecurityRule,
    OwnerSecurityRule,
    PolicyCondition,
    PublicSecurityRule,
    RawSQLCheckOnlySecurityRule,
    RawSQLSecurityRule,
    RedactedSecurityRule,
    RegisteredSecurityRule,
    RolesOnlySecurityRule,
    SecurityRule,
    StructuredSecurityRule
} from "@rebasepro/types";
import type {
    CollectionConfig
} from "@rebasepro/cms-types";
import { policyConditionToExpression } from "@rebasepro/common";
import { policyToPostgres } from "@rebasepro/cms-types";

/**
 * Which form a declared rule is written in, as the RLS tab sees it.
 *
 * The tab's form edits a rule as a policy — name, command, mode, roles and
 * raw USING / WITH CHECK — and writes back only the fields it changed. For
 * the forms it has always handled (`raw`, `owner`, `public`, a structured
 * `PolicyExpression` condition, `roles_only`) that is enough. The forms below
 * it has no field for, and opened in it they would show empty clauses that a
 * save could only replace:
 *
 * - `shorthand`: a `PolicyShorthand` condition / check (`{ status: "published" }`);
 * - `conditional_access`: `access` together with a condition / check;
 * - `authenticated`: bare `access: "authenticated"`;
 * - `registered`: bare `access: "registered"`;
 * - `redacted`: the server withheld the rule's clauses from this caller.
 *
 * Those are shown read-only (see {@link isEditableInForm}): listed with what
 * they mean, and saved exactly as written — rewriting one into another shape
 * would rename its policy.
 */
export type RlsRuleForm =
    | "raw" | "owner" | "public" | "structured" | "roles_only"
    | "shorthand" | "conditional_access" | "authenticated" | "registered" | "redacted";

/**
 * Every `SecurityRule` member {@link rlsRuleForm} classifies. A member added
 * to the union and not listed here fails to compile at
 * {@link RULE_FORMS_COVER_THE_UNION} — the one place to decide how the tab
 * treats it.
 */
type ClassifiedRule =
    | OwnerSecurityRule | PublicSecurityRule | AuthenticatedSecurityRule | RegisteredSecurityRule
    | ConditionalAccessSecurityRule | CheckedAccessSecurityRule | StructuredSecurityRule
    | RawSQLSecurityRule | RawSQLCheckOnlySecurityRule | RolesOnlySecurityRule | RedactedSecurityRule;
const RULE_FORMS_COVER_THE_UNION: [Exclude<SecurityRule, ClassifiedRule>] extends [never] ? true : false = true;
void RULE_FORMS_COVER_THE_UNION;

/** The {@link RlsRuleForm} of a declared rule. */
export function rlsRuleForm(rule: SecurityRule): RlsRuleForm {
    if (isRedactedSecurityRule(rule)) return "redacted";
    if (rule.using != null || rule.withCheck != null) return "raw";
    if (rule.ownerField != null) return "owner";
    if (rule.access !== undefined) {
        if (rule.condition != null || rule.check != null) return "conditional_access";
        if (rule.access === "authenticated") return "authenticated";
        return rule.access === "registered" ? "registered" : "public";
    }
    if (isPolicyShorthand(rule.condition) || isPolicyShorthand(rule.check)) return "shorthand";
    if (rule.condition != null || rule.check != null) return "structured";
    return "roles_only";
}

/** Whether the tab's form can edit a rule of this form without losing what it says. */
export function isEditableInForm(form: RlsRuleForm): boolean {
    switch (form) {
        case "raw":
        case "owner":
        case "public":
        case "structured":
        case "roles_only":
            return true;
        case "shorthand":
        case "conditional_access":
        case "authenticated":
        case "registered":
        case "redacted":
            return false;
    }
}

/**
 * A condition / check as the SQL it compiles to — a shorthand
 * `{ status: "published" }` reads `status = 'published'`, with each key
 * resolved to its column. Falls back to the condition as JSON when it does
 * not compile (an invalid object), so a listing never throws.
 */
export function describeCondition(condition: PolicyCondition, collection?: CollectionConfig): string {
    try {
        return policyToPostgres(policyConditionToExpression(condition), collection);
    } catch {
        return JSON.stringify(condition);
    }
}
