import { describe, expect, it } from "@jest/globals";
import { col, defineTable } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import { keyAddressInfo, keyColumns } from "../src/table/keys";
import { columnByKey, columnBySqlName, columnMaps, columnNameOf, keyForColumn } from "../src/table/columns";

/**
 * Keys and column lookup: one answer, read from the descriptor. The legacy
 * driver resolved keys in three tiers (`isId` properties, the drizzle primary
 * key, a column named `id`) and column names by scanning properties; a
 * compiled table states both, so the agreement tests below pin the descriptor
 * answer to the declared tier on every lifted fixture until the legacy one is
 * deleted.
 */

const orders = defineTable("orders", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        number: col.serial(),
        customerId: col.uuid("customer_ref")
    },
    rls: "admin-only"
});

const lines = defineTable("order_lines", {
    columns: {
        orderId: col.uuid().primaryKey(),
        position: col.integer().primaryKey(),
        sku: col.text()
    },
    rls: "admin-only"
});

const counters = defineTable("counters", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        day: col.date(),
        name: col.varchar({ length: 255 })
    },
    rls: "admin-only"
});

const days = defineTable("days", {
    columns: { day: col.date().primaryKey(), code: col.text().primaryKey(), counter: col.bigserial({ mode: "number" }) },
    rls: "admin-only"
});

const [ordersT, linesT, countersT, daysT] = compileTables([orders, lines, counters, days]);

describe("keyColumns", () => {
    it("reads a single uuid key", () => {
        expect(keyColumns(ordersT)).toEqual([
            { key: "id", column: "id", type: { kind: "uuid" }, identity: "uuid", generated: true }
        ]);
    });

    it("reads a composite key in declaration order", () => {
        expect(keyColumns(linesT).map(k => [k.key, k.column, k.identity, k.generated])).toEqual([
            ["orderId", "order_id", "uuid", false],
            ["position", "position", "integer", false]
        ]);
    });

    it("tells an identity integer from a given one, and a serial from both", () => {
        expect(keyColumns(countersT)[0]).toMatchObject({ identity: "identity", generated: true });
        expect(keyColumns(daysT).map(k => k.identity)).toEqual(["other", "text"]);
    });

    it("is empty for a described table whose database table has no key", () => {
        expect(keyColumns({ ...ordersT, primaryKey: [] })).toEqual([]);
    });
});

describe("keyAddressInfo", () => {
    it("is the shape the address helpers read: number, uuid, day", () => {
        expect(keyAddressInfo(ordersT)).toEqual([{ fieldName: "id", type: "string", isUUID: true }]);
        expect(keyAddressInfo(linesT)).toEqual([
            { fieldName: "orderId", type: "string", isUUID: true },
            { fieldName: "position", type: "number", isUUID: false }
        ]);
        expect(keyAddressInfo(daysT)).toEqual([
            { fieldName: "day", type: "string", isUUID: false, isDay: true },
            { fieldName: "code", type: "string", isUUID: false }
        ]);
    });
});

describe("column lookup", () => {
    it("finds a column by key and by SQL name, and says no rather than guessing", () => {
        expect(columnByKey(ordersT, "customerId")?.column).toBe("customer_ref");
        expect(columnBySqlName(ordersT, "customer_ref")?.key).toBe("customerId");
        expect(keyForColumn(ordersT, "customer_ref")).toBe("customerId");
        expect(columnNameOf(ordersT, "customerId")).toBe("customer_ref");
        // The legacy fallback camel-cased any name: `customer_id` became a key.
        expect(keyForColumn(ordersT, "customer_id")).toBeUndefined();
        expect(columnNameOf(ordersT, "missing")).toBeUndefined();
    });

    it("builds both maps at once", () => {
        const { byKey, bySqlName } = columnMaps(linesT);
        expect(byKey.get("orderId")?.column).toBe("order_id");
        expect(bySqlName.get("order_id")?.key).toBe("orderId");
    });
});
