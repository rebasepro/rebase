import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createCollectionClient, etagOf } from "../src/collection";
import { Transport, type ResponseMeta } from "../src/transport";

/**
 * The write options the SDK gained so it can reach what the REST layer serves.
 *
 * The rule this file exists to keep is that the SDK and the HTTP API expose the
 * same capability. Every assertion here is about the *request the client makes*
 * — the header, the verb, the query — because that is the seam where the two
 * drift: the server grew `If-Match`, `Prefer` and `?on_conflict=` and a client
 * that cannot send them makes the feature unreachable for anyone using it.
 *
 * `Idempotency-Key` is the cautionary case. The SDK has sent it on `update()`
 * since the option existed, and the route read it off no request at all — a
 * header sent into nothing for as long as both sides had a test that only
 * checked their own half.
 */

function createMockTransport(): { transport: Transport; mockRequest: jest.Mock<Transport["request"]> } {
    const mockRequest = jest.fn() as jest.Mock<Transport["request"]>;
    const transport: Transport = {
        request: mockRequest,
        baseUrl: "http://localhost",
        apiPath: "/api/v1",
        fetchFn: globalThis.fetch,
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        setOnUnauthorized: jest.fn(),
        getHeaders: jest.fn().mockReturnValue({}),
        resolveToken: jest.fn().mockResolvedValue(null)
    } as unknown as Transport;
    return { transport, mockRequest };
}

describe("write options", () => {
    let transport: Transport;
    let mockRequest: jest.Mock<Transport["request"]>;
    let client: ReturnType<typeof createCollectionClient>;

    beforeEach(() => {
        ({ transport, mockRequest } = createMockTransport());
        mockRequest.mockResolvedValue({ id: "1" } as never);
        client = createCollectionClient(transport, "posts");
    });

    const initOf = (call = 0) => mockRequest.mock.calls[call][1] as RequestInit & {
        headers?: Record<string, string>;
    };

    describe("ifMatch", () => {
        it("sends If-Match on an update", async () => {
            await client.update("1", { title: "x" }, { ifMatch: '"abc"' });

            expect(initOf().headers).toMatchObject({ "If-Match": '"abc"' });
        });

        it("sends If-Match on a delete", async () => {
            // The one write that took no options at all, so the one mutation
            // that could not be made conditional or idempotent.
            await client.delete("1", { ifMatch: '"abc"' });

            expect(initOf()).toMatchObject({ method: "DELETE" });
            expect(initOf().headers).toMatchObject({ "If-Match": '"abc"' });
        });

        it("sends no header at all when the option is absent", async () => {
            await client.update("1", { title: "x" });

            expect(initOf().headers).toBeUndefined();
        });

        it("degrades to an unconditional write when the tag is undefined", async () => {
            // `{ ifMatch: etagOf(row) }` is the idiomatic call, and `etagOf`
            // answers undefined for a row that did not come from a read that
            // reported one. Failing there would make the idiom a trap.
            await client.update("1", { title: "x" }, { ifMatch: undefined });

            expect(initOf().headers).toBeUndefined();
        });
    });

    describe("etagOf", () => {
        it("reads the version off a row `findById` fetched", async () => {
            mockRequest.mockImplementation(async (_path, _init, meta?: ResponseMeta) => {
                if (meta) meta.etag = '"v1"';
                return { id: "1", title: "x" } as never;
            });

            const row = await client.findById("1");

            expect(etagOf(row)).toBe('"v1"');
        });

        it("keeps the version out of the row itself", async () => {
            // Not a column: it must not appear in `Object.keys`, in a
            // `JSON.stringify`, or in a spread into the next update body — or
            // the server would have to strip a field it never sent.
            mockRequest.mockImplementation(async (_path, _init, meta?: ResponseMeta) => {
                if (meta) meta.etag = '"v1"';
                return { id: "1", title: "x" } as never;
            });

            const row = await client.findById("1") as Record<string, unknown>;

            expect(Object.keys(row)).toEqual(["id", "title"]);
            expect(JSON.parse(JSON.stringify(row))).toEqual({ id: "1", title: "x" });
        });

        it("answers undefined for a row that carries no version", async () => {
            expect(etagOf({ id: "1" })).toBeUndefined();
            expect(etagOf(undefined)).toBeUndefined();
            expect(etagOf("not a row")).toBeUndefined();
        });
    });

    describe("returning: false", () => {
        it("sends Prefer: return=minimal on a create", async () => {
            await client.create({ title: "x" }, undefined, { returning: false });

            expect(initOf().headers).toMatchObject({ Prefer: "return=minimal" });
        });

        it("sends it on an update", async () => {
            await client.update("1", { title: "x" }, { returning: false });

            expect(initOf().headers).toMatchObject({ Prefer: "return=minimal" });
        });

        it("returns an empty array from a bulk write rather than the ids as rows", async () => {
            // The server answers ids, and ids are not `M`. Handing back `[]` is
            // the honest answer to "you said you did not want them".
            mockRequest.mockResolvedValue({ data: [1, 2], meta: { written: 2 } } as never);

            const rows = await client.createMany([{ title: "a" }], { returning: false });

            expect(rows).toEqual([]);
        });

        it("still returns the rows when it is not set", async () => {
            mockRequest.mockResolvedValue({ data: [{ id: 1 }], meta: { written: 1 } } as never);

            expect(await client.createMany([{ title: "a" }])).toEqual([{ id: 1 }]);
        });
    });

    describe("upsert", () => {
        it("POSTs with the conflict target in the query", async () => {
            // A query parameter rather than a body field, because the body is
            // the row: a directive mixed into it collides with a column of the
            // same name the day someone declares one.
            await client.upsert({ email: "a@b.c" }, { onConflict: ["email"] });

            expect(mockRequest.mock.calls[0][0]).toBe("/data/posts?on_conflict=email");
            expect(initOf()).toMatchObject({ method: "POST" });
        });

        it("upserts on the primary key when no target is named", async () => {
            await client.upsert({ id: 1, title: "x" });

            expect(mockRequest.mock.calls[0][0]).toBe("/data/posts");
        });

        it("encodes a composite target", async () => {
            await client.upsert({ tenant_id: "t", slug: "s" }, { onConflict: ["tenant_id", "slug"] });

            expect(mockRequest.mock.calls[0][0]).toBe("/data/posts?on_conflict=tenant_id%2Cslug");
        });

        it("carries an idempotency key like any other write", async () => {
            await client.upsert({ email: "a@b.c" }, { idempotencyKey: "k-1" });

            expect(initOf().headers).toMatchObject({ "Idempotency-Key": "k-1" });
        });
    });

    describe("field operations", () => {
        it("sends the marker through untouched", async () => {
            // The client does not interpret them — the server splits and
            // compiles them, so there is one implementation rather than one per
            // transport.
            await client.update("1", { views: { $inc: 1 } } as never);

            expect(JSON.parse(String(initOf().body))).toEqual({ views: { $inc: 1 } });
        });
    });
});
