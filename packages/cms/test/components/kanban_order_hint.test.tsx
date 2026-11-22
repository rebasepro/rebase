/**
 * @jest-environment jsdom
 *
 * A board with no order field explains itself only when that matters.
 *
 * Moving a card to another column is saved whether or not the board has an
 * order field; only its place *within* a column needs one. The board used to
 * warn on load — "Drag-and-drop ordering is not configured" — over every
 * status board, where moving cards between columns is the whole job and works.
 * It now says it once a card is dropped somewhere in its own column, which is
 * the one move it cannot keep.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AdminCollection, Entity, EntityTableController } from "@rebasepro/cms-types";
import type { BoardItem } from "@rebasepro/ui";

type Task = { name: string; status: string; order?: string };

const save = jest.fn(async () => undefined);

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useTranslation: () => ({ t: (key: string) => key }),
        useData: () => ({ table: () => ({ count: async () => 0, find: async () => ({ data: [] }) }) }),
        useRebaseContext: () => ({}),
        useAnalyticsController: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {} }),
        useSnackbarController: () => ({ open: () => undefined, close: () => undefined }),
        useSlot: () => [],
        saveEntityWithCallbacks: save
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/hooks/useSidePanel", () => ({ useSidePanel: () => ({ open: () => undefined }) }));

const first: Entity<Task> = { id: "1", path: "tasks", values: { name: "Write", status: "todo" } };
const second: Entity<Task> = { id: "2", path: "tasks", values: { name: "Review", status: "todo" } };

jest.mock("../../src/components/CollectionViewBinding/useBoardDataController", () => ({
    useBoardDataController: () => ({
        columnData: {
            todo: { entities: [first, second], loading: false, hasMore: false, totalCount: 2 },
            done: { entities: [], loading: false, hasMore: false, totalCount: 0 }
        },
        loadMoreColumn: () => undefined,
        refreshColumn: () => undefined,
        refreshAll: () => undefined,
        moveItemOptimistically: () => undefined,
        decrementColumnCounts: () => undefined,
        loading: false
    })
}));

/** The board itself is the kit's; this drives the drops it reports. */
jest.mock("@rebasepro/ui", () => {
    const actual = jest.requireActual("@rebasepro/ui") as Record<string, unknown>;
    type Reorder = (items: BoardItem<Entity<Task>>[], move: { itemId: string; sourceColumn: string; targetColumn: string }) => void;
    return {
        ...actual,
        KanbanView: ({ onItemsReorder }: { onItemsReorder: Reorder }) => (
            <div>
                <button onClick={() => onItemsReorder(
                    [{ id: "2", data: second }, { id: "1", data: first }],
                    { itemId: "2", sourceColumn: "todo", targetColumn: "todo" })}>
                    within column
                </button>
                <button onClick={() => onItemsReorder(
                    [{ id: "1", data: first }],
                    { itemId: "1", sourceColumn: "todo", targetColumn: "done" })}>
                    to another column
                </button>
            </div>
        )
    };
});

import { CollectionBoardViewBinding } from "../../src/components/CollectionViewBinding/CollectionBoardViewBinding";

function collection(orderProperty?: string): AdminCollection<Task> {
    return {
        slug: "tasks",
        name: "Tasks",
        properties: {
            name: { type: "string", name: "Name" },
            status: { type: "string", name: "Status", enum: [{ id: "todo", label: "To do" }, { id: "done", label: "Done" }] },
            order: { type: "string", name: "Order" }
        },
        ...(orderProperty ? { orderProperty } : {})
    };
}

function renderBoard(orderProperty?: string) {
    const tableController = {} as EntityTableController<Task>;
    return render(<CollectionBoardViewBinding<Task>
        collection={collection(orderProperty)}
        tableController={tableController}
        fullPath={"tasks"}
        columnProperty={"status"}/>);
}

const HINT = "kanban_order_not_configured";

describe("the board's order hint", () => {
    it("says nothing on a board that only moves cards between columns", async () => {
        renderBoard();
        expect(screen.queryByText(HINT)).toBeNull();

        await act(async () => {
            fireEvent.click(screen.getByText("to another column"));
        });
        expect(screen.queryByText(HINT)).toBeNull();
        expect(save).toHaveBeenCalled();
    });

    it("explains, once a card is dropped within its column, that the order is not kept", async () => {
        renderBoard();
        await act(async () => {
            fireEvent.click(screen.getByText("within column"));
        });
        expect(screen.getByText(HINT)).toBeTruthy();
    });

    it("says nothing on a board with an order field", async () => {
        renderBoard("order");
        await act(async () => {
            fireEvent.click(screen.getByText("within column"));
        });
        expect(screen.queryByText(HINT)).toBeNull();
    });
});
