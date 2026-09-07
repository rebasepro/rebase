import { getTableColumns } from "drizzle-orm";
import { pgTable, numeric, varchar, integer } from "drizzle-orm/pg-core";
import { patchPgNumericToNumber } from "../src/utils/pg-numeric-number-patch";

const prices = pgTable("prices", {
    id: varchar("id").primaryKey(),
    amount: numeric("amount"),
    quantity: integer("quantity"),
    samples: numeric("samples").array()
});

const columns = () => getTableColumns(prices);

describe("patchPgNumericToNumber", () => {
    beforeAll(() => {
        patchPgNumericToNumber({ prices });
    });

    it("maps the text Postgres sends for NUMERIC to a JS number", () => {
        expect(columns().amount.mapFromDriverValue("2.5")).toBe(2.5);
        expect(columns().amount.mapFromDriverValue("0")).toBe(0);
    });

    it("leaves null alone", () => {
        expect(columns().amount.mapFromDriverValue(null)).toBeNull();
    });

    it("passes a value it cannot parse through untouched", () => {
        // Better a surprising string than a silent NaN: the caller can still see
        // what the database actually said.
        expect(columns().amount.mapFromDriverValue("not-a-number")).toBe("not-a-number");
    });

    it("parses the elements of a numeric[] column", () => {
        expect(columns().samples.mapFromDriverValue("{1.5,2}")).toEqual([1.5, 2]);
    });

    it("is idempotent, so a second data source does not stack wrappers", () => {
        patchPgNumericToNumber({ prices });
        patchPgNumericToNumber({ prices });
        expect(columns().amount.mapFromDriverValue("3.25")).toBe(3.25);
    });

    it("leaves every other column kind alone", () => {
        expect(columns().quantity.mapFromDriverValue(7)).toBe(7);
        expect(columns().id.mapFromDriverValue("abc")).toBe("abc");
    });
});
