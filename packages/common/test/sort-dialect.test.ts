import type { OrderByTuple } from "@rebasepro/types";
import {
    OrderBySpecError,
    deserializeOrderBy,
    deserializeOrderByList,
    normalizeDriverOrderBy,
    normalizeOrderBy,
    parseOrderBySpecStrict,
    primaryOrderBy,
    serializeOrderBy
} from "../src/data/sort-dialect";

describe("sort-dialect", () => {
    // -----------------------------------------------------------------------
    // serializeOrderBy
    // -----------------------------------------------------------------------
    describe("serializeOrderBy", () => {
        it("serializes a tuple to wire format", () => {
            expect(serializeOrderBy(["price", "desc"])).toBe("price:desc");
            expect(serializeOrderBy(["name", "asc"])).toBe("name:asc");
        });

        it("returns undefined for undefined input", () => {
            expect(serializeOrderBy(undefined)).toBeUndefined();
        });

        it("passes through a well-formed wire string unchanged (runtime tolerance)", () => {
            // This is undocumented runtime tolerance for untyped JS callers
            expect(serializeOrderBy("price:desc" as never)).toBe("price:desc");
            expect(serializeOrderBy("name:asc" as never)).toBe("name:asc");
        });

        it("passes through a bare field string unchanged", () => {
            expect(serializeOrderBy("name" as never)).toBe("name");
        });
    });

    // -----------------------------------------------------------------------
    // deserializeOrderBy
    // -----------------------------------------------------------------------
    describe("deserializeOrderBy", () => {
        it("deserializes a wire string into a tuple", () => {
            expect(deserializeOrderBy("price:desc")).toEqual(["price", "desc"]);
            expect(deserializeOrderBy("name:asc")).toEqual(["name", "asc"]);
        });

        it("returns undefined for undefined input", () => {
            expect(deserializeOrderBy(undefined)).toBeUndefined();
        });

        it("returns undefined for empty string input", () => {
            expect(deserializeOrderBy("")).toBeUndefined();
        });

        it("defaults direction to asc for bare field name", () => {
            expect(deserializeOrderBy("name")).toEqual(["name", "asc"]);
        });

        it("defaults invalid direction to asc", () => {
            expect(deserializeOrderBy("name:foo")).toEqual(["name", "asc"]);
            expect(deserializeOrderBy("name:ASC")).toEqual(["name", "asc"]);
            expect(deserializeOrderBy("name:DESC")).toEqual(["name", "asc"]);
        });

        it("handles field names with special characters (before colon)", () => {
            expect(deserializeOrderBy("created_at:desc")).toEqual(["created_at", "desc"]);
            expect(deserializeOrderBy("my-field:asc")).toEqual(["my-field", "asc"]);
        });
    });

    // -----------------------------------------------------------------------
    // Round-trip
    // -----------------------------------------------------------------------
    describe("round-trip", () => {
        it("serialize → deserialize preserves the tuple", () => {
            const original: [string, "asc" | "desc"] = ["created_at", "desc"];
            const wire = serializeOrderBy(original);
            const restored = deserializeOrderBy(wire);
            expect(restored).toEqual(original);
        });
    });
});

// ---------------------------------------------------------------------------
// The multi-key half of the codec.
//
// A sort used to be one key, spelled two ways depending on where you stood: a
// tuple in the query builders, and a field name plus a separate `order` at the
// driver. Neither can carry a tie-breaker, so both grew a list form, and the
// old spellings still arrive from callers that have not moved. Every one of
// them collapses through the functions below, which is the only reason a single
// sort has one meaning everywhere.
// ---------------------------------------------------------------------------
describe("sort-dialect — multi-key", () => {
    describe("normalizeOrderBy", () => {
        it("reads the one-key and many-key spellings as the same sort", () => {
            expect(normalizeOrderBy(["price", "desc"])).toEqual([["price", "desc"]]);
            expect(normalizeOrderBy([["price", "desc"]])).toEqual([["price", "desc"]]);
        });

        it("keeps the keys in the order they were given", () => {
            expect(normalizeOrderBy([["roles", "asc"], ["created_at", "desc"]]))
                .toEqual([["roles", "asc"], ["created_at", "desc"]]);
        });

        it("reads an empty list as no sort at all", () => {
            // Not `[]`: letting it through would have every layer below decide
            // for itself whether "sort by nothing" means unsorted or a default.
            expect(normalizeOrderBy([])).toBeUndefined();
            expect(normalizeOrderBy(undefined)).toBeUndefined();
        });
    });

    describe("primaryOrderBy", () => {
        it("hands a single-key caller the most significant key", () => {
            expect(primaryOrderBy([["roles", "asc"], ["created_at", "desc"]])).toEqual(["roles", "asc"]);
            expect(primaryOrderBy(["price", "desc"])).toEqual(["price", "desc"]);
            expect(primaryOrderBy(undefined)).toBeUndefined();
        });
    });

    describe("normalizeDriverOrderBy", () => {
        it("collapses the driver's field-plus-order pair into the list form", () => {
            expect(normalizeDriverOrderBy("price", "desc")).toEqual([["price", "desc"]]);
        });

        it("reads a missing direction as ascending", () => {
            // This is the disagreement the pair used to hide: Postgres read a
            // bare field name as DESC and Mongo read it as ASC, so one call
            // described two different queries depending on the database
            // underneath. `?orderBy=name` over HTTP has always meant ascending.
            expect(normalizeDriverOrderBy("name")).toEqual([["name", "asc"]]);
        });

        it("passes a list through and reads an empty one as no sort", () => {
            expect(normalizeDriverOrderBy([["a", "asc"], ["b", "desc"]]))
                .toEqual([["a", "asc"], ["b", "desc"]]);
            expect(normalizeDriverOrderBy([])).toBeUndefined();
            expect(normalizeDriverOrderBy(undefined)).toBeUndefined();
        });
    });

    describe("parseOrderBySpecStrict", () => {
        it("accepts every spelling a caller outside this process might send", () => {
            expect(parseOrderBySpecStrict("name", "desc")).toEqual([["name", "desc"]]);
            expect(parseOrderBySpecStrict(["name", "desc"])).toEqual([["name", "desc"]]);
            expect(parseOrderBySpecStrict([["a", "asc"], ["b", "desc"]]))
                .toEqual([["a", "asc"], ["b", "desc"]]);
            expect(parseOrderBySpecStrict(undefined)).toBeUndefined();
            expect(parseOrderBySpecStrict("")).toBeUndefined();
        });

        it("refuses a malformed sort instead of reading it as a field name", () => {
            // The failure mode being bought off here is not a crash. A bad entry
            // read as a field name resolves to no column, the sort is dropped,
            // and the rows arrive in whatever order the database pleased —
            // sorted, as far as the subscriber can tell, by what they asked for.
            expect(() => parseOrderBySpecStrict(42)).toThrow(OrderBySpecError);
            expect(() => parseOrderBySpecStrict([[42, "asc"]])).toThrow(OrderBySpecError);
            expect(() => parseOrderBySpecStrict([["", "asc"]])).toThrow(OrderBySpecError);
            expect(() => parseOrderBySpecStrict([["name", "sideways"]])).toThrow(OrderBySpecError);
            expect(() => parseOrderBySpecStrict([])).toThrow(OrderBySpecError);
        });

        it("names the offending entry, so a long sort can be debugged", () => {
            expect(() => parseOrderBySpecStrict([["a", "asc"], ["", "desc"]]))
                .toThrow(/entry 1/);
        });
    });

    describe("round trip over the wire", () => {
        it("keeps the colon shorthand for one key", () => {
            // The shorthand is what `?orderBy=` has always looked like; a
            // single-key sort must not start arriving as JSON.
            expect(serializeOrderBy([["price", "desc"]])).toBe("price:desc");
        });

        it("restores a multi-key sort unchanged", () => {
            const original: OrderByTuple[] = [["roles", "asc"], ["created_at", "desc"]];
            expect(deserializeOrderByList(serializeOrderBy(original))).toEqual(original);
        });

        it("restores a single-key sort through the list reader too", () => {
            expect(deserializeOrderByList(serializeOrderBy(["price", "desc"]))).toEqual([["price", "desc"]]);
        });

        it("reads a bare field name as ascending", () => {
            expect(deserializeOrderByList("name")).toEqual([["name", "asc"]]);
            expect(deserializeOrderByList(undefined)).toBeUndefined();
        });

        it("falls back to the shorthand for a field name that merely looks like JSON", () => {
            // `[weird` is not parseable JSON, and a field may legitimately
            // start with a bracket; the reader must not lose it to a throw.
            expect(deserializeOrderByList("[weird")).toEqual([["[weird", "asc"]]);
        });
    });
});
