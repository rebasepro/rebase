import { date, integer, pgTable, primaryKey, serial, text, uuid, varchar } from "drizzle-orm/pg-core";
import { col, defineTable, type AnyTableDef, type TableDescriptor } from "@rebasepro/types";
import { compileSchema, compileDescribedTables } from "@rebasepro/common";
import type { PgTable } from "drizzle-orm/pg-core";
import { getPrimaryKeys, requirePrimaryKeys, requireTableKeys, tableKeys } from "../src/services/collection-helpers";
import { tableKeyColumns } from "../src/services/cdc/identity-columns";
import { buildRuntimeTable, type RuntimeTable } from "../src/model/runtime-table";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";

/**
 * Row keys read from the runtime table: the descriptor's answer
 * (`.primaryKey()` and the column types); the catalogue only for a table
 * introspected without a key.
 *
 * This replaced the driver's three tiers (`isId` properties, the drizzle
 * primary key, a column named `id`) and the boot warning about keys the admin
 * could not resolve: the admin reads the served descriptors now, which always
 * state the key, so the disagreement that warning reported cannot arise.
 */

const runtimeOf = (def: AnyTableDef, pg?: PgTable): RuntimeTable => buildRuntimeTable(compileSchema([def])[0], pg);

describe("tableKeys", () => {
    it("reads the declared key", () => {
        const items = defineTable("items", { columns: { sku: col.text().primaryKey(), label: col.text() }, rls: "admin-only" });
        expect(tableKeys(runtimeOf(items, pgTable("items", { sku: varchar("sku").primaryKey(), label: text("label") }))))
            .toEqual([{ fieldName: "sku", type: "string", isUUID: false }]);
    });

    it("reads a composite key in declaration order", () => {
        const translations = defineTable("company_translation", {
            columns: { id: col.integer().primaryKey(), locale: col.varchar({ length: 255 }).primaryKey(), name: col.text() },
            rls: "admin-only"
        });
        const pg = pgTable("company_translation", {
            id: integer("id").notNull(), locale: varchar("locale").notNull(), name: varchar("name")
        }, table => [primaryKey({ columns: [table.id, table.locale] })]);
        expect(tableKeys(runtimeOf(translations, pg))).toEqual([
            { fieldName: "id", type: "number", isUUID: false },
            { fieldName: "locale", type: "string", isUUID: false }
        ]);
    });

    it("answers from the descriptor when this database holds no such table", () => {
        const notes = defineTable("notes", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" });
        expect(tableKeys(runtimeOf(notes))).toEqual([{ fieldName: "id", type: "string", isUUID: true }]);
    });

    it("keeps the declared key's columns when the catalogue's primary key differs, and the catalogue's type", () => {
        // A database behind its declaration: the key named is the declaration's,
        // the value is built for the column the statement runs against.
        const counters = defineTable("counters", { columns: { id: col.text().primaryKey(), seq: col.integer() }, rls: "admin-only" });
        const pg = pgTable("counters", { id: serial("id"), seq: integer("seq").primaryKey() });
        expect(tableKeys(runtimeOf(counters, pg))).toEqual([{ fieldName: "id", type: "string", isUUID: false }]);
    });

    it("marks a day key, so a Date is addressed as YYYY-MM-DD", () => {
        const days = defineTable("days", { columns: { day: col.date().primaryKey() }, rls: "admin-only" });
        expect(tableKeys(runtimeOf(days, pgTable("days", { day: date("day").primaryKey() })))[0].isDay).toBe(true);
        expect(tableKeys(runtimeOf(days))[0].isDay).toBe(true);
    });

    describe("an introspected table whose database table declares no key", () => {
        const keyless = (pg: PgTable, columns: TableDescriptor["columns"]): RuntimeTable => {
            const descriptor: TableDescriptor = {
                name: "loose", slug: "loose", table: "loose", schema: "public", kind: "table",
                columns, primaryKey: [], relations: [],
                rls: { posture: "rules", rules: [], defaultPolicies: false }
            };
            return buildRuntimeTable(compileDescribedTables([descriptor], { rls: () => "admin-only" })[0], pg);
        };

        it("reads the catalogue's composite constraint", () => {
            const pg = pgTable("loose", { a: integer("a").notNull(), b: uuid("b").notNull() }, t => [primaryKey({ columns: [t.a, t.b] })]);
            expect(tableKeys(keyless(pg, [
                { key: "a", column: "a", type: { kind: "integer" }, nullable: false },
                { key: "b", column: "b", type: { kind: "uuid" }, nullable: false }
            ]))).toEqual([
                { fieldName: "a", type: "number", isUUID: false },
                { fieldName: "b", type: "string", isUUID: true }
            ]);
        });

        it("falls back to a column named id, and to nothing", () => {
            expect(tableKeys(keyless(pgTable("loose", { id: serial("id"), name: text("name") }), [
                { key: "id", column: "id", type: { kind: "serial" }, nullable: false },
                { key: "name", column: "name", type: { kind: "text" }, nullable: true }
            ])).map(k => k.fieldName)).toEqual(["id"]);
            const none = keyless(pgTable("loose", { name: text("name") }), [{ key: "name", column: "name", type: { kind: "text" }, nullable: true }]);
            expect(tableKeys(none)).toEqual([]);
            expect(() => requireTableKeys(none)).toThrow(
                "The table 'loose' has no primary key, so its rows cannot be addressed. Declare one with `.primaryKey()`; " +
                "a table introspected from the database needs a primary key there."
            );
        });
    });
});

describe("getPrimaryKeys / requirePrimaryKeys — from a call site holding the lowered collection", () => {
    const items = defineTable("items", { columns: { sku: col.text().primaryKey() }, rls: "admin-only" });
    const registry = new PostgresTableRegistry();
    registry.registerTables(compileSchema([items]));

    it("reads the runtime table of the collection's slug", () => {
        expect(getPrimaryKeys(registry.requireTable({ slug: "items", name: "items", properties: {} }.slug), registry).map(k => k.fieldName)).toEqual(["sku"]);
        expect(requirePrimaryKeys(registry.requireTable({ slug: "items", name: "items", properties: {} }.slug), registry).map(k => k.fieldName)).toEqual(["sku"]);
    });

    it("refuses a collection the driver serves no table for, naming the slug", () => {
        expect(() => getPrimaryKeys(registry.requireTable({ slug: "elsewhere", name: "elsewhere", properties: {} }.slug), registry))
            .toThrow(/The table "elsewhere" is not one this driver serves\. It serves: items\./);
    });
});

describe("tableKeyColumns", () => {
    it("maps each key to the SQL column a trigger captures", () => {
        const members = defineTable("members", {
            columns: { userId: col.uuid().primaryKey(), orgId: col.uuid("org_ref").primaryKey() },
            rls: "admin-only"
        });
        expect(tableKeyColumns(runtimeOf(members))).toEqual([
            { fieldName: "userId", columnName: "user_id" },
            { fieldName: "orgId", columnName: "org_ref" }
        ]);
    });
});
