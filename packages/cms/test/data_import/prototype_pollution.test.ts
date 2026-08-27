import { afterEach, describe, expect, test } from "@jest/globals";
import { mapJsonParse, unflattenObject } from "../../src/data_import/utils/transforms";
import { flattenEntry } from "../../src/data_import/utils/data";
import { parseCsvToObjects } from "../../src/data_import/utils/csv";

/**
 * The keys these functions write are the **header row of an uploaded file**, so
 * `obj[key] = value` is `docs/bug-classes.md` class 22 with an attacker holding
 * the key. `res["__proto__"]` is the prototype setter rather than an own
 * property, so `__proto__.polluted` walked out of the accumulator and onto
 * `Object.prototype` for the life of the tab.
 */
describe("import refuses header keys that reach the prototype chain", () => {

    afterEach(() => {
        // Nothing should have leaked, but a leak must not cascade into the
        // next test and make it pass for the wrong reason.
        delete (Object.prototype as Record<string, unknown>).polluted;
        delete (Object.prototype as Record<string, unknown>).isAdmin;
    });

    test("unflattenObject does not write through __proto__", () => {
        const result = unflattenObject({ "__proto__.polluted": "pwned" }) as Record<string, unknown>;

        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(result.polluted).toBeUndefined();
    });

    test("unflattenObject does not write through constructor.prototype", () => {
        // In a module (strict mode) this used to throw `Cannot assign to read
        // only property 'prototype'`, which surfaced as an unreadable file.
        const result = unflattenObject({ "constructor.prototype.polluted": "pwned" }) as Record<string, unknown>;

        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(result.polluted).toBeUndefined();
    });

    test("unflattenObject does not write through an indexed __proto__ header", () => {
        const result = unflattenObject({ "__proto__[0]": "pwned" }) as Record<string, unknown>;

        expect(([] as unknown[])[0]).toBeUndefined();
        expect(({} as Record<string, unknown>)[0]).toBeUndefined();
        expect(result[0]).toBeUndefined();
    });

    test("unflattenObject keeps ordinary keys while refusing the unsafe one", () => {
        const result = unflattenObject({
            "address.street": "Main St",
            "__proto__.isAdmin": true
        });

        expect(result).toEqual({ address: { street: "Main St" } });
        expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    });

    test("mapJsonParse does not replace the accumulator's prototype", () => {
        const result = mapJsonParse({ __proto__: "{\"isAdmin\":true}",
            name: "Alice" });

        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect((result as Record<string, unknown>).isAdmin).toBeUndefined();
        expect(result.name).toEqual("Alice");
    });

    test("flattenEntry drops a __proto__ column", () => {
        const result = flattenEntry({ __proto__: { isAdmin: true },
            name: "Alice" } as Record<string, unknown>);

        expect(result).toEqual({ name: "Alice" });
        expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    });

    test("a CSV whose header row is the payload imports nothing dangerous", () => {
        // The same two steps `convertFileToJson` runs over the parsed cells.
        const { data } = parseCsvToObjects("name,__proto__.polluted\nAlice,pwned\n");
        const rows = data.map(mapJsonParse).map(unflattenObject);

        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(rows).toEqual([{ name: "Alice" }]);
    });

    test("a CSV header that is exactly __proto__ never reaches the row object", () => {
        const { data } = parseCsvToObjects("name,__proto__\nAlice,pwned\n");

        expect(Object.getPrototypeOf(data[0])).toBe(Object.prototype);
        expect(data).toEqual([{ name: "Alice" }]);
    });
});
