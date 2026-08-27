/**
 * @jest-environment jsdom
 */
import {
    DEFAULT_OPEN_ENTITY_MODE,
    DEFAULT_VIEW_MODE,
    getViewModeFromSearch,
    isViewMode,
    resolveOpenEntityMode,
    resolveViewMode,
    VIEW_MODE_PARAM,
    withViewMode
} from "../../src/util/view_mode";

// ---------------------------------------------------------------------------
// isViewMode
// ---------------------------------------------------------------------------
describe("isViewMode", () => {
    it("accepts every valid view mode", () => {
        expect(isViewMode("list")).toBe(true);
        expect(isViewMode("table")).toBe(true);
        expect(isViewMode("cards")).toBe(true);
        expect(isViewMode("kanban")).toBe(true);
    });
    it("rejects invalid values", () => {
        expect(isViewMode("grid")).toBe(false);
        expect(isViewMode("")).toBe(false);
        expect(isViewMode(null)).toBe(false);
        expect(isViewMode(undefined)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// getViewModeFromSearch
// ---------------------------------------------------------------------------
describe("getViewModeFromSearch", () => {
    it("reads a valid view mode from an explicit query string", () => {
        expect(getViewModeFromSearch(`?${VIEW_MODE_PARAM}=kanban`)).toBe("kanban");
    });
    it("ignores an invalid view mode", () => {
        expect(getViewModeFromSearch(`?${VIEW_MODE_PARAM}=bogus`)).toBeNull();
    });
    it("returns null when the param is absent", () => {
        expect(getViewModeFromSearch("?foo=bar")).toBeNull();
        expect(getViewModeFromSearch("")).toBeNull();
    });
    it("falls back to window.location.search when no query string is given", () => {
        window.history.replaceState({}, "", `/c/products?${VIEW_MODE_PARAM}=table`);
        expect(getViewModeFromSearch()).toBe("table");
        window.history.replaceState({}, "", "/");
    });
});

// ---------------------------------------------------------------------------
// withViewMode
// ---------------------------------------------------------------------------
describe("withViewMode", () => {
    it("returns the URL unchanged when no view mode is active", () => {
        expect(withViewMode("/c/products", "")).toBe("/c/products");
    });
    it("appends the view mode to a bare URL", () => {
        expect(withViewMode("/c/products", `?${VIEW_MODE_PARAM}=kanban`))
            .toBe(`/c/products?${VIEW_MODE_PARAM}=kanban`);
    });
    it("appends with & when the URL already has a query string", () => {
        expect(withViewMode("/c/products?foo=bar", `?${VIEW_MODE_PARAM}=cards`))
            .toBe(`/c/products?foo=bar&${VIEW_MODE_PARAM}=cards`);
    });
    it("keeps the hash after the query", () => {
        expect(withViewMode("/c/products#new", `?${VIEW_MODE_PARAM}=table`))
            .toBe(`/c/products?${VIEW_MODE_PARAM}=table#new`);
    });
    it("does not duplicate an existing view mode param", () => {
        expect(withViewMode(`/c/products?${VIEW_MODE_PARAM}=list`, `?${VIEW_MODE_PARAM}=kanban`))
            .toBe(`/c/products?${VIEW_MODE_PARAM}=list`);
    });
    it("reads the current browser location by default", () => {
        window.history.replaceState({}, "", `/c/products?${VIEW_MODE_PARAM}=cards`);
        expect(withViewMode("/c/products/42")).toBe(`/c/products/42?${VIEW_MODE_PARAM}=cards`);
        window.history.replaceState({}, "", "/");
    });
});

// ---------------------------------------------------------------------------
// resolveViewMode
// ---------------------------------------------------------------------------
describe("resolveViewMode", () => {
    it("prefers the URL param over everything", () => {
        expect(resolveViewMode({
            collection: { defaultViewMode: "table" },
            search: `?${VIEW_MODE_PARAM}=kanban`,
            savedViewMode: "cards"
        })).toBe("kanban");
    });
    it("falls back to the saved user config", () => {
        expect(resolveViewMode({
            collection: { defaultViewMode: "table" },
            search: "",
            savedViewMode: "cards"
        })).toBe("cards");
    });
    it("falls back to the collection default", () => {
        expect(resolveViewMode({
            collection: { defaultViewMode: "table" },
            search: ""
        })).toBe("table");
    });
    it("defaults when nothing is configured", () => {
        expect(resolveViewMode({ search: "" })).toBe(DEFAULT_VIEW_MODE);
    });
    it("ignores an invalid saved view mode", () => {
        expect(resolveViewMode({
            search: "",
            savedViewMode: "bogus" as never
        })).toBe(DEFAULT_VIEW_MODE);
    });
});

// ---------------------------------------------------------------------------
// resolveOpenEntityMode
// ---------------------------------------------------------------------------
describe("resolveOpenEntityMode", () => {
    it("honours an explicit collection.openEntityMode over the view mode", () => {
        expect(resolveOpenEntityMode({
            collection: { openEntityMode: "dialog" },
            viewMode: "table"
        })).toBe("dialog");
    });
    it("derives side_panel for kanban", () => {
        expect(resolveOpenEntityMode({ viewMode: "kanban" })).toBe("side_panel");
    });
    it("derives full_screen for table and cards", () => {
        expect(resolveOpenEntityMode({ viewMode: "table" })).toBe("full_screen");
        expect(resolveOpenEntityMode({ viewMode: "cards" })).toBe("full_screen");
    });
    it("derives split for list", () => {
        expect(resolveOpenEntityMode({ viewMode: "list" })).toBe("split");
    });
    it("defaults to split when no view mode is known", () => {
        expect(resolveOpenEntityMode({})).toBe(DEFAULT_OPEN_ENTITY_MODE);
    });
});

// ---------------------------------------------------------------------------
// Custom view modes
//
// A custom view is named by a key that no built-in list knows about, so every
// gate between the URL and the render chain has to be handed the collection's
// keys. The cases below are the ones that were silently falling back to a
// built-in before: each of them 200s either way, which is why they are pinned.
// ---------------------------------------------------------------------------
describe("custom view modes", () => {
    const CUSTOM = ["map", "calendar"];

    it("accepts a custom key only when the collection declares it", () => {
        expect(isViewMode("map", CUSTOM)).toBe(true);
        expect(isViewMode("map")).toBe(false);
        expect(isViewMode("timeline", CUSTOM)).toBe(false);
    });

    it("reads a custom key from the URL", () => {
        expect(getViewModeFromSearch(`?${VIEW_MODE_PARAM}=map`, CUSTOM)).toBe("map");
        // Without the keys there is no way to tell "map" from a typo.
        expect(getViewModeFromSearch(`?${VIEW_MODE_PARAM}=map`)).toBeNull();
    });

    it("carries a custom key across a navigation", () => {
        // `withViewMode` has no collection in hand, so it must not validate:
        // dropping the param here is what reset the view on every row click.
        expect(withViewMode("/c/places", `?${VIEW_MODE_PARAM}=map`))
            .toBe(`/c/places?${VIEW_MODE_PARAM}=map`);
    });

    it("resolves a custom view from the URL, saved config and the default", () => {
        expect(resolveViewMode({ search: `?${VIEW_MODE_PARAM}=map`, customKeys: CUSTOM })).toBe("map");
        expect(resolveViewMode({ search: "", savedViewMode: "map", customKeys: CUSTOM })).toBe("map");
        expect(resolveViewMode({
            collection: { defaultViewMode: "map" },
            search: "",
            customKeys: CUSTOM
        })).toBe("map");
    });

    it("falls back to a working view when the custom one is gone", () => {
        // The user picked "map", it was persisted, and the view has since been
        // removed from config. Every source has to fail closed, or the
        // collection opens on a mode nothing renders: a blank panel under a
        // working toolbar.
        expect(resolveViewMode({ search: `?${VIEW_MODE_PARAM}=map` })).toBe(DEFAULT_VIEW_MODE);
        expect(resolveViewMode({ search: "", savedViewMode: "map" })).toBe(DEFAULT_VIEW_MODE);
        expect(resolveViewMode({ collection: { defaultViewMode: "map" }, search: "" }))
            .toBe(DEFAULT_VIEW_MODE);
    });

    it("opens records over a custom view rather than beside them", () => {
        // A map or a calendar owns its canvas; "split" would halve it.
        expect(resolveOpenEntityMode({ viewMode: "map", customView: { key: "map" } as never }))
            .toBe("side_panel");
        expect(resolveOpenEntityMode({
            viewMode: "map",
            customView: { key: "map", openEntityMode: "full_screen" } as never
        })).toBe("full_screen");
        // An explicit collection setting still wins over the view's preference.
        expect(resolveOpenEntityMode({
            collection: { openEntityMode: "dialog" },
            viewMode: "map",
            customView: { key: "map", openEntityMode: "full_screen" } as never
        })).toBe("dialog");
    });
});
