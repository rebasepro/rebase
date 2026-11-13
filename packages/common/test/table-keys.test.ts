import { describe, expect, it } from "@jest/globals";
import { col, defineTable } from "@rebasepro/types";
import type { CollectionConfig } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import { collectionsToTableDefs } from "../src/migrate";
import { getDeclaredPrimaryKeys } from "../src/util/identity";
import { keyAddressInfo, keyColumns } from "../src/table/keys";
import { columnByKey, columnBySqlName, columnMaps, columnNameOf, keyForColumn } from "../src/table/columns";
import { ALL } from "./schema/fixtures/legacy-capabilities";

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
        customerId: col.uuid().column("customer_ref")
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
        id: col.integer().primaryKey().identity(),
        day: col.date(),
        name: col.varchar()
    },
    rls: "admin-only"
});

const days = defineTable("days", {
    columns: { day: col.date().primaryKey(), code: col.text().primaryKey(), counter: col.bigserial() },
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

describe("keys agree with the declared `isId` tier on every lifted fixture", () => {
    const fixtures: CollectionConfig[] = ALL;
    const { tables, defaultRls } = collectionsToTableDefs(fixtures);
    const descriptors = compileTables(tables, defaultRls ? { defaultRls } : {});

    it.each(fixtures.map((collection, index) => [collection.slug, collection, index] as const))(
        "%s",
        (_slug, collection, index) => {
            const descriptor = descriptors[index];
            const declared = getDeclaredPrimaryKeys(collection);
            const fromDescriptor = keyAddressInfo(descriptor);
            if (declared.length > 0) {
                expect(fromDescriptor.map(k => k.fieldName)).toEqual(declared.map(k => k.fieldName));
                expect(fromDescriptor.map(k => k.type)).toEqual(declared.map(k => k.type));
                // `isId: "uuid"` is a claim about a uuid column; the descriptor says uuid
                // whenever the column is one — the claim implies it, never the reverse.
                declared.forEach((key, i) => {
                    if (key.isUUID) expect(fromDescriptor[i].isUUID).toBe(true);
                });
            } else {
                // No `isId`: the implicit `id` column is the key, on both sides.
                expect(fromDescriptor.map(k => k.fieldName)).toEqual(["id"]);
            }
        }
    );
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
