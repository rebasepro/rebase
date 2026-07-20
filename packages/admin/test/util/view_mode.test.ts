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
