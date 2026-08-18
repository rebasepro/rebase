import {
    FALLBACK_ROLE_OPTIONS,
    IS_ADMIN_SQL,
    OWNS_ROW_SQL,
    POLICY_PRESETS,
    roleOptionsFor,
    SIGNED_IN_SQL
} from "../src/components/RLSEditor/policy-presets";
import { policy, RLS_ROLES_SQL, RLS_UID_SQL } from "@rebasepro/types";
import { policyToPostgres, REBASE_USER_ROLE } from "@rebasepro/common";

/**
 * The RLS editor's presets are applied as raw `CREATE POLICY ... TO <roles>`
 * against the live database, so a wrong name here is not a cosmetic slip.
 *
 * The list used to be `["public", "authenticated", "anon", "admin"]` — the
 * first is Rebase's, the next two are Supabase's, and the last is an
 * *application* role that has no business in a `TO` list at all. Five presets
 * targeted `authenticated`, which fails outright; the danger is the shape that
 * does not, where a `TO` list naming a real role the request never assumes
 * creates cleanly and then filters every row.
 */
describe("the RLS editor's preset policies", () => {

    it("offers only roles a Rebase database actually has", () => {
        expect(FALLBACK_ROLE_OPTIONS).toEqual(["public", REBASE_USER_ROLE]);
        // Named individually rather than by a filter, so adding one back to the
        // list is a failing test rather than a passing one.
        for (const foreign of ["authenticated", "anon", "service_role"]) {
            expect(FALLBACK_ROLE_OPTIONS).not.toContain(foreign);
        }
    });

    it("targets `public` from every preset, which is what the generator emits", () => {
        expect(POLICY_PRESETS.length).toBeGreaterThan(0);
        for (const preset of POLICY_PRESETS) {
            expect(preset.roles).toEqual(["public"]);
        }
    });

    it("compiles its conditions with the compiler `db push` uses", () => {
        // Not string equality against a literal written here — that is the drift
        // this is meant to prevent. These must be what the framework emits.
        expect(SIGNED_IN_SQL).toBe(policyToPostgres(policy.authenticated()));
        expect(IS_ADMIN_SQL).toBe(policyToPostgres(policy.rolesOverlap(["admin"])));
        expect(OWNS_ROW_SQL).toBe(
            policyToPostgres(policy.compare(policy.authUid(), "eq", policy.field("uid")))
        );
    });

    it("does not hand out the tautology `authenticated()` used to compile to", () => {
        // `rebase.uid() IS NOT NULL` alone is true for anonymous visitors: the
        // request path gives them a sentinel uid rather than NULL. A preset that
        // froze the old spelling would still be granting to everyone.
        expect(SIGNED_IN_SQL).toContain("NOT IN");
        expect(SIGNED_IN_SQL).toContain("'anonymous'");
        expect(SIGNED_IN_SQL.replace(/\s+/g, " ")).not.toBe(`${RLS_UID_SQL} IS NOT NULL`);
    });

    it("says 'signed in' and 'admin' as conditions, never as a TO role", () => {
        const signedIn = POLICY_PRESETS.filter((p) => p.id.startsWith("auth_"));
        const admin = POLICY_PRESETS.filter((p) => p.id === "admin_all");
        expect(signedIn.length).toBeGreaterThan(0);
        expect(admin).toHaveLength(1);

        for (const preset of [...signedIn, ...admin]) {
            const clauses = `${preset.qual} ${preset.with_check}`;
            expect(clauses).toMatch(new RegExp(`${RLS_UID_SQL}|${RLS_ROLES_SQL}`.replace(/[.()]/g, "\\$&")));
        }
        expect(admin[0].qual).toContain(RLS_ROLES_SQL);
    });

    it("carries no pre-1.0 helper spelling", () => {
        for (const preset of POLICY_PRESETS) {
            expect(`${preset.qual} ${preset.with_check} ${preset.description}`)
                .not.toMatch(/\bauth\.(uid|roles|jwt)\s*\(/);
        }
    });
});

/**
 * `public` is a PostgreSQL *keyword*, not a row in `pg_roles`, so the live
 * role query cannot return it — and it is the role every generated policy
 * targets. Seeding the picker from the fetch alone would have dropped it.
 */
describe("roleOptionsFor", () => {

    it("keeps the defaults when the database answers", () => {
        const options = roleOptionsFor(["postgres", "rebase_user", "app_read"], undefined);
        expect(options).toContain("public");
        expect(options).toContain("app_read");
    });

    it("keeps the defaults when the database cannot be asked", () => {
        expect(roleOptionsFor(undefined, undefined)).toEqual(FALLBACK_ROLE_OPTIONS);
        expect(roleOptionsFor([], undefined)).toEqual(FALLBACK_ROLE_OPTIONS);
    });

    it("offers the edited policy's own roles, so editing cannot drop them", () => {
        // A MultiSelect silently discards a value with no matching item, and
        // here that value is who an existing policy applies to.
        const options = roleOptionsFor(["postgres"], ["legacy_reporting_role"]);
        expect(options).toContain("legacy_reporting_role");
    });

    it("does not repeat a role reported by more than one source", () => {
        const options = roleOptionsFor(["rebase_user"], ["rebase_user", "public"]);
        expect(options.filter((r) => r === "rebase_user")).toHaveLength(1);
        expect(options.filter((r) => r === "public")).toHaveLength(1);
    });
});
