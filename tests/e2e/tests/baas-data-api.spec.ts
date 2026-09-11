/**
 * The REST Data API, driven the way a customer's client would drive it.
 *
 * Everything else in this directory drives the admin panel, which reaches the
 * same routes through the SDK and so can only fail in the ways the SDK fails.
 * These go straight at the wire: the status codes, the error envelope and the
 * query parameters are the contract a BaaS sells, and until now nothing at any
 * tier asserted them.
 *
 * `tags` is the collection under test wherever one will do — two columns, one
 * of them required, no auto-dates and no storage — so a failure is about the
 * route rather than about whatever the fixture happened to declare.
 */
import { test, expect } from "@playwright/test";
import { getAuthHeaders, getApiBaseUrl } from "./test-helpers";

interface DataListResponse<T> {
    readonly data: readonly T[];
}

interface TagEntity {
    readonly id: string;
    readonly name: string;
}

interface PostEntity {
    readonly id: string;
    readonly title: string;
    readonly slug?: string;
    readonly author?: { readonly id?: string; readonly name?: string } | string | null;
}

interface ErrorEnvelope {
    readonly error: {
        readonly message: string;
        readonly code: string;
    };
}

test.describe("BaaS REST Data API", () => {
    let authHeaders: Record<string, string>;
    const baseUrl = getApiBaseUrl();

    test.beforeAll(async () => {
        authHeaders = await getAuthHeaders();
    });

    test("full CRUD lifecycle on a collection (tags)", async ({ request }) => {
        const tagName = `E2E Tag ${Date.now()}`;

        const createRes = await request.post(`${baseUrl}/api/data/tags`, {
            headers: authHeaders,
            data: { name: tagName }
        });
        expect(createRes.status(), "POST /api/data/tags should return 201 Created").toBe(201);
        const createdTag = (await createRes.json()) as TagEntity;
        expect(createdTag.id).toBeDefined();
        expect(createdTag.name).toBe(tagName);

        const tagId = createdTag.id;

        const readRes = await request.get(`${baseUrl}/api/data/tags/${tagId}`, { headers: authHeaders });
        expect(readRes.status(), "GET /api/data/tags/:id should return 200 OK").toBe(200);
        const fetchedTag = (await readRes.json()) as TagEntity;
        expect(fetchedTag.id).toBe(tagId);
        expect(fetchedTag.name).toBe(tagName);

        const updatedName = `${tagName} - Updated`;
        const patchRes = await request.patch(`${baseUrl}/api/data/tags/${tagId}`, {
            headers: authHeaders,
            data: { name: updatedName }
        });
        expect(patchRes.status(), "PATCH /api/data/tags/:id should return 200 OK").toBe(200);
        const updatedTag = (await patchRes.json()) as TagEntity;
        expect(updatedTag.id).toBe(tagId);
        expect(updatedTag.name).toBe(updatedName);

        const deleteRes = await request.delete(`${baseUrl}/api/data/tags/${tagId}`, { headers: authHeaders });
        expect(deleteRes.status(), "DELETE /api/data/tags/:id should return 204 No Content").toBe(204);

        // The delete is only proven by the row being gone afterwards. A 204 is
        // what the route returns whether or not it wrote anything.
        const verifyRes = await request.get(`${baseUrl}/api/data/tags/${tagId}`, { headers: authHeaders });
        expect(verifyRes.status(), "GET /api/data/tags/:id after delete should return 404").toBe(404);
    });

    test("rejects invalid payloads with structured 400 Bad Request error", async ({ request }) => {
        const resMissing = await request.post(`${baseUrl}/api/data/tags`, {
            headers: authHeaders,
            data: {}
        });
        expect(resMissing.status(), "POST without required field should return 400").toBe(400);
        const errBodyMissing = (await resMissing.json()) as ErrorEnvelope;
        expect(errBodyMissing.error).toBeDefined();
        expect(errBodyMissing.error.message).toBeTruthy();

        // An undeclared column is a typo in the caller's code, and silently
        // dropping it is how a client ships a field that never persists.
        const resUnknown = await request.post(`${baseUrl}/api/data/tags`, {
            headers: authHeaders,
            data: { name: "Valid Name", non_existent_column_field: "unexpected_data" }
        });
        expect(resUnknown.status(), "POST with undeclared field should return 400").toBe(400);
        const errBodyUnknown = (await resUnknown.json()) as ErrorEnvelope;
        expect(errBodyUnknown.error.code).toBe("VALIDATION_UNKNOWN_FIELDS");
    });

    test("returns canonical 404 envelope on non-existent collection", async ({ request }) => {
        const res = await request.get(`${baseUrl}/api/data/nonexistent_collection_slug_xyz`, {
            headers: authHeaders
        });
        expect(res.status(), "Accessing non-existent collection should return 404").toBe(404);
        const body = (await res.json()) as ErrorEnvelope;
        expect(body.error.code).toBe("NOT_FOUND");
    });

    /**
     * `?limit` and `?offset`, asserted as a window rather than as two 200s.
     *
     * Ordered by `id` deliberately. Paging without an `ORDER BY` is paging over
     * an order Postgres never promised, so the second page can legitimately
     * repeat a row from the first and the test would flake; and ordering by a
     * text column would make this a test of collation instead (`title` asc puts
     * "Adoption is…" before "A failing…" on this database). A uuid sorts one
     * way only.
     */
    test("pages through a collection with limit and offset", async ({ request }) => {
        const idsOf = async (query: string): Promise<readonly string[]> => {
            const res = await request.get(`${baseUrl}/api/data/posts?${query}`, { headers: authHeaders });
            expect(res.status(), `GET /api/data/posts?${query} should return 200`).toBe(200);
            return ((await res.json()) as DataListResponse<PostEntity>).data.map(post => post.id);
        };

        const firstFour = await idsOf("orderBy=id&limit=4&offset=0");
        expect(firstFour.length, "the fixture needs at least four posts to page through").toBe(4);

        const secondPage = await idsOf("orderBy=id&limit=2&offset=2");
        expect(secondPage, "?offset=2&limit=2 is the third and fourth rows of the same order")
            .toEqual(firstFour.slice(2));
    });

    test("supports filtering rows via where and field parameters", async ({ request }) => {
        const testSlug = `filter-test-${Date.now()}`;
        const createRes = await request.post(`${baseUrl}/api/data/posts`, {
            headers: authHeaders,
            data: { title: `Filter Test Post ${Date.now()}`, slug: testSlug, status: "draft" }
        });
        expect(createRes.status()).toBe(201);
        const createdPost = (await createRes.json()) as PostEntity;

        try {
            // PostgREST-style direct field equality.
            const filterFieldRes = await request.get(`${baseUrl}/api/data/posts?slug=${testSlug}`, {
                headers: authHeaders
            });
            expect(filterFieldRes.status(), "Filter by slug field should return 200").toBe(200);
            const filterFieldBody = (await filterFieldRes.json()) as DataListResponse<PostEntity>;
            expect(filterFieldBody.data.length).toBe(1);
            expect(filterFieldBody.data[0].slug).toBe(testSlug);

            // The JSON dialect, which has to select the same single row.
            const filterWhereRes = await request.get(
                `${baseUrl}/api/data/posts?where=${encodeURIComponent(JSON.stringify({ slug: testSlug }))}`,
                { headers: authHeaders }
            );
            expect(filterWhereRes.status(), "Filter with ?where JSON should return 200").toBe(200);
            const filterWhereBody = (await filterWhereRes.json()) as DataListResponse<PostEntity>;
            expect(filterWhereBody.data.length).toBe(1);
            expect(filterWhereBody.data[0].id).toBe(createdPost.id);
        } finally {
            await request.delete(`${baseUrl}/api/data/posts/${createdPost.id}`, { headers: authHeaders });
        }
    });

    /**
     * The two ways to ask how many rows there are, asserted against each other.
     *
     * They are separate code paths — `/count` counts, `/aggregate` compiles a
     * `select` — and a suite that checks each of them returns *a* number would
     * not notice them disagreeing. Note that `?select=count()` on the *listing*
     * route is not a third way: `select` is only read on `/aggregate`, and the
     * listing silently ignores it and returns the rows.
     */
    test("counts rows identically via /count and /aggregate", async ({ request }) => {
        const countRes = await request.get(`${baseUrl}/api/data/posts/count`, { headers: authHeaders });
        expect(countRes.status(), "GET /api/data/posts/count should return 200").toBe(200);
        const { count } = (await countRes.json()) as { readonly count: number };
        expect(typeof count).toBe("number");
        expect(count).toBeGreaterThan(0);

        const aggRes = await request.get(`${baseUrl}/api/data/posts/aggregate?select=count()`, {
            headers: authHeaders
        });
        expect(aggRes.status(), "GET /api/data/posts/aggregate?select=count() should return 200").toBe(200);
        const aggBody = (await aggRes.json()) as DataListResponse<{ readonly count: number }>;
        expect(aggBody.data.length).toBe(1);
        expect(aggBody.data[0].count, "/aggregate must agree with /count").toBe(count);
    });

    test("supports relation inclusion via include query parameter", async ({ request }) => {
        const stamp = Date.now();
        const authorRes = await request.post(`${baseUrl}/api/data/authors`, {
            headers: authHeaders,
            data: { name: `Relation Author ${stamp}`, email: `author-${stamp}@example.com` }
        });
        expect(authorRes.status()).toBe(201);
        const author = (await authorRes.json()) as { readonly id: string; readonly name: string };

        const postRes = await request.post(`${baseUrl}/api/data/posts`, {
            headers: authHeaders,
            data: {
                title: `Included Author Post ${stamp}`,
                slug: `included-author-post-${stamp}`,
                status: "draft",
                author: author.id
            }
        });
        expect(postRes.status()).toBe(201);
        const post = (await postRes.json()) as PostEntity;

        try {
            // Without `?include` the relation is the foreign key; with it, the
            // row. Asserting the *name* is what tells the two apart — an id
            // echoed back would satisfy "author is defined" just as well.
            const includeRes = await request.get(`${baseUrl}/api/data/posts/${post.id}?include=author`, {
                headers: authHeaders
            });
            expect(includeRes.status(), "GET /api/data/posts/:id?include=author should return 200").toBe(200);
            const postWithAuthor = (await includeRes.json()) as PostEntity;
            expect(postWithAuthor.author).toMatchObject({ id: author.id, name: author.name });
        } finally {
            await request.delete(`${baseUrl}/api/data/posts/${post.id}`, { headers: authHeaders });
            await request.delete(`${baseUrl}/api/data/authors/${author.id}`, { headers: authHeaders });
        }
    });
});
