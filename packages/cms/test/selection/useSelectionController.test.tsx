import { describe, expect, test } from "@jest/globals";
import { act, renderHook } from "@testing-library/react";
import { Entity } from "@rebasepro/types";
import { useSelectionController } from "../../src/components/CollectionViewBinding/useSelectionController";

function entity(id: string, path = "orders"): Entity<any> {
    return { id, path, values: {} };
}

describe("useSelectionController", () => {

    test("starts empty", () => {
        const { result } = renderHook(() => useSelectionController());

        expect(result.current.selection).toEqual({ type: "entities", entities: [] });
        expect(result.current.selectedCount).toBe(0);
        expect(result.current.hasSelection).toBe(false);
    });

    test("ticking and unticking rows", () => {
        const { result } = renderHook(() => useSelectionController());

        act(() => result.current.toggleEntitySelection(entity("a")));
        act(() => result.current.toggleEntitySelection(entity("b")));
        expect(result.current.selectedCount).toBe(2);
        expect(result.current.isEntitySelected(entity("a"))).toBe(true);

        act(() => result.current.toggleEntitySelection(entity("a")));
        expect(result.current.selectedCount).toBe(1);
        expect(result.current.isEntitySelected(entity("a"))).toBe(false);
    });

    /** Same id at another path is another row — a junction-backed tab shows both. */
    test("a row is identified by path as well as id", () => {
        const { result } = renderHook(() => useSelectionController());

        act(() => result.current.toggleEntitySelection(entity("a", "orders")));

        expect(result.current.isEntitySelected(entity("a", "orders"))).toBe(true);
        expect(result.current.isEntitySelected(entity("a", "archived_orders"))).toBe(false);
    });

    describe("query mode", () => {

        test("selects every matching row and reports the count it was given", () => {
            const { result } = renderHook(() => useSelectionController());

            act(() => result.current.selectAllMatching({ path: "orders" }, 12480));

            expect(result.current.selection.type).toBe("query");
            expect(result.current.selectedCount).toBe(12480);
            expect(result.current.hasSelection).toBe(true);
            // Every row the view can show came out of that query.
            expect(result.current.isEntitySelected(entity("anything"))).toBe(true);
        });

        /**
         * Gmail drops to a plain list when you untick one. Keeping the query and
         * carrying the exclusion is both closer to what was meant and cheaper —
         * dropping to a list would have to read all 12,480 rows first.
         */
        test("unticking a row excludes it and decrements the count", () => {
            const { result } = renderHook(() => useSelectionController());

            act(() => result.current.selectAllMatching({ path: "orders" }, 12480));
            act(() => result.current.toggleEntitySelection(entity("a"), false));

            expect(result.current.selection.type).toBe("query");
            expect(result.current.selectedCount).toBe(12479);
            expect(result.current.isEntitySelected(entity("a"))).toBe(false);
            expect(result.current.isEntitySelected(entity("b"))).toBe(true);
        });

        test("re-ticking an excluded row puts it back", () => {
            const { result } = renderHook(() => useSelectionController());

            act(() => result.current.selectAllMatching({ path: "orders" }, 10));
            act(() => result.current.toggleEntitySelection(entity("a"), false));
            act(() => result.current.toggleEntitySelection(entity("a"), true));

            expect(result.current.selectedCount).toBe(10);
            expect(result.current.isEntitySelected(entity("a"))).toBe(true);
        });

        test("toggling with no explicit state flips membership", () => {
            const { result } = renderHook(() => useSelectionController());

            act(() => result.current.selectAllMatching({ path: "orders" }, 10));
            act(() => result.current.toggleEntitySelection(entity("a")));
            expect(result.current.isEntitySelected(entity("a"))).toBe(false);

            act(() => result.current.toggleEntitySelection(entity("a")));
            expect(result.current.isEntitySelected(entity("a"))).toBe(true);
        });

        /**
         * An accessor with no `count` can still be selected in full. Reporting
         * that as 0 would say the opposite of what is true, so it stays
         * `undefined` and every caller has to render the unknown case.
         */
        test("a full selection with no count is unknown, not zero", () => {
            const { result } = renderHook(() => useSelectionController());

            act(() => result.current.selectAllMatching({ path: "orders" }));

            expect(result.current.selectedCount).toBeUndefined();
            expect(result.current.hasSelection).toBe(true);
        });

        test("excluding everything leaves nothing selected", () => {
            const { result } = renderHook(() => useSelectionController());

            act(() => result.current.selectAllMatching({ path: "orders" }, 1));
            act(() => result.current.toggleEntitySelection(entity("a"), false));

            expect(result.current.selectedCount).toBe(0);
            expect(result.current.hasSelection).toBe(false);
        });

        test("setSelectedEntities drops back to a plain list of rows", () => {
            const { result } = renderHook(() => useSelectionController());

            act(() => result.current.selectAllMatching({ path: "orders" }, 12480));
            act(() => result.current.setSelectedEntities([entity("a")]));

            expect(result.current.selection).toEqual({ type: "entities", entities: [entity("a")] });
            expect(result.current.selectedCount).toBe(1);
        });

        test("clearSelection empties it", () => {
            const { result } = renderHook(() => useSelectionController());

            act(() => result.current.selectAllMatching({ path: "orders" }, 12480));
            act(() => result.current.clearSelection());

            expect(result.current.hasSelection).toBe(false);
            expect(result.current.selectedCount).toBe(0);
        });
    });

    test("onSelectionChange fires for exclusions as well as ticks", () => {
        const events: [string, boolean][] = [];
        const { result } = renderHook(() =>
            useSelectionController((e, selected) => events.push([String(e.id), selected])));

        act(() => result.current.toggleEntitySelection(entity("a"), true));
        act(() => result.current.selectAllMatching({ path: "orders" }, 10));
        act(() => result.current.toggleEntitySelection(entity("b"), false));

        expect(events).toEqual([["a", true], ["b", false]]);
    });

    test("toggling to the state a row is already in changes nothing", () => {
        const { result } = renderHook(() => useSelectionController());

        act(() => result.current.toggleEntitySelection(entity("a"), true));
        const before = result.current.selection;
        act(() => result.current.toggleEntitySelection(entity("a"), true));

        expect(result.current.selection).toBe(before);
    });
});
