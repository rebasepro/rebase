/**
 * @jest-environment jsdom
 */
import {
    getGroup,
    computeNavigationGroups,
    areCollectionsEqual,
    areCollectionListsEqual,
    NAVIGATION_DEFAULT_GROUP_NAME,
    NAVIGATION_ADMIN_GROUP_NAME,
    NAVIGATION_BOTTOM_GROUP_NAMES,
    isBottomPinnedGroupName
} from "../../src/hooks/navigation/utils";
import type { AdminCollection, AppView, RebasePlugin, NavigationGroupMapping } from "@rebasepro/cms-types";
import { fakeCollection as collection } from "../helpers/fakes";

/** A minimal view; it renders nothing, which is all these helpers need. */
function appView(slug: string, rest: Partial<AppView> = {}): AppView {
    return { slug, name: slug, view: null, ...rest };
}

// ---------------------------------------------------------------------------
// isBottomPinnedGroupName
// ---------------------------------------------------------------------------
describe("isBottomPinnedGroupName", () => {
    it("pins the two names it has always pinned", () => {
        // Kept for compatibility: apps have relied on `group: "Settings"`
        // landing last since before there was a flag for it.
        for (const name of NAVIGATION_BOTTOM_GROUP_NAMES) {
            expect(isBottomPinnedGroupName(name)).toBe(true);
        }
        expect(isBottomPinnedGroupName(NAVIGATION_ADMIN_GROUP_NAME)).toBe(true);
    });

    it("does not pin a translated or renamed group", () => {
        // The failure this documents: the same group, relabelled, silently
        // stops sinking. `pinToBottom` is the way to keep the behaviour.
        expect(isBottomPinnedGroupName("Ajustes")).toBe(false);
        expect(isBottomPinnedGroupName("settings")).toBe(false);
        expect(isBottomPinnedGroupName(undefined)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// getGroup
// ---------------------------------------------------------------------------
describe("getGroup", () => {
    it("returns the default group name when no group is set", () => {
        expect(getGroup(collection("posts"))).toBe(NAVIGATION_DEFAULT_GROUP_NAME);
    });

    it("returns default group name for AppView without group", () => {
        expect(getGroup(appView("dashboard"))).toBe(NAVIGATION_DEFAULT_GROUP_NAME);
    });

    it("returns the custom group name from a collection", () => {
        expect(getGroup(collection("products", { group: "E-Commerce" }))).toBe("E-Commerce");
    });

    it("returns the custom group name from a view", () => {
        expect(getGroup(appView("dashboard", { group: "Dashboard" }))).toBe("Dashboard");
    });

    it("trims whitespace from group names", () => {
        expect(getGroup(collection("posts", { group: "  Content  " }))).toBe("Content");
    });

    it("returns default group for empty string group", () => {
        expect(getGroup(collection("posts", { group: "" }))).toBe(NAVIGATION_DEFAULT_GROUP_NAME);
    });

    it("returns default group for whitespace-only group", () => {
        expect(getGroup(collection("posts", { group: "   " }))).toBe(NAVIGATION_DEFAULT_GROUP_NAME);
    });
});

// ---------------------------------------------------------------------------
// computeNavigationGroups
// ---------------------------------------------------------------------------
describe("computeNavigationGroups", () => {
    const collection1 = collection("products");
    const collection2 = collection("orders");
    const collection3 = collection("settings");

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
        const view = appView("dashboard", { name: "Dashboard" });

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
            key: "tools",
            hooks: {
                navigationEntries: [
                    {
                        name: "Tools",
                        entries: ["import", "export"]
                    }
                ]
            }
        };

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
    const collA = collection("products", {
        name: "Products",
        properties: { title: { type: "string",
name: "Title" } }
    });

    const collB = collection("products", {
        name: "Products",
        properties: { title: { type: "string",
name: "Title" } }
    });

    it("considers identical collections equal", () => {
        expect(areCollectionsEqual(collA, collB)).toBe(true);
    });

    it("considers collections with different slugs unequal", () => {
        const different: AdminCollection = { ...collA,
slug: "different" };
        expect(areCollectionsEqual(collA, different)).toBe(false);
    });

    it("considers collections with different properties unequal", () => {
        const different: AdminCollection = {
            ...collA,
            properties: { body: { type: "string",
name: "Body" } }
        };
        expect(areCollectionsEqual(collA, different)).toBe(false);
    });

    it("ignores function properties during comparison", () => {
        const withFn: AdminCollection = {
            ...collA,
            defaultSelectedView: () => "table"
        };
        expect(areCollectionsEqual(collA, withFn)).toBe(true);
    });

    it("handles circular subcollection references via visitedSlugs", () => {
        // A collection that lists itself as its own subcollection. Without the
        // visitedSlugs guard the comparison descends into it forever and blows
        // the stack, so "returns at all" is the assertion that matters here.
        const makeCircular = (): AdminCollection => {
            const self: AdminCollection = collection("self", {
                name: "Self",
                childCollections: () => [self]
            });
            return self;
        };

        expect(areCollectionsEqual(makeCircular(), makeCircular())).toBe(true);
    });

    it("stops descending once a slug has already been visited", () => {
        // Same slug, different properties. The visitedSlugs short-circuit fires
        // before any comparison, so this is `true` — that early return is the
        // only reason a cycle terminates, and this pins it apart from a plain
        // structural equality result, which would be false.
        const seen = collection("self", {
            name: "Self",
            properties: { title: { type: "string",
name: "Title" } }
        });

        const other: AdminCollection = {
            ...seen,
            properties: { body: { type: "string",
name: "Body" } }
        };

        expect(areCollectionsEqual(seen, other, ["self"])).toBe(true);
        expect(areCollectionsEqual(seen, other)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// areCollectionListsEqual
// ---------------------------------------------------------------------------
describe("areCollectionListsEqual", () => {
    const col1 = collection("a", { name: "A" });
    const col2 = collection("b", { name: "B" });

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
        const col3: AdminCollection = { ...col1,
slug: "c" };
        expect(areCollectionListsEqual([col1], [col3])).toBe(false);
    });

    it("returns true for empty lists", () => {
        expect(areCollectionListsEqual([], [])).toBe(true);
    });
});
