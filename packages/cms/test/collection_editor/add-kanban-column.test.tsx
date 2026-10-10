/**
 * @jest-environment jsdom
 */
/**
 * Kanban "Add column" adds one enum value and keeps the others as they are.
 *
 * It rebuilt every existing value as `{ id, label }`, so adding "Scheduled" to
 * a board whose statuses were coloured saved the enum without a single colour.
 * A label that slugified to an existing id was saved as a second value with
 * that id, and a failed save only reached the console.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

const snackbar = { open: jest.fn() };
jest.mock("@rebasepro/app", () => ({
    useSnackbarController: () => snackbar,
    useTranslation: () => ({ t: (key: string) => key })
}));

const controller = {
    readOnly: false,
    saveProperty: jest.fn(async (_params: unknown) => undefined)
};
jest.mock("../../src/collection_editor/useCollectionsConfigController", () => ({
    useCollectionsConfigController: () => controller
}));

import { AddKanbanColumnAction } from "../../src/collection_editor/ui/AddKanbanColumnAction";
import { SchemaChangeCancelled } from "../../src/collection_editor/liveSchemaClient";

const statuses = [
    { id: "draft", label: "Draft", color: "grayLight" },
    { id: "review", label: "In review", color: "orangeLight", disabled: false },
    { id: "published", label: "Published", color: "greenLight" }
];

const posts = {
    slug: "posts",
    name: "Posts",
    properties: {
        status: { type: "string", name: "Status", enum: statuses }
    }
};

const openAndType = async (label: string) => {
    render(<AddKanbanColumnAction
        collection={posts as never}
        fullPath="posts"
        parentCollectionSlugs={[]}
        parentEntityIds={[]}
        columnProperty="status"
    />);
    await act(async () => { fireEvent.click(screen.getByText("studio_add_kanban_column")); });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: label } });
};

const addButton = () => screen.getByRole("button", { name: "studio_add_kanban_column_add" });

beforeEach(() => {
    jest.clearAllMocks();
});

describe("Kanban add column", () => {
    it("saves the existing values unchanged, plus the new one", async () => {
        await openAndType("Scheduled");
        await act(async () => { fireEvent.click(addButton()); });
        expect(controller.saveProperty).toHaveBeenCalledTimes(1);
        const params = controller.saveProperty.mock.calls[0][0] as { property: { enum: unknown } };
        expect(params.property.enum).toEqual([...statuses, { id: "scheduled", label: "Scheduled" }]);
    });

    it("refuses a label whose id is already a column, and says so", async () => {
        await openAndType("Published");
        expect(screen.getByText("studio_add_kanban_column_exists")).toBeTruthy();
        expect((addButton() as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" }); });
        expect(controller.saveProperty).not.toHaveBeenCalled();
    });

    it("shows a failed save", async () => {
        controller.saveProperty.mockRejectedValueOnce(new Error("refused by the server"));
        await openAndType("Scheduled");
        await act(async () => { fireEvent.click(addButton()); });
        expect(snackbar.open).toHaveBeenCalledWith(expect.objectContaining({ type: "error", message: "refused by the server" }));
    });

    it("says nothing when the review was cancelled", async () => {
        controller.saveProperty.mockRejectedValueOnce(new SchemaChangeCancelled());
        await openAndType("Scheduled");
        await act(async () => { fireEvent.click(addButton()); });
        expect(snackbar.open).not.toHaveBeenCalled();
    });
});
