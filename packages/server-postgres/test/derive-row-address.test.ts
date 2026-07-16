import { CollectionConfig } from "@rebasepro/types";
import { deriveRowAddress } from "../src/services/collection-helpers";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

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
    const registry = new PostgresCollectionRegistry();

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { _def: { tableName: name } };
        for (const c of columns) t[c] = { name: c };
        return t;
    };

    const productsCollection: CollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            id: { type: "number",
isId: "increment" },
            name: { type: "string" }
        },
        idField: "id"
    };

    const skuItemsCollection: CollectionConfig = {
        slug: "sku_items",
        name: "SKU Items",
        table: "sku_items",
        properties: {
            sku: { type: "string",
isId: true },
            label: { type: "string" }
        },
        idField: "sku"
    };

    const membershipsCollection: CollectionConfig = {
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
    const eventsCollection: CollectionConfig = {
        slug: "events",
        name: "Events",
        table: "events",
        properties: {
            event_id: { type: "number",
isId: true },
            id: { type: "string" },
            name: { type: "string" }
        },
        idField: "event_id"
    };

    const unregisteredCollection: CollectionConfig = {
        slug: "ghosts",
        name: "Ghosts",
        table: "ghosts",
        properties: {
            name: { type: "string" }
        }
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "products") return table("products", ["id", "name"]) as any;
            if (name === "sku_items") return table("sku_items", ["sku", "label"]) as any;
            if (name === "memberships") return table("memberships", ["tenant_id", "user_id", "role"]) as any;
            if (name === "events") return table("events", ["event_id", "id", "name"]) as any;
            return undefined;
        });
    });

    it("derives a single key from its own column", () => {
        expect(deriveRowAddress({ id: 42,
name: "Camera" }, productsCollection, registry)).toBe("42");
    });

    it("derives a string key that is not called `id`", () => {
        expect(deriveRowAddress({ sku: "ABC-1",
label: "Widget" }, skuItemsCollection, registry)).toBe("ABC-1");
    });

    it("joins a composite key in primary-key order", () => {
        expect(deriveRowAddress({ tenant_id: 1,
user_id: 2,
role: "admin" }, membershipsCollection, registry)).toBe("1:::2");
    });

    it("prefers the real key over a column that is merely named `id`", () => {
        // The address is `event_id`; `id` here is ordinary data, and reading it
        // would address a different row than the one that changed.
        expect(deriveRowAddress(
            { event_id: 7,
id: "external-ref-99",
name: "Launch" },
            eventsCollection,
            registry
        )).toBe("7");
    });

    it("falls back to a literal `id` when the table cannot be resolved", () => {
        // `getPrimaryKeys` throws for an unregistered table rather than
        // returning nothing, so the fallback has to survive an exception.
        expect(deriveRowAddress({ id: "abc",
name: "Boo" }, unregisteredCollection, registry)).toBe("abc");
    });

    it("returns empty when there is no key and no `id`", () => {
        expect(deriveRowAddress({ name: "Boo" }, unregisteredCollection, registry)).toBe("");
    });

    it("returns empty rather than a bare separator when a composite key is absent", () => {
        // `buildCompositeId` renders missing parts as empty strings, so an
        // unkeyed row would otherwise be addressed as ":::" — a token that
        // matches nothing and looks like a real one.
        expect(deriveRowAddress({ role: "admin" }, membershipsCollection, registry)).toBe("");
    });
});
