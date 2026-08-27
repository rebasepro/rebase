import { CollectionConfig, User } from "@rebasepro/types";
import { RebaseContext } from "@rebasepro/cms-types";
import { resolveNavigationFrom } from "../src/hooks/useResolvedNavigationFrom";

/**
 * Resolving a navigation path to an entity means fetching the row it names and
 * wrapping it in the view-model the admin renders — which needs an address.
 *
 * The row does not have one: it is exactly its columns. The address was being
 * read back off it, which is `undefined` for every table not keyed on `id`, and
 * for a table that *has* an ordinary `id` column is a different row's data. It
 * is already in hand: the path segment this row was just fetched by.
 */
describe("resolveNavigationFrom — the entity's address is the one it was fetched by", () => {
    const skuItemsCollection: CollectionConfig = {
        slug: "sku_items",
        name: "SKU Items",
        table: "sku_items",
        properties: {
            sku: { type: "string",
isId: true },
            label: { type: "string" }
        }
    };

    const eventsCollection: CollectionConfig = {
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

    /** A context whose data layer serves `row` for any findById. */
    const contextServing = (collections: CollectionConfig[], row: Record<string, unknown> | undefined) => {
        const findById = jest.fn().mockResolvedValue(row);
        return {
            context: {
                data: { collection: () => ({ findById }) },
                navigationStateController: {},
                collectionRegistryController: {
                    collections,
                    getCollection: (slug: string) => collections.find(c => c.slug === slug)
                }
            } as unknown as RebaseContext<User>,
            findById
        };
    };

    it("addresses a `sku`-keyed row by the path segment, not by a missing `id`", async () => {
        const { context, findById } = contextServing([skuItemsCollection], { sku: "ABC-1",
label: "Widget" });

        const entries = await resolveNavigationFrom({ path: "sku_items/ABC-1",
context });

        expect(findById).toHaveBeenCalledWith("ABC-1");
        const entity = (entries.find(e => e.type === "entity") as { entity: { id: unknown; values: unknown } }).entity;
        expect(entity.id).toBe("ABC-1");
        expect(entity.values).toEqual({ sku: "ABC-1",
label: "Widget" });
    });

    it("does not address a row by a column that merely happens to be called `id`", async () => {
        // The key is `event_id`; `id` here holds an external reference. Reading
        // it would give the entity an address that routes somewhere else.
        const { context } = contextServing([eventsCollection], {
            event_id: 7,
            id: "external-ref-99",
            name: "Launch"
        });

        const entries = await resolveNavigationFrom({ path: "events/7",
context });

        const entity = (entries.find(e => e.type === "entity") as { entity: { id: unknown } }).entity;
        expect(entity.id).toBe("7");
    });

    it("resolves to nothing when the row is not there", async () => {
        const { context } = contextServing([skuItemsCollection], undefined);

        const entries = await resolveNavigationFrom({ path: "sku_items/GONE",
context });

        expect(entries.some(e => e?.type === "entity")).toBe(false);
    });
});
