/**
 * @jest-environment jsdom
 */
import React, { useContext } from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { UnmappedTable } from "@rebasepro/types";

/**
 * When the collection editor asks the database for tables no collection maps.
 *
 * It asked on every admin page load — `information_schema.tables` plus the
 * junction-table query, ~50–70 ms of catalogue at 2,000 tables and a socket
 * round trip — and again whenever the collections or the user changed, for a
 * list only the "new collection" dialog shows. It now asks — the schema
 * editor, which knows what `backend/schema` declares — when that dialog opens.
 */

const fetchUnmappedTables = jest.fn(async (): Promise<UnmappedTable[]> => [
    { schema: "public", table: "legacy_orders", rlsEnabled: true, policies: 1, notes: [] },
    { schema: "public", table: "audit_log", rlsEnabled: false, policies: 0, notes: [], unimportable: "it has no primary key." }
]);
const user = { uid: "u1" };

jest.mock("@rebasepro/app", () => ({
    useAuthController: () => ({ initialLoading: false, user }),
    useCustomizationController: () => ({ propertyConfigs: {} }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useBridgeRegistration: () => undefined
}));

jest.mock("../../src/collection_editor/_cms_internals", () => ({
    useUrlController: () => ({ buildUrlCollectionPath: (slug: string) => `/c/${slug}` })
}));

jest.mock("react-router", () => ({
    useNavigate: () => jest.fn()
}));

import { CollectionEditorContext, ConfigControllerProvider } from "../../src/collection_editor/ConfigControllerProvider";
import { CollectionEditorDialogsContext } from "../../src/collection_editor/CollectionEditorDialogsContext";
import type { CollectionsConfigController } from "../../src/collection_editor/types/config_controller";
import { fakeCollectionsConfigController } from "../helpers/fakes";

const posts: AdminCollection = { slug: "posts", name: "Posts", properties: {} };
const controller: CollectionsConfigController = { ...fakeCollectionsConfigController([posts]), listUnmappedTables: fetchUnmappedTables };

/** A button that opens the "new collection" dialog, and what the dialog would be shown. */
function NewCollectionButton() {
    const editor = useContext(CollectionEditorContext);
    const dialogs = useContext(CollectionEditorDialogsContext);
    const offered = (dialogs.collectionDialogProps as { unmappedTables?: string[] } | undefined)?.unmappedTables ?? [];
    return <>
        <button onClick={() => editor.createCollection({ parentCollectionSlugs: [], parentEntityIds: [], redirect: false })}>New collection</button>
        <span>{offered.join(",") || "none offered"}</span>
    </>;
}

beforeEach(() => {
    fetchUnmappedTables.mockClear();
});

describe("tables no collection maps", () => {
    it("are not asked for when the admin loads", async () => {
        render(<ConfigControllerProvider collectionConfigController={controller}><NewCollectionButton/></ConfigControllerProvider>);
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

        expect(fetchUnmappedTables).not.toHaveBeenCalled();
    });

    it("are asked for when the new-collection dialog opens, and offered in it — those that can be imported", async () => {
        render(<ConfigControllerProvider collectionConfigController={controller}><NewCollectionButton/></ConfigControllerProvider>);

        await act(async () => { screen.getByText("New collection").click(); });

        await waitFor(() => expect(screen.getByText("legacy_orders")).toBeTruthy());
        expect(fetchUnmappedTables).toHaveBeenCalledTimes(1);
    });
});
