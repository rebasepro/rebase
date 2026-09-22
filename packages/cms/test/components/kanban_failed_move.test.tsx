/**
 * @jest-environment jsdom
 *
 * A drag whose save is refused says so, and puts the card back.
 *
 * The move is shown optimistically before the save; when the save failed the
 * failure only reached the console. The board was asked to refresh from two
 * places — the save's error callback and the `catch` after it, since
 * `saveEntityWithCallbacks` calls the callback *and* rethrows — and nothing on
 * screen explained why the card then jumped back.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, renderHook } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection, AnalyticsController, RebaseContext } from "@rebasepro/cms-types";
import type { BoardItem } from "@rebasepro/ui";
import type { BoardDataController } from "../../src/components/CollectionViewBinding/useBoardDataController";

const snackbarOpen = jest.fn();

jest.mock("@rebasepro/app", () => ({
    saveEntityWithCallbacks: async ({ afterSaveError }: { afterSaveError?: (e: Error) => void }) => {
        const error = new Error("permission denied for table tasks");
        afterSaveError?.(error);
        throw error;
    },
    useSnackbarController: () => ({ open: snackbarOpen, close: () => undefined }),
    useTranslation: () => ({ t: (key: string) => key })
}));

import { useKanbanDragAndDrop } from "../../src/components/CollectionViewBinding/hooks/useKanbanDragAndDrop";

type Task = { status: string };

const collection: AdminCollection<Task> = { slug: "tasks", name: "Tasks", properties: {} };

const card: Entity<Task> = { id: "1", path: "tasks", values: { status: "todo" } };

describe("useKanbanDragAndDrop — a refused move", () => {

    beforeEach(() => {
        snackbarOpen.mockReset();
    });

    it("refreshes the board once and tells the user", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const refreshAll = jest.fn();
        const moveItemOptimistically = jest.fn();
        const boardDataController = {
            columnData: {},
            loadMoreColumn: () => undefined,
            refreshColumn: () => undefined,
            refreshAll,
            moveItemOptimistically,
            decrementColumnCounts: () => undefined,
            loading: false
        } satisfies BoardDataController<Task>;

        const { result } = renderHook(() => useKanbanDragAndDrop<Task>({
            collection,
            fullPath: "tasks",
            columnProperty: "status",
            dataClient: {} as never,
            context: {} as RebaseContext,
            boardDataController,
            analyticsController: {} as AnalyticsController
        }));

        const items: BoardItem<Entity<Task>>[] = [{ id: "1", data: card }];
        await act(async () => {
            await result.current.handleItemsReorder(items, { itemId: "1", sourceColumn: "todo", targetColumn: "done" });
        });

        expect(moveItemOptimistically).toHaveBeenCalledTimes(1);
        expect(refreshAll).toHaveBeenCalledTimes(1);
        expect(snackbarOpen).toHaveBeenCalledTimes(1);
        expect(snackbarOpen.mock.calls[0][0]).toMatchObject({
            type: "error",
            message: "permission denied for table tasks"
        });
        consoleError.mockRestore();
    });
});
