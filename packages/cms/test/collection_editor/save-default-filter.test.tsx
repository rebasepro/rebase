/**
 * @jest-environment jsdom
 */
/**
 * "Save default filter" writes two presentation keys, and nothing else.
 *
 * The toolbar button posted the collection the view renders — normalized by the
 * registry and flattened for the panel — merged with the filter, as a full
 * save. The file gained `resolvedRelation` on every relation, the default
 * `dataSource`/`engine`, the default `securityRules` and a top-level
 * `defaultFilter`/`sort`, and stopped type-checking; the plan was "safe, 0
 * changes", so the dialog committed it. A failure or a cancelled review was an
 * unhandled rejection with nothing on screen.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

const snackbar = { open: jest.fn() };
jest.mock("@rebasepro/app", () => ({
    useAuthController: () => ({ user: { uid: "u" } }),
    useSnackbarController: () => snackbar,
    useTranslation: () => ({ t: (key: string) => key })
}));

const controller = {
    readOnly: false,
    saveCollection: jest.fn(async () => undefined),
    updateCollection: jest.fn(async (_params: unknown) => undefined)
};
jest.mock("../../src/collection_editor/useCollectionsConfigController", () => ({
    useCollectionsConfigController: () => controller
}));
jest.mock("../../src/collection_editor/useCollectionEditorController", () => ({
    useCollectionEditorController: () => ({})
}));

import { EditorCollectionActionStart } from "../../src/collection_editor/ui/EditorCollectionActionStart";
import { SchemaChangeCancelled } from "../../src/collection_editor/liveSchemaClient";

/** What the view renders: normalized and flattened. */
const resolved = {
    slug: "posts",
    name: "Posts",
    dataSource: "(default)",
    engine: "postgres",
    properties: {
        author: { type: "relation", relation: { kind: "belongsTo" }, resolvedRelation: { kind: "belongsTo", targetSlug: "authors" } }
    }
};

const tableController = {
    filterValues: { status: ["==", "published"] },
    sortBy: ["publish_date", "desc"],
    setFilterValues: jest.fn(),
    setSortBy: jest.fn(),
    clearFilter: jest.fn()
};

const press = async () => {
    render(<EditorCollectionActionStart
        path="posts"
        parentCollectionSlugs={[]}
        parentEntityIds={[]}
        collection={resolved as never}
        tableController={tableController as never}
        {...({} as Record<string, never>)}
    />);
    await act(async () => { fireEvent.click(screen.getAllByRole("button")[0]); });
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe("the toolbar's save-default-filter button", () => {
    it("updates the two keys it is about, and does not save the rendered collection", async () => {
        await press();
        expect(controller.saveCollection).not.toHaveBeenCalled();
        expect(controller.updateCollection).toHaveBeenCalledWith(expect.objectContaining({
            id: "posts",
            collectionData: { defaultFilter: { status: ["==", "published"] }, sort: ["publish_date", "desc"] }
        }));
    });

    it("reports a failure instead of leaving an unhandled rejection", async () => {
        controller.updateCollection.mockRejectedValueOnce(new Error("refused by the server"));
        await press();
        expect(snackbar.open).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    });

    it("says nothing when the review was cancelled", async () => {
        controller.updateCollection.mockRejectedValueOnce(new SchemaChangeCancelled());
        await press();
        expect(snackbar.open).not.toHaveBeenCalled();
    });
});
