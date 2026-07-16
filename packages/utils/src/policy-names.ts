import type { SecurityOperation, SecurityRule } from "@rebasepro/types";
import { sha1Hex } from "./sha1";

/**
 * Naming of the Postgres policies generated from a collection's security rules.
 *
 * A rule without an explicit `name` is compiled to `<table>_<op>_<hash>`, where
 * the hash covers the rule's semantics. The Studio needs the same names to tell
 * "this policy came from your code" apart from "someone wrote this in SQL" —
 * without them it treats generated policies as foreign and offers to import
 * them back into the codebase they came from.
 *
 * This is the single definition of that naming. The DDL and Drizzle generators
 * both derive names from here, so a change cannot silently rename every policy
 * in every deployed database while the UI keeps matching the old ones.
 */

/** Stable digest of the parts of a rule that determine what the policy does. */
export function getPolicyNameHash(rule: SecurityRule): string {
    const data = JSON.stringify({
        a: rule.access,
        m: rule.mode,
        op: rule.operation,
        ops: rule.operations?.slice().sort(),
        own: rule.ownerField,
        rol: rule.roles?.slice().sort(),
        pg: rule.pgRoles?.slice().sort(),
        u: rule.using,
        w: rule.withCheck,
        c: rule.condition,
        ch: rule.check
    });
    return sha1Hex(data).substring(0, 7);
}

/** The operations a rule expands to — `operations` wins over `operation`. */
export function getPolicyOperations(rule: SecurityRule): readonly SecurityOperation[] {
    return rule.operations && rule.operations.length > 0
        ? rule.operations
        : [rule.operation ?? "all"];
}

/**
 * Every Postgres policy name a single rule compiles to — one per operation.
 *
 * @param rule      The security rule as written in the collection config.
 * @param tableName The rule's table (see `getTableName` in `@rebasepro/common`).
 */
export function getPolicyNamesForRule(rule: SecurityRule, tableName: string): string[] {
    const ops = getPolicyOperations(rule);
    const ruleHash = getPolicyNameHash(rule);

    return ops.map((op, opIdx) => rule.name
        ? (ops.length > 1 ? `${rule.name}_${op}` : rule.name)
        : `${tableName}_${op}_${ruleHash}${ops.length > 1 ? `_${opIdx}` : ""}`);
}

/** Every policy name a set of rules compiles to, for membership checks. */
export function getPolicyNamesForRules(rules: SecurityRule[], tableName: string): Set<string> {
    const names = new Set<string>();
    for (const rule of rules) {
        for (const name of getPolicyNamesForRule(rule, tableName)) names.add(name);
    }
    return names;
}
