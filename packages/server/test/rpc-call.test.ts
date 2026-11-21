import { describe, expect, it } from "@jest/globals";
import { defineRpc, json } from "../src/schema/index";
import {
    RPC_SIGNATURE_TTL_MS,
    RpcResolutionError,
    RpcSignatureCache,
    buildRpcStatement,
    candidateFromCatalogue,
    resolveCandidate,
    shapeRpcResult,
    type RpcCandidate
} from "../src/rpc/rpc-call";

/**
 * The statement an RPC runs is built from the declaration and the catalogue;
 * the caller's values travel as one bound parameter, never in the text.
 */

const def = defineRpc("get_items", {
    access: "public",
    args: { prefix: json.string(), max_n: json.number() }
});

const items: RpcCandidate = candidateFromCatalogue({
    returns_set: true,
    return_kind: "c",
    return_type: "items",
    default_count: 1,
    parameters: [{ name: "prefix", type: "text", mode: "i" }, { name: "max_n", type: "integer", mode: "i" }]
});

describe("candidateFromCatalogue", () => {
    it("reads what one result row is from the return type", () => {
        const of = (kind: string, type: string) => candidateFromCatalogue({ returns_set: false, return_kind: kind, return_type: type, default_count: 0, parameters: [] }).returns;
        expect(of("c", "items")).toBe("row");
        expect(of("p", "record")).toBe("row");
        expect(of("p", "void")).toBe("void");
        expect(of("b", "int8")).toBe("value");
        expect(of("d", "email")).toBe("value");
        expect(of("e", "mood")).toBe("value");
    });

    it("reads parameters sent as JSON text too", () => {
        expect(candidateFromCatalogue({ returns_set: false, return_kind: "b", return_type: "int4", default_count: 0, parameters: "[{\"name\":\"a\",\"type\":\"integer\",\"mode\":\"i\"}]" }).parameters)
            .toEqual([{ name: "a", type: "integer", mode: "i" }]);
    });
});

describe("buildRpcStatement", () => {
    it("binds the values as one JSON parameter and names each argument", () => {
        const { query, params } = buildRpcStatement(def, items, { prefix: "a'; drop table items; --", max_n: 5 });
        expect(query).toBe(
            "SELECT _r.* FROM json_to_record($1::json) AS _a(\"prefix\" text, \"max_n\" integer), " +
            "\"public\".\"get_items\"(\"prefix\" => _a.\"prefix\", \"max_n\" => _a.\"max_n\") AS _r"
        );
        expect(query).not.toContain("drop table");
        expect(params).toEqual([JSON.stringify({ prefix: "a'; drop table items; --", max_n: 5 })]);
    });

    it("passes only the arguments sent, so the function's DEFAULT applies", () => {
        const { query, params } = buildRpcStatement(def, items, { prefix: "a" });
        expect(query).toContain("AS _a(\"prefix\" text)");
        expect(query).not.toContain("max_n");
        expect(params).toEqual(["{\"prefix\":\"a\"}"]);
    });

    it("calls a function with no arguments without a parameter", () => {
        const none = defineRpc("count_items", { access: "public", schema: "reports" });
        const candidate = candidateFromCatalogue({ returns_set: false, return_kind: "b", return_type: "int8", default_count: 0, parameters: [] });
        expect(buildRpcStatement(none, candidate, {})).toEqual({ query: "SELECT _r.* FROM \"reports\".\"count_items\"() AS _r", params: [] });
    });
});

describe("resolveCandidate", () => {
    const overload = (names: string[], defaults = 0): RpcCandidate => ({
        returnsSet: false,
        returns: "value",
        defaultCount: defaults,
        parameters: names.map(name => ({ name, type: "text", mode: "i" }))
    });

    it("says the function is missing when the catalogue has none", () => {
        expect(() => resolveCandidate(def, [], [])).toThrow(expect.objectContaining({ reason: "missing" }));
    });

    it("picks the overload that takes exactly what was sent", () => {
        const one = overload(["prefix"]);
        const two = overload(["prefix", "max_n"]);
        expect(resolveCandidate(def, [one, two], ["prefix"])).toBe(one);
        expect(resolveCandidate(def, [one, two], ["prefix", "max_n"])).toBe(two);
    });

    it("counts a parameter with a DEFAULT as optional", () => {
        expect(resolveCandidate(def, [items], ["prefix"])).toBe(items);
        expect(() => resolveCandidate(def, [items], [])).toThrow(RpcResolutionError);
        expect(() => resolveCandidate(def, [items], [])).toThrow(/cannot be called with the arguments \(none\): it takes \(prefix, max_n\)/);
    });

    it("refuses an ambiguous call", () => {
        expect(() => resolveCandidate(def, [overload(["prefix"], 1), overload(["prefix"], 1)], ["prefix"]))
            .toThrow(expect.objectContaining({ reason: "ambiguous" }));
    });

    it("never passes an OUT or TABLE column as an argument", () => {
        const withOut: RpcCandidate = { ...items, parameters: [...items.parameters, { name: "total", type: "integer", mode: "o" }] };
        expect(() => resolveCandidate(def, [withOut], ["prefix", "total"])).toThrow(/cannot be called/);
    });
});

describe("shapeRpcResult", () => {
    const candidate = (returnsSet: boolean, returns: RpcCandidate["returns"]): RpcCandidate => ({ returnsSet, returns, defaultCount: 0, parameters: [] });

    it("answers a set of rows as an array, and a set of values as an array of values", () => {
        expect(shapeRpcResult(candidate(true, "row"), [{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
        expect(shapeRpcResult(candidate(true, "value"), [{ _r: 1 }, { _r: 2 }])).toEqual([1, 2]);
        expect(shapeRpcResult(candidate(true, "row"), [])).toEqual([]);
    });

    it("answers one row as an object, and a row of nulls as null", () => {
        expect(shapeRpcResult(candidate(false, "row"), [{ id: 1, name: "a" }])).toEqual({ id: 1, name: "a" });
        expect(shapeRpcResult(candidate(false, "row"), [{ id: null, name: null }])).toBeNull();
    });

    it("answers a scalar as the value, and void as null", () => {
        expect(shapeRpcResult(candidate(false, "value"), [{ _r: 42 }])).toBe(42);
        expect(shapeRpcResult(candidate(false, "value"), [{ _r: { nested: true } }])).toEqual({ nested: true });
        expect(shapeRpcResult(candidate(false, "value"), [])).toBeNull();
        expect(shapeRpcResult(candidate(false, "void"), [{ _r: "" }])).toBeNull();
    });
});

describe("RpcSignatureCache", () => {
    it("reads the catalogue once per window, and again after forget()", async () => {
        let now = 0;
        const cache = new RpcSignatureCache(() => now);
        let reads = 0;
        const sql = async (query: string, options?: { params?: unknown[] }) => {
            reads++;
            expect(query).toContain("pg_catalog.pg_proc");
            expect(options?.params).toEqual(["public", "get_items"]);
            return [{ returns_set: true, return_kind: "c", return_type: "items", default_count: 0, parameters: [] }];
        };
        await cache.candidates(def, sql);
        await cache.candidates(def, sql);
        expect(reads).toBe(1);
        expect(cache.holds(def)).toBe(true);
        now += RPC_SIGNATURE_TTL_MS;
        expect(cache.holds(def)).toBe(false);
        await cache.candidates(def, sql);
        expect(reads).toBe(2);
        cache.forget(def);
        await cache.candidates(def, sql);
        expect(reads).toBe(3);
    });

    it("does not keep a failed read", async () => {
        const cache = new RpcSignatureCache();
        let fail = true;
        const sql = async () => {
            if (fail) throw new Error("down");
            return [];
        };
        await expect(cache.candidates(def, sql)).rejects.toThrow("down");
        fail = false;
        await expect(cache.candidates(def, sql)).resolves.toEqual([]);
    });
});
