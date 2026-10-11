import type { SecurityOperation, SecurityRule } from "@rebasepro/types";
import { sha1Hex } from "./sha1";
import { toPostgresIdentifier, truncateToBytes } from "./names";

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
 * The names a rule compiled to before {@link getPolicyNamesForRule} learned
 * about Postgres's identifier limit — and still compiles to whenever they fit.
 */
function untruncatedPolicyNames(rule: SecurityRule, tableName: string): string[] {
    const ops = getPolicyOperations(rule);
    const ruleHash = getPolicyNameHash(rule);
    return ops.map((op, opIdx) => rule.name
        ? (ops.length > 1 ? `${rule.name}_${op}` : rule.name)
        : `${tableName}_${op}_${ruleHash}${ops.length > 1 ? `_${opIdx}` : ""}`);
}

/** Whether Postgres, keeping 63 bytes of each, would store two of these under one name. */
const collideWhenStored = (names: readonly string[]): boolean =>
    new Set(names.map(toPostgresIdentifier)).size < names.length;

/**
 * `<prefix cut to fit>_<hash8>_<op>`, at most 63 bytes. The hash is over the
 * full name, so it carries everything the cut drops; the operation stays
 * readable at the end.
 */
function suffixFirstPolicyName(fullName: string, op: SecurityOperation): string {
    const tail = `_${sha1Hex(fullName).substring(0, 8)}_${op}`;
    const head = truncateToBytes(fullName, 63 - tail.length).replace(/_+$/, "");
    return `${head}${tail}`;
}

/**
 * Every Postgres policy name a single rule compiles to — one per operation.
 *
 * `<table>_<op>_<hash>[_<i>]`, or `<name>[_<op>]` for a named rule — byte for
 * byte what every release has written, with one exception. Postgres keeps the
 * first 63 bytes of an identifier, so a multi-operation rule whose names differ
 * only past that point (the injected `<table>_default_admin_write_<op>` on a
 * table of 42 bytes or more) used to store every operation under ONE name: each
 * `CREATE POLICY` replaced the last, only the final operation survived, and the
 * table denied the others. Only for such a rule each name is derived
 * suffix-first instead — see {@link suffixFirstPolicyName} — and
 * {@link getPolicySupersededNames} names the one policy the old names left in
 * the database, so the next boot or push replaces it. A single over-long name
 * that is unique as stored is left as it is.
 *
 * @param rule      The security rule as written in the collection config.
 * @param tableName The rule's table (see `getTableName` in `@rebasepro/common`).
 */
export function getPolicyNamesForRule(rule: SecurityRule, tableName: string): string[] {
    const names = untruncatedPolicyNames(rule, tableName);
    if (!collideWhenStored(names)) return names;
    const ops = getPolicyOperations(rule);
    return names.map((name, index) => suffixFirstPolicyName(name, ops[index]));
}

/**
 * The policy names, as Postgres stored them, that the old naming wrote for
 * this rule and {@link getPolicyNamesForRule} no longer produces — empty unless
 * the rule's per-operation names collided at 63 bytes. Dropping them is what
 * turns a database a previous release left with one truncated policy into one
 * with a policy per operation.
 */
export function getPolicySupersededNames(rule: SecurityRule, tableName: string): string[] {
    const names = untruncatedPolicyNames(rule, tableName);
    if (!collideWhenStored(names)) return [];
    return Array.from(new Set(names.map(toPostgresIdentifier)));
}

/** Every policy name a set of rules compiles to, for membership checks. */
export function getPolicyNamesForRules(rules: SecurityRule[], tableName: string): Set<string> {
    const names = new Set<string>();
    for (const rule of rules) {
        for (const name of getPolicyNamesForRule(rule, tableName)) names.add(name);
    }
    return names;
}
