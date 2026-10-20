/**
 * @jest-environment jsdom
 */
/**
 * `exportable: false` removes Export from the collection toolbar.
 *
 * The flag was typed, carried through Studio's serializer and the panel's
 * collection merge, and read nowhere: `ExportCollectionAction` only looked at
 * the object form (for its extra fields), and the toolbar rendered Export
 * whatever the collection said.
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
        usePermissions: () => ({ canCreate: () => false, canDelete: () => false })
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
jest.mock("../../src/data_export/export", () => ({ ExportCollectionAction: () => <button>export</button> }));
jest.mock("../../src/data_import/import", () => ({ ImportCollectionAction: () => <button>import</button> }));

import { CollectionViewActions } from "../../src/components/CollectionViewBinding/CollectionViewActions";

function renderActions(exportable: boolean | object | undefined) {
    const collection = { slug: "posts", name: "Posts", properties: {}, exportable } as never;
    return render(<CollectionViewActions
        collection={collection}
        path={"posts"}
        relativePath={"posts"}
        parentCollectionSlugs={[]}
        parentEntityIds={[]}
        selectionEnabled={false}
        onNewClick={() => undefined}
        onMultipleDeleteClick={() => undefined}
        selectionController={{ selectedCount: 0, hasSelection: false } as never}
        tableController={{} as never}
        openNewDocument={() => undefined}/>);
}

describe("the collection toolbar's Export", () => {

    test("is offered by default", async () => {
        renderActions(undefined);
        expect(await screen.findByText("export")).toBeTruthy();
    });

    test("is offered with an export config", async () => {
        renderActions({ additionalFields: [] });
        expect(await screen.findByText("export")).toBeTruthy();
    });

    test("is gone with `exportable: false`, and Import stays", async () => {
        renderActions(false);
        expect(await screen.findByText("import")).toBeTruthy();
        expect(screen.queryByText("export")).toBeNull();
    });
});
