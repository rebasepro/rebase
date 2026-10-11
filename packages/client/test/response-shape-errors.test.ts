import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { RebaseApiError, RebaseClientError } from "@rebasepro/types";
import { createRebaseClient } from "../src/index";
import { createCollectionClient } from "../src/collection";
import { createTransport } from "../src/transport";
import { OfflineManager } from "../src/offline";
import { MemoryOfflineStore } from "../src/offline-store";

/**
 * Every failure the client reports is a `RebaseApiError` with a `code`, so the
 * documented `switch (e.code)` handles it. Three edges did not:
 *
 * - a `find()` answered with an empty body resolved as an empty page with no
 *   `meta`, and `findById()` as the row `{}` — a misrouted proxy looked like
 *   "no rows";
 * - a `find()` answered `204` threw a raw `TypeError` (reading `.data` of
 *   `undefined`);
 * - `createMany`/`updateMany`/`deleteMany`/`batch` given something other than
 *   an array threw a bare `TypeError`.
 */

beforeEach(() => { jest.spyOn(console, "warn").mockImplementation(() => undefined); });

function respond(status: number, body: string) {
    return jest.fn(async () => new Response(status === 204 ? null : body, {
        status,
        headers: body ? { "Content-Type": "application/json" } : {}
    }));
}

function client(status: number, body: string) {
    const transport = createTransport({ baseUrl: "https://api.example.com", fetch: respond(status, body) });
    return createCollectionClient<{ id: string; title: string }>(transport, "posts");
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("expected a rejection");
}

describe("a read answered with no body", () => {
    it("find() on a 200 with an empty body is a RebaseApiError, not an empty page", async () => {
        const error = await caught(client(200, "").find());
        expect(error).toBeInstanceOf(RebaseApiError);
        expect(error).toMatchObject({ status: 200, code: "UNEXPECTED_RESPONSE" });
    });

    it("find() on a 204 is a RebaseApiError, not a TypeError", async () => {
        const error = await caught(client(204, "").find());
        expect(error).toBeInstanceOf(RebaseApiError);
        expect(error).toMatchObject({ status: 204, code: "UNEXPECTED_RESPONSE" });
    });

    it("find() on a body without a data list is a RebaseApiError", async () => {
        const error = await caught(client(200, JSON.stringify({ ok: true })).find());
        expect(error).toMatchObject({ status: 200, code: "UNEXPECTED_RESPONSE" });
    });

    it("findById() on a 200 with an empty body is a RebaseApiError, not the row {}", async () => {
        const error = await caught(client(200, "").findById("1"));
        expect(error).toBeInstanceOf(RebaseApiError);
        expect(error).toMatchObject({ status: 200, code: "UNEXPECTED_RESPONSE" });
    });

    it("still reads a well-formed page and row", async () => {
        await expect(client(200, JSON.stringify({ data: [], meta: { total: 0 } })).find())
            .resolves.toEqual({ data: [], meta: { total: 0 } });
        await expect(client(200, JSON.stringify({ id: "1", title: "a" })).findById("1"))
            .resolves.toMatchObject({ id: "1", title: "a" });
    });
});

describe("a bulk call given something other than an array", () => {
    const notAnArray = "nope" as unknown as never[];

    async function expectInvalid(promise: Promise<unknown>) {
        const error = await caught(promise);
        expect(error).toBeInstanceOf(RebaseClientError);
        expect(error).toMatchObject({ code: "INVALID_BULK_BODY" });
    }

    it("is a RebaseClientError with INVALID_BULK_BODY on the HTTP client", async () => {
        const posts = client(200, "{}");
        await expectInvalid(posts.createMany(notAnArray));
        await expectInvalid(posts.updateMany(notAnArray));
        await expectInvalid(posts.deleteMany(notAnArray));
    });

    it("is the same on batch()", async () => {
        const rebase = createRebaseClient({ baseUrl: "https://api.example.com", realtime: false, fetch: respond(200, "{}") });
        await expectInvalid(rebase.batch(notAnArray));
    });

    it("is the same on the offline wrapper", async () => {
        const inner = client(200, "{}");
        const manager = new OfflineManager({ store: new MemoryOfflineStore(), syncIntervalMs: 0 }, () => inner);
        const posts = manager.wrap("posts", inner);
        await expectInvalid(posts.createMany(notAnArray));
        await expectInvalid(posts.updateMany(notAnArray));
        await expectInvalid(posts.deleteMany(notAnArray));
    });
});
