/**
 * @jest-environment jsdom
 */
import {
    removeInitialAndTrailingSlashes,
    removeInitialSlash,
    removeTrailingSlash,
    addInitialSlash,
    getLastSegment,
    resolveCollectionPathIds,
    getCollectionBySlugWithin,
    getCollectionPathsCombinations,
    navigateToEntity
} from "../../src/util/navigation_utils";

import type { CollectionConfig } from "@rebasepro/types";
import type { SidePanelController, UrlController } from "@rebasepro/cms-types";

// ---------------------------------------------------------------------------
// removeInitialSlash
// ---------------------------------------------------------------------------
describe("removeInitialSlash", () => {
    it("removes a leading slash", () => {
        expect(removeInitialSlash("/foo/bar")).toBe("foo/bar");
    });
    it("returns unchanged string when no leading slash", () => {
        expect(removeInitialSlash("foo/bar")).toBe("foo/bar");
    });
    it("handles empty string", () => {
        expect(removeInitialSlash("")).toBe("");
    });
    it("handles only a slash", () => {
        expect(removeInitialSlash("/")).toBe("");
    });
});

// ---------------------------------------------------------------------------
// removeTrailingSlash
// ---------------------------------------------------------------------------
describe("removeTrailingSlash", () => {
    it("removes a trailing slash", () => {
        expect(removeTrailingSlash("foo/bar/")).toBe("foo/bar");
    });
    it("returns unchanged string when no trailing slash", () => {
        expect(removeTrailingSlash("foo/bar")).toBe("foo/bar");
    });
    it("handles empty string", () => {
        expect(removeTrailingSlash("")).toBe("");
    });
    it("handles only a slash", () => {
        expect(removeTrailingSlash("/")).toBe("");
    });
});

// ---------------------------------------------------------------------------
// removeInitialAndTrailingSlashes
// ---------------------------------------------------------------------------
describe("removeInitialAndTrailingSlashes", () => {
    it("strips both leading and trailing slashes", () => {
        expect(removeInitialAndTrailingSlashes("/foo/bar/")).toBe("foo/bar");
    });
    it("strips only leading slash", () => {
        expect(removeInitialAndTrailingSlashes("/foo")).toBe("foo");
    });
    it("strips only trailing slash", () => {
        expect(removeInitialAndTrailingSlashes("foo/")).toBe("foo");
    });
    it("handles a clean path", () => {
        expect(removeInitialAndTrailingSlashes("foo/bar")).toBe("foo/bar");
    });
    it("handles empty string", () => {
        expect(removeInitialAndTrailingSlashes("")).toBe("");
    });
    it("handles / only", () => {
        expect(removeInitialAndTrailingSlashes("/")).toBe("");
    });
});

// ---------------------------------------------------------------------------
// addInitialSlash
// ---------------------------------------------------------------------------
describe("addInitialSlash", () => {
    it("adds a leading slash when missing", () => {
        expect(addInitialSlash("foo")).toBe("/foo");
    });
    it("does not double a leading slash", () => {
        expect(addInitialSlash("/foo")).toBe("/foo");
    });
    it("handles empty string", () => {
        expect(addInitialSlash("")).toBe("/");
    });
});

// ---------------------------------------------------------------------------
// getLastSegment
// ---------------------------------------------------------------------------
describe("getLastSegment", () => {
    it("returns the last path segment", () => {
        expect(getLastSegment("a/b/c")).toBe("c");
    });
    it("strips surrounding slashes first", () => {
        expect(getLastSegment("/a/b/c/")).toBe("c");
    });
    it("returns path as-is if no separators", () => {
        expect(getLastSegment("lonely")).toBe("lonely");
    });
    it("handles slash-only input", () => {
        expect(getLastSegment("/")).toBe("");
    });
});

// ---------------------------------------------------------------------------
// getCollectionPathsCombinations
// ---------------------------------------------------------------------------
describe("getCollectionPathsCombinations", () => {
    it("returns every whole-segment prefix, longest first", () => {
        // Even lengths too: a slug may contain slashes, so `sites/es` is as
        // much a candidate collection as `sites`.
        expect(getCollectionPathsCombinations(["sites", "es", "locales"]))
            .toEqual(["sites/es/locales", "sites/es", "sites"]);
    });
    it("handles single-element array", () => {
        expect(getCollectionPathsCombinations(["products"]))
            .toEqual(["products"]);
    });
    it("handles empty array", () => {
        expect(getCollectionPathsCombinations([])).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// resolveCollectionPathIds
// ---------------------------------------------------------------------------
describe("resolveCollectionPathIds", () => {
    const collections: CollectionConfig[] = [
        {
            id: "products",
            name: "Products",
            path: "products_table",
            slug: "products",
            table: "products_table",
            properties: {}
        },
        {
            id: "users",
            name: "Users",
            path: "users_table",
            slug: "users",
            table: "users_table",
            properties: {},
            driver: "firestore",
            childCollections: () => [
                {
                    id: "orders",
                    name: "Orders",
                    path: "orders_table",
                    slug: "orders",
                    table: "orders_table",
                    properties: {}
                }
            ]
        }
    ] as CollectionConfig[];

    it("returns empty string for empty path", () => {
        expect(resolveCollectionPathIds("", collections)).toBe("");
    });

    // The fixture gives every collection a `table` that differs from its `slug`
    // precisely so these assertions can tell the two apart: the resolver deals in
    // slugs, and a segment must never come back as the underlying table name.
    it("resolves a top-level collection segment to its slug, never its table name", () => {
        expect(resolveCollectionPathIds("products", collections)).toBe("products");
        expect(resolveCollectionPathIds("products", collections)).not.toContain("products_table");
    });

    it("resolves collection/entityId path and warns that the path ends on an id", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();
        const result = resolveCollectionPathIds("users/abc123", collections);
        expect(result).toBe("users/abc123");
        // An odd-segment path is the valid shape; ending on an entity id is
        // handled defensively and is meant to be reported.
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0][0])).toContain("abc123");
        warnSpy.mockRestore();
    });

    it("resolves nested subcollections", () => {
        const result = resolveCollectionPathIds("users/abc123/orders", collections);
        expect(result).toBe("users/abc123/orders");
    });

    it("appends remaining path when no subcollection matches", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();
        const result = resolveCollectionPathIds("users/abc123/orders/xyz/nested", collections);
        // `orders` declares no subcollections, so everything past its entity id
        // is carried over verbatim rather than dropped.
        expect(result).toBe("users/abc123/orders/xyz/nested");
        warnSpy.mockRestore();
    });

    it("matches a slug against whole segments only", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();
        // `products` is a string prefix of `productsx`, not a segment of it. A
        // bare `startsWith` read this as the record `x` of `products`.
        expect(resolveCollectionPathIds("productsx/1", collections)).toBe("productsx/1");
        warnSpy.mockRestore();
    });

    it("falls back to original path when no collection matches", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();
        const result = resolveCollectionPathIds("unknown_path", collections);
        expect(result).toBe("unknown_path");
        warnSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// getCollectionBySlugWithin
// ---------------------------------------------------------------------------
describe("getCollectionBySlugWithin", () => {
    const collections: CollectionConfig[] = [
        {
            id: "products",
            name: "Products",
            path: "products",
            slug: "products",
            properties: {},
            driver: "firestore",
            childCollections: () => [
                {
                    id: "reviews",
                    name: "Reviews",
                    path: "reviews",
                    slug: "reviews",
                    properties: {}
                }
            ]
        },
        {
            id: "users",
            name: "Users",
            path: "users",
            slug: "users",
            properties: {}
        }
    ] as CollectionConfig[];

    it("finds a top-level collection by slug", () => {
        const result = getCollectionBySlugWithin("products", collections);
        expect(result).toBeDefined();
        expect(result!.id).toBe("products");
    });

    it("finds a subcollection by nested path", () => {
        const result = getCollectionBySlugWithin("products/entity1/reviews", collections);
        expect(result).toBeDefined();
        expect(result!.id).toBe("reviews");
    });

    it("returns undefined for unknown slug", () => {
        expect(getCollectionBySlugWithin("unknown", collections)).toBeUndefined();
    });

    it("finds a collection whose slug contains slashes, and a subcollection under it", () => {
        const podcasts = {
            name: "Podcasts",
            slug: "content/podcasts",
            properties: {},
            childCollections: () => [{ name: "Episodes",
slug: "episodes",
properties: {} }]
        } as unknown as CollectionConfig;

        // Both paths have an even number of segments, which was refused
        // before any collection was looked at.
        expect(getCollectionBySlugWithin("content/podcasts", [podcasts])?.slug).toBe("content/podcasts");
        expect(getCollectionBySlugWithin("content/podcasts/p1/episodes", [podcasts])?.slug).toBe("episodes");
        expect(() => getCollectionBySlugWithin("content/podcasts/p1", [podcasts]))
            .toThrow("Collection paths must end at a collection, not at a record");
    });

    it("throws on a path that ends at a record (invalid collection path)", () => {
        expect(() => getCollectionBySlugWithin("products/entity1", collections))
            .toThrow("Collection paths must end at a collection, not at a record");
    });
});

// ---------------------------------------------------------------------------
// navigateToEntity
// ---------------------------------------------------------------------------
describe("navigateToEntity", () => {
    const mockNavigate = jest.fn();

    const mockNavigation: UrlController = {
        buildUrlCollectionPath: (path: string) => `/c/${path}`,
        buildAppUrlPath: (path: string) => `/${path}`,
        basePath: "/",
        baseCollectionPath: "/c",
        homeUrl: "/",
        urlPathToDataPath: jest.fn(),
        isUrlCollectionPath: jest.fn(),
        resolveDatabasePathsFrom: jest.fn(),
        navigate: mockNavigate
    } as unknown as UrlController;

    const mockSidePanelController = {
        open: jest.fn(),
        close: jest.fn(),
        replace: jest.fn()
    } as unknown as SidePanelController;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("opens a side panel when openEntityMode is side_panel", () => {
        navigateToEntity({
            openEntityMode: "side_panel",
            entityId: "abc",
            path: "products",
            sidePanelController: mockSidePanelController,
            navigation: mockNavigation
        });

        expect(mockSidePanelController.open).toHaveBeenCalledWith(
            expect.objectContaining({
                entityId: "abc",
                path: "products",
                updateUrl: true
            })
        );
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("navigates to full screen when openEntityMode is full_screen", () => {
        navigateToEntity({
            openEntityMode: "full_screen",
            entityId: "abc",
            path: "products",
            sidePanelController: mockSidePanelController,
            navigation: mockNavigation
        });

        expect(mockNavigate).toHaveBeenCalledWith("/c/products/abc", undefined);
        expect(mockSidePanelController.open).not.toHaveBeenCalled();
    });

    it("appends selectedTab to full_screen URL", () => {
        navigateToEntity({
            openEntityMode: "full_screen",
            entityId: "abc",
            path: "products",
            selectedTab: "details",
            sidePanelController: mockSidePanelController,
            navigation: mockNavigation
        });

        expect(mockNavigate).toHaveBeenCalledWith("/c/products/abc/details", undefined);
    });

    it("adds #new when no entityId in full_screen mode", () => {
        navigateToEntity({
            openEntityMode: "full_screen",
            entityId: undefined,
            path: "products",
            sidePanelController: mockSidePanelController,
            navigation: mockNavigation
        });

        expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("#new"), undefined);
    });

    it("adds #copy when copy flag is set in full_screen mode", () => {
        navigateToEntity({
            openEntityMode: "full_screen",
            entityId: "abc",
            path: "products",
            copy: true,
            sidePanelController: mockSidePanelController,
            navigation: mockNavigation
        });

        expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("#copy"), undefined);
    });

    it("passes replace option when replace parameter is set", () => {
        navigateToEntity({
            openEntityMode: "full_screen",
            entityId: "abc",
            path: "products",
            sidePanelController: mockSidePanelController,
            navigation: mockNavigation,
            replace: true
        });

        expect(mockNavigate).toHaveBeenCalledWith("/c/products/abc", { replace: true });
    });
});
