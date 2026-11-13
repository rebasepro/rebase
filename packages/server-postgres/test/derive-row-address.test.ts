import { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { pgTable, text } from "drizzle-orm/pg-core";
import { deriveRowAddress } from "../src/services/collection-helpers";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";

/**
 * The address of a row, derived rather than read off it.
 *
 * A row is exactly its columns, so nothing on the wire carries an `id` unless
 * the table happens to have that column. Everything that needs to name a row —
 * a realtime notification, a history entry, an `afterSave` callback — derives
 * the address from the collection's primary keys, and this is the one helper
 * they all share.
 */
describe("deriveRowAddress", () => {
    const registry = new FixtureTableRegistry();

    /** A table of plain columns, none of them declared a primary key. */
    const table = (name: string, columns: string[]) =>
        pgTable(name, Object.fromEntries(columns.map(column => [column, text(column)])));

    const productsCollection: LegacyCollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            id: { type: "number",
isId: "increment" },
            name: { type: "string" }
        }
    };

    const skuItemsCollection: LegacyCollectionConfig = {
        slug: "sku_items",
        name: "SKU Items",
        table: "sku_items",
        properties: {
            sku: { type: "string",
isId: true },
            label: { type: "string" }
        }
    };

    const membershipsCollection: LegacyCollectionConfig = {
        slug: "memberships",
        name: "Memberships",
        table: "memberships",
        properties: {
            tenant_id: { type: "number",
isId: true },
            user_id: { type: "number",
isId: true },
            role: { type: "string" }
        }
    };

    // `event_id` is the key; `id` is an ordinary column that happens to share
    // the name the address used to be written under.
    const eventsCollection: LegacyCollectionConfig = {
        slug: "events",
        name: "Events",
        table: "events",
        properties: {
            event_id: { type: "number",
isId: true },
            id: { type: "string" },
            name: { type: "string" }
        }
    };

    const unregisteredCollection: LegacyCollectionConfig = {
        slug: "ghosts",
        name: "Ghosts",
        table: "ghosts",
        properties: {
            name: { type: "string" }
        }
    };

    registry.registerMultiple([productsCollection, skuItemsCollection, membershipsCollection, eventsCollection, unregisteredCollection]);
    registry.registerPgTable(table("products", ["id", "name"]), "products");
    registry.registerPgTable(table("sku_items", ["sku", "label"]), "sku_items");
    registry.registerPgTable(table("memberships", ["tenant_id", "user_id", "role"]), "memberships");
    registry.registerPgTable(table("events", ["event_id", "id", "name"]), "events");

    it("derives a single key from its own column", () => {
        expect(deriveRowAddress({ id: 42,
name: "Camera" }, registry.requireTable(productsCollection.slug), registry)).toBe("42");
    });

    it("derives a string key that is not called `id`", () => {
        expect(deriveRowAddress({ sku: "ABC-1",
label: "Widget" }, registry.requireTable(skuItemsCollection.slug), registry)).toBe("ABC-1");
    });

    it("joins a composite key in primary-key order", () => {
        expect(deriveRowAddress({ tenant_id: 1,
user_id: 2,
role: "admin" }, registry.requireTable(membershipsCollection.slug), registry)).toBe("1:::2");
    });

    it("prefers the real key over a column that is merely named `id`", () => {
        // The address is `event_id`; `id` here is ordinary data, and reading it
        // would address a different row than the one that changed.
        expect(deriveRowAddress(
            { event_id: 7,
id: "external-ref-99",
name: "Launch" },
            registry.requireTable(eventsCollection.slug),
            registry
        )).toBe("7");
    });

    it("addresses a table keyed by an implicit `id` by that column", () => {
        // A collection declaring no key lifts to the implicit `id` key; the
        // database holds no table for it here, so the descriptor answers.
        expect(deriveRowAddress({ id: "abc",
name: "Boo" }, registry.requireTable(unregisteredCollection.slug), registry)).toBe("abc");
    });

    it("returns empty when there is no key and no `id`", () => {
        expect(deriveRowAddress({ name: "Boo" }, registry.requireTable(unregisteredCollection.slug), registry)).toBe("");
    });

    it("returns empty rather than a bare separator when a composite key is absent", () => {
        // `buildCompositeId` renders missing parts as empty strings, so an
        // unkeyed row would otherwise be addressed as ":::" — a token that
        // matches nothing and looks like a real one.
        expect(deriveRowAddress({ role: "admin" }, registry.requireTable(membershipsCollection.slug), registry)).toBe("");
    });
});
