import { enforceAuthSecretExclusion } from "../src/auth/exclude-auth-secrets";

/**
 * The users collection a project scaffolds for itself REPLACES the framework's
 * default rather than merging with it, so every protection the default carried
 * has to survive the copy. `excludeFromApi` is the one that fails silently when
 * it does not: the neighbouring admin flags hide the field from the CMS and look
 * like they did the job, while the column keeps riding out on every row a read
 * policy admits.
 */
describe("auth secret exclusion", () => {
    /** The exact shape that leaked: admin hints, no excludeFromApi. */
    function usersCollectionWithAdminHintsOnly() {
        return {
            slug: "users",
            auth: true,
            properties: {
                email: { name: "Email", type: "string" },
                password_hash: {
                    name: "Password Hash",
                    type: "string",
                    admin: { hideFromCollection: true, disabled: { hidden: true } }
                },
                email_verification_token: {
                    name: "Email Verification Token",
                    type: "string",
                    admin: { hideFromCollection: true, disabled: { hidden: true } }
                }
            }
        } as Record<string, unknown>;
    }

    it("excludes the password hash and the verification token from the API", () => {
        const users = usersCollectionWithAdminHintsOnly();

        const fixed = enforceAuthSecretExclusion([users]);

        const properties = users.properties as Record<string, { excludeFromApi?: boolean }>;
        expect(properties.password_hash.excludeFromApi).toBe(true);
        expect(properties.email_verification_token.excludeFromApi).toBe(true);
        expect(fixed).toEqual([
            { slug: "users", columns: ["password_hash", "email_verification_token"] }
        ]);
    });

    it("leaves ordinary columns alone", () => {
        const users = usersCollectionWithAdminHintsOnly();

        enforceAuthSecretExclusion([users]);

        const properties = users.properties as Record<string, { excludeFromApi?: boolean }>;
        expect(properties.email.excludeFromApi).toBeUndefined();
    });

    /** Property names differ between the default and a redeclaration; the column does not. */
    it("matches on the column name when the property is spelled differently", () => {
        const users = {
            slug: "people",
            auth: true,
            properties: {
                secret: { name: "Secret", type: "string", columnName: "password_hash" }
            }
        } as Record<string, unknown>;

        enforceAuthSecretExclusion([users]);

        expect((users.properties as Record<string, { excludeFromApi?: boolean }>).secret.excludeFromApi).toBe(true);
    });

    it("says nothing about a collection that already excludes them", () => {
        const users = {
            slug: "users",
            auth: true,
            properties: {
                passwordHash: { name: "Password Hash", type: "string", excludeFromApi: true }
            }
        } as Record<string, unknown>;

        expect(enforceAuthSecretExclusion([users])).toEqual([]);
    });

    /**
     * A `password_hash` column on a collection that is not the user store is
     * someone else's data — a CRM importing hashes, say — and not this
     * function's business.
     */
    it("only touches the auth collection", () => {
        const notUsers = {
            slug: "legacy_import",
            properties: {
                password_hash: { name: "Password Hash", type: "string" }
            }
        } as Record<string, unknown>;

        expect(enforceAuthSecretExclusion([notUsers])).toEqual([]);
        expect(
            (notUsers.properties as Record<string, { excludeFromApi?: boolean }>).password_hash.excludeFromApi
        ).toBeUndefined();
    });

    it("recognises the object form of the auth flag", () => {
        const users = {
            slug: "users",
            auth: { enabled: true },
            properties: { password_hash: { name: "Password Hash", type: "string" } }
        } as Record<string, unknown>;

        expect(enforceAuthSecretExclusion([users])).toHaveLength(1);
    });
});
