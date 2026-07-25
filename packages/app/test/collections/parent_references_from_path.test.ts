import { getParentReferencesFromPath } from "../../src/collections/parent_references_from_path";
import { CollectionConfig, EntityReference } from "@rebasepro/types";

function makeCollection(overrides: Partial<CollectionConfig> = {}): CollectionConfig {
    return {
        name: "Products",
        slug: "products",
        table: "products",
        properties: {},
        ...overrides
    } as CollectionConfig;
}

describe("getParentReferencesFromPath", () => {
    it("returns empty array for root collection path", () => {
        const collections = [makeCollection()];
        const result = getParentReferencesFromPath({
            path: "products",
            collections
        });
        expect(result).toEqual([]);
    });

    it("returns parent reference for entity path", () => {
        const collections = [makeCollection()];
        const result = getParentReferencesFromPath({
            path: "products/123",
            collections
        });
        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(EntityReference);
        expect(result[0].id).toBe("123");
        expect(result[0].path).toBe("products");
    });

    it("returns multiple references for nested paths", () => {
        const subCol = makeCollection({
            name: "Variants",
            slug: "variants",
            table: "variants"
        });
        const rootCol = makeCollection({
            slug: "products",
            childCollections: () => [subCol]
        });
        
        const result = getParentReferencesFromPath({
            path: "products/123/variants/abc",
            collections: [rootCol]
        });
        
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe("123");
        expect(result[0].path).toBe("products");
        expect(result[1].id).toBe("abc");
        expect(result[1].path).toBe("products/123/variants");
    });

    it("handles deeper nesting", () => {
        const grandChildCol = makeCollection({
            name: "Images",
            slug: "images",
            table: "images"
        });
        const subCol = makeCollection({
            slug: "variants",
            childCollections: () => [grandChildCol]
        });
        const rootCol = makeCollection({
            slug: "products",
            childCollections: () => [subCol]
        });
        
        const result = getParentReferencesFromPath({
            path: "products/123/variants/abc/images/img1",
            collections: [rootCol]
        });
        
        expect(result).toHaveLength(3);
        expect(result[0].id).toBe("123");
        expect(result[0].path).toBe("products");
        expect(result[1].id).toBe("abc");
        expect(result[1].path).toBe("products/123/variants");
        expect(result[2].id).toBe("img1");
        expect(result[2].path).toBe("products/123/variants/abc/images");
    });

    it("returns empty if collection not found", () => {
        const result = getParentReferencesFromPath({
            path: "unknown/123",
            collections: [makeCollection()]
        });
        expect(result).toEqual([]);
    });
});
