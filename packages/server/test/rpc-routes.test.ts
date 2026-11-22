import { describe, expect, it } from "@jest/globals";
import { Hono, type MiddlewareHandler } from "hono";
import type { CallerSqlOptions } from "@rebasepro/types";
import { defineRpc, json } from "../src/schema/index";
import { createRpcRouter } from "../src/rpc/rpc-routes";
import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-a-fakes";

/**
 * `POST /api/rpc/<name>`: only declared names, `access` decided per RPC,
 * arguments validated before the database, every public RPC limited, and the
 * call run as the caller through the request's driver.
 */

interface SqlCall {
    query: string;
    params?: unknown[];
    write?: boolean;
    uid: string;
}

const catalogueRow = (overrides: Record<string, unknown> = {}) => ({
    returns_set: true,
    return_kind: "c",
    return_type: "proposals",
    default_count: 0,
    parameters: [{ name: "token", type: "text", mode: "i" }],
    ...overrides
});

/**
 * A router behind a stand-in auth middleware: `Authorization: Bearer <uid>`
 * signs in as `<uid>`, `x-scopes` narrows the credential, no header is
 * anonymous. The driver records each statement and answers with `answer`.
 */
function harness(rpc: Parameters<typeof createRpcRouter>[0]["rpc"], answer: (call: SqlCall) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>) {
    const calls: SqlCall[] = [];
    const auth: MiddlewareHandler<HonoEnv> = async (c, next) => {
        const bearer = c.req.header("authorization")?.replace(/^Bearer /, "");
        const uid = bearer ?? "anonymous";
        if (bearer) c.set("user", { uid: bearer, roles: ["user"] });
        const scopes = c.req.header("x-scopes");
        if (scopes !== undefined) c.set("scopes", scopes.split(",").filter(Boolean));
        c.set("driver", fakeDataDriver({
            key: "default",
            sql: async (query: string, options?: CallerSqlOptions) => {
                const call = { query, params: options?.params, write: options?.write, uid };
                calls.push(call);
                return answer(call);
            }
        }));
        return next();
    };
    const app = new Hono<HonoEnv>();
    app.route("/api/rpc", createRpcRouter({ rpc, auth }));
    const post = (name: string, body?: unknown, headers: Record<string, string> = {}) =>
        app.request(`/api/rpc/${name}`, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {})
        });
    return { app, calls, post };
}

const getPublicProposal = defineRpc("get_public_proposal", { access: "public", args: { token: json.string().required() } });
const myTrips = defineRpc("my_trips", { access: "authenticated" });
const bookTrip = defineRpc("book_trip", { access: "authenticated", write: true, args: { trip: json.number().required() } });

/** Answers the catalogue read with `row`, and the call with `rows`. */
const catalogueThen = (row: Record<string, unknown>, rows: Record<string, unknown>[]) => (call: SqlCall) =>
    call.query.includes("pg_catalog.pg_proc") ? [row] : rows;

describe("the RPC router", () => {
    it("calls a declared function as the caller, with the arguments bound", async () => {
        const { post, calls } = harness([getPublicProposal], catalogueThen(catalogueRow(), [{ id: 7, title: "Rome" }]));
        const res = await post("get_public_proposal", { token: "t-1" });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([{ id: 7, title: "Rome" }]);
        expect(calls.map(call => call.uid)).toEqual(["anonymous", "anonymous"]);
        expect(calls[0].params).toEqual(["public", "get_public_proposal"]);
        expect(calls[1]).toMatchObject({
            query: "SELECT _r.* FROM json_to_record($1::json) AS _a(\"token\" text), \"public\".\"get_public_proposal\"(\"token\" => _a.\"token\") AS _r",
            params: ["{\"token\":\"t-1\"}"],
            write: false
        });
    });

    it("reads the catalogue once, and answers a scalar function with its value", async () => {
        const { post, calls } = harness([getPublicProposal], catalogueThen(catalogueRow({ returns_set: false, return_kind: "b", return_type: "int8" }), [{ _r: 3 }]));
        expect(await (await post("get_public_proposal", { token: "a" })).json()).toBe(3);
        expect(await (await post("get_public_proposal", { token: "b" })).json()).toBe(3);
        expect(calls.filter(call => call.query.includes("pg_proc"))).toHaveLength(1);
    });

    it("answers 404 RPC_NOT_FOUND for a name nobody declared, before touching the database", async () => {
        const { post, calls } = harness([getPublicProposal], () => []);
        const res = await post("drop_everything", {});
        expect(res.status).toBe(404);
        expect((await res.json()).error).toMatchObject({ code: "RPC_NOT_FOUND" });
        expect(calls).toHaveLength(0);
    });

    it("answers 405 for another method on a declared name", async () => {
        const { app } = harness([getPublicProposal], () => []);
        const res = await app.request("/api/rpc/get_public_proposal");
        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("POST");
        expect((await app.request("/api/rpc/get_public_proposal/extra")).status).toBe(404);
    });

    it("refuses an anonymous caller of an authenticated RPC with 401", async () => {
        const { post, calls } = harness([myTrips], catalogueThen(catalogueRow({ parameters: [] }), []));
        const res = await post("my_trips");
        expect(res.status).toBe(401);
        expect(calls).toHaveLength(0);
        const signedIn = await post("my_trips", undefined, { authorization: "Bearer ada" });
        expect(signedIn.status).toBe(200);
        expect(calls.every(call => call.uid === "ada")).toBe(true);
    });

    it("refuses bad arguments with 400 naming the field, before touching the database", async () => {
        const { post, calls } = harness([getPublicProposal], () => []);
        const res = await post("get_public_proposal", { token: 5, extra: true });
        expect(res.status).toBe(400);
        const { error } = await res.json();
        expect(error.code).toBe("VALIDATION_CONSTRAINT");
        expect(error.details.violations.map((v: { field: string }) => v.field)).toEqual(["extra", "token"]);
        expect(calls).toHaveLength(0);
        expect((await post("get_public_proposal", "{not json")).status).toBe(400);
    });

    it("runs a write RPC read-write, and needs data:write from a narrowed credential", async () => {
        const { post, calls } = harness([bookTrip], catalogueThen(catalogueRow({ returns_set: false, return_kind: "p", return_type: "void", parameters: [{ name: "trip", type: "integer", mode: "i" }] }), [{ _r: "" }]));
        const narrowed = await post("book_trip", { trip: 1 }, { authorization: "Bearer key", "x-scopes": "data:read" });
        expect(narrowed.status).toBe(403);
        expect((await narrowed.json()).error).toMatchObject({ code: "SCOPE_MISSING", details: { requiredScope: "data:write" } });
        const res = await post("book_trip", { trip: 1 }, { authorization: "Bearer key", "x-scopes": "data:write" });
        expect(res.status).toBe(200);
        expect(await res.json()).toBeNull();
        expect(calls.at(-1)?.write).toBe(true);
    });

    it("holds a public RPC to its limit, per caller", async () => {
        const limited = defineRpc("ping", { access: "public", rateLimit: { limit: 2, windowMs: 60_000 } });
        const { post } = harness([limited], catalogueThen(catalogueRow({ returns_set: false, return_kind: "b", return_type: "int4", parameters: [] }), [{ _r: 1 }]));
        expect((await post("ping")).status).toBe(200);
        expect((await post("ping")).status).toBe(200);
        const third = await post("ping");
        expect(third.status).toBe(429);
        expect(third.headers.get("retry-after")).not.toBeNull();
        expect((await third.json()).error.code).toBe("RATE_LIMITED");
        // A signed-in caller has a count of their own.
        expect((await post("ping", undefined, { authorization: "Bearer ada" })).status).toBe(200);
    });

    it("answers RAISE EXCEPTION with 400 and its message, and PTnnn with that status", async () => {
        const raised = (code: string, message: string) => Object.assign(new Error("Failed query: …"), { cause: Object.assign(new Error(message), { code, hint: "ask the agency" }) });
        let code = "P0001";
        const { post } = harness([getPublicProposal], (call) => {
            if (call.query.includes("pg_proc")) return [catalogueRow()];
            throw raised(code, "Invalid or expired token");
        });
        const res = await post("get_public_proposal", { token: "x" });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatchObject({
            code: "RPC_EXCEPTION",
            message: "Invalid or expired token",
            details: { sqlState: "P0001", hint: "ask the agency" }
        });
        code = "PT404";
        expect((await post("get_public_proposal", { token: "x" })).status).toBe(404);
    });

    it("says to declare write: true when a read-only RPC writes", async () => {
        const { post } = harness([getPublicProposal], (call) => {
            if (call.query.includes("pg_proc")) return [catalogueRow()];
            throw Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("cannot execute INSERT in a read-only transaction"), { code: "25006" }) });
        });
        const res = await post("get_public_proposal", { token: "x" });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatchObject({ code: "RPC_READ_ONLY", message: expect.stringContaining("write: true") });
    });

    it("answers a bad value for the function's type with 400", async () => {
        const { post } = harness([getPublicProposal], (call) => {
            if (call.query.includes("pg_proc")) return [catalogueRow({ parameters: [{ name: "token", type: "uuid", mode: "i" }] })];
            throw Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("invalid input syntax for type uuid: \"abc\""), { code: "22P02" }) });
        });
        const res = await post("get_public_proposal", { token: "abc" });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatchObject({ code: "RPC_INVALID_ARGUMENT", message: "\"abc\" is not a valid uuid." });
    });

    it("reads the catalogue again when the function changed under the cache", async () => {
        let version = 1;
        const { post, calls } = harness([getPublicProposal], (call) => {
            if (call.query.includes("pg_proc")) {
                return [catalogueRow({ parameters: [{ name: "token", type: version === 1 ? "text" : "uuid", mode: "i" }] })];
            }
            if (version === 2 && call.query.includes("\"token\" text")) {
                throw Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("function does not exist"), { code: "42883" }) });
            }
            return [{ id: 1 }];
        });
        expect((await post("get_public_proposal", { token: "a" })).status).toBe(200);
        version = 2;
        const res = await post("get_public_proposal", { token: "a" });
        expect(res.status).toBe(200);
        expect(calls.filter(call => call.query.includes("pg_proc"))).toHaveLength(2);
        expect(calls.at(-1)?.query).toContain("\"token\" uuid");
    });

    it("answers 500 RPC_FUNCTION_MISSING when the database has no such function", async () => {
        const { post } = harness([getPublicProposal], () => []);
        const res = await post("get_public_proposal", { token: "a" });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatchObject({ code: "RPC_FUNCTION_MISSING" });
    });

    it("refuses two declarations under one name", () => {
        expect(() => createRpcRouter({ rpc: [myTrips, defineRpc("my_trips", { access: "public" })], auth: async (_c, next) => next() }))
            .toThrow(/declared more than once/);
    });
});
