import { flatMapSnapshotValues } from "../utils/values";

describe("flatMapSnapshotValues", () => {
    it("returns flat object unchanged", () => {
        const values = { name: "John",
age: 30 };
        const result = flatMapSnapshotValues(values);
        expect(result).toEqual({ name: "John",
age: 30 });
    });

    it("flattens nested object to dot-notation keys", () => {
        const values = {
            address: { city: "NYC",
zip: "10001" }
        };
        const result = flatMapSnapshotValues(values);
        expect(result).toEqual({
            "address.city": "NYC",
            "address.zip": "10001"
        });
    });

    it("flattens deeply nested objects", () => {
        const values = {
            a: { b: { c: { d: "deep" } } }
        };
        const result = flatMapSnapshotValues(values);
        expect(result).toEqual({ "a.b.c.d": "deep" });
    });

    it("returns empty object for empty input", () => {
        expect(flatMapSnapshotValues({})).toEqual({});
    });

    it("returns empty object for null input", () => {
        expect(flatMapSnapshotValues(null as unknown as object)).toEqual({});
    });

    it("returns empty object for undefined input", () => {
        expect(flatMapSnapshotValues(undefined as unknown as object)).toEqual({});
    });

    it("handles mixed nested and flat values", () => {
        const values = {
            name: "John",
            address: { city: "NYC" },
            active: true
        };
        const result = flatMapSnapshotValues(values);
        expect(result).toEqual({
            name: "John",
            "address.city": "NYC",
            active: true
        });
    });

    it("handles multiple nested objects", () => {
        const values = {
            home: { city: "NYC" },
            work: { city: "SF" }
        };
        const result = flatMapSnapshotValues(values);
        expect(result).toEqual({
            "home.city": "NYC",
            "work.city": "SF"
        });
    });

    it("handles numeric values in nested objects", () => {
        const values = {
            stats: { visits: 100,
clicks: 50 }
        };
        const result = flatMapSnapshotValues(values);
        expect(result).toEqual({
            "stats.visits": 100,
            "stats.clicks": 50
        });
    });

    it("uses custom path prefix", () => {
        const values = { name: "John" };
        const result = flatMapSnapshotValues(values, "user");
        expect(result).toEqual({ "user.name": "John" });
    });
});
