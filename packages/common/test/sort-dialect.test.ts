import { deserializeOrderBy, serializeOrderBy } from "../src/data/sort-dialect";

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
