import { describe, expect, it } from "vitest";

import { role, snapshot, table } from "../../test/fixtures/snapshot";
import { rlsEnabledNotForced } from "./rls-enabled-not-forced";

const owned = (owner: string, roles = snapshot().roles) =>
    snapshot({ relations: [table("public", "orders", { rlsEnabled: true, owner })], roles });

describe("rls-enabled-not-forced", () => {
    it("is `high` when the owner is an ordinary login role", () => {
        const findings = rlsEnabledNotForced.run(
            owned("app_owner", [role("app_owner", { canLogin: true })])
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("high");
        expect(findings[0].fix).toBe(
            'ALTER TABLE "public"."orders" FORCE ROW LEVEL SECURITY;'
        );
    });

    it("is `medium` when the owner cannot log in", () => {
        const [f] = rlsEnabledNotForced.run(owned("provisioner", [role("provisioner")]));

        expect(f.severity).toBe("medium");
        expect(f.impact).toContain("No caller bypasses policies through ownership right now");
    });

    it("stays `medium` for a BYPASSRLS owner, and says FORCE would not help", () => {
        const [f] = rlsEnabledNotForced.run(
            owned("postgres", [role("postgres", { canLogin: true, bypassRls: true })])
        );

        expect(f.severity).toBe("medium");
        expect(f.detail).toContain("FORCE would not constrain it");
    });

    it("stays `medium` for a superuser owner for the same reason", () => {
        const [f] = rlsEnabledNotForced.run(
            owned("postgres", [role("postgres", { canLogin: true, superuser: true })])
        );

        expect(f.severity).toBe("medium");
        expect(f.detail).toContain("a superuser");
    });

    // Postgres exempts from non-forced RLS every role that has the owner's
    // privileges, not only the owner: `object_ownercheck` asks
    // `has_privs_of_role`. A NOLOGIN owner is therefore only harmless when
    // nothing that logs in, and nothing a caller arrives as, is a member of it.
    it("is `high` when the owner cannot log in but a login role is a member of it", () => {
        const [f] = rlsEnabledNotForced.run(
            owned("app_owner", [role("app_owner"), role("app", { canLogin: true, memberOf: ["app_owner"] })])
        );

        expect(f.severity).toBe("high");
        expect(f.detail).toContain("but app can");
        expect(f.impact).not.toContain("No caller bypasses policies");
    });

    it("is `critical` when a role callers arrive as is a member of the owner", () => {
        const [f] = rlsEnabledNotForced.run(
            owned("app_owner", [role("app_owner"), role("anon", { memberOf: ["app_owner"] }), role("authenticated")])
        );

        expect(f.severity).toBe("critical");
        expect(f.impact).toContain("anon");
        expect(f.fix).toContain('REVOKE "app_owner" FROM "anon";');
    });

    it("is `critical` when a role callers arrive as owns the table", () => {
        const [f] = rlsEnabledNotForced.run(owned("anon", [role("anon"), role("authenticated")]));

        expect(f.severity).toBe("critical");
        expect(f.fix).toBe('ALTER TABLE "public"."orders" FORCE ROW LEVEL SECURITY;');
    });

    it("stays `medium` when the only members of a NOLOGIN owner cannot log in either", () => {
        const [f] = rlsEnabledNotForced.run(
            owned("app_owner", [role("app_owner"), role("migrator", { memberOf: ["app_owner"] })])
        );

        expect(f.severity).toBe("medium");
    });

    it("does NOT flag a table with FORCE set", () => {
        const findings = rlsEnabledNotForced.run(
            snapshot({
                relations: [table("public", "orders", { rlsEnabled: true, rlsForced: true })]
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a table with RLS off — rls-disabled owns that", () => {
        const findings = rlsEnabledNotForced.run(
            snapshot({ relations: [table("public", "orders")] })
        );

        expect(findings).toEqual([]);
    });
});
