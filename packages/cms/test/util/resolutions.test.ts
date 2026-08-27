/**
 * @jest-environment jsdom
 */
import {
    resolveEntityView,
    resolveEntityAction,
    resolveCollectionViews,
    resolvedSelectedEntityView
} from "../../src/util/resolutions";
import type {
    EntityCustomView,
    EntityAction,
    CollectionCustomView,
    CustomizationController
} from "@rebasepro/cms-types";

// ---------------------------------------------------------------------------
// resolveEntityView
// ---------------------------------------------------------------------------
describe("resolveEntityView", () => {
    const view1: EntityCustomView = { key: "overview",
name: "Overview",
Builder: jest.fn() } as unknown as EntityCustomView;
    const view2: EntityCustomView = { key: "analytics",
name: "Analytics",
Builder: jest.fn() } as unknown as EntityCustomView;
    const contextViews = [view1, view2];

    it("returns the view object directly when not a string", () => {
        expect(resolveEntityView(view1)).toBe(view1);
    });

    it("resolves a string key to a matching EntityCustomView", () => {
        expect(resolveEntityView("analytics", contextViews)).toBe(view2);
    });

    it("returns undefined when string key has no match", () => {
        expect(resolveEntityView("missing", contextViews)).toBeUndefined();
    });

    it("returns undefined when string key and no context views provided", () => {
        expect(resolveEntityView("overview", undefined)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// resolveEntityAction
// ---------------------------------------------------------------------------
describe("resolveEntityAction", () => {
    const action1: EntityAction = { key: "publish",
name: "Publish" } as EntityAction;
    const action2: EntityAction = { key: "archive",
name: "Archive" } as EntityAction;
    const contextActions = [action1, action2];

    it("returns the action object directly when not a string", () => {
        expect(resolveEntityAction(action1)).toBe(action1);
    });

    it("resolves a string key to a matching EntityAction", () => {
        expect(resolveEntityAction("archive", contextActions)).toBe(action2);
    });

    it("returns undefined when string key has no match", () => {
        expect(resolveEntityAction("missing", contextActions)).toBeUndefined();
    });

    it("returns undefined when string key and no context actions provided", () => {
        expect(resolveEntityAction("publish", undefined)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// resolvedSelectedEntityView
// ---------------------------------------------------------------------------
describe("resolvedSelectedEntityView", () => {
    const view1: EntityCustomView = {
        key: "overview",
        name: "Overview",
        Builder: jest.fn(),
        includeActions: false
    } as unknown as EntityCustomView;

    const view2: EntityCustomView = {
        key: "form",
        name: "Form",
        Builder: jest.fn(),
        includeActions: true
    } as unknown as EntityCustomView;

    const mockCustomizationController = {
        entityViews: [view1, view2]
    } as unknown as CustomizationController;

    it("resolves all custom views", () => {
        const result = resolvedSelectedEntityView(
            [view1, view2],
            mockCustomizationController
        );
        expect(result.resolvedEntityViews).toHaveLength(2);
    });

    it("finds the selectedEntityView by tab key", () => {
        const result = resolvedSelectedEntityView(
            [view1, view2],
            mockCustomizationController,
            "overview"
        );
        expect(result.selectedEntityView).toBe(view1);
    });

    it("returns undefined selectedEntityView when tab key doesn't match", () => {
        const result = resolvedSelectedEntityView(
            [view1, view2],
            mockCustomizationController,
            "nonexistent"
        );
        expect(result.selectedEntityView).toBeUndefined();
    });

    it("returns undefined selectedEntityView when no tab is specified", () => {
        const result = resolvedSelectedEntityView(
            [view1, view2],
            mockCustomizationController
        );
        expect(result.selectedEntityView).toBeUndefined();
    });

    it("identifies selectedSecondaryForm as view with includeActions", () => {
        const result = resolvedSelectedEntityView(
            [view1, view2],
            mockCustomizationController,
            "form"
        );
        expect(result.selectedSecondaryForm).toBe(view2);
    });

    it("does not select secondary form for views without includeActions", () => {
        const result = resolvedSelectedEntityView(
            [view1, view2],
            mockCustomizationController,
            "overview"
        );
        expect(result.selectedSecondaryForm).toBeUndefined();
    });

    it("handles undefined customViews", () => {
        const result = resolvedSelectedEntityView(
            undefined,
            mockCustomizationController,
            "overview"
        );
        expect(result.resolvedEntityViews).toEqual([]);
        expect(result.selectedEntityView).toBeUndefined();
    });

    it("resolves string-referenced views via customizationController", () => {
        const result = resolvedSelectedEntityView(
            ["overview", "form"],
            mockCustomizationController,
            "form"
        );
        expect(result.resolvedEntityViews).toHaveLength(2);
        expect(result.selectedEntityView?.key).toBe("form");
        expect(result.selectedSecondaryForm?.key).toBe("form");
    });
});

// ---------------------------------------------------------------------------
// resolveCollectionViews
//
// This runs once per collection and everything downstream reads its output —
// the view switcher, `enabledViews`, and the checks on the URL param and the
// saved user config. Anything it lets through is a mode the render chain has
// to be able to draw.
// ---------------------------------------------------------------------------
describe("resolveCollectionViews", () => {
    const MapView: CollectionCustomView = { key: "map", name: "Map", Builder: () => null };
    const CalendarView: CollectionCustomView = { key: "calendar", name: "Calendar", Builder: () => null };

    it("returns nothing when the collection declares nothing", () => {
        expect(resolveCollectionViews(undefined)).toEqual([]);
        expect(resolveCollectionViews([])).toEqual([]);
    });

    it("keeps an inline view as it is", () => {
        expect(resolveCollectionViews([MapView])).toEqual([MapView]);
    });

    it("resolves a view named by key from the app registry", () => {
        expect(resolveCollectionViews(["map"], [MapView, CalendarView])).toEqual([MapView]);
    });

    it("drops a key nothing registered", () => {
        // Rather than becoming a switcher entry that renders a blank panel.
        expect(resolveCollectionViews(["map"], [CalendarView])).toEqual([]);
        expect(resolveCollectionViews(["map"])).toEqual([]);
    });

    it("refuses a view keyed as a built-in", () => {
        // The render chain checks the built-ins first, so a view keyed "table"
        // would sit in the switcher and never draw.
        const shadow = { key: "table", name: "Not the table", Builder: () => null };
        expect(resolveCollectionViews([shadow])).toEqual([]);
    });

    it("keeps the first of two views sharing a key", () => {
        const other = { key: "map", name: "Other map", Builder: () => null };
        expect(resolveCollectionViews([MapView, other])).toEqual([MapView]);
    });

    it("preserves declaration order", () => {
        expect(resolveCollectionViews(["calendar", "map"], [MapView, CalendarView])
            .map(v => v.key)).toEqual(["calendar", "map"]);
    });
});
