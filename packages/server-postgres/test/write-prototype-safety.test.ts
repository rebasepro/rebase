import { sanitizeAndConvertDates } from "../src/data-transformer";

/**
 * A `__proto__` key in a request body, on the server write path.
 *
 * `JSON.parse` creates `__proto__` as an *own* property, so it survives the
 * `hasOwnProperty` guard in the transformer's copy loop — and
 * `newObj[key] = value` then invokes the prototype setter rather than creating
 * a property. `Object.prototype` is not touched, but the row object's own
 * prototype is replaced by whatever the request supplied, so `row.isAdmin`
 * answers `true` while `Object.keys(row)` shows nothing of the sort.
 *
 * `assertKnownWriteFields` rejects the key for any collection that declares
 * properties — `Object.keys` does include `__proto__` — so this is reachable
 * only where that check deliberately stands down: a collection with no
 * declared properties, or `strictWrites: false`. Those are exactly the
 * configurations that trust the body most.
 */
describe("request bodies cannot reshape the rows built from them", () => {
    const hostile = () => JSON.parse('{"title":"hi","__proto__":{"isAdmin":true}}');

    it("leaves the result on the ordinary object prototype", () => {
        const out = sanitizeAndConvertDates(hostile()) as Record<string, unknown>;

        expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    });

    it("does not let the body answer for a property the row does not have", () => {
        const out = sanitizeAndConvertDates(hostile()) as { isAdmin?: unknown };

        expect(out.isAdmin).toBeUndefined();
    });

    it("keeps the fields that are real", () => {
        const out = sanitizeAndConvertDates(hostile()) as Record<string, unknown>;

        expect(out.title).toBe("hi");
    });

    it("leaves ordinary bodies alone", () => {
        const out = sanitizeAndConvertDates({ title: "hi", count: 3 }) as Record<string, unknown>;

        expect(out).toEqual({ title: "hi", count: 3 });
    });
});
