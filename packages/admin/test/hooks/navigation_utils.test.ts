/**
 * @jest-environment jsdom
 */
import {
    getGroup,
    computeNavigationGroups,
    areCollectionsEqual,
    areCollectionListsEqual,
    NAVIGATION_DEFAULT_GROUP_NAME,
    NAVIGATION_ADMIN_GROUP_NAME
} from "../../src/hooks/navigation/utils";
import type { EntityCollection, AppView, RebasePlugin, NavigationGroupMapping } from "@rebasepro/types";

// ---------------------------------------------------------------------------
// getGroup
// ---------------------------------------------------------------------------
describe("getGroup", () => {
    it("returns the default group name when no group is set", () => {
        const collection = {} as EntityCollection;
        expect(getGroup(collection)).toBe(NAVIGATION_DEFAULT_GROUP_NAME);
    });

    it("returns default group name for AppView without group", () => {
        const view = {} as AppView;
        expect(getGroup(view)).toBe(NAVIGATION_DEFAULT_GROUP_NAME);
    });

    it("returns the custom group name from a collection", () => {
        const collection = { group: "E-Commerce" } as unknown as EntityCollection;
        expect(getGroup(collection)).toBe("E-Commerce");
    });

    it("returns the custom group name from a view", () => {
        const view = { group: "Dashboard" } as unknown as AppView;
        expect(getGroup(view)).toBe("Dashboard");
    });

    it("trims whitespace from group names", () => {
        const collection = { group: "  Content  " } as unknown as EntityCollection;
        expect(getGroup(collection)).toBe("Content");
    });

    it("returns default group for empty string group", () => {
        const collection = { group: "" } as unknown as EntityCollection;
        expect(getGroup(collection)).toBe(NAVIGATION_DEFAULT_GROUP_NAME);
    });

    it("returns default group for whitespace-only group", () => {
        const collection = { group: "   " } as unknown as EntityCollection;
        expect(getGroup(collection)).toBe(NAVIGATION_DEFAULT_GROUP_NAME);
    });
});

// ---------------------------------------------------------------------------
// computeNavigationGroups
// ---------------------------------------------------------------------------
describe("computeNavigationGroups", () => {
    const collection1: EntityCollection = {
        id: "products",
        slug: "products",
        properties: {}
    } as unknown as EntityCollection;

    const collection2: EntityCollection = {
        id: "orders",
        slug: "orders",
        properties: {}
    } as unknown as EntityCollection;

    const collection3: EntityCollection = {
        id: "settings",
        slug: "settings",
        properties: {}
    } as unknown as EntityCollection;

    it("puts all collections in default group when no mappings", () => {
        const result = computeNavigationGroups({
            collections: [collection1, collection2, collection3]
        });

        expect(result).toHaveLength(1);
        const defaultGroup = result.find(g => g.name === NAVIGATION_DEFAULT_GROUP_NAME);
        expect(defaultGroup?.entries).toContain("products");
        expect(defaultGroup?.entries).toContain("orders");
        expect(defaultGroup?.entries).toContain("settings");
    });

    it("preserves existing group mappings and adds unassigned to default", () => {
        const existingMappings: NavigationGroupMapping[] = [
            { name: "Content",
entries: ["products", "orders"] }
        ];

        const result = computeNavigationGroups({
            navigationGroupMappings: existingMappings,
            collections: [collection1, collection2, collection3]
        });

        // products & orders should stay in Content
        const contentGroup = result.find(g => g.name === "Content");
        expect(contentGroup?.entries).toContain("products");
        expect(contentGroup?.entries).toContain("orders");

        // settings is unassigned, should go to default group
        const defaultGroup = result.find(g => g.name === NAVIGATION_DEFAULT_GROUP_NAME);
        expect(defaultGroup?.entries).toContain("settings");
    });

    it("handles views alongside collections", () => {
        const view: AppView = {
            name: "Dashboard",
            slug: "dashboard",
            view: null!
        } as unknown as AppView;

        const existingMappings: NavigationGroupMapping[] = [
            { name: "Content",
entries: ["products"] },
            { name: "Main",
entries: ["dashboard"] }
        ];

        const result = computeNavigationGroups({
            navigationGroupMappings: existingMappings,
            collections: [collection1],
            views: [view]
        });

        const mainGroup = result.find(g => g.name === "Main");
        expect(mainGroup?.entries).toContain("dashboard");
    });

    it("handles empty inputs", () => {
        const result = computeNavigationGroups({});
        expect(result).toEqual([]);
    });

    it("deduplicates entries within groups", () => {
        const existingMappings: NavigationGroupMapping[] = [
            { name: "Content",
entries: ["products", "products"] }
        ];

        const result = computeNavigationGroups({
            navigationGroupMappings: existingMappings,
            collections: [collection1]
        });

        const contentGroup = result.find(g => g.name === "Content");
        // Should be deduplicated
        expect(contentGroup?.entries.filter(e => e === "products")).toHaveLength(1);
    });

    it("merges plugin navigation entries", () => {
        const plugin: RebasePlugin = {
            hooks: {
                navigationEntries: [
                    {
                        name: "Tools",
                        entries: ["import", "export"]
                    }
                ]
            }
        } as unknown as RebasePlugin;

        const result = computeNavigationGroups({
            navigationGroupMappings: [],
            plugins: [plugin]
        });

        const toolsGroup = result.find(g => g.name === "Tools");
        expect(toolsGroup?.entries).toContain("import");
        expect(toolsGroup?.entries).toContain("export");
    });

    it("does not mutate the original input mappings", () => {
        const existingMappings: NavigationGroupMapping[] = [
            { name: "Content",
entries: ["products"] }
        ];
        const originalEntries = [...existingMappings[0].entries];

        const result = computeNavigationGroups({
            navigationGroupMappings: existingMappings,
            collections: [collection1, collection2]
        });

        // The result should contain both entries
        const contentGroup = result.find(g => g.name === "Content");
        expect(contentGroup?.entries).toContain("products");

        // orders is unassigned, so it goes to default
        const defaultGroup = result.find(g => g.name === NAVIGATION_DEFAULT_GROUP_NAME);
        expect(defaultGroup?.entries).toContain("orders");

        // But the original input must not have been mutated
        expect(existingMappings[0].entries).toEqual(originalEntries);
    });
});

// ---------------------------------------------------------------------------
// areCollectionsEqual
// ---------------------------------------------------------------------------
describe("areCollectionsEqual", () => {
    const collA: EntityCollection = {
        id: "products",
        name: "Products",
        path: "products",
        slug: "products",
        properties: { title: { type: "string",
name: "Title" } }
    } as unknown as EntityCollection;

    const collB: EntityCollection = {
        id: "products",
        name: "Products",
        path: "products",
        slug: "products",
        properties: { title: { type: "string",
name: "Title" } }
    } as unknown as EntityCollection;

    it("considers identical collections equal", () => {
        expect(areCollectionsEqual(collA, collB)).toBe(true);
    });

    it("considers collections with different slugs unequal", () => {
        const different = { ...collA,
slug: "different" } as unknown as EntityCollection;
        expect(areCollectionsEqual(collA, different)).toBe(false);
    });

    it("considers collections with different properties unequal", () => {
        const different = {
            ...collA,
            properties: { body: { type: "string",
name: "Body" } }
        } as unknown as EntityCollection;
        expect(areCollectionsEqual(collA, different)).toBe(false);
    });

    it("ignores function properties during comparison", () => {
        const withFn = {
            ...collA,
            onSave: () => {}
        } as unknown as EntityCollection;
        expect(areCollectionsEqual(collA, withFn)).toBe(true);
    });

    it("handles circular subcollection references via visitedSlugs", () => {
        const circularA: EntityCollection = {
            id: "self",
            name: "Self",
            path: "self",
            slug: "self",
            properties: {}
        } as unknown as EntityCollection;

        const circularB: EntityCollection = {
            ...circularA
        } as unknown as EntityCollection;

        // Simulating that we already visited this slug
        expect(areCollectionsEqual(circularA, circularB, ["self"])).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// areCollectionListsEqual
// ---------------------------------------------------------------------------
describe("areCollectionListsEqual", () => {
    const col1: EntityCollection = {
        id: "a",
        name: "A",
        path: "a",
        slug: "a",
        properties: {}
    } as unknown as EntityCollection;

    const col2: EntityCollection = {
        id: "b",
        name: "B",
        path: "b",
        slug: "b",
        properties: {}
    } as unknown as EntityCollection;

    it("returns true for identical lists", () => {
        expect(areCollectionListsEqual([col1, col2], [col1, col2])).toBe(true);
    });

    it("returns true regardless of order (sorts by slug)", () => {
        expect(areCollectionListsEqual([col2, col1], [col1, col2])).toBe(true);
    });

    it("returns false for different lengths", () => {
        expect(areCollectionListsEqual([col1], [col1, col2])).toBe(false);
    });

    it("returns false for different collections", () => {
        const col3 = { ...col1,
slug: "c" } as unknown as EntityCollection;
        expect(areCollectionListsEqual([col1], [col3])).toBe(false);
    });

    it("returns true for empty lists", () => {
        expect(areCollectionListsEqual([], [])).toBe(true);
    });
});
