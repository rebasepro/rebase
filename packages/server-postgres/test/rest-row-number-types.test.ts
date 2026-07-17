import { CollectionConfig } from "@rebasepro/types";
import { toRestRow } from "../src/services/row-pipeline";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * A `number` property is served as a number.
 *
 * Postgres returns NUMERIC as a string and drizzle keeps it that way. REST used
 * to pass that straight through, so `POST /data/products` answered with
 * `price: 9.99` and the `GET` right after it answered with `price: "9.99"` —
 * the same field, the same row, two types. Client arithmetic worked until the
 * first refresh, and the published OpenAPI spec said `type: number` throughout.
 */
describe("REST row — declared number properties keep their declared type", () => {
    const registry = new PostgresCollectionRegistry();

    const categoriesCollection: CollectionConfig = {
        slug: "categories",
        name: "Categories",
        table: "categories",
        properties: {
            id: { type: "number", isId: true },
            name: { type: "string" },
            rating: { type: "number" }
        }
    };

    const productsCollection: CollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            id: { type: "number", isId: true },
            name: { type: "string" },
            price: { type: "number" },
            created_at: { type: "date" }
        }
    };

    it("parses a NUMERIC string into a number", () => {
        const row = toRestRow(
            { id: 3, name: "Widget", price: "9.99" },
            productsCollection,
            registry
        );

        expect(row.price).toBe(9.99);
        expect(typeof row.price).toBe("number");
    });

    it("leaves values of other declared types exactly as the database returned them", () => {
        // Dates in particular: REST serves what Postgres gave it, because JSON
        // has its own opinions the admin's view-model does not share.
        const createdAt = "2026-07-17T10:00:00.000Z";
        const row = toRestRow(
            { id: 3, name: "Widget", price: "1", created_at: createdAt },
            productsCollection,
            registry
        );

        expect(row.created_at).toBe(createdAt);
        expect(row.name).toBe("Widget");
    });

    it("passes through columns no property declares", () => {
        // baas/introspected rows can carry columns the collection never named;
        // they are not ours to reinterpret.
        const row = toRestRow(
            { id: 3, price: "2.50", legacy_total: "1234.5" },
            productsCollection,
            registry
        );

        expect(row.price).toBe(2.5);
        expect(row.legacy_total).toBe("1234.5");
    });

    it("nulls a number that is not one rather than serving NaN", () => {
        const row = toRestRow({ id: 3, price: "not-a-number" }, productsCollection, registry);

        expect(row.price).toBeNull();
    });

    it("leaves null and already-numeric values alone", () => {
        const row = toRestRow({ id: 3, price: null }, productsCollection, registry);
        expect(row.price).toBeNull();

        const numeric = toRestRow({ id: 3, price: 4.25 }, productsCollection, registry);
        expect(numeric.price).toBe(4.25);
    });

    it("applies to the columns of an inlined relation target", () => {
        const withRelation: CollectionConfig = {
            ...productsCollection,
            relations: [
                {
                    relationName: "category",
                    cardinality: "one",
                    localKey: "category_id",
                    target: () => categoriesCollection
                }
            ]
        } as CollectionConfig;

        const row = toRestRow(
            {
                id: 3,
                price: "9.99",
                category: { id: 2, name: "Gadgets", rating: "4.5" }
            },
            withRelation,
            registry
        );

        expect(row.price).toBe(9.99);
        expect((row.category as Record<string, unknown>).rating).toBe(4.5);
    });
});
