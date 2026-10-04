import { getNavigationEntriesFromPath } from "../../src/collections/navigation_from_path";
import { CollectionConfig, FirebaseCollectionConfig } from "@rebasepro/types";
import { EntityCustomView } from "@rebasepro/cms-types";

function makeCollection(overrides: Record<string, any> = {}): CollectionConfig {
    const base = {
        name: "Products",
        slug: "products",
        table: "products",
        properties: {},
        ...overrides
    };
    return base as CollectionConfig;
}

describe("getNavigationEntriesFromPath", () => {

    it("resolves a single collection", () => {
        const collections = [makeCollection()];
        const result = getNavigationEntriesFromPath({
            path: "products",
            collections
        });
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("collection");
        expect((result[0] as any).collection.slug).toBe("products");
    });

    it("resolves collection + entity", () => {
        const collections = [makeCollection()];
        const result = getNavigationEntriesFromPath({
            path: "products/123",
            collections
        });
        expect(result).toHaveLength(2);
        expect(result[0].type).toBe("collection");
        expect(result[1].type).toBe("entity");
        expect((result[1] as any).entityId).toBe("123");
    });

    it("resolves nested subcollection path", () => {
        const subCol = makeCollection({
            name: "Variants",
            slug: "variants",
            table: "variants"
        });
        const collections = [
            makeCollection({
                childCollections: () => [subCol]
            })
        ];
        const result = getNavigationEntriesFromPath({
            path: "products/123/variants",
            collections
        });
        expect(result).toHaveLength(3);
        expect(result[0].type).toBe("collection");
        expect(result[1].type).toBe("entity");
        expect(result[2].type).toBe("collection");
        expect((result[2] as any).collection.slug).toBe("variants");
    });

    it("resolves custom entity view", () => {
        const customView: EntityCustomView<any> = {
            key: "analytics",
            name: "Analytics",
            Builder: () => null
        };
        const collections = [
            makeCollection({
                entityViews: [customView]
            })
        ];
        const result = getNavigationEntriesFromPath({
            path: "products/123/analytics",
            collections
        });
        expect(result).toHaveLength(3);
        expect(result[2].type).toBe("custom_view");
        expect((result[2] as any).view.key).toBe("analytics");
    });

    it("resolves string entity view reference", () => {
        const contextView: EntityCustomView<any> = {
            key: "preview",
            name: "Preview",
            Builder: () => null
        };
        const collections = [
            makeCollection({
                entityViews: ["preview"]
            })
        ];
        const result = getNavigationEntriesFromPath({
            path: "products/123/preview",
            collections,
            contextEntityViews: [contextView]
        });
        expect(result).toHaveLength(3);
        expect(result[2].type).toBe("custom_view");
    });

    describe("a slug that contains slashes", () => {
        // Firestore collections are declared this way — `medico/v2.0.0/joints`
        // is one collection's name — and have subcollections under them. The
        // breadcrumbs, the split view and the side panel all read these entries.
        const movements = makeCollection({ name: "Movements",
slug: "movements",
table: "movements" });
        const joints = makeCollection({
            name: "Joints",
            slug: "medico/v2.0.0/joints",
            table: "joints",
            childCollections: () => [movements]
        });
        const podcasts = makeCollection({
            name: "Podcasts",
            slug: "content/podcasts",
            table: "podcasts",
            childCollections: () => [movements]
        });

        it("resolves a subcollection under it, and a record inside that", () => {
            const result = getNavigationEntriesFromPath({
                path: "medico/v2.0.0/joints/j1/movements/m1",
                collections: [joints]
            });
            expect(result.map(entry => [entry.type, entry.path])).toEqual([
                ["collection", "medico/v2.0.0/joints"],
                ["entity", "medico/v2.0.0/joints/j1"],
                ["collection", "medico/v2.0.0/joints/j1/movements"],
                ["entity", "medico/v2.0.0/joints/j1/movements/m1"]
            ]);
        });

        it("resolves under a slug with an even number of segments", () => {
            // Only odd-length prefixes were tried, and `content/podcasts` is two
            // segments long: none of these paths produced a single entry.
            expect(getNavigationEntriesFromPath({ path: "content/podcasts",
collections: [podcasts] }).map(entry => entry.type))
                .toEqual(["collection"]);
            expect(getNavigationEntriesFromPath({ path: "content/podcasts/p1/movements",
collections: [podcasts] }).map(entry => entry.type))
                .toEqual(["collection", "entity", "collection"]);
        });
    });

    it("returns empty array for empty collections", () => {
        const result = getNavigationEntriesFromPath({
            path: "unknown",
            collections: []
        });
        expect(result).toEqual([]);
    });

    it("returns empty array when path does not match any collection", () => {
        const collections = [makeCollection()];
        const result = getNavigationEntriesFromPath({
            path: "nonexistent",
            collections
        });
        expect(result).toEqual([]);
    });

    it("handles leading/trailing slashes", () => {
        const collections = [makeCollection()];
        const result = getNavigationEntriesFromPath({
            path: "/products/",
            collections
        });
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("collection");
    });
});
