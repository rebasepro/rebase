/**
 * @jest-environment jsdom
 */
/**
 * The toolbar's bulk delete says what it does, in both its forms.
 *
 * Where the toolbar has room the button is labelled, and its only text is the
 * count: a screen reader announced "(1)", and a locator for "Delete" found it
 * only when the toolbar happened to be too narrow for labels.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";

jest.mock("@rebasepro/app", () => {
    const actual = jest.requireActual("@rebasepro/app") as Record<string, unknown>;
    const overrides: Record<string, unknown> = {
        useLargeLayout: () => true,
        useTranslation: () => ({ t: (key: string) => key }),
        useSlot: () => [],
        usePermissions: () => ({ canCreate: () => false, canDelete: () => true })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides) ? overrides[key] : actual[key as string]
    });
});
jest.mock("../../src/hooks/useAdminContext", () => ({ useAdminContext: () => ({}) }));
jest.mock("../../src/collection_editor/useCollectionEditorController", () => ({
    useCollectionEditorController: () => undefined
}));
jest.mock("../../src/data_export/export", () => ({ ExportCollectionAction: () => null }));
jest.mock("../../src/data_import/import", () => ({ ImportCollectionAction: () => null }));

import { CollectionViewActions } from "../../src/components/CollectionViewBinding/CollectionViewActions";

function renderActions({ compact, removeUnlinks }: { compact?: boolean; removeUnlinks?: boolean }) {
    const collection = { slug: "posts", name: "Posts", properties: {} } as never;
    return render(<CollectionViewActions
        collection={collection}
        path={"posts"}
        relativePath={"posts"}
        parentCollectionSlugs={[]}
        parentEntityIds={[]}
        selectionEnabled={true}
        compact={compact}
        removeUnlinks={removeUnlinks}
        onMultipleDeleteClick={() => undefined}
        onNewClick={() => undefined}
        selectionController={{ selection: { type: "entities", entities: [] }, selectedCount: 1, hasSelection: true } as never}
        tableController={{ data: [] } as never}
        openNewDocument={() => undefined}/>);
}

describe("the toolbar's bulk delete", () => {

    test("labelled, is named for its action and its count", () => {
        renderActions({});
        expect(screen.getByRole("button", { name: "delete_selected (1)" })).toBeTruthy();
    });

    test("icon-only, is named for its action", () => {
        renderActions({ compact: true });
        expect(screen.getByRole("button", { name: "delete_selected" })).toBeTruthy();
    });

    test("in a record's relation tab, says it removes rather than deletes", () => {
        renderActions({ removeUnlinks: true });
        expect(screen.getByRole("button", { name: "remove_from_record (1)" })).toBeTruthy();
    });
});
