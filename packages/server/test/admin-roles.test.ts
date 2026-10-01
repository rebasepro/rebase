import { describe, it, expect, afterEach } from "@jest/globals";
import { ADMIN_ROLE, ADMIN_SCOPES, EMPTY_ACCESS_MODEL, hasAdminRole, scopeGrants } from "@rebasepro/types";
import { ADMIN_ROLE_NAME, heldScopesGrant, holdsAdminRole } from "../src/auth/admin-roles";
import { configureAccess } from "../src/auth/access";
import { createAuthRoutes } from "../src/auth/routes";

afterEach(() => configureAccess({ model: EMPTY_ACCESS_MODEL }));

/**
 * The portable restatement in `auth/admin-roles.ts` — what the custom-function
 * guards use, because that surface cannot import `@rebasepro/types` — must
 * answer exactly as the canonical definitions do.
 */
describe("the portable admin-role and scope rules", () => {
    it("name the same admin role", () => {
        expect(ADMIN_ROLE_NAME).toBe(ADMIN_ROLE);
    });

    it.each([
        [["admin"]],
        [["viewer", "admin"]],
        [["viewer"]],
        [[]],
        [["admin "]],
        [["schema-admin"]]
    ])("agree about %j", (roles) => {
        expect(holdsAdminRole(roles)).toBe(hasAdminRole(roles));
    });

    it("tolerate null and undefined", () => {
        expect(holdsAdminRole(null)).toBe(false);
        expect(holdsAdminRole(undefined)).toBe(false);
    });

    it.each([
        [["data:read"], "data:read", undefined],
        [["data:read"], "data:read", "posts"],
        [["data:read:posts"], "data:read", "posts"],
        [["data:read:posts"], "data:read", "comments"],
        [["data:read:posts"], "data:read", undefined],
        [["data:write"], "data:read", "posts"],
        [[], "logs:read", undefined]
    ])("match scopes the same: %j grants %s on %s", (held, scope, target) => {
        expect(heldScopesGrant(held, scope, target)).toBe(scopeGrants(held, scope, target));
    });
});

/**
 * Every registrant gets the default role, so it may hold nothing a stranger
 * should: not `admin`, and no declared role with an admin-plane scope.
 */
describe("registration cannot hand out an admin-plane scope", () => {
    it("refuses defaultRole 'admin' at construction", () => {
        expect(() => createAuthRoutes({ defaultRole: "admin" } as never))
            .toThrow(/CRITICAL SECURITY ERROR/);
    });

    it.each([...ADMIN_SCOPES])("refuses a declared default role holding %s", (scope) => {
        configureAccess({ model: { roles: { member: { scopes: [scope] } }, scopes: {} } });
        expect(() => createAuthRoutes({ defaultRole: "member" } as never))
            .toThrow(new RegExp(`CRITICAL SECURITY ERROR.*${scope}`));
    });

    it("allows a declared default role holding only app scopes", () => {
        configureAccess({
            model: {
                roles: { member: { scopes: ["project:deploy"] } },
                scopes: { "project:deploy": { label: "Deploy" } }
            }
        });
        expect(() => createAuthRoutes({ defaultRole: "member" } as never))
            .not.toThrow(/CRITICAL SECURITY ERROR/);
    });

    it("still allows an ordinary default role", () => {
        // The control: a guard that refused everything would satisfy the
        // assertions above without being correct.
        expect(() => createAuthRoutes({ defaultRole: "editor" } as never))
            .not.toThrow(/CRITICAL SECURITY ERROR/);
    });
});
