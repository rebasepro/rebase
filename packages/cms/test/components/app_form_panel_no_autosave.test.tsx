/**
 * @jest-environment jsdom
 */
/**
 * The record form an app the model wrote imports (`@rebasepro/cms` in
 * show_app) never saves itself: with `formAutoSave` and seeded values, a
 * form would write on mount, with nobody's click — whether the override or
 * the collection asked for it. Every other override reaches the form as
 * given.
 */
import React from "react";
import type { AdminCollection } from "@rebasepro/cms-types";
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react";

const mockSeen: Record<string, unknown>[] = [];

jest.mock("../../src/components/RecordForm", () => ({
    RecordForm: (props: Record<string, unknown>) => {
        mockSeen.push(props);
        return null;
    }
}));

jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({ getCollection: () => undefined })
}));

import { APP_MODULE_EXPORTS } from "../../src/mcp_view/app_modules";
import type { RecordFormProps } from "../../src/components/RecordForm";

const orders: AdminCollection = { slug: "orders", name: "Orders", properties: { status: { type: "string" } } };

function isPanel(value: unknown): value is React.ComponentType<RecordFormProps> {
    return typeof value === "function";
}

/** The component an app gets for `import { RecordForm } from "@rebasepro/cms"`. */
function served(): React.ComponentType<RecordFormProps> {
    const panel: unknown = Reflect.get(APP_MODULE_EXPORTS["@rebasepro/cms"], "RecordForm");
    if (!isPanel(panel)) throw new Error("no RecordForm");
    return panel;
}

describe("an app's RecordForm", () => {
    it("turns formAutoSave off over its overrides, and keeps the rest", () => {
        const Panel = served();
        render(<Panel collection={orders} defaultValues={{ status: "shipped" }}
            collectionOverrides={{ formAutoSave: true, name: "Shipments" }}/>);
        expect(mockSeen.at(-1)?.collectionOverrides).toEqual({ name: "Shipments", formAutoSave: false });
        expect(mockSeen.at(-1)?.defaultValues).toEqual({ status: "shipped" });
    });

    it("turns it off where it was given no overrides: the collection itself may save itself", () => {
        // The overrides merge over the collection the form opens — the
        // registered one, or the value in its own scope — so a collection
        // declared with `formAutoSave: true` saves itself no more than an
        // override that asks for it.
        const Panel = served();
        const autoSaving = { slug: "orders", name: "Orders", formAutoSave: true, properties: { status: { type: "string" as const } } };
        render(<Panel collection={autoSaving} defaultValues={{ status: "shipped" }}/>);
        expect(mockSeen.at(-1)?.collectionOverrides).toEqual({ formAutoSave: false });

        render(<Panel collection="orders"/>);
        expect(mockSeen.at(-1)?.collectionOverrides).toEqual({ formAutoSave: false });
    });
});
