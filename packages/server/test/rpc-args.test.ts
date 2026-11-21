import { describe, expect, it } from "@jest/globals";
import { defineRpc, json } from "../src/schema/index";
import { validateRpcArgs } from "../src/rpc/rpc-args";
import { ApiError } from "../src/api/errors";

/**
 * An RPC's body is checked against the `args` it declared before anything
 * reaches the database: a 400 naming every bad field, the way the data API
 * names them.
 */

const search = defineRpc("search_trips", {
    access: "public",
    args: {
        query: json.string().required().validate({ max: 20 }),
        limit: json.number().validate({ integer: true, min: 1, max: 50 }),
        kind: json.string().oneOf(["city", "beach"]),
        when: json.date(),
        tags: json.array(json.string()),
        filters: json.object({ from: json.date().required(), budget: json.number() }),
        page: json.number().default(1)
    }
});

function refusal(body: unknown): ApiError {
    try {
        validateRpcArgs(search, body);
    } catch (error) {
        if (error instanceof ApiError) return error;
        throw error;
    }
    throw new Error("expected the arguments to be refused");
}

function violations(body: unknown): Array<{ field: string; code: string }> {
    const details = refusal(body).details as { violations: Array<{ field: string; code: string }> };
    return details.violations.map(({ field, code }) => ({ field, code }));
}

describe("validateRpcArgs", () => {
    it("passes the arguments sent, and fills a declared default", () => {
        expect(validateRpcArgs(search, { query: "rome", limit: 5, tags: ["a"] }))
            .toEqual({ query: "rome", limit: 5, tags: ["a"], page: 1 });
    });

    it("passes an explicit null as SQL NULL, and leaves an absent argument out", () => {
        expect(validateRpcArgs(search, { query: "rome", kind: null })).toEqual({ query: "rome", kind: null, page: 1 });
    });

    it("refuses with 400 VALIDATION_CONSTRAINT, naming the missing and the unknown field", () => {
        const error = refusal({ limt: 3 });
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe("VALIDATION_CONSTRAINT");
        expect(error.message).toContain("'limt' is not an argument of search_trips");
        expect(error.message).toContain("'query' is required.");
        expect(violations({ limt: 3 })).toEqual([
            { field: "limt", code: "unknown_argument" },
            { field: "query", code: "required" }
        ]);
    });

    it("refuses a value of the wrong kind, nested ones by their path", () => {
        expect(violations({ query: 4, limit: "5", tags: ["a", 2], filters: { budget: "x" }, when: "not a date" })).toEqual([
            { field: "query", code: "type" },
            { field: "limit", code: "type" },
            { field: "when", code: "type" },
            { field: "tags[1]", code: "type" },
            { field: "filters.from", code: "required" },
            { field: "filters.budget", code: "type" }
        ]);
    });

    it("applies the declared rules, with the data API's codes", () => {
        expect(violations({ query: "x".repeat(21), limit: 1.5, kind: "mountain" })).toEqual([
            { field: "query", code: "max_length" },
            { field: "limit", code: "integer" },
            { field: "kind", code: "enum" }
        ]);
        expect(violations({ query: "rome", limit: 99 })).toEqual([{ field: "limit", code: "max" }]);
    });

    it("takes no body as no arguments, and refuses a body that is not an object", () => {
        const none = defineRpc("ping", { access: "public" });
        expect(validateRpcArgs(none, undefined)).toEqual({});
        expect(validateRpcArgs(none, {})).toEqual({});
        expect(() => validateRpcArgs(none, [1])).toThrow(expect.objectContaining({ code: "INVALID_RPC_BODY", statusCode: 400 }));
        expect(() => validateRpcArgs(none, { x: 1 })).toThrow(expect.objectContaining({
            code: "VALIDATION_CONSTRAINT",
            message: "'x' is not an argument of ping, which takes none."
        }));
    });
});

describe("defineRpc", () => {
    it("returns a branded declaration", () => {
        const def = defineRpc("get_public_proposal", { access: "public", args: { token: json.string().required() } });
        expect(def.brand).toBe("rebase.rpc");
        expect(def.name).toBe("get_public_proposal");
    });

    it("refuses a name, schema or argument no SQL function can have", () => {
        expect(() => defineRpc("get-proposal", { access: "public" })).toThrow(/not a function name/);
        expect(() => defineRpc("x", { access: "public", schema: "my schema" })).toThrow(/not a schema name/);
        expect(() => defineRpc("x", { access: "public", schema: "rebase" })).toThrow(/never exposed/);
        expect(() => defineRpc("x", { access: "public", args: { "a-b": json.string() } })).toThrow(/not a SQL parameter name/);
    });

    it("requires access to be stated", () => {
        // @ts-expect-error — `access` is required.
        expect(() => defineRpc("x", {})).toThrow(/`access` must be "public" or "authenticated"/);
        // @ts-expect-error — not an access level.
        expect(() => defineRpc("x", { access: "anon" })).toThrow(/`access` must be/);
    });

    it("refuses a write-only modifier on an argument, and a rate limit that is not one", () => {
        expect(() => defineRpc("x", { access: "public", args: { by: json.string().onCreateUser() } })).toThrow(/applies to a row being written/);
        expect(() => defineRpc("x", { access: "public", args: { f: json.object({ at: json.date().onCreateNow() }) } })).toThrow(/applies to a row being written/);
        expect(() => defineRpc("x", { access: "public", rateLimit: { limit: 0, windowMs: 1000 } })).toThrow(/positive integer/);
    });
});
