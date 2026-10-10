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

    /**
     * "Select all loaded rows", then every view asks each loaded row whether it
     * is selected — the selection menu, and the list or card view again. A
     * linear search per row made that n² reads of row ids: 10,000 rows held
     * and selected took ~200 ms per view per change. Counted, not timed: the
     * reads of `id` must grow with n, not with n².
     */
    describe("asking every loaded row whether it is selected", () => {

        function countingRows(n: number, path: string, counter: { reads: number }): Entity<any>[] {
            return Array.from({ length: n }, (_, i) => {
                const id = `id_${i}`;
                return {
                    path,
                    values: {},
                    get id() {
                        counter.reads++;
                        return id;
                    }
                } as Entity<any>;
            });
        }

        function idReadsToAskAll(n: number, mode: "entities" | "query"): number {
            const counter = { reads: 0 };
            const loaded = countingRows(n, "orders", counter);
            const { result } = renderHook(() => useSelectionController());
            if (mode === "entities") {
                act(() => result.current.setSelectedEntities(loaded));
            } else {
                act(() => result.current.selectAllMatching({ path: "orders" }, n));
                // Every other row taken back out: n/2 exclusions.
                act(() => {
                    for (let i = 0; i < n; i += 2) result.current.toggleEntitySelection(loaded[i], false);
                });
            }
            counter.reads = 0;
            const selected = loaded.filter(e => result.current.isEntitySelected(e)).length;
            expect(selected).toBe(mode === "entities" ? n : n / 2);
            return counter.reads;
        }

        test.each(["entities", "query"] as const)("in %s mode the work grows linearly", (mode) => {
            const small = idReadsToAskAll(1000, mode);
            const large = idReadsToAskAll(4000, mode);
            // 4x the rows: ~4x the reads when linear, ~16x when quadratic.
            expect(large / small).toBeLessThan(6);
            expect(large).toBeLessThan(4000 * 10);
        });

        test("still identifies a row by path as well as id, for ids that look alike", () => {
            const { result } = renderHook(() => useSelectionController());
            act(() => result.current.setSelectedEntities([
                { id: 1, path: "orders", values: {} },
                { id: "a/b", path: "x", values: {} }
            ]));
            expect(result.current.isEntitySelected({ id: 1, path: "orders", values: {} })).toBe(true);
            // A number id is not its string.
            expect(result.current.isEntitySelected({ id: "1", path: "orders", values: {} })).toBe(false);
            // Path and id are not one string glued with a slash.
            expect(result.current.isEntitySelected({ id: "b", path: "x/a", values: {} })).toBe(false);
            expect(result.current.isEntitySelected({ id: "a/b", path: "x", values: {} })).toBe(true);
        });
    });
});
