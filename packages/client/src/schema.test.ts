import { describe, it, expect, jest } from "@jest/globals";
import { RebaseApiError, type TableDescriptor } from "@rebasepro/types";
import { createTransport } from "./transport";
import { createSchema, isSchemaUnavailable, SCHEMA_UNAVAILABLE } from "./schema";
import { createRebaseClient } from "./index";

/**
 * `client.schema.tables()` — the contract `GET /api/schema/tables` is served
 * against: a JSON array of descriptors, an `ETag`, `If-None-Match` → `304`,
 * `401` signed out, `404 SCHEMA_UNAVAILABLE` when the backend serves none.
 */

const posts: TableDescriptor = {
    name: "posts",
    slug: "posts",
    table: "posts",
    schema: "public",
    kind: "table",
    columns: [{ key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true }],
    primaryKey: ["id"],
    relations: [],
    rls: { posture: "admin-only", rules: [], defaultPolicies: true }
};

type FetchCall = { url: string; init: RequestInit };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(status === 304 ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers }
    });
}

function fakeFetch(...answers: Response[]) {
    const calls: FetchCall[] = [];
    const fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        const next = answers.shift();
        if (!next) throw new Error("no more answers");
        return next;
    });
    return { fetch, calls };
}

function headerOf(call: FetchCall, name: string): string | undefined {
    const headers = call.init.headers;
    if (!headers || headers instanceof Headers || Array.isArray(headers)) return undefined;
    return headers[name];
}

describe("client.schema.tables()", () => {
    it("asks GET {apiPath}/schema/tables with the caller's token, and answers the descriptors", async () => {
        const { fetch, calls } = fakeFetch(json(200, [posts], { ETag: "W/\"v1-abc\"" }));
        const schema = createSchema(createTransport({ baseUrl: "https://api.test", token: "tkn", fetch }));

        await expect(schema.tables()).resolves.toEqual([posts]);

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("https://api.test/api/schema/tables");
        expect(calls[0].init.method).toBe("GET");
        expect(headerOf(calls[0], "Authorization")).toBe("Bearer tkn");
        expect(headerOf(calls[0], "If-None-Match")).toBeUndefined();
    });

    it("honours a non-default API base path", async () => {
        const { fetch, calls } = fakeFetch(json(200, []));
        const schema = createSchema(createTransport({ baseUrl: "https://api.test", apiPath: "/v2", token: "tkn", fetch }));
        await schema.tables();
        expect(calls[0].url).toBe("https://api.test/v2/schema/tables");
    });

    it("sends the last ETag in If-None-Match and answers a 304 with the tables it held", async () => {
        const { fetch, calls } = fakeFetch(
            json(200, [posts], { ETag: "W/\"v1-abc\"" }),
            json(304, null, { ETag: "W/\"v1-abc\"" })
        );
        const schema = createSchema(createTransport({ baseUrl: "https://api.test", token: "tkn", fetch }));

        const first = await schema.tables();
        const second = await schema.tables();

        expect(second).toBe(first);
        expect(headerOf(calls[1], "If-None-Match")).toBe("W/\"v1-abc\"");
    });

    it("replaces what it holds when the schema changed", async () => {
        const changed: TableDescriptor = { ...posts, description: "changed" };
        const { fetch, calls } = fakeFetch(
            json(200, [posts], { ETag: "\"a\"" }),
            json(200, [changed], { ETag: "\"b\"" }),
            json(304, null)
        );
        const schema = createSchema(createTransport({ baseUrl: "https://api.test", token: "tkn", fetch }));

        await schema.tables();
        await expect(schema.tables()).resolves.toEqual([changed]);
        await expect(schema.tables()).resolves.toEqual([changed]);
        expect(headerOf(calls[2], "If-None-Match")).toBe("\"b\"");
    });

    it("keeps nothing from an answer without an ETag, so it never sends a stale one", async () => {
        const { fetch, calls } = fakeFetch(json(200, [posts], { ETag: "\"a\"" }), json(200, []), json(200, []));
        const schema = createSchema(createTransport({ baseUrl: "https://api.test", token: "tkn", fetch }));
        await schema.tables();
        await schema.tables();
        await schema.tables();
        expect(headerOf(calls[2], "If-None-Match")).toBeUndefined();
    });

    it("rejects a 401 with the server's status and code", async () => {
        const { fetch } = fakeFetch(json(401, { error: { message: "Sign in first", code: "UNAUTHORIZED" } }));
        const schema = createSchema(createTransport({ baseUrl: "https://api.test", token: "tkn", fetch }));

        const error = await schema.tables().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RebaseApiError);
        expect(error).toMatchObject({ status: 401, code: "UNAUTHORIZED", message: "Sign in first" });
        expect(isSchemaUnavailable(error)).toBe(false);
    });

    it("rejects a 404 SCHEMA_UNAVAILABLE as is", async () => {
        const { fetch } = fakeFetch(json(404, { error: { message: "No auth is configured", code: SCHEMA_UNAVAILABLE } }));
        const schema = createSchema(createTransport({ baseUrl: "https://api.test", token: "tkn", fetch }));

        const error = await schema.tables().catch((e: unknown) => e);
        expect(error).toMatchObject({ status: 404, code: SCHEMA_UNAVAILABLE, message: "No auth is configured" });
        expect(isSchemaUnavailable(error)).toBe(true);
    });

    it("reads a bare 404 — a server older than the route — as SCHEMA_UNAVAILABLE, and says so", async () => {
        const { fetch } = fakeFetch(json(404, { error: { message: "Not Found", code: "NOT_FOUND" } }));
        const schema = createSchema(createTransport({ baseUrl: "https://api.test", token: "tkn", fetch }));

        const error = await schema.tables().catch((e: unknown) => e);
        expect(isSchemaUnavailable(error)).toBe(true);
        expect(error).toMatchObject({ status: 404, code: SCHEMA_UNAVAILABLE });
        expect(error instanceof Error ? error.message : "").toContain("predates the route");
    });

    it("rejects a network failure with the transport's NETWORK_ERROR", async () => {
        const fetch = jest.fn(async () => { throw new TypeError("Failed to fetch"); });
        const schema = createSchema(createTransport({ baseUrl: "https://api.test", token: "tkn", fetch }));

        const error = await schema.tables().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RebaseApiError);
        expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
    });

    it("refuses a body that is not a list of tables", async () => {
        const { fetch } = fakeFetch(json(200, { tables: [posts] }));
        const schema = createSchema(createTransport({ baseUrl: "https://api.test", token: "tkn", fetch }));
        await expect(schema.tables()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("passes an abort signal to fetch", async () => {
        const { fetch, calls } = fakeFetch(json(200, []));
        const schema = createSchema(createTransport({ baseUrl: "https://api.test", token: "tkn", fetch }));
        const controller = new AbortController();
        await schema.tables({ signal: controller.signal });
        expect(calls[0].init.signal).toBe(controller.signal);
    });

    it("is reachable as client.schema", async () => {
        const { fetch, calls } = fakeFetch(json(200, [posts]));
        const client = createRebaseClient({ baseUrl: "https://api.test", token: "tkn", fetch, realtime: false });
        await expect(client.schema.tables()).resolves.toEqual([posts]);
        expect(calls[0].url).toBe("https://api.test/api/schema/tables");
        client.close?.();
    });
});
