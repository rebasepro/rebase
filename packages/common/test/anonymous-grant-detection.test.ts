import { policyToPostgres, sqlToPolicy, findAnonymousGrants } from "../src/index";
import { policy } from "@rebasepro/types";

/**
 * The anonymous-grant detector, on the two inputs it used to get wrong.
 *
 * Both were found by the round-trip property test in
 * `test/property/policy-roundtrip.property.test.ts`, which fails only on the
 * seeds that generate an `existsIn` — it had been failing roughly one run in
 * eight and reading as flake.
 */
describe("findAnonymousGrants", () => {
    /**
     * `FOREIGN_CONVENTION_UIDS` was a plain object indexed with a literal taken
     * out of the policy, so every `Object.prototype` key answered truthy and the
     * detector reported a risk that does not exist — naming the matched
     * function as the "platform".
     */
    it.each(["valueOf", "toString", "constructor", "hasOwnProperty", "__proto__"])(
        "does not invent a risk for a policy comparing uid to %p",
        name => {
            const expr = policy.compare(policy.authUid(), "eq", policy.literal(name));
            expect(findAnonymousGrants(expr as never)).toEqual([]);
        }
    );

    it("still catches the real foreign literals", () => {
        // The control: a detector that reported nothing would pass the above.
        for (const real of ["anon", "authenticated", "service_role"]) {
            const expr = policy.compare(policy.authUid(), "eq", policy.literal(real));
            const found = findAnonymousGrants(expr as never);
            expect(found).toHaveLength(1);
            expect(found[0].pattern).toBe("foreign-uid-literal");
            expect(found[0].detail).toBe(real);
        }
    });

    /**
     * `sqlToPolicy` cannot parse `EXISTS (...)` back into structure, so it
     * returns one `raw` node — and the raw branch only looked for the
     * `IS NOT NULL` tautology. A genuine `= 'anon'` inside an `existsIn` was
     * therefore invisible after a round trip, and the caller read the empty
     * array as "clean".
     */
    it("sees a foreign literal inside SQL it could not parse back", () => {
        // Built directly: the same node the property test's counterexample
        // produced, so this pins the exact shape that regressed.
        const expr = {
            kind: "existsIn",
            collection: "a",
            where: policy.compare(policy.authUid(), "eq", policy.literal("anon"))
        };

        expect(findAnonymousGrants(expr as never)).toHaveLength(1);

        const round = sqlToPolicy(policyToPostgres(expr as never));
        expect((round as { kind: string }).kind).toBe("raw");
        const after = findAnonymousGrants(round as never);
        expect(after).toHaveLength(1);
        expect(after[0].pattern).toBe("foreign-uid-literal");
    });

    it("does not fire on raw SQL that merely mentions a safe literal", () => {
        const round = sqlToPolicy("EXISTS (SELECT 1 FROM \"public\".\"a\" WHERE rebase.uid() = 'u-123')");
        expect(findAnonymousGrants(round as never)).toEqual([]);
    });
});
