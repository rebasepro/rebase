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
import { toFlatRow, toRestRow } from "../src/services/row-pipeline";
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

        const served = toFlatRow(row, usersCollection, registry);

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

    /**
     * A relation target is rendered twice, in two shapes, and only one of them
     * used to be filtered.
     *
     * REST inlines the target's columns; the admin's view-model and every
     * realtime/WebSocket frame carry a *ref* with the target's values attached.
     * The inline branch stripped, the ref branch copied the row through
     * untouched — so a collection with any relation to `users` (the scaffold's
     * `posts.author` is one) served colleagues' password hashes on every
     * `.listen()` frame while REST looked clean.
     */
    describe("relation targets", () => {
        const postsCollection = {
            name: "Posts",
            slug: "posts",
            properties: {
                id: { name: "Id", type: "number", isId: "increment" },
                title: { name: "Title", type: "string" },
                author: {
                    name: "Author",
                    type: "relation",
                    relation: { kind: "belongsTo", target: () => usersCollection, relationName: "author" }
                }
            }
        } as unknown as CollectionConfig;

        /*
         * Keyed by PROPERTY name, which is how a row comes back from the
         * relational query — drizzle maps the column to its field name on the
         * way out. A fixture keyed by column name proves nothing here: the
         * normalizer drops keys it cannot find a property for, so the secret
         * would appear to be stripped by a pipeline that in fact never looked.
         */
        const author = {
            id: 7,
            email: "author@example.com",
            passwordHash: "salt:hash",
            emailVerificationToken: "tok_123"
        };

        it("strips the target's excluded columns from an inlined relation (REST)", () => {
            const served = toRestRow({ id: 1, title: "hi", author }, postsCollection, registry);

            const inlined = served.author as Record<string, unknown>;
            expect(inlined.email).toBe("author@example.com");
            expect(inlined).not.toHaveProperty("passwordHash");
            expect(inlined).not.toHaveProperty("password_hash");
            expect(inlined).not.toHaveProperty("emailVerificationToken");
            expect(inlined).not.toHaveProperty("email_verification_token");
        });

        it("strips them from a relation REFERENCE too (admin, WebSocket, realtime)", () => {
            const served = toFlatRow({ id: 1, title: "hi", author }, postsCollection, registry);

            const ref = served.author as { data?: { values?: Record<string, unknown> } };
            expect(ref.data?.values?.email).toBe("author@example.com");
            // Both spellings: `normalizeDbValues` renames the column to its
            // property key on the way through, so asserting only on the
            // snake_case name would pass on a ref that still carries the secret.
            expect(ref.data?.values).not.toHaveProperty("passwordHash");
            expect(ref.data?.values).not.toHaveProperty("password_hash");
            expect(ref.data?.values).not.toHaveProperty("emailVerificationToken");
            expect(ref.data?.values).not.toHaveProperty("email_verification_token");
        });

        it("strips them from every element of a to-many relation", () => {
            const authorsCollection = {
                name: "Articles",
                slug: "articles",
                properties: {
                    id: { name: "Id", type: "number", isId: "increment" },
                    editors: {
                        name: "Editors",
                        type: "relation",
                        relation: { kind: "hasMany", target: () => usersCollection, relationName: "editors" }
                    }
                }
            } as unknown as CollectionConfig;

            const served = toFlatRow({ id: 1, editors: [author, { ...author, id: 8 }] }, authorsCollection, registry);

            for (const ref of served.editors as Array<{ data?: { values?: Record<string, unknown> } }>) {
                expect(ref.data?.values?.email).toBe("author@example.com");
                expect(ref.data?.values).not.toHaveProperty("passwordHash");
                expect(ref.data?.values).not.toHaveProperty("emailVerificationToken");
            }
        });
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
