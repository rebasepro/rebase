import { getGeneratedPolicyNames } from "../src/util/auth-default-policies";
import { getPolicyNamesForRules } from "@rebasepro/utils";
import type { CollectionConfig } from "@rebasepro/types";

/**
 * Which live policies did the codebase produce?
 *
 * Every UI that flags RLS drift has to answer this, and until there was one
 * derivation each of them answered it differently. The Studio's RLS editor read
 * `securityRules` alone, so the four policies the generator *injects* —
 * `<table>_default_admin_read` and the three `_default_admin_write_*` — came
 * back as drift on every table in the project: badged "DB Only", with a button
 * offering to import Rebase's own defaults into the codebase that produced
 * them. The admin panel's RLS tab derived a different subset by hand and got it
 * right, which is why the two disagreed.
 *
 * The drift signal only means something if it is exactly the policies the
 * codebase does *not* account for, so both halves are pinned here: nothing
 * generated is called drift, and something hand-written still is.
 */

function collection(overrides: Partial<CollectionConfig> = {}): CollectionConfig {
    return {
        name: "Authors",
        slug: "authors",
        table: "authors",
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" }
        },
        ...overrides
    } as unknown as CollectionConfig;
}

describe("getGeneratedPolicyNames", () => {
    it("accounts for the baseline the generator injects, which no collection declares", () => {
        const names = getGeneratedPolicyNames(collection());

        expect([...names].sort()).toEqual([
            "authors_default_admin_read",
            "authors_default_admin_write_delete",
            "authors_default_admin_write_insert",
            "authors_default_admin_write_update"
        ]);
    });

    it("accounts for an unnamed rule under the hashed name Postgres actually gets", () => {
        // `rule.name` is undefined here, so matching on it never matches — the
        // policy is live as `<table>_<op>_<hash>`.
        const names = getGeneratedPolicyNames(collection({
            securityRules: [{ operation: "select", using: "true" }]
        } as Partial<CollectionConfig>));

        const hashed = [...names].filter(n => !n.includes("default_admin"));
        expect(hashed).toHaveLength(1);
        expect(hashed[0]).toMatch(/^authors_select_[0-9a-f]+$/);
    });

    it("keeps a rule's explicit name", () => {
        const names = getGeneratedPolicyNames(collection({
            securityRules: [{ name: "authors_are_public", operation: "select", using: "true" }]
        } as Partial<CollectionConfig>));

        expect(names.has("authors_are_public")).toBe(true);
    });

    it("splits a multi-operation rule the way the generator does", () => {
        const names = getGeneratedPolicyNames(collection({
            securityRules: [{ name: "authors_owner", operations: ["update", "delete"], using: "true" }]
        } as Partial<CollectionConfig>));

        expect(names.has("authors_owner_update")).toBe(true);
        expect(names.has("authors_owner_delete")).toBe(true);
    });

    it("does not account for a hand-written policy — that is the whole point", () => {
        const names = getGeneratedPolicyNames(collection({
            securityRules: [{ name: "authors_are_public", operation: "select", using: "true" }]
        } as Partial<CollectionConfig>));

        expect(names.has("authors_handwritten_drift")).toBe(false);
    });

    it("drops the injected baseline when the collection opted out of it", () => {
        const names = getGeneratedPolicyNames(collection({
            disableDefaultPolicies: true,
            securityRules: [{ name: "authors_are_public", operation: "select", using: "true" }]
        } as Partial<CollectionConfig>));

        expect([...names]).toEqual(["authors_are_public"]);
    });

    it("covers strictly more than the declared rules do — the bug, stated directly", () => {
        // Deriving from `securityRules` is what the Studio's RLS editor did, and
        // it is short by exactly the injected baseline. If a future change makes
        // these two agree, either the baseline stopped being injected or this
        // helper stopped accounting for it — both worth failing on.
        const c = collection({
            securityRules: [{ operation: "select", using: "true" }]
        } as Partial<CollectionConfig>);

        const declaredOnly = getPolicyNamesForRules([...(c.securityRules ?? [])], "authors");
        const generated = getGeneratedPolicyNames(c);

        for (const name of declaredOnly) expect(generated.has(name)).toBe(true);

        const missedByDeclaredOnly = [...generated].filter(n => !declaredOnly.has(n));
        expect(missedByDeclaredOnly.sort()).toEqual([
            "authors_default_admin_read",
            "authors_default_admin_write_delete",
            "authors_default_admin_write_insert",
            "authors_default_admin_write_update"
        ]);
    });
});
