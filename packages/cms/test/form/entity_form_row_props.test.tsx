/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";
import type { AdminCollection, EntityCustomViewParams, FormContext } from "@rebasepro/cms-types";

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useSnackbarController: () => ({ open: () => undefined })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { EntityForm } from "../../src/form/EntityForm";
import type { OnSavedParams } from "../../src/types/components/EntityFormProps";

/**
 * The record form takes the record as a row and an id, and reports it back
 * the same way: what an app holds is what it hands in.
 */

type Order = Record<string, unknown>;

// Keyed by an integer column: the row's `id` is that column, a number; the
// id the admin addresses the record by is the string it derives from it.
const orders: AdminCollection = {
    slug: "orders",
    name: "Orders",
    properties: {
        id: { type: "number", name: "Id", isId: true },
        title: { type: "string", name: "Title" },
        placedAt: { type: "date", name: "Placed at" }
    }
};

let context: FormContext<Order> | undefined;
function Capture({ formContext }: EntityCustomViewParams<Order>) {
    context = formContext;
    return null;
}

describe("EntityForm: a record as a row and an id", () => {
    it("opens with the row's values, typed for the editor", () => {
        context = undefined;
        render(<EntityForm<Order>
            path="orders"
            id={5}
            collection={orders}
            row={{ id: 5, title: "Five", placedAt: "2026-11-08T09:30:00.000Z" }}
            initialStatus="existing"
            Builder={Capture}/>);
        expect(context!.values.title).toBe("Five");
        expect(context!.values.placedAt).toEqual(new Date("2026-11-08T09:30:00.000Z"));
        expect(context!.id).toBe(5);
    });

    it("reports the saved record as its row and its id — a string, whatever the key column's type", async () => {
        context = undefined;
        const saved: OnSavedParams[] = [];
        const changed: { row: Record<string, unknown>; id: string }[] = [];
        render(<EntityForm<Order>
            path="orders"
            id={5}
            collection={orders}
            row={{ id: 5, title: "Five", placedAt: "2026-11-08T09:30:00.000Z" }}
            initialStatus="existing"
            Builder={Capture}
            onSubmit={async (values) => ({ row: { id: 5, title: values.title, placedAt: "2026-11-08T09:30:00.000Z" }, id: 5 })}
            onSaved={(params) => saved.push(params)}
            onRowChange={(params) => changed.push(params)}/>);

        await act(async () => {
            context!.setFieldValue("title", "Five!");
        });
        await act(async () => {
            await context!.save(context!.values);
        });

        expect(saved).toHaveLength(1);
        expect(saved[0].id).toBe("5");
        expect(saved[0].row).toEqual({ id: 5, title: "Five!", placedAt: "2026-11-08T09:30:00.000Z" });
        expect(changed).toEqual([{ row: saved[0].row, id: "5" }]);
    });
});
