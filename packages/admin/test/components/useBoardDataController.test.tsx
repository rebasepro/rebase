/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/admin-types";

// The hook reads its data client and context out of `@rebasepro/app`. Only the
// three bindings it actually imports are stubbed; anything else in that module
// would drag the whole runtime into a unit test.
const listen = jest.fn();
const find = jest.fn();
const count = jest.fn();

jest.mock("@rebasepro/app", () => ({
    useData: () => ({ collection: () => ({ listen,
find,
count }) }),
    useRebaseContext: () => ({}),
    getRelationIncludeParams: () => undefined
}));

import { useBoardDataController } from "../../src/components/CollectionViewBinding/useBoardDataController";

type Task = { title: string; status: string; order: string };

const collection = {
    slug: "tasks",
    name: "Tasks",
    properties: {}
} as unknown as AdminCollection<Task>;

/** Entity shape the data client hands back — flat `values` plus an id. */
function entity(id: string, values: Partial<Task>) {
    return { id,
path: `tasks/${id}`,
values };
}

/** Resolve the `onUpdate` callback the hook registered for a given column. */
function updateFor(column: string): (entities: unknown[]) => void {
    const call = listen.mock.calls.find(([params]: any[]) => params.where.status?.[1] === column);
    if (!call) throw new Error(`No listen registered for column ${column}`);
    return (entities) => (call[1] as (res: { data: unknown[] }) => void)({ data: entities });
}

/**
 * The board accepts a `searchString`, stores it in a ref, lists it as an effect
 * dependency — so typing re-subscribes every column — and then passed it to
 * none of its three queries. `currentSearchString` was read into a local in two
 * places and used in neither. Searching a board did nothing but make it flicker.
 */
describe("useBoardDataController search", () => {
    beforeEach(() => {
        listen.mockReset();
        find.mockReset();
        count.mockReset();
        listen.mockReturnValue(() => { /* unsubscribe */ });
        find.mockResolvedValue({ data: [] });
        count.mockResolvedValue(0);
    });

    it("narrows every column subscription by the search term", async () => {
        renderHook(() => useBoardDataController<Task>({
            fullPath: "tasks",
            collection,
            columnProperty: "status",
            columns: ["open"],
            orderProperty: "order",
            pageSize: 10,
            searchString: "widget",
            filterValues: undefined
        } as never));

        await waitFor(() => expect(listen).toHaveBeenCalled());
        expect(listen.mock.calls[0][0]).toMatchObject({ searchString: "widget" });
    });

    it("narrows each column's count by the same term", async () => {
        renderHook(() => useBoardDataController<Task>({
            fullPath: "tasks",
            collection,
            columnProperty: "status",
            columns: ["open"],
            orderProperty: "order",
            pageSize: 10,
            searchString: "widget",
            filterValues: undefined
        } as never));

        // Otherwise the column header counts the unsearched collection while
        // the column below it shows the searched rows.
        await waitFor(() => expect(count).toHaveBeenCalled());
        expect(count.mock.calls[0][0]).toMatchObject({ searchString: "widget" });
    });
});

describe("useBoardDataController", () => {

    beforeEach(() => {
        listen.mockReset();
        find.mockReset();
        count.mockReset();
        listen.mockReturnValue(() => undefined);
        count.mockResolvedValue(0);
    });

    function renderBoard(overrides: Record<string, unknown> = {}) {
        return renderHook(() => useBoardDataController<Task, "todo" | "done">({
            fullPath: "tasks",
            collection,
            columnProperty: "status",
            columns: ["todo", "done"],
            pageSize: 30,
            ...overrides
        } as any));
    }

    it("subscribes once per column, each scoped to its own column value", async () => {
        renderBoard();

        await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));

        const wheres = listen.mock.calls.map(([params]: any[]) => params.where.status);
        expect(wheres).toEqual([["==", "todo"], ["==", "done"]]);
        // The per-column page size is what makes each column paginate on its own.
        expect(listen.mock.calls.map(([params]: any[]) => params.limit)).toEqual([30, 30]);
    });

    it("keeps only entities whose column property matches the column", async () => {
        const { result } = renderBoard();
        await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));

        // A text search or a just-moved entity can arrive on a column's stream
        // while belonging to another column; the hook filters in memory.
        await act(async () => {
            updateFor("todo")([
                entity("1", { title: "A",
status: "todo" }),
                entity("2", { title: "B",
status: "done" })
            ]);
        });

        expect(result.current.columnData.todo.entities.map(e => e.id)).toEqual(["1"]);
        expect(result.current.columnData.todo.loading).toBe(false);
    });

    it("sorts a column by the order property, with empty values last", async () => {
        const { result } = renderBoard({ orderProperty: "order" });
        await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));

        await act(async () => {
            updateFor("todo")([
                entity("blank", { status: "todo",
order: "" }),
                entity("c", { status: "todo",
order: "c" }),
                entity("a", { status: "todo",
order: "a" })
            ]);
        });

        expect(result.current.columnData.todo.entities.map(e => e.id)).toEqual(["a", "c", "blank"]);
    });

    it("does not query a column the active filter excludes, and reports it empty", async () => {
        const { result } = renderBoard({ filterValues: { status: ["in", ["todo"]] } });

        await waitFor(() => expect(listen).toHaveBeenCalledTimes(1));

        // "done" is outside the `in` set: no listen, no count query, and the
        // column shows as an empty finished column rather than a loading one.
        expect(listen.mock.calls[0][0].where.status).toEqual(["==", "todo"]);
        // `listen` firing once proves `todo` subscribed; it does not prove
        // `done` has been reduced to its finished state, which is a separate
        // effect. Waiting on the value under assertion rather than on a proxy
        // for it removes the race — this failed under `pnpm -r test` while
        // passing 3/3 on its own.
        await waitFor(() => expect(result.current.columnData.done).toEqual({
            entities: [],
            loading: false,
            hasMore: false,
            error: undefined,
            totalCount: 0
        }));
        expect(count).toHaveBeenCalledTimes(1);
    });

    it("reports hasMore only when a column filled its page", async () => {
        const { result } = renderBoard({ pageSize: 2 });
        await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));

        await act(async () => {
            updateFor("todo")([entity("1", { status: "todo" }), entity("2", { status: "todo" })]);
            updateFor("done")([entity("3", { status: "done" })]);
        });

        expect(result.current.columnData.todo.hasMore).toBe(true);
        expect(result.current.columnData.done.hasMore).toBe(false);
    });

    it("re-subscribes only the column that asked for more, with a larger limit", async () => {
        const { result } = renderBoard({ pageSize: 2 });
        await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));
        listen.mockClear();

        act(() => {
            result.current.loadMoreColumn("todo");
        });

        await waitFor(() => expect(listen).toHaveBeenCalledTimes(1));
        expect(listen.mock.calls[0][0]).toMatchObject({
            where: { status: ["==", "todo"] },
            limit: 4
        });
    });

    it("moves an entity between columns optimistically and shifts both counts", async () => {
        const { result } = renderBoard();
        await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));

        await act(async () => {
            updateFor("todo")([entity("1", { title: "A",
status: "todo" })]);
            updateFor("done")([]);
        });
        // Counts come from the count query; seed them so the deltas are visible.
        await waitFor(() => expect(result.current.columnData.todo.totalCount).toBe(0));

        act(() => {
            result.current.moveItemOptimistically("1", "todo", "done", { status: "done" });
        });

        expect(result.current.columnData.todo.entities).toHaveLength(0);
        expect(result.current.columnData.done.entities.map(e => e.id)).toEqual(["1"]);
        // The moved entity carries the expected values before the DB confirms.
        expect(result.current.columnData.done.entities[0].values.status).toBe("done");
        expect(result.current.columnData.done.totalCount).toBe(1);
    });

    it("keeps the optimistic values until the DB stream catches up", async () => {
        const { result } = renderBoard();
        await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));

        await act(async () => {
            updateFor("todo")([entity("1", { title: "A",
status: "todo" })]);
            updateFor("done")([]);
        });

        act(() => {
            result.current.moveItemOptimistically("1", "todo", "done", { status: "done" });
        });

        // A stale frame still showing the old column must not undo the move.
        await act(async () => {
            updateFor("todo")([entity("1", { title: "A",
status: "todo" })]);
        });

        expect(result.current.columnData.todo.entities).toHaveLength(0);
    });

    it("decrements column counts when entities are deleted", async () => {
        count.mockResolvedValue(5);
        const { result } = renderBoard();
        await waitFor(() => expect(result.current.columnData.todo.totalCount).toBe(5));

        act(() => {
            result.current.decrementColumnCounts({ todo: 2,
done: 0 });
        });

        expect(result.current.columnData.todo.totalCount).toBe(3);
        expect(result.current.columnData.done.totalCount).toBe(5);
    });

    /**
     * A subscription that dies is not the same thing as a column with nothing
     * in it, and the hook is careful about the difference: it reads the column
     * once over HTTP and paints that, losing the live updates but not the
     * contents. The error only reaches the caller if the fallback read fails
     * too. Both halves are asserted, because a hook that surfaced the error
     * immediately — as an earlier version did — renders "No items" above a
     * header still counting eleven of them.
     */
    it("falls back to a one-shot read when a column's subscription fails", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        find.mockResolvedValue({ data: [entity("1", { status: "todo" }), entity("2", { status: "todo" })] });
        const { result } = renderBoard();
        await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));

        await act(async () => {
            (listen.mock.calls[0][2] as (e: Error) => void)(new Error("stream failed"));
            updateFor("done")([]);
        });

        await waitFor(() => expect(result.current.columnData.todo.entities).toHaveLength(2));
        expect(result.current.error).toBeUndefined();
        expect(result.current.columnData.todo.loading).toBe(false);
        expect(result.current.loading).toBe(false);
        consoleError.mockRestore();
    });

    it("surfaces the error only when the fallback read fails too", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        find.mockRejectedValue(new Error("http failed"));
        const { result } = renderBoard();
        await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));

        const boom = new Error("stream failed");
        await act(async () => {
            (listen.mock.calls[0][2] as (e: Error) => void)(boom);
            updateFor("done")([]);
        });

        await waitFor(() => expect(result.current.columnData.todo.error).toBe(boom));
        expect(result.current.columnData.todo.loading).toBe(false);
        expect(result.current.loading).toBe(false);
        consoleError.mockRestore();
    });

    it("falls back to find() when the data client cannot listen", async () => {
        listen.mockReset();
        (listen as any).mockReturnValue(undefined);
        // Emulate a driver with no realtime support.
        const noListen = { listen: undefined,
find,
count };
        find.mockResolvedValue({ data: [entity("1", { status: "todo" })] });
        jest.spyOn(require("@rebasepro/app"), "useData").mockReturnValue({ collection: () => noListen } as never);

        const { result } = renderBoard();

        await waitFor(() => expect(result.current.columnData.todo.entities).toHaveLength(1));
        expect(find).toHaveBeenCalled();
        jest.restoreAllMocks();
    });
});
