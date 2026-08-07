/**
 * Properties of generated policy names.
 *
 * A policy name is a derived identifier that lives in customers' databases.
 * The module doc states the consequence plainly: a change "cannot silently
 * rename every policy in every deployed database while the UI keeps matching
 * the old ones". That makes the naming function's behaviour a compatibility
 * surface, and the properties below are the parts of it that must not move.
 *
 * Two failure directions matter, and they are not symmetric:
 *
 *  - The hash ignoring a field that changes what a policy *does* means two
 *    different rules compile to the same name, and one silently replaces the
 *    other in the database.
 *  - The name drifting for a rule that did not semantically change means every
 *    deployment drops and recreates policies, and the drift checker never
 *    settles.
 */

import fc from "fast-check";
import type { SecurityOperation, SecurityRule } from "@rebasepro/types";
import {
    getPolicyNameHash,
    getPolicyNamesForRule,
    getPolicyNamesForRules,
    getPolicyOperations
} from "../../src/policy-names";

const RUNS = Number(process.env.FC_RUNS ?? 3000);

/** PostgreSQL's identifier limit. Longer names are silently truncated. */
const PG_IDENTIFIER_LIMIT = 63;

/**
 * Longest table name for which every generated policy name still fits,
 * across every rule shape.
 *
 * The worst case is a multi-operation rule: `_select_` (8) + seven hex + the
 * `_<index>` disambiguator (2, since a rule expands to at most the five
 * operations) = 17, so 63 − 17 = 46. A single-operation rule has two
 * characters more headroom, which is why the pinned limitation below sits at
 * 48 — the bound depends on the rule, and the safe answer is the smaller one.
 *
 * The first version of this constant said 48 and the property found the
 * counterexample immediately. That is the shape of the thing: a bound guessed
 * from reading the code, corrected by a generator that tried a case the reader
 * did not.
 */
const SAFE_TABLE_NAME_LENGTH = 46;

/** The same bound for a rule that expands to exactly one operation. */
const SAFE_TABLE_NAME_LENGTH_SINGLE_OP = 48;

const operation = fc.constantFrom<SecurityOperation>("select", "insert", "update", "delete", "all");
const identifier = fc.stringMatching(/^[a-z][a-z0-9_]{0,14}$/);

/**
 * Rules covering every discriminated variant of `SecurityRule`.
 *
 * Built as loose objects and cast, because the union's `?: never` members make
 * each variant mutually exclusive at the type level — which is exactly right
 * for authors and exactly wrong for a generator that wants to reach all of them.
 */
const securityRule: fc.Arbitrary<SecurityRule> = fc.oneof(
    fc.record({ ownerField: identifier }),
    fc.record({ access: fc.constant("public" as const) }),
    fc.record({ using: fc.stringMatching(/^[a-z_ =']{1,20}$/) }),
    fc.record({
        using: fc.stringMatching(/^[a-z_ =']{1,20}$/),
        withCheck: fc.stringMatching(/^[a-z_ =']{1,20}$/)
    }),
    fc.record({ roles: fc.array(identifier, { minLength: 1, maxLength: 3 }) })
).chain(base => fc.record({
    operation: fc.option(operation, { nil: undefined }),
    operations: fc.option(fc.array(operation, { minLength: 1, maxLength: 3 }), { nil: undefined }),
    mode: fc.option(fc.constantFrom("permissive" as const, "restrictive" as const), { nil: undefined }),
    pgRoles: fc.option(fc.array(identifier, { maxLength: 2 }), { nil: undefined })
}).map(extra => ({ ...base, ...extra } as unknown as SecurityRule)));

describe("policy name hash", () => {

    it("is deterministic", () => {
        fc.assert(fc.property(securityRule, rule => {
            expect(getPolicyNameHash(rule)).toBe(getPolicyNameHash(structuredClone(rule)));
        }), { numRuns: RUNS });
    });

    it("is seven lowercase hex characters", () => {
        fc.assert(fc.property(securityRule, rule => {
            expect(getPolicyNameHash(rule)).toMatch(/^[0-9a-f]{7}$/);
        }), { numRuns: RUNS });
    });

    /**
     * Insensitive to the order the author happened to write the object keys in,
     * and to the order of the sets that are semantically unordered. `roles:
     * ["a","b"]` and `roles: ["b","a"]` grant the same thing, so they must not
     * be two policies.
     */
    it("ignores key order and the order of role sets", () => {
        fc.assert(fc.property(
            fc.array(identifier, { minLength: 2, maxLength: 4 }),
            fc.array(identifier, { minLength: 2, maxLength: 3 }),
            identifier,
            (roles, pgRoles, owner) => {
                const a = { ownerField: owner, roles, pgRoles } as unknown as SecurityRule;
                const b = {
                    pgRoles: [...pgRoles].reverse(),
                    roles: [...roles].reverse(),
                    ownerField: owner
                } as unknown as SecurityRule;
                expect(getPolicyNameHash(a)).toBe(getPolicyNameHash(b));
            }
        ), { numRuns: RUNS });
    });

    /**
     * The one that guards against the likeliest future regression: someone adds
     * a field to `SecurityRule` that changes what the policy does, and forgets
     * to add it to the digest. Two rules then compile to the same name and one
     * silently replaces the other.
     *
     * Stated field by field rather than as "the hash is injective", because
     * injectivity over a 28-bit digest is false and this is the part that is
     * actually true and actually checkable.
     */
    it("changes when any semantic field changes", () => {
        const base = { ownerField: "owner_id" } as unknown as SecurityRule;
        const mutations: [string, SecurityRule][] = [
            ["access", { access: "public" } as unknown as SecurityRule],
            ["mode", { ownerField: "owner_id", mode: "restrictive" } as unknown as SecurityRule],
            ["operation", { ownerField: "owner_id", operation: "insert" } as unknown as SecurityRule],
            ["operations", { ownerField: "owner_id", operations: ["select", "update"] } as unknown as SecurityRule],
            ["ownerField", { ownerField: "author_id" } as unknown as SecurityRule],
            ["roles", { ownerField: "owner_id", roles: ["admin"] } as unknown as SecurityRule],
            ["pgRoles", { ownerField: "owner_id", pgRoles: ["app_user"] } as unknown as SecurityRule],
            ["using", { using: "true" } as unknown as SecurityRule],
            ["withCheck", { using: "true", withCheck: "false" } as unknown as SecurityRule],
            ["condition", { condition: { kind: "true" } } as unknown as SecurityRule],
            ["check", { condition: { kind: "true" }, check: { kind: "false" } } as unknown as SecurityRule]
        ];
        const baseHash = getPolicyNameHash(base);
        for (const [field, mutated] of mutations) {
            expect(`${field}:${getPolicyNameHash(mutated)}`).not.toBe(`${field}:${baseHash}`);
        }
    });

    /**
     * `name` is deliberately *not* in the digest — a named rule uses its name
     * directly, so hashing it would be dead weight. Pinned so that "add every
     * field to the hash" is not applied mechanically later: doing so would
     * rename every named rule's fallback and churn every deployed database.
     */
    it("ignores the rule's explicit name", () => {
        const withoutName = { ownerField: "owner_id" } as unknown as SecurityRule;
        const withName = { ownerField: "owner_id", name: "my_policy" } as unknown as SecurityRule;
        expect(getPolicyNameHash(withName)).toBe(getPolicyNameHash(withoutName));
    });
});

describe("policy names", () => {

    it("produces exactly one name per operation the rule expands to", () => {
        fc.assert(fc.property(securityRule, identifier, (rule, table) => {
            expect(getPolicyNamesForRule(rule, table)).toHaveLength(getPolicyOperations(rule).length);
        }), { numRuns: RUNS });
    });

    it("produces distinct names within a single rule", () => {
        fc.assert(fc.property(securityRule, identifier, (rule, table) => {
            const names = getPolicyNamesForRule(rule, table);
            expect(new Set(names).size).toBe(names.length);
        }), { numRuns: RUNS });
    });

    /**
     * Every name lands in the set the drift checker builds. Trivially true by
     * construction today, and worth freezing: `getPolicyNamesForRules` is what
     * `checkPolicyDrift` compares live policies against, and a name the
     * generator emits but the set omits reads to the checker as an orphan —
     * that is, as something to drop.
     */
    it("puts every per-rule name into the combined set", () => {
        fc.assert(fc.property(
            fc.array(securityRule, { minLength: 1, maxLength: 4 }),
            identifier,
            (rules, table) => {
                const combined = getPolicyNamesForRules(rules, table);
                for (const rule of rules) {
                    for (const name of getPolicyNamesForRule(rule, table)) {
                        expect(combined.has(name)).toBe(true);
                    }
                }
            }
        ), { numRuns: RUNS });
    });

    /**
     * **The identifier limit.**
     *
     * PostgreSQL truncates an identifier over 63 bytes rather than rejecting
     * it, and it does so silently. A generated name that overruns is therefore
     * created under a name the generator does not know it has: `checkPolicyDrift`
     * compares the live (truncated) name against the expected (full) one, finds
     * no match, and reports the policy as orphaned on every single run — while
     * the rule it came from is reported as missing. `dropOrphanedPolicies` then
     * drops a policy that is not orphaned at all.
     *
     * Table names may themselves be up to 63 characters, and the suffix costs
     * up to 12 more, so this is reachable with an ordinary long table name
     * rather than a pathological one.
     */
    it("stays within PostgreSQL's identifier limit for table names up to the safe bound", () => {
        fc.assert(fc.property(
            securityRule,
            // Generated by length rather than by `stringMatching`, which biases
            // heavily towards short strings — the first version of this property
            // passed for exactly that reason while the bug below was sitting
            // there. A generator that cannot reach the interesting end of the
            // input space turns a property into a decoration.
            fc.integer({ min: 1, max: SAFE_TABLE_NAME_LENGTH }).map(n => "t".repeat(n)),
            (rule, table) => {
                for (const name of getPolicyNamesForRule(rule, table)) {
                    expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(PG_IDENTIFIER_LIMIT);
                }
            }
        ), { numRuns: RUNS });
    });

    /**
     * **KNOWN LIMITATION, pinned rather than asserted away.**
     *
     * Past {@link SAFE_TABLE_NAME_LENGTH} the generated name overruns
     * PostgreSQL's 63-byte identifier limit, and PostgreSQL *truncates* rather
     * than rejecting. The policy is then created under a name the generator
     * does not know it has, so `checkPolicyDrift` reports the live policy as
     * orphaned and the expected one as missing — permanently, on every run,
     * with `rls:check` never able to go green and nothing pointing at the
     * cause.
     *
     * It is not destructive: truncation always eats into the seven hex
     * characters, so `isGeneratedPolicyName` stops matching and
     * `dropOrphanedPolicies` keeps the policy rather than dropping it. The
     * failure is phantom drift, not lost RLS.
     *
     * Not fixed here because every fix renames identifiers that are already in
     * deployed databases, and that decision needs to be made deliberately
     * rather than as a side effect of a test sweep. This test exists so the
     * threshold is written down and so whoever changes it finds out here.
     */
    it("KNOWN: overruns the identifier limit past a 48-character table name", () => {
        const rule = { ownerField: "o", operation: "select" } as unknown as SecurityRule;
        expect(getPolicyNamesForRule(rule, "t".repeat(SAFE_TABLE_NAME_LENGTH_SINGLE_OP))[0])
            .toHaveLength(PG_IDENTIFIER_LIMIT);
        expect(getPolicyNamesForRule(rule, "t".repeat(SAFE_TABLE_NAME_LENGTH_SINGLE_OP + 1))[0].length)
            .toBeGreaterThan(PG_IDENTIFIER_LIMIT);

        // And the shape of the consequence: PostgreSQL's truncation destroys the
        // hash, so the recogniser no longer sees its own output.
        const overrun = getPolicyNamesForRule(rule, "t".repeat(55))[0];
        const asPostgresStoresIt = overrun.slice(0, PG_IDENTIFIER_LIMIT);
        expect(asPostgresStoresIt).not.toBe(overrun);
        expect(/_[0-9a-f]{7}$/.test(asPostgresStoresIt)).toBe(false);
    });

    /**
     * Two rules that differ semantically must not collide on a name, or one
     * replaces the other in the database with no diagnostic anywhere. Not a
     * proof — a 28-bit digest collides eventually, by design and acceptably —
     * but a corpus wide enough to catch a hash that has stopped covering
     * something.
     */
    it("does not collide across a wide corpus of distinct rules", () => {
        const seen = new Map<string, string>();
        const rules: SecurityRule[] = [];
        for (const owner of ["a", "b", "c", "d"]) {
            for (const op of ["select", "insert", "update", "delete", "all"] as SecurityOperation[]) {
                for (const mode of ["permissive", "restrictive"] as const) {
                    for (const roles of [undefined, ["admin"], ["editor"], ["admin", "editor"]]) {
                        rules.push({ ownerField: owner, operation: op, mode, roles } as unknown as SecurityRule);
                    }
                }
            }
        }
        for (const rule of rules) {
            const key = JSON.stringify(rule);
            for (const name of getPolicyNamesForRule(rule, "things")) {
                const prior = seen.get(name);
                if (prior !== undefined && prior !== key) {
                    throw new Error(`policy name ${name} generated for two different rules:\n  ${prior}\n  ${key}`);
                }
                seen.set(name, key);
            }
        }
        expect(seen.size).toBeGreaterThan(100);
    });
});
