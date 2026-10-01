import { describe, expect, test } from "@jest/globals";
import { CollectionRegistryController, Properties, Property } from "@rebasepro/types";
import { AuthController } from "@rebasepro/cms-types";
import { convertImportData, ImportConversionProblem, processValueMapping } from "../../src/data_import/utils/data";
import { loadFixture } from "./fixtures/pipeline";

/**
 * A cell the import cannot convert to its property's type is reported to the
 * person importing — before anything is written — and left out of the row.
 * It used to become `null`, `0`, `false` or a wrong date without a word: a
 * price of `N/A`, a boolean of `maybe`, a vector item `x`, `25/12/2024`.
 */
const auth = {} as AuthController;
const navigation = { getCollection: () => undefined } as unknown as CollectionRegistryController;

function convert(value: unknown, property: Property) {
    const reasons: string[] = [];
    const result = processValueMapping(auth, value, navigation, property, (problem) => reasons.push(problem.reason));
    return { result, reasons };
}

describe("a value that does not convert is reported, not blanked", () => {

    test.each([
        ["N/A", "not_a_number"],
        ["-", "not_a_number"],
        ["1,234", "not_a_number"],
        ["$1.00", "not_a_number"],
        ["12%", "not_a_number"],
        ["555-1234", "not_a_number"],
        ["02134", "number_leading_zero"],
        ["12345678901234567890", "number_too_precise"],
        ["9007199254740993", "number_too_precise"]
    ])("number: %j is reported (%s)", (cell, reason) => {
        expect(convert(cell, { type: "number" }).reasons).toEqual([reason]);
    });

    test.each([["10.00", 10], ["1e3", 1000], [" 42 ", 42], ["-3.5", -3.5]])("number: %j reads as %p", (cell, expected) => {
        expect(convert(cell, { type: "number" })).toEqual({ result: expected, reasons: [] });
    });

    test.each([["maybe"], ["2"]])("boolean: %j is reported", (cell) => {
        expect(convert(cell, { type: "boolean" }).reasons).toEqual(["not_a_boolean"]);
    });

    test("boolean: a number other than 1 or 0 is reported, not false", () => {
        expect(convert(2, { type: "boolean" }).reasons).toEqual(["not_a_boolean"]);
        expect(convert(0, { type: "boolean" })).toEqual({ result: false, reasons: [] });
    });

    test.each([["Y", true], ["n", false], ["TRUE", true], ["no", false]])("boolean: %j reads as %p", (cell, expected) => {
        expect(convert(cell, { type: "boolean" })).toEqual({ result: expected, reasons: [] });
    });

    test("date: text that is no date is reported, not an Invalid Date", () => {
        expect(convert("next tuesday-ish", { type: "date" }).reasons).toEqual(["not_a_date"]);
    });

    test("vector: an item that is not a number is reported, not zero", () => {
        expect(convert("1, x, 3", { type: "vector" }).reasons).toEqual(["not_a_vector"]);
        expect(convert([1, "x"], { type: "vector" }).reasons).toEqual(["not_a_vector"]);
    });

    test("an array item that does not convert reports the cell", () => {
        expect(convert("1, two, 3", { type: "array", of: { type: "number" } }).reasons).toEqual(["not_a_number"]);
    });
});

describe("dates are read as the file means them", () => {
    const date = (cell: unknown, column?: unknown[]) => {
        const converted = convertImportData(auth, navigation, (column ?? [cell]).map(when => ({ when })),
            undefined, { when: "when" }, { when: { type: "date" } }, "TEMP_PATH", {});
        const index = column ? column.indexOf(cell) : 0;
        const value = converted.entities[index].values.when;
        return value instanceof Date ? value.toISOString() : value;
    };

    test("an ISO date and a written-out date are the same day", () => {
        expect(date("2024-01-05")).toBe("2024-01-05T00:00:00.000Z");
        expect(date("5 Jan 2024")).toBe("2024-01-05T00:00:00.000Z");
    });

    test("a column of day/month dates is read day first when one day is past 12", () => {
        const column = ["05/01/2024", "06/02/2024", "25/12/2024"];
        expect(date("05/01/2024", column)).toBe("2024-01-05T00:00:00.000Z");
        expect(date("25/12/2024", column)).toBe("2024-12-25T00:00:00.000Z");
    });

    test("a column of month/day dates is read month first when one day is past 12", () => {
        const column = ["01/05/2024", "12/25/2024"];
        expect(date("01/05/2024", column)).toBe("2024-01-05T00:00:00.000Z");
    });

    test("epoch seconds and epoch milliseconds are both read", () => {
        expect(date(1704448800)).toBe("2024-01-05T10:00:00.000Z");
        expect(date(1704448800000)).toBe("2024-01-05T10:00:00.000Z");
        expect(date("1704448800")).toBe("2024-01-05T10:00:00.000Z");
    });

    test("a date with an offset keeps its instant", () => {
        expect(date("2024-01-05T10:00:00+02:00")).toBe("2024-01-05T08:00:00.000Z");
    });

    // Both orders occur, so the column has no one order: a date only one
    // order can read is read that way, and one either order could read is
    // reported rather than guessed.
    test("a column mixing day/month and month/day reports the dates it cannot place", () => {
        const column = ["25/12/2024", "12/25/2024", "05/06/2024"];
        const converted = convertImportData(auth, navigation, column.map(when => ({ when })),
            undefined, { when: "when" }, { when: { type: "date" } }, "TEMP_PATH", {});
        expect(converted.problems).toEqual([
            { row: 2, column: "when", property: "when", expected: "date", value: "05/06/2024", reason: "ambiguous_date" }
        ]);
        expect(date("25/12/2024", column)).toBe("2024-12-25T00:00:00.000Z");
        expect(date("12/25/2024", column)).toBe("2024-12-25T00:00:00.000Z");
    });
});

describe("convertImportData reports every cell it leaves out", () => {

    // The price column of this file holds `N/A`, a blank and `-` beside
    // its numbers. Mapped to a number field, the two words are not numbers:
    // they are reported with their row, and the rows carry no price.
    test("a number field fed `N/A` and `-` lists both and leaves them out", () => {
        const { data } = loadFixture("a_numeric_na.csv");
        const properties: Properties = { sku: { type: "string" }, price: { type: "number" }, stock: { type: "number" } };
        const mapping = { sku: "sku", price: "price", stock: "stock" };
        const { entities, problems } = convertImportData(auth, navigation, data, undefined, mapping, properties, "TEMP_PATH", {});

        expect(problems).toEqual<ImportConversionProblem[]>([
            { row: 1, column: "price", property: "price", expected: "number", value: "N/A", reason: "not_a_number" },
            { row: 3, column: "price", property: "price", expected: "number", value: "-", reason: "not_a_number" }
        ]);
        expect(entities[1].values).toEqual({ sku: "A2", stock: 4 });
        expect(entities[3].values).toEqual({ sku: "A4", stock: 6 });
        expect(entities[0].values).toEqual({ sku: "A1", price: 10.5, stock: 3 });
    });

    test("a file that converts cleanly reports nothing", () => {
        const { data } = loadFixture("d_bools.csv");
        const properties: Properties = { name: { type: "string" }, yn: { type: "boolean" }, tf_excel: { type: "boolean" }, tf: { type: "boolean" }, zo: { type: "boolean" }, y_n: { type: "boolean" } };
        const mapping = Object.fromEntries(Object.keys(properties).map(key => [key, key]));
        const { entities, problems } = convertImportData(auth, navigation, data, undefined, mapping, properties, "TEMP_PATH", {});
        expect(problems).toEqual([]);
        expect(entities[1].values).toEqual({ name: "b", yn: false, tf_excel: false, tf: false, zo: false, y_n: false });
    });

    test("every date spelling in the dates fixture lands on its day", () => {
        const { data } = loadFixture("c_dates.csv");
        const keys = ["iso", "day", "us", "eu", "text", "epoch_ms", "epoch_s", "tz"];
        const properties: Properties = Object.fromEntries(keys.map(key => [key, { type: "date" } as Property]));
        const mapping = Object.fromEntries(keys.map(key => [key, key]));
        const { entities, problems } = convertImportData(auth, navigation, data, undefined, mapping, properties, "TEMP_PATH", {});
        expect(problems).toEqual([]);
        const day = (key: string, row: number) => (entities[row].values[key] as Date).toISOString().slice(0, 10);
        for (const key of ["iso", "day", "us", "eu", "text", "epoch_ms", "epoch_s"]) {
            expect([key, day(key, 0), day(key, 3)]).toEqual([key, "2024-01-05", "2024-12-25"]);
        }
        expect((entities[3].values.tz as Date).toISOString()).toBe("2024-12-24T15:00:00.000Z");
    });
});

describe("converting a row is linear in its columns", () => {
    // Each column used to spread the whole row built so far into a new
    // object: 5,000 rows of 300 columns took 16 s on the main thread.
    test("eight times the columns costs well under eight squared times the time", () => {
        const time = (columns: number) => {
            const keys = Array.from({ length: columns }, (_, i) => `c${i}`);
            const properties: Properties = Object.fromEntries(keys.map(key => [key, { type: "string" } as Property]));
            const mapping = Object.fromEntries(keys.map(key => [key, key]));
            const rows = Array.from({ length: 100 }, () => Object.fromEntries(keys.map(key => [key, "x"])));
            // The fastest of a few runs: the least disturbed by whatever else
            // the machine is doing.
            let fastest = Infinity;
            for (let run = 0; run < 4; run++) {
                const start = performance.now();
                convertImportData(auth, navigation, rows, undefined, mapping, properties, "TEMP_PATH", {});
                fastest = Math.min(fastest, performance.now() - start);
            }
            return fastest;
        };
        expect(time(800) / time(100)).toBeLessThan(25);
    });
});
