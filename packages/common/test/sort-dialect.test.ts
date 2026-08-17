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

/**
 * An aggregate sort key stops being an object here.
 *
 * `normalizeOrderBy` is the one place that already collapses the two *shapes*
 * of a sort — one tuple, or a list of them — so it is where the two *spellings*
 * of a key collapse too. Above it a key may be either; below it, every key is a
 * string, which is what `OrderByTuple`, the REST parameter, the driver contract
 * and the cursor all already were.
 */
describe("sort-dialect — aggregate sort keys", () => {

    const oldest = { relation: "applications", field: "created_at", agg: "min" } as const;

    describe("normalizeOrderBy", () => {
        it("encodes an aggregate key to its string spelling", () => {
            expect(normalizeOrderBy([oldest, "asc"])).toEqual([["min(applications.created_at)", "asc"]]);
        });

        it("still tells the single-tuple form from the list form", () => {
            // An aggregate key is an object, not an array, so the "is the first
            // element an array" test that distinguishes the two still holds.
            expect(normalizeOrderBy([[oldest, "asc"], ["name", "desc"]]))
                .toEqual([["min(applications.created_at)", "asc"], ["name", "desc"]]);
        });

        it("leaves an ordinary field name alone", () => {
            expect(normalizeOrderBy(["created_at", "desc"])).toEqual([["created_at", "desc"]]);
        });

        it("encodes a bare count", () => {
            expect(normalizeOrderBy([{ relation: "applications", agg: "count" }, "desc"]))
                .toEqual([["count(applications)", "desc"]]);
        });
    });

    describe("serializeOrderBy", () => {
        it("keeps the colon shorthand, because the key carries no colon", () => {
            expect(serializeOrderBy([oldest, "asc"])).toBe("min(applications.created_at):asc");
        });

        it("survives the round trip to the wire and back", () => {
            expect(deserializeOrderByList(serializeOrderBy([oldest, "asc"])))
                .toEqual([["min(applications.created_at)", "asc"]]);
        });

        it("survives it as one key of several", () => {
            expect(deserializeOrderByList(serializeOrderBy([[oldest, "asc"], ["name", "desc"]])))
                .toEqual([["min(applications.created_at)", "asc"], ["name", "desc"]]);
        });
    });

    describe("parseOrderBySpecStrict", () => {
        it("encodes the object spelling from an untyped caller", () => {
            // A subscribe frame or a driver call from plain JavaScript never
            // went through `normalizeOrderBy`. Refusing the shape a typed
            // caller writes would be a distinction nothing else makes.
            expect(parseOrderBySpecStrict([oldest, "asc"]))
                .toEqual([["min(applications.created_at)", "asc"]]);
            expect(parseOrderBySpecStrict([[oldest, "asc"], ["name", "desc"]]))
                .toEqual([["min(applications.created_at)", "asc"], ["name", "desc"]]);
        });

        it("still refuses an entry that is neither a field name nor an aggregate", () => {
            expect(() => parseOrderBySpecStrict([[{ nonsense: true }, "asc"]]))
                .toThrow(OrderBySpecError);
        });
    });
});
