/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Pinning rows to the top of a table — the relation picker's dialog does it
 * with the rows already linked — must not hand the table a new array on every
 * render.
 *
 * `useDataOrder` rebuilt its result on each call whenever
 * `entitiesDisplayedFirst` was set, so the controller built around it was a new
 * object every render too, and everything below it re-rendered and deep-compared
 * every row: the dialog's table re-rendered on each keystroke in its search box.
 */

const mockLocation = { pathname: "/c/tags", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

const mockFind = jest.fn();
const mockAccessor = { find: mockFind };
const mockData = { collection: () => mockAccessor };
const mockContext = {};
jest.mock("../../src/hooks", () => ({
    useData: () => mockData,
    useRebaseContext: () => mockContext
}));
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: jest.fn() }));

import { useDataOrder } from "../../src/hooks/data/useDataOrder";
import { useDataTableController } from "../../src/components/common/useDataTableController";

type Tag = { label: string };
const tag = (id: string): Entity<Tag> => ({ id, path: "tags", values: { label: id } });

const collection: AdminCollection<Tag> = {
    slug: "tags",
    name: "Tags",
    table: "tags",
    properties: { label: { type: "string" } }
};

describe("useDataOrder", () => {

    it("hands back the same array until the rows or the pinned rows change", () => {
        const data = [tag("a"), tag("b"), tag("c")];
        const pinned = [tag("c")];
        const { result, rerender } = renderHook(
            (props: { data: Entity<Tag>[]; pinned: Entity<Tag>[] }) => useDataOrder({ data: props.data, entitiesDisplayedFirst: props.pinned }),
            { initialProps: { data, pinned } });
        const first = result.current;
        expect(first.map(e => e.id)).toEqual(["c", "a", "b"]);

        rerender({ data, pinned });
        expect(result.current).toBe(first);

        rerender({ data, pinned: [tag("b")] });
        expect(result.current).not.toBe(first);
        expect(result.current.map(e => e.id)).toEqual(["b", "a", "c"]);
    });

    it("keeps the table controller stable across a render that changed nothing", async () => {
        mockFind.mockResolvedValue({ data: [tag("a"), tag("b")] });
        const pinned = [tag("b")];
        const { result, rerender } = renderHook(() =>
            useDataTableController<Tag>({ path: "tags", collection, entitiesDisplayedFirst: pinned }));
        await waitFor(() => expect(result.current.data.map(e => e.id)).toEqual(["b", "a"]));

        const controller = result.current;
        rerender();
        expect(result.current.data).toBe(controller.data);
        expect(result.current).toBe(controller);
    });
});
