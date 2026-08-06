import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { logger } from "@rebasepro/server";

import { warnOnAnonymousGrants } from "./rls-enforcement";

/** Capture what the operator would actually see at boot. */
function captureWarning(fn: () => void): string | null {
    const spy = jest.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    try {
        fn();
        return spy.mock.calls.length > 0 ? String(spy.mock.calls[0][0]) : null;
    } finally {
        spy.mockRestore();
    }
}

const collectionWith = (slug: string, using: string) => ({
    slug,
    securityRules: [{ name: "authenticated_access", operation: "all", using, withCheck: using }]
});

afterEach(() => jest.restoreAllMocks());

describe("warnOnAnonymousGrants", () => {
    // The rule found in a real app, across 8 collections of PII. It reads as
    // "any logged-in user" and grants every anonymous visitor read and write.
    const FROM_THE_WILD = "auth.uid() IS NOT NULL AND auth.uid() != 'anon'";

    it("reports both mistakes in the rule from the wild", () => {
        const warning = captureWarning(() => warnOnAnonymousGrants([collectionWith("talents", FROM_THE_WILD)]));

        // The rule is written in the pre-1.0 spelling and must still be
        // detected; the advice is printed in the current one.
        expect(warning).toContain("rebase.uid() IS NOT NULL");
        expect(warning).toContain("'anon' is a Supabase convention");
        expect(warning).toContain("policy.authenticated()");
    });

    it("groups by mistake and names every collection it appears on", () => {
        const warning = captureWarning(() => warnOnAnonymousGrants(
            ["talents", "companies", "contact_messages"].map(s => collectionWith(s, FROM_THE_WILD))
        ));

        expect(warning).toContain("talents");
        expect(warning).toContain("companies");
        expect(warning).toContain("contact_messages");
        // Grouped, not repeated once per collection: the same habit across 8
        // collections should not print the same paragraph 16 times.
        expect(warning!.match(/Supabase convention/g)).toHaveLength(1);
        expect(warning).toContain("3 rule(s)");
    });

    it("catches the bare tautology, which carries no literal to notice", () => {
        const warning = captureWarning(() => warnOnAnonymousGrants([collectionWith("talents", "auth.uid() IS NOT NULL")]));

        expect(warning).toContain("rebase.uid() IS NOT NULL");
        expect(warning).not.toContain("Supabase convention");
    });

    it("says nothing about rules that are actually correct", () => {
        const warning = captureWarning(() => warnOnAnonymousGrants([
            { slug: "talents", securityRules: [{ name: "own_rows", operation: "all", ownerField: "owner_id" }] },
            collectionWith("posts", `auth.uid() != 'anonymous'`),
            { slug: "public_page", securityRules: [{ name: "read", operation: "select", access: "public" }] }
        ] as never));

        expect(warning).toBeNull();
    });

    it("says nothing when no collection has rules at all", () => {
        expect(captureWarning(() => warnOnAnonymousGrants([{ slug: "empty" }]))).toBeNull();
    });
});
