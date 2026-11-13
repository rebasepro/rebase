import { getDefaultValuesFor, CollectionRegistry, CollectionConfig } from "@rebasepro/cms-types";

/**
 * The panel's form baseline for a redeclared users collection: the registry
 * restores `excludeFromApi` on the auth secrets (tested in `@rebasepro/common`),
 * and the form must then leave them out of a new record — otherwise "new user"
 * submits `passwordHash: null` and the server refuses the write for fields that
 * were never on screen.
 */

/** The scaffolded shape before it carried the flag: admin hints only. */
function redeclaredUsersCollection(): CollectionConfig {
    return {
        name: "Users",
        slug: "users",
        table: "users",
        auth: { enabled: true },
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            email: { name: "Email", type: "string" },
            roles: { name: "Roles", type: "array", of: { type: "string" } },
            passwordHash: {
                name: "Password Hash",
                type: "string",
                columnName: "password_hash",
                admin: { hideFromCollection: true, disabled: { hidden: true } }
            },
            emailVerified: { name: "Email Verified", type: "boolean", columnName: "email_verified", defaultValue: false },
            emailVerificationToken: {
                name: "Email Verification Token",
                type: "string",
                columnName: "email_verification_token",
                admin: { hideFromCollection: true, disabled: { hidden: true } }
            }
        }
    } as CollectionConfig;
}

describe("the form baseline of an auth collection", () => {
    it("leaves them out of the form baseline for a new user", () => {
        const registry = new CollectionRegistry([redeclaredUsersCollection()]);
        const baseline = getDefaultValuesFor(registry.get("users")!.properties);

        expect(baseline).not.toHaveProperty("passwordHash");
        expect(baseline).not.toHaveProperty("emailVerificationToken");
        expect(baseline).toHaveProperty("email", null);
        expect(baseline).toHaveProperty("emailVerified", false);
    });
});
