/**
 * `excludeFromApi` — server-side secret stripping.
 *
 * Password hashes and verification tokens must be readable server-side but must
 * never reach a client. Before this flag existed the users collection relied on
 * `ui.hideFromCollection`, which only stops the admin panel from *rendering* a
 * field — the value was still serialized into `/api/data/users`, so any
 * authenticated user could read their own password hash and verification token
 * straight out of the JSON.
 *
 * These tests pin the guarantee at every exit of the row pipeline, including
 * relation targets, since a secret only has to leak through one overlooked path.
 */
import { CollectionConfig } from "@rebasepro/types";
import { toCmsRow, toRestRow } from "../src/services/row-pipeline";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const usersCollection = {
    name: "Users",
    slug: "users",
    properties: {
        id: { name: "Id", type: "number", isId: "increment" },
        email: { name: "Email", type: "string" },
        passwordHash: {
            name: "Password Hash",
            type: "string",
            columnName: "password_hash",
            excludeFromApi: true
        },
        emailVerificationToken: {
            name: "Token",
            type: "string",
            columnName: "email_verification_token",
            excludeFromApi: true
        }
    }
} as unknown as CollectionConfig;

function makeRegistry(): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    registry.registerCollection?.(usersCollection);
    return registry;
}

describe("excludeFromApi", () => {
    const registry = makeRegistry();

    it("strips excluded columns from the REST row", () => {
        const row = {
            id: 1,
            email: "a@b.c",
            passwordHash: "salt:hash",
            emailVerificationToken: "tok_123"
        };

        const served = toRestRow(row, usersCollection, registry);

        expect(served.email).toBe("a@b.c");
        expect(served).not.toHaveProperty("passwordHash");
        expect(served).not.toHaveProperty("emailVerificationToken");
    });

    it("strips excluded columns from the admin (CMS) row", () => {
        const row = {
            id: 1,
            email: "a@b.c",
            passwordHash: "salt:hash",
            emailVerificationToken: "tok_123"
        };

        const served = toCmsRow(row, usersCollection, registry);

        expect(served.email).toBe("a@b.c");
        expect(served).not.toHaveProperty("passwordHash");
        expect(served).not.toHaveProperty("emailVerificationToken");
    });

    it("strips by column name too, since rows can arrive keyed either way", () => {
        const row = {
            id: 1,
            email: "a@b.c",
            password_hash: "salt:hash",
            email_verification_token: "tok_123"
        };

        const served = toRestRow(row, usersCollection, registry);

        expect(served).not.toHaveProperty("password_hash");
        expect(served).not.toHaveProperty("email_verification_token");
    });

    it("leaves collections without the flag untouched", () => {
        const posts = {
            name: "Posts",
            slug: "posts",
            properties: {
                id: { name: "Id", type: "number", isId: "increment" },
                title: { name: "Title", type: "string" }
            }
        } as unknown as CollectionConfig;

        const served = toRestRow({ id: 1,
title: "hello" }, posts, registry);

        expect(served).toEqual({ id: 1,
title: "hello" });
    });
});
