import { isRedactedSecurityRule } from "@rebasepro/types";
import type {
    AuthenticatedSecurityRule,
    CheckedAccessSecurityRule,
    ConditionalAccessSecurityRule,
    OwnerSecurityRule,
    PolicyCondition,
    PostgresPolicy,
    PublicSecurityRule,
    RawSQLCheckOnlySecurityRule,
    RawSQLSecurityRule,
    RedactedSecurityRule,
    RolesOnlySecurityRule,
    SecurityRule,
    SecurityRuleAccess,
    SecurityRuleBase,
    StructuredSecurityRule
} from "@rebasepro/types";
import { policyToSecurityRule } from "@rebasepro/common";
import { getPolicyOperations } from "@rebasepro/utils";
import type { ListedPolicy } from "./policyListing";

/**
 * The security-rule fields a {@link PostgresPolicy} describes, and the ones an
 * edit carries over from the rule it changes.
 *
 * Wider than any one `SecurityRule` variant on purpose: an edit starts from the
 * rule as written and deletes and assigns the fields that changed one at a
 * time, and the variants are exclusive about which fields go together.
 */
export type PolicyRule = SecurityRuleBase & {
    using?: string;
    withCheck?: string;
    ownerField?: string;
    access?: SecurityRuleAccess;
    condition?: PolicyCondition;
    check?: PolicyCondition;
    /** Carried through untouched; a redacted rule is never edited ({@link ruleForm}). */
    redacted?: true;
};

/**
 * Which form a declared rule is written in — what the editor can do with it.
 *
 * Every rule form but one is editable as SQL: the editor shows the policy the
 * rule compiles to, and a field is only rewritten when the form changed it
 * ({@link applyPolicyEdit}), so an untouched rule — a `PolicyShorthand`
 * condition, `access` with a condition — is saved exactly as written, and
 * its policy keeps its name. The exception is `redacted`: the server withheld
 * the rule's clauses from this caller, so there is nothing to show or edit;
 * it is defined on the server.
 */
export type PolicyRuleForm =
    | "owner" | "access" | "conditional_access" | "structured" | "raw" | "roles_only" | "redacted";

/**
 * Every `SecurityRule` member {@link ruleForm} classifies. A member added to
 * the union and not listed here fails to compile at {@link RULE_FORMS_COVER_THE_UNION}
 * — the one place to decide how the editor treats it.
 */
type ClassifiedRule =
    | OwnerSecurityRule | PublicSecurityRule | AuthenticatedSecurityRule
    | ConditionalAccessSecurityRule | CheckedAccessSecurityRule | StructuredSecurityRule
    | RawSQLSecurityRule | RawSQLCheckOnlySecurityRule | RolesOnlySecurityRule | RedactedSecurityRule;
const RULE_FORMS_COVER_THE_UNION: [Exclude<SecurityRule, ClassifiedRule>] extends [never] ? true : false = true;
void RULE_FORMS_COVER_THE_UNION;

/** The {@link PolicyRuleForm} of a declared rule. */
export function ruleForm(rule: SecurityRule): PolicyRuleForm {
    if (isRedactedSecurityRule(rule)) return "redacted";
    if (rule.using != null || rule.withCheck != null) return "raw";
    if (rule.ownerField != null) return "owner";
    if (rule.access !== undefined) return rule.condition != null || rule.check != null ? "conditional_access" : "access";
    if (rule.condition != null || rule.check != null) return "structured";
    return "roles_only";
}

/** Why an edited policy could not be written back to a rule. */
export type PolicyEditRefusal =
    /** Rebase adds it (the admin baseline, tenancy); no declared rule holds it. */
    | "generated"
    /** It exists only in the database. */
    | "not_declared"
    /** Its rule covers several operations, and the policy is one of them. */
    | "several_operations"
    /** Its rule was served redacted: the clauses are defined on the server. */
    | "redacted";

export type PolicyEdit =
    | { ok: true; rules: PolicyRule[] }
    | { ok: false; reason: PolicyEditRefusal };

/**
 * Write an edit of one policy back to the declared rule it compiles from.
 *
 * The rule is the one the server says the policy was compiled from (the
 * served policy's `rule` index, carried on the listed row) — the server is the
 * one compiler, so the editor never guesses it from names. A policy with no
 * rule is Rebase's own (`generated`: the admin baseline, tenancy, a junction's
 * derived policies) or exists only in the database.
 *
 * A rule over several operations is refused rather than split: taking one
 * operation out renames every policy the rule compiles to.
 *
 * @param declared The table's declared rules (`rls.rules`), as written.
 * @param original The listed policy the editor was opened with.
 */
export function applyPolicyEdit(
    declared: readonly SecurityRule[],
    original: ListedPolicy,
    edited: Partial<PostgresPolicy>
): PolicyEdit {
    const index = original.rule;
    if (index === undefined || declared[index] === undefined) {
        return { ok: false, reason: original.generated ? "generated" : "not_declared" };
    }
    const rule = declared[index];
    if (ruleForm(rule) === "redacted") return { ok: false, reason: "redacted" };
    if (getPolicyOperations(rule).length > 1) return { ok: false, reason: "several_operations" };

    return {
        ok: true,
        rules: declared.map((r, i) => (i === index ? editedRule(r, original, edited) : r))
    };
}

/**
 * The rule with what the editor changed, and nothing else.
 *
 * The editor shows a rule as a policy — name, command, mode, `TO` list and raw
 * USING / WITH CHECK — and an `ownerField` or `access` rule has no raw clause
 * to show. So a field is only written when it differs from what the editor was
 * opened with: renaming an `access: "public"` rule keeps it public, and an
 * unnamed rule stays unnamed unless the name was changed. A condition typed in
 * replaces the rule's condition whole — the forms are exclusive.
 */
function editedRule(rule: SecurityRule, original: PostgresPolicy, edited: Partial<PostgresPolicy>): PolicyRule {
    const next = policyToSecurityRule(edited);
    const result: PolicyRule = { ...rule };

    if ((edited.policyname ?? "") !== original.policyname) {
        if (next.name) result.name = next.name;
        else delete result.name;
    }
    if (edited.cmd !== original.cmd) {
        delete result.operations;
        result.operation = next.operation;
    }
    if (edited.permissive !== original.permissive) {
        result.mode = next.mode;
    }
    if (!sameRoles(edited.roles, original.roles)) {
        if (next.pgRoles) result.pgRoles = next.pgRoles;
        else delete result.pgRoles;
    }
    if ((edited.qual || null) !== (original.qual || null) || (edited.with_check || null) !== (original.with_check || null)) {
        delete result.ownerField;
        delete result.access;
        delete result.condition;
        delete result.check;
        delete result.using;
        delete result.withCheck;
        if (next.using) result.using = next.using;
        if (next.withCheck) result.withCheck = next.withCheck;
    }
    return result;
}

function sameRoles(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
    const left = [...(a ?? [])].sort();
    const right = [...(b ?? [])].sort();
    return left.length === right.length && left.every((role, i) => role === right[i]);
}
