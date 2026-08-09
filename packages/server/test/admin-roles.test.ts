import { describe, it, expect } from "@jest/globals";
import { ADMINISTRATIVE_ROLES, isAdministrativeRole, hasAdministrativeRole } from "../src/auth/admin-roles";
import { createAuthRoutes } from "../src/auth/routes";

/**
 * The registration guard and the admin check have to agree on what "admin"
 * means.
 *
 * They did not. `requireAdmin` accepted `admin` **or** `schema-admin`; the
 * guard refusing a dangerous `defaultRole` compared against `admin` alone. So
 * `AUTH_DEFAULT_ROLE=schema-admin` was accepted at boot and every public
 * registrant became an administrator — with the schema editor and the SQL
 * surfaces, from which real `admin` is one user edit away.
 *
 * The property below is the one that matters and the one that regressed: for
 * every role the admin check honours, the registration guard must refuse it.
 * Asserting it over the shared list means adding a role cannot reopen the gap.
 */
describe("administrative roles", () => {
    it("recognises exactly the documented set", () => {
        expect([...ADMINISTRATIVE_ROLES]).toEqual(["admin", "schema-admin"]);
        expect(isAdministrativeRole("admin")).toBe(true);
        expect(isAdministrativeRole("schema-admin")).toBe(true);
        expect(isAdministrativeRole("editor")).toBe(false);
        expect(isAdministrativeRole("")).toBe(false);
    });

    it("answers for a list, tolerating null and undefined", () => {
        expect(hasAdministrativeRole(["viewer", "schema-admin"])).toBe(true);
        expect(hasAdministrativeRole(["viewer"])).toBe(false);
        expect(hasAdministrativeRole([])).toBe(false);
        expect(hasAdministrativeRole(null)).toBe(false);
        expect(hasAdministrativeRole(undefined)).toBe(false);
    });

    describe("registration cannot hand out an administrative role", () => {
        // The property, over the shared list: no administrative role may be a
        // default role. `schema-admin` is the one that used to get through.
        it.each([...ADMINISTRATIVE_ROLES])("refuses defaultRole '%s' at construction", role => {
            expect(() => createAuthRoutes({ defaultRole: role } as never))
                .toThrow(/CRITICAL SECURITY ERROR/);
        });

        it("names the offending role and the whole set in the error", () => {
            expect(() => createAuthRoutes({ defaultRole: "schema-admin" } as never))
                .toThrow(/schema-admin/);
            expect(() => createAuthRoutes({ defaultRole: "schema-admin" } as never))
                .toThrow(/admin, schema-admin/);
        });

        it("still allows an ordinary default role", () => {
            // The control: a guard that refused everything would satisfy the
            // assertions above without being correct.
            expect(() => createAuthRoutes({ defaultRole: "editor" } as never))
                .not.toThrow(/CRITICAL SECURITY ERROR/);
        });
    });
});
