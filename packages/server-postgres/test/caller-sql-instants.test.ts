/**
 * `getSql(c)` returns an instant as `/api/data` does.
 *
 * It returned Postgres's text (`2026-11-18 10:52:23.5+00`), which some
 * browsers' `Date` cannot parse, while the same column read through the data
 * API is RFC 3339.
 */
import { int8AsNumber, rfc3339Instant, withInstantsAsRfc3339 } from "../src/utils/result-rows";

describe("instants in caller-SQL results", () => {
    it("spells Postgres's timestamptz text, and a Date, as RFC 3339 in UTC", () => {
        expect(rfc3339Instant("2026-11-18 10:52:23.5+00")).toBe("2026-11-18T10:52:23.500Z");
        expect(rfc3339Instant("2026-11-18 12:52:23+02")).toBe("2026-11-18T10:52:23.000Z");
        expect(rfc3339Instant("2026-11-18 10:52:23.123456+05:30")).toBe("2026-11-18T05:22:23.123Z");
        expect(rfc3339Instant(new Date("2026-11-18T10:52:23.5Z"))).toBe("2026-11-18T10:52:23.500Z");
        expect(rfc3339Instant("infinity")).toBe("infinity");
        expect(rfc3339Instant(null)).toBeNull();
    });

    it("rewrites only the timestamptz and bigint columns, aliased or not", () => {
        const result = {
            rows: [{ seen: "2026-11-18 10:52:23.5+00", label: "2026-11-18 10:52:23.5+00", n: "12" }],
            fields: [
                { name: "seen", dataTypeID: 1184 },
                { name: "label", dataTypeID: 25 },
                { name: "n", dataTypeID: 20 }
            ]
        };
        expect(withInstantsAsRfc3339(result, result.rows)).toEqual([
            { seen: "2026-11-18T10:52:23.500Z", label: "2026-11-18 10:52:23.5+00", n: 12 }
        ]);
    });

    it("returns a bigint as a number when it fits, as /api/data does, and the digits when it does not", () => {
        expect(int8AsNumber("42")).toBe(42);
        expect(int8AsNumber("-7")).toBe(-7);
        expect(int8AsNumber("9007199254740993")).toBe("9007199254740993");
        expect(int8AsNumber(null)).toBeNull();
    });
});
