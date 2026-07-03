/**
 * @jest-environment jsdom
 */
import {
    resolveSnapshotView,
    resolveSnapshotAction,
    resolvedSelectedSnapshotView
} from "../../src/util/resolutions";
import type { SnapshotCustomView, SnapshotAction, CustomizationController } from "@rebasepro/types";

// ---------------------------------------------------------------------------
// resolveSnapshotView
// ---------------------------------------------------------------------------
describe("resolveSnapshotView", () => {
    const view1: SnapshotCustomView = { key: "overview",
name: "Overview",
Builder: jest.fn() } as unknown as SnapshotCustomView;
    const view2: SnapshotCustomView = { key: "analytics",
name: "Analytics",
Builder: jest.fn() } as unknown as SnapshotCustomView;
    const contextViews = [view1, view2];

    it("returns the view object directly when not a string", () => {
        expect(resolveSnapshotView(view1)).toBe(view1);
    });

    it("resolves a string key to a matching SnapshotCustomView", () => {
        expect(resolveSnapshotView("analytics", contextViews)).toBe(view2);
    });

    it("returns undefined when string key has no match", () => {
        expect(resolveSnapshotView("missing", contextViews)).toBeUndefined();
    });

    it("returns undefined when string key and no context views provided", () => {
        expect(resolveSnapshotView("overview", undefined)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// resolveSnapshotAction
// ---------------------------------------------------------------------------
describe("resolveSnapshotAction", () => {
    const action1: SnapshotAction = { key: "publish",
name: "Publish" } as SnapshotAction;
    const action2: SnapshotAction = { key: "archive",
name: "Archive" } as SnapshotAction;
    const contextActions = [action1, action2];

    it("returns the action object directly when not a string", () => {
        expect(resolveSnapshotAction(action1)).toBe(action1);
    });

    it("resolves a string key to a matching SnapshotAction", () => {
        expect(resolveSnapshotAction("archive", contextActions)).toBe(action2);
    });

    it("returns undefined when string key has no match", () => {
        expect(resolveSnapshotAction("missing", contextActions)).toBeUndefined();
    });

    it("returns undefined when string key and no context actions provided", () => {
        expect(resolveSnapshotAction("publish", undefined)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// resolvedSelectedSnapshotView
// ---------------------------------------------------------------------------
describe("resolvedSelectedSnapshotView", () => {
    const view1: SnapshotCustomView = {
        key: "overview",
        name: "Overview",
        Builder: jest.fn(),
        includeActions: false
    } as unknown as SnapshotCustomView;

    const view2: SnapshotCustomView = {
        key: "form",
        name: "Form",
        Builder: jest.fn(),
        includeActions: true
    } as unknown as SnapshotCustomView;

    const mockCustomizationController = {
        snapshotViews: [view1, view2]
    } as unknown as CustomizationController;

    it("resolves all custom views", () => {
        const result = resolvedSelectedSnapshotView(
            [view1, view2],
            mockCustomizationController
        );
        expect(result.resolvedSnapshotViews).toHaveLength(2);
    });

    it("finds the selectedSnapshotView by tab key", () => {
        const result = resolvedSelectedSnapshotView(
            [view1, view2],
            mockCustomizationController,
            "overview"
        );
        expect(result.selectedSnapshotView).toBe(view1);
    });

    it("returns undefined selectedSnapshotView when tab key doesn't match", () => {
        const result = resolvedSelectedSnapshotView(
            [view1, view2],
            mockCustomizationController,
            "nonexistent"
        );
        expect(result.selectedSnapshotView).toBeUndefined();
    });

    it("returns undefined selectedSnapshotView when no tab is specified", () => {
        const result = resolvedSelectedSnapshotView(
            [view1, view2],
            mockCustomizationController
        );
        expect(result.selectedSnapshotView).toBeUndefined();
    });

    it("identifies selectedSecondaryForm as view with includeActions", () => {
        const result = resolvedSelectedSnapshotView(
            [view1, view2],
            mockCustomizationController,
            "form"
        );
        expect(result.selectedSecondaryForm).toBe(view2);
    });

    it("does not select secondary form for views without includeActions", () => {
        const result = resolvedSelectedSnapshotView(
            [view1, view2],
            mockCustomizationController,
            "overview"
        );
        expect(result.selectedSecondaryForm).toBeUndefined();
    });

    it("handles undefined customViews", () => {
        const result = resolvedSelectedSnapshotView(
            undefined,
            mockCustomizationController,
            "overview"
        );
        expect(result.resolvedSnapshotViews).toEqual([]);
        expect(result.selectedSnapshotView).toBeUndefined();
    });

    it("resolves string-referenced views via customizationController", () => {
        const result = resolvedSelectedSnapshotView(
            ["overview", "form"],
            mockCustomizationController,
            "form"
        );
        expect(result.resolvedSnapshotViews).toHaveLength(2);
        expect(result.selectedSnapshotView?.key).toBe("form");
        expect(result.selectedSecondaryForm?.key).toBe("form");
    });
});
