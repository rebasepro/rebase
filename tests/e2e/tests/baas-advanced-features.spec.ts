/**
 * The parts of the data engine a REST CRUD test never reaches.
 *
 * Optimistic concurrency, idempotent replay, atomic field operators and
 * cross-collection batches are each a promise made to a client that cannot be
 * checked by looking at a row afterwards: they are about what happens when two
 * writers race, when a client retries, and when half a batch would otherwise
 * land. All four are implemented and documented; none of them was exercised
 * outside unit tests, where the transaction is a mock.
 */
import { test, expect } from "@playwright/test";
import { getAuthHeaders, getApiBaseUrl } from "./test-helpers";

interface ProductEntity {
    readonly id: string;
    readonly stock_quantity?: number;
    readonly available_locales?: readonly string[];
}

interface TagEntity {
    readonly id: string;
    readonly name: string;
}

interface AuthorEntity {
    readonly id: string;
    readonly name: string;
}

interface ErrorEnvelope {
    readonly error: {
        readonly message: string;
        readonly code: string;
    };
}

test.describe("BaaS Advanced Engine Features", () => {
    let authHeaders: Record<string, string>;
    const baseUrl = getApiBaseUrl();

    test.beforeAll(async () => {
        authHeaders = await getAuthHeaders();
    });

    /**
     * The lost-update guard: two clients read the same row, both write, and
     * without this the second silently overwrites the first.
     *
     * Both halves matter. A 412 on a stale tag proves the check runs; a 200 on
     * the current one proves it is a check rather than a wall — an
     * implementation that rejected every `If-Match` would pass the first
     * assertion alone.
     */
    test("optimistic concurrency control via ETag and If-Match", async ({ request }) => {
        const tagName = `ETag Tag ${Date.now()}`;
        const createRes = await request.post(`${baseUrl}/api/data/tags`, {
            headers: authHeaders,
            data: { name: tagName }
        });
        expect(createRes.status()).toBe(201);
        const tag = (await createRes.json()) as TagEntity;

        try {
            const getRes = await request.get(`${baseUrl}/api/data/tags/${tag.id}`, { headers: authHeaders });
            expect(getRes.status()).toBe(200);
            const etag = getRes.headers()["etag"];
            expect(etag, "ETag header must be returned on entity GET").toBeTruthy();

            const stalePatchRes = await request.patch(`${baseUrl}/api/data/tags/${tag.id}`, {
                headers: { ...authHeaders, "If-Match": '"mismatched-stale-etag-value"' },
                data: { name: `${tagName} Stale Update` }
            });
            expect(
                stalePatchRes.status(),
                "PATCH with mismatched If-Match must return 412 Precondition Failed"
            ).toBe(412);
            expect(((await stalePatchRes.json()) as ErrorEnvelope).error).toBeDefined();

            // And the rejected write must not have landed.
            const afterStale = (await (
                await request.get(`${baseUrl}/api/data/tags/${tag.id}`, { headers: authHeaders })
            ).json()) as TagEntity;
            expect(afterStale.name, "a 412 must leave the row untouched").toBe(tagName);

            const validPatchRes = await request.patch(`${baseUrl}/api/data/tags/${tag.id}`, {
                headers: { ...authHeaders, "If-Match": etag },
                data: { name: `${tagName} Succeeded Update` }
            });
            expect(
                validPatchRes.status(),
                "PATCH with matching If-Match header must succeed with 200 OK"
            ).toBe(200);
        } finally {
            await request.delete(`${baseUrl}/api/data/tags/${tag.id}`, { headers: authHeaders });
        }
    });

    /**
     * A retried POST must not create a second row.
     *
     * The id coming back identical is the whole assertion: a route that ignored
     * `Idempotency-Key` would also return 201 twice, and the duplicate would
     * only be found later by whoever counted.
     */
    test("idempotent mutations replay cached response without duplicate records", async ({ request }) => {
        const idempotencyKey = `idem-key-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const tagName = `Idem Tag ${Date.now()}`;
        const headers = { ...authHeaders, "Idempotency-Key": idempotencyKey };

        const firstRes = await request.post(`${baseUrl}/api/data/tags`, { headers, data: { name: tagName } });
        expect(firstRes.status(), "First request should return 201 Created").toBe(201);
        const firstBody = (await firstRes.json()) as TagEntity;
        expect(firstBody.id).toBeTruthy();

        try {
            const secondRes = await request.post(`${baseUrl}/api/data/tags`, {
                headers,
                data: { name: tagName }
            });
            expect(secondRes.status(), "Replayed idempotent mutation should return success").toBe(201);
            const secondBody = (await secondRes.json()) as TagEntity;
            expect(secondBody.id, "the replay must return the first row, not a second one").toBe(firstBody.id);
            expect(secondBody.name).toBe(firstBody.name);
        } finally {
            await request.delete(`${baseUrl}/api/data/tags/${firstBody.id}`, { headers: authHeaders });
        }
    });

    test("atomic field operators ($inc on numbers, $push on arrays)", async ({ request }) => {
        const stamp = Date.now();
        const createRes = await request.post(`${baseUrl}/api/data/products`, {
            headers: authHeaders,
            data: {
                name: `Atomic Product ${stamp}`,
                sku: `SKU-ATOM-${stamp}`,
                category: "electronics",
                price: 99.99,
                stock_quantity: 10,
                available_locales: ["en"]
            }
        });
        expect(createRes.status()).toBe(201);
        const product = (await createRes.json()) as ProductEntity;
        expect(product.stock_quantity).toBe(10);

        try {
            const incRes = await request.patch(`${baseUrl}/api/data/products/${product.id}`, {
                headers: authHeaders,
                data: { stock_quantity: { $inc: 5 } }
            });
            expect(incRes.status(), "PATCH with $inc operator should return 200").toBe(200);
            expect(((await incRes.json()) as ProductEntity).stock_quantity).toBe(15);

            const pushRes = await request.patch(`${baseUrl}/api/data/products/${product.id}`, {
                headers: authHeaders,
                data: { available_locales: { $push: "de" } }
            });
            expect(pushRes.status(), "PATCH with $push operator should return 200").toBe(200);
            // Appended, not replaced: `$push` that overwrote the array would
            // still contain "de".
            expect(((await pushRes.json()) as ProductEntity).available_locales).toEqual(["en", "de"]);
        } finally {
            await request.delete(`${baseUrl}/api/data/products/${product.id}`, { headers: authHeaders });
        }
    });

    /**
     * Two collections, one transaction, and a forward reference between them.
     *
     * `$ref` is the reason a batch exists rather than two requests: the post
     * needs the id of an author that does not exist yet when the body is
     * written. Asserting the resolved id is what proves the reference was
     * substituted rather than stored as the literal string.
     */
    test("cross-collection atomic batch transactions with $ref resolution", async ({ request }) => {
        const stamp = Date.now();
        const batchRes = await request.post(`${baseUrl}/api/data/_batch`, {
            headers: authHeaders,
            data: {
                operations: [
                    {
                        op: "create",
                        collection: "authors",
                        values: { name: `Batch Author ${stamp}`, email: `batch-${stamp}@rebase.pro` },
                        ref: "createdAuthor"
                    },
                    {
                        op: "create",
                        collection: "posts",
                        values: {
                            title: `Batch Post ${stamp}`,
                            slug: `batch-post-${stamp}`,
                            author: { $ref: "createdAuthor.id" }
                        },
                        ref: "createdPost"
                    }
                ]
            }
        });
        expect(batchRes.status(), `POST /api/data/_batch should return 200: ${await batchRes.text()}`).toBe(200);
        const batchBody = (await batchRes.json()) as {
            readonly data: readonly [AuthorEntity, { readonly id: string; readonly title: string; readonly authorId?: string }];
        };

        expect(batchBody.data.length).toBe(2);
        const [author, post] = batchBody.data;
        expect(author.id).toBeTruthy();
        expect(author.name).toBe(`Batch Author ${stamp}`);
        expect(post.id).toBeTruthy();
        expect(post.title).toBe(`Batch Post ${stamp}`);
        expect(post.authorId, "the forward $ref must resolve to the id the batch just created")
            .toBe(author.id);

        await request.delete(`${baseUrl}/api/data/posts/${post.id}`, { headers: authHeaders });
        await request.delete(`${baseUrl}/api/data/authors/${author.id}`, { headers: authHeaders });
    });

    /**
     * Both soft-delete parameters reject a value they do not understand.
     *
     * The codes are asserted, not just the 400: the failure mode these guard
     * against is a typo being read as the default, and "it was a 400" does not
     * distinguish that from the request being malformed some other way.
     */
    test("validates soft-delete and hard-delete query parameters", async ({ request }) => {
        const invalidDeletedRes = await request.get(
            `${baseUrl}/api/data/products?deleted=not_a_valid_mode`,
            { headers: authHeaders }
        );
        expect(invalidDeletedRes.status(), "Invalid ?deleted value must return 400").toBe(400);
        expect(((await invalidDeletedRes.json()) as ErrorEnvelope).error.code).toBe("INVALID_DELETED_PARAM");

        const invalidHardRes = await request.delete(
            `${baseUrl}/api/data/products/placeholder-id?hard=not_a_boolean`,
            { headers: authHeaders }
        );
        expect(invalidHardRes.status(), "Invalid ?hard value must return 400").toBe(400);
        expect(((await invalidHardRes.json()) as ErrorEnvelope).error.code).toBe("INVALID_HARD_PARAM");
    });
});
