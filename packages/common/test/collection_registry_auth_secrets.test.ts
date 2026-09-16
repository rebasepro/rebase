import { CollectionConfig, Property } from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";
import { authSecretsMissingExclusion } from "../src/collections/auth-secrets";
import { getDefaultValuesFor } from "../src/util/entities";

/**
 * The panel builds its registry from the project's collection files as written.
 * The server restores `excludeFromApi` on a redeclared users collection's
 * secrets, and refuses any write that names them; a panel that did not also know
 * opened "new user" with `passwordHash: null` in the form's baseline, submitted
 * it, and got "'passwordHash', 'emailVerificationToken' are excluded from the
 * API on 'users'" for fields that were never on screen. Every registry applies
 * the rule, so both sides read the same collection.
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

function excluded(collection: CollectionConfig | undefined, key: string): boolean | undefined {
    return (collection?.properties[key] as Property | undefined)?.excludeFromApi;
}

describe("CollectionRegistry — auth collection secrets", () => {
    it("excludes the password hash and verification token on a redeclared users collection", () => {
        const registry = new CollectionRegistry([redeclaredUsersCollection()]);
        const users = registry.get("users");

        expect(excluded(users, "passwordHash")).toBe(true);
        expect(excluded(users, "emailVerificationToken")).toBe(true);
        expect(excluded(users, "email")).toBeUndefined();
        expect(excluded(users, "emailVerified")).toBeUndefined();
    });

    it("leaves them out of the form baseline for a new user", () => {
        const registry = new CollectionRegistry([redeclaredUsersCollection()]);
        const baseline = getDefaultValuesFor(registry.get("users")!.properties);

        expect(baseline).not.toHaveProperty("passwordHash");
        expect(baseline).not.toHaveProperty("emailVerificationToken");
        expect(baseline).toHaveProperty("email", null);
        expect(baseline).toHaveProperty("emailVerified", false);
    });

    it("does not write the flag back into the collection it was given", () => {
        const users = redeclaredUsersCollection();
        const registry = new CollectionRegistry([users]);

        expect(excluded(users, "passwordHash")).toBeUndefined();
        expect(excluded(registry.getRaw("users"), "passwordHash")).toBeUndefined();
    });

    it("applies on a single register, as the server registers", () => {
        const registry = new CollectionRegistry();
        registry.register(redeclaredUsersCollection());

        expect(excluded(registry.get("users"), "passwordHash")).toBe(true);
    });

    /** Someone else's `password_hash` column is that project's data. */
    it("leaves a collection that is not the user store alone", () => {
        const registry = new CollectionRegistry([{
            name: "Legacy import",
            slug: "legacy_import",
            table: "legacy_import",
            properties: {
                password_hash: { name: "Password Hash", type: "string" }
            }
        }]);

        expect(excluded(registry.get("legacy_import"), "password_hash")).toBeUndefined();
    });
});

describe("authSecretsMissingExclusion", () => {
    it("matches by column when the property is spelled differently", () => {
        expect(authSecretsMissingExclusion({
            auth: true,
            properties: { secret: { columnName: "password_hash" }, token: { columnName: "email_verification_token" } }
        })).toEqual(["secret", "token"]);
    });

    it("names nothing a collection already excludes", () => {
        expect(authSecretsMissingExclusion({
            auth: true,
            properties: { passwordHash: { excludeFromApi: true } }
        })).toEqual([]);
    });

    it("names nothing when the auth flag is off", () => {
        expect(authSecretsMissingExclusion({
            auth: { enabled: false },
            properties: { passwordHash: {} }
        })).toEqual([]);
    });
});
