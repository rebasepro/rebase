import { isPostgresCollectionConfig } from "@rebasepro/types";
import type { CollectionConfig, PostgresPolicy, SecurityOperation, SecurityRule } from "@rebasepro/types";
import {
    compileRulePolicies,
    getEffectiveSecurityRules,
    getInjectedSecurityRules,
    getTableName,
    type CompiledRulePolicy
} from "@rebasepro/common";
import { getPolicyNamesForRule, getPolicyNamesForRules, getPolicyOperations } from "@rebasepro/utils";

/** A part of a policy the database can hold differently from its declaration. */
export type PolicyDriftField = "roles" | "command" | "mode" | "USING" | "WITH CHECK";

/** A row of the RLS editor's policy list. */
export interface ListedPolicy extends PostgresPolicy {
    /**
     * What the project's code compiles this policy to, when it declares one by
     * this name. For a policy the database also has, the row's own fields are
     * the database's and this is what they are compared against.
     */
    declared?: PostgresPolicy;
    /** Where the database's policy differs from {@link declared}. Empty when it does not. */
    drift?: PolicyDriftField[];
    /**
     * Rebase adds this policy itself — the admin baseline, a tenancy or
     * auth-write gate, a junction's derived policies — so no rule of the
     * author's holds it, and the next server start re-creates it.
     */
    generated?: boolean;
}

const COMMANDS: Record<SecurityOperation, PostgresPolicy["cmd"]> = {
    select: "SELECT",
    insert: "INSERT",
    update: "UPDATE",
    delete: "DELETE",
    all: "ALL"
};

/** A compiled policy, in the shape `pg_policies` describes one. */
function asPostgresPolicy(compiled: CompiledRulePolicy, tableName: string): PostgresPolicy {
    return {
        policyname: compiled.name,
        tablename: tableName,
        permissive: compiled.mode === "restrictive" ? "RESTRICTIVE" : "PERMISSIVE",
        cmd: COMMANDS[compiled.operation],
        roles: compiled.roles,
        qual: compiled.using,
        with_check: compiled.withCheck
    };
}

/**
 * The rule's own clauses, for a rule the compiler could not compile — an
 * `existsIn` naming a collection the registry does not hold, say. Only ever a
 * `code_only` row's content: nothing is compared against it.
 */
function uncompiledPolicy(rule: SecurityRule, operation: SecurityOperation, name: string, tableName: string): PostgresPolicy {
    return {
        policyname: name,
        tablename: tableName,
        permissive: rule.mode === "restrictive" ? "RESTRICTIVE" : "PERMISSIVE",
        cmd: COMMANDS[operation],
        roles: [...(rule.pgRoles ?? ["public"])],
        qual: rule.using || null,
        with_check: rule.withCheck || null
    };
}

function sameRoles(a: readonly string[], b: readonly string[]): boolean {
    const left = [...a].sort();
    const right = [...b].sort();
    return left.length === right.length && left.every((role, i) => role === right[i]);
}

/**
 * Where a live policy differs from the one the code compiles to.
 *
 * The same comparison `rebase doctor` makes: the `TO` list, the command, the
 * mode, and whether each clause is there at all. Never the clause text —
 * Postgres rewrites an expression when it stores it, so the text of a policy
 * that matches its declaration exactly still differs from the declaration's.
 * A clause that is missing is not a rewrite, though: a `USING` that is gone
 * changes who the policy admits.
 */
export function policyDrift(declared: PostgresPolicy, live: PostgresPolicy): PolicyDriftField[] {
    const drift: PolicyDriftField[] = [];
    if (!sameRoles(declared.roles, live.roles)) drift.push("roles");
    if (declared.cmd !== live.cmd) drift.push("command");
    if (declared.permissive !== live.permissive) drift.push("mode");
    if ((declared.qual != null) !== (live.qual != null)) drift.push("USING");
    if ((declared.with_check != null) !== (live.with_check != null)) drift.push("WITH CHECK");
    return drift;
}

/**
 * The policies of one table: every policy the database has, as the database
 * has it, and every policy the code declares for the table that it does not.
 *
 * A policy in both keeps the database's fields — this list is what Postgres
 * enforces — and carries the declaration beside them, with where the two
 * differ.
 *
 * @param live        The table's `pg_policies` rows.
 * @param collection  The collection the table belongs to, if any.
 * @param collections Every collection, to resolve the ones a rule refers to.
 */
export function listPolicies(
    live: readonly PostgresPolicy[],
    collection: CollectionConfig | null,
    tableName: string,
    collections: readonly CollectionConfig[]
): ListedPolicy[] {
    const listed = new Map<string, ListedPolicy>();
    for (const policy of live) listed.set(policy.policyname, { ...policy, status: "live" });
    if (!collection || !isPostgresCollectionConfig(collection)) return [...listed.values()];

    const resolveCollection = (slug: string) =>
        collections.find(c => c.slug === slug || getTableName(c) === slug);
    const injectedNames = getPolicyNamesForRules(getInjectedSecurityRules(collection), tableName);
    const livePolicies = new Map(live.map(policy => [policy.policyname, policy]));

    for (const rule of getEffectiveSecurityRules(collection)) {
        const operations = getPolicyOperations(rule);
        let compiled: CompiledRulePolicy[] | undefined;
        try {
            compiled = compileRulePolicies(collection, rule, { resolveCollection });
        } catch {
            compiled = undefined;
        }

        getPolicyNamesForRule(rule, tableName).forEach((name, index) => {
            const declared = compiled ? asPostgresPolicy(compiled[index], tableName) : undefined;
            const generated = injectedNames.has(name);
            const existing = livePolicies.get(name);
            if (existing) {
                listed.set(name, {
                    ...existing,
                    status: "both",
                    declared,
                    drift: declared ? policyDrift(declared, existing) : undefined,
                    generated
                });
            } else {
                listed.set(name, {
                    ...(declared ?? uncompiledPolicy(rule, operations[index] ?? "all", name, tableName)),
                    status: "code_only",
                    generated
                });
            }
        });
    }

    return [...listed.values()];
}
