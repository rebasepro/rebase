/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";

/**
 * "Add existing" on a junction tab links the rows picked when Done is pressed.
 *
 * The picker reports its selection live, on every tick, which is right for a
 * reference field whose value *is* the selection. The junction tab used the
 * same callback to write: each tick linked a row at once, and unticking it or
 * pressing Clear removed nothing — tick the wrong tag, untick it, press Done,
 * and the tag stayed linked to the post. `onSelectionDone` is the other
 * contract: the final selection, once.
 */

jest.mock("../../src/hooks/useSidePanel", () => {
    const controller = { open: () => undefined, close: () => undefined, replace: () => undefined };
    return { useSidePanel: () => controller };
});

jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => {
    const controller = { resolveDatabasePathsFrom: (p: string) => p };
    return { useUrlController: () => controller };
});

const dialogClose = jest.fn();
jest.mock("../../src/components/SideDialogs", () => {
    const context = { close: (...args: unknown[]) => dialogClose(...args), setBlocked: () => undefined };
    return { useSideDialogContext: () => context };
});

type Tag = { name: string };
const rows: Entity<Tag>[] = [
    { id: "1", path: "tags", values: { name: "wrong" } },
    { id: "2", path: "tags", values: { name: "right" } }
];

// The table is not under test: it renders one button per row, wired to the
// row click the real table makes, and the `actions` slot Clear lives in.
jest.mock("../../src/components/CollectionTableBinding", () => ({
    CollectionTableBinding: ({ actions, onEntityClick }: {
        actions?: React.ReactNode,
        onEntityClick?: (entity: Entity<Tag>) => void
    }) => <div>
        {rows.map(row => <button key={row.id} onClick={() => onEntityClick?.(row)}>{`row ${row.values.name}`}</button>)}
        {actions}
    </div>,
    CollectionRowActions: () => null
}));

jest.mock("@rebasepro/app", () => {
    const analytics = { onAnalyticsEvent: () => undefined };
    const data = { collection: () => ({}) };
    const tableController = {};
    const columnIds: string[] = [];
    const permissions = { canCreate: () => false };
    const translation = { t: (key: string) => key };
    return {
        CollectionScopeProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
        ErrorView: ({ error }: { error: string }) => <div>{error}</div>,
        IconForView: () => null,
        useAuthController: () => ({}),
        useCustomizationController: () => ({}),
        useAnalyticsController: () => analytics,
        useData: () => data,
        useDataTableController: () => tableController,
        useColumnIds: () => columnIds,
        useLargeLayout: () => true,
        usePermissions: () => permissions,
        useTranslation: () => translation
    };
});

import { SelectionTableBinding } from "../../src/components/ReferenceTable/SelectionTableBinding";

beforeAll(() => {
    Object.assign(Element.prototype, { scrollIntoView: () => undefined });
});

const collection = {
    slug: "tags",
    name: "Tags",
    singularName: "Tag",
    properties: { name: { type: "string", name: "Name" } }
} as never;

describe("SelectionTableBinding — onSelectionDone", () => {

    beforeEach(() => {
        dialogClose.mockClear();
    });

    const renderPicker = (onSelectionDone: (entities: Entity<Tag>[]) => void) => render(
        <SelectionTableBinding<Tag> collection={collection} path="tags" multiselect={true} onSelectionDone={onSelectionDone}/>
    );

    it("reports nothing while rows are ticked and unticked, then the final selection once", async () => {
        const onSelectionDone = jest.fn<(entities: Entity<Tag>[]) => void>();
        renderPicker(onSelectionDone);

        await act(async () => fireEvent.click(screen.getByText("row wrong")));
        await act(async () => fireEvent.click(screen.getByText("row right")));
        await act(async () => fireEvent.click(screen.getByText("row wrong")));
        expect(onSelectionDone).not.toHaveBeenCalled();

        await act(async () => fireEvent.click(screen.getByText("Done")));
        expect(onSelectionDone).toHaveBeenCalledTimes(1);
        expect(onSelectionDone.mock.calls[0][0].map(e => e.id)).toEqual(["2"]);
        expect(dialogClose).toHaveBeenCalledTimes(1);
    });

    it("reports an empty selection after Clear", async () => {
        const onSelectionDone = jest.fn<(entities: Entity<Tag>[]) => void>();
        renderPicker(onSelectionDone);

        await act(async () => fireEvent.click(screen.getByText("row wrong")));
        await act(async () => fireEvent.click(screen.getByText("Clear")));
        await act(async () => fireEvent.click(screen.getByText("Done")));

        expect(onSelectionDone).toHaveBeenCalledTimes(1);
        expect(onSelectionDone.mock.calls[0][0]).toEqual([]);
    });
});
