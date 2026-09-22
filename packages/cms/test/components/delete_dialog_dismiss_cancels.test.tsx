/**
 * @jest-environment jsdom
 *
 * Dismissing the bulk-delete dialog stops the deletes.
 *
 * The Cancel button set the abort flag the delete queue checks before each
 * row. Escape and a click outside went through the dialog's `onOpenChange`,
 * which only closed it: the dialog disappeared and the queue kept walking the
 * selection, deleting every remaining row with nothing on screen saying so.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection, EntitySelection } from "@rebasepro/cms-types";

type PendingDelete = { entity: Entity<Record<string, unknown>>; resolve: (ok: boolean) => void };
const pending: PendingDelete[] = [];

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useData: () => ({ collection: () => ({}) }),
        useSnackbarController: () => ({ open: () => undefined, close: () => undefined }),
        deleteEntityWithCallbacks: ({ entity }: { entity: Entity<Record<string, unknown>> }) =>
            new Promise<boolean>(resolve => pending.push({ entity, resolve }))
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/hooks", () => ({ useAdminContext: () => ({}) }));
jest.mock("../../src/components/EntityViewBinding", () => ({ EntityViewBinding: () => null }));

import { RebaseI18nProvider } from "@rebasepro/app";
import { DeleteEntityDialog } from "../../src/components/DeleteEntityDialog";

const collection: AdminCollection<Record<string, unknown>> = { slug: "products", name: "Products", properties: {} };

const rows = Array.from({ length: 40 }, (_, i): Entity<Record<string, unknown>> => ({
    id: String(i + 1),
    path: "products",
    values: {}
}));

const selection: EntitySelection<Record<string, unknown>> = { type: "entities", entities: rows };

const flush = () => act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
});

function renderDialog(onClose: () => void) {
    return render(
        <RebaseI18nProvider locale="en">
            <DeleteEntityDialog
                target={selection}
                path="products"
                collection={collection}
                open={true}
                onClose={onClose}/>
        </RebaseI18nProvider>
    );
}

describe("DeleteEntityDialog — dismissing a bulk delete", () => {

    beforeEach(() => {
        pending.length = 0;
    });

    it("Escape stops the queue: no row is deleted after the dialog is dismissed", async () => {
        const onClose = jest.fn();
        renderDialog(onClose);

        fireEvent.click(screen.getByRole("button", { name: /ok/i }));
        await flush();
        // The first wave is in flight (eight at a time).
        expect(pending).toHaveLength(8);

        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
        expect(onClose).toHaveBeenCalled();

        // The rows already sent finish; nothing further may start.
        await act(async () => {
            pending.slice().forEach(p => p.resolve(true));
        });
        await flush();
        expect(pending).toHaveLength(8);
    });
});
