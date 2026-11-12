import { isPolicyShorthand, type SecurityOperation, type SecurityRule } from "@rebasepro/types";
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

/**
 * Stable digest of the parts of a rule that determine what the policy does.
 *
 * Two hash inputs, never mixed:
 *
 * - **A rule of a shape every release has known** hashes
 *   `JSON.stringify({ a, m, op, ops, own, rol, pg, u, w, c, ch })`, byte for
 *   byte as it always has — a deployed database keeps its policies by these
 *   names, so this input must never move. Its `condition` / `check` are
 *   serialised in the key order they were written in, as they always were.
 * - **A rule using a newer form** ({@link isNewShapeRule}: a
 *   `PolicyShorthand` condition / check, `access` combined with a
 *   condition / check, or `access: "authenticated"` / `"registered"`) hashes {@link newShapeHashInput}:
 *   `"rls2:"` followed by canonical JSON in which every object's keys are
 *   sorted, so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` name the same policy.
 *   A legacy input starts with `{`, so the two spaces cannot meet.
 */
export function getPolicyNameHash(rule: SecurityRule): string {
    if (isNewShapeRule(rule)) return sha1Hex(newShapeHashInput(rule)).substring(0, 7);
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
        c: frozenHashSpelling(rule.condition),
        ch: frozenHashSpelling(rule.check)
    });
    return sha1Hex(data).substring(0, 7);
}

/**
 * Whether a rule uses a form newer than the legacy hash input knows: a
 * `PolicyShorthand` condition or check, `access` together with a condition or
 * check, or `access: "authenticated"` (which older releases did not type and
 * compiled to a deny; it now means any signed-in caller, under a new name) or
 * `access: "registered"` (added after it). Such a rule hashes
 * {@link newShapeHashInput}; every other rule keeps the legacy input.
 */
export function isNewShapeRule(rule: SecurityRule): boolean {
    if (rule.access === "authenticated" || rule.access === "registered") return true;
    if (rule.access !== undefined && (rule.condition != null || rule.check != null)) return true;
    return isPolicyShorthand(rule.condition) || isPolicyShorthand(rule.check);
}

/**
 * The hash input of a {@link isNewShapeRule new-shape} rule:
 * `"rls2:" + canonicalJson({ a, c, ch, m, op, ops, own, pg, rol, u, w })`.
 *
 * `canonicalJson` is `JSON.stringify` with every object's keys sorted (arrays
 * keep their order, `undefined` members are dropped). A shorthand is encoded
 * as `{ "=": [[column, value], …] }`, its pairs sorted by column — the
 * `=` tag keeps it apart from an expression node, which always carries
 * `kind`. `ops`, `rol` and `pg` are sorted as in the legacy input.
 */
export function newShapeHashInput(rule: SecurityRule): string {
    return `rls2:${canonicalJson({
        a: rule.access,
        m: rule.mode,
        op: rule.operation,
        ops: rule.operations?.slice().sort(),
        own: rule.ownerField,
        rol: rule.roles?.slice().sort(),
        pg: rule.pgRoles?.slice().sort(),
        u: rule.using,
        w: rule.withCheck,
        c: conditionHashValue(frozenHashSpelling(rule.condition)),
        ch: conditionHashValue(frozenHashSpelling(rule.check))
    })}`;
}

/**
 * The frozen spelling of the hash input: a condition as it was spelled when
 * the names in deployed databases were derived from it.
 *
 * An `existsIn` node names its join table in `table`, which was spelled
 * `collection` before tables replaced collections in the backend vocabulary.
 * Hashed as written, every unnamed policy with a membership subquery would be
 * renamed by the rename alone. So the hash reads each `existsIn` node with
 * `table` put back as `collection`, in the same key position, and nothing
 * else changes: this is the input, byte for byte, the old spelling produced.
 * Never extend it to a new field — it exists only to keep old names.
 */
function frozenHashSpelling(condition: unknown): unknown {
    if (Array.isArray(condition)) return condition.map(frozenHashSpelling);
    if (typeof condition !== "object" || condition === null) return condition;
    const existsIn = "kind" in condition && condition.kind === "existsIn";
    return Object.fromEntries(Object.entries(condition).map(([key, value]) =>
        [existsIn && key === "table" ? "collection" : key, frozenHashSpelling(value)]));
}

function conditionHashValue(condition: unknown): unknown {
    if (!isPolicyShorthand(condition)) return condition;
    return { "=": Object.keys(condition).sort().map(column => [column, condition[column]]) };
}

function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, member: unknown) => {
        if (typeof member !== "object" || member === null || Array.isArray(member)) return member;
        return Object.fromEntries(Object.entries(member).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    });
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

/** What every {@link adminRequestPolicyName} ends with: `_ar_` and eight hex digits. */
export const ADMIN_REQUEST_POLICY_SUFFIX = /_ar_[0-9a-f]{8}$/;

/**
 * The name of an admin-only policy's companion — the `USING (true)` grant to
 * the admin request roles (`REBASE_ADMIN_REQUEST_ROLE`): the base name cut to
 * fit, then `_ar_` and a hash of the whole base name, at most 63 bytes, so two
 * bases that share a cut prefix never share a companion.
 */
export function adminRequestPolicyName(baseName: string): string {
    const tail = `_ar_${sha1Hex(baseName).substring(0, 8)}`;
    return `${truncateToBytes(baseName, 63 - tail.length).replace(/_+$/, "")}${tail}`;
}
