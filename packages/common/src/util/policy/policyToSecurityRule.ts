import { rewriteLegacyRlsFunctions } from "@rebasepro/types";
import type { PostgresPolicy, SecurityOperation, SecurityRule, SecurityRuleBase } from "@rebasepro/types";

/**
 * The rule a Postgres policy compiles back from — a `pg_policies` row, or what
 * a policy editor produced in that shape.
 *
 * One definition for every place that turns a policy into a rule: Studio's RLS
 * editor ("Save" and "Import to codebase"), the collection editor's RLS tab
 * ("Import to codebase") and "Import from table"
 * (`buildCollectionFromTableMetadata`). The rule is what `db push` compiles back
 * into the database, so anything this gets wrong is a policy that changes on
 * the way back:
 *
 * - The `TO` list names *database* roles, which is `pgRoles`. `roles` holds
 *   *application* roles and compiles to a `rebase.roles()` check: filed there,
 *   `TO public` is a check no user passes, and on a restrictive policy — which
 *   compiles to `NOT (roles) OR condition` — a gate every user passes.
 *   `pgRoles` is omitted at the `public` default, so a rule that targets every
 *   connection, nearly all of them, carries no advanced field it does not need.
 * - The WITH CHECK is kept whether or not there is a USING beside it. Every
 *   INSERT policy has only a check, and a rule with neither clause compiles to
 *   `WITH CHECK (false)`, which stops every insert.
 * - `mode` is written when the policy states one: a restrictive policy read
 *   back as permissive is OR'd with every grant beside it.
 * - Retired RLS helpers (`auth.uid()`) are respelled, as `sqlToPolicy` does
 *   for what it reads, because this rule is written into the project's config.
 */
export function policyToSecurityRule(policy: Partial<PostgresPolicy>): SecurityRule {
    const operation = toSecurityOperation(policy.cmd);
    const mode = toSecurityMode(policy.permissive);
    const pgRoles = toPgRoles(policy.roles);
    const base: SecurityRuleBase = {
        ...(policy.policyname ? { name: policy.policyname } : {}),
        ...(operation ? { operation } : {}),
        ...(mode ? { mode } : {}),
        ...(pgRoles ? { pgRoles } : {})
    };

    const using = policy.qual ? rewriteLegacyRlsFunctions(policy.qual) : undefined;
    const withCheck = policy.with_check ? rewriteLegacyRlsFunctions(policy.with_check) : undefined;
    if (using) return withCheck ? { ...base, using, withCheck } : { ...base, using };
    if (withCheck) return { ...base, withCheck };
    return base;
}

function toPgRoles(roles: readonly string[] | undefined): string[] | undefined {
    if (!roles || roles.length === 0) return undefined;
    if (roles.length === 1 && roles[0] === "public") return undefined;
    return [...roles];
}

function toSecurityOperation(cmd: PostgresPolicy["cmd"] | undefined): SecurityOperation | undefined {
    switch (cmd) {
        case "SELECT": return "select";
        case "INSERT": return "insert";
        case "UPDATE": return "update";
        case "DELETE": return "delete";
        case "ALL": return "all";
        default: return undefined;
    }
}

function toSecurityMode(permissive: PostgresPolicy["permissive"] | undefined): SecurityRuleBase["mode"] {
    switch (permissive) {
        case "PERMISSIVE": return "permissive";
        case "RESTRICTIVE": return "restrictive";
        default: return undefined;
    }
}
