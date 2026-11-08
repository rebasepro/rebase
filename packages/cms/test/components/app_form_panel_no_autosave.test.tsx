/**
 * @jest-environment jsdom
 */
/**
 * The record form an app the model wrote imports (`@rebasepro/cms` in
 * show_app) never saves itself: with `formAutoSave` and seeded values, a
 * form would write on mount, with nobody's click. Every other override
 * reaches the form as given.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react";

const mockSeen: Record<string, unknown>[] = [];

jest.mock("../../src/components/EntityFormPanel", () => ({
    EntityFormPanel: (props: Record<string, unknown>) => {
        mockSeen.push(props);
        return null;
    }
}));

jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({ getCollection: () => undefined })
}));

import { APP_MODULE_EXPORTS } from "../../src/mcp_view/app_modules";
import type { EntityFormPanelProps } from "../../src/components/EntityFormPanel";

const orders = { slug: "orders", name: "Orders", properties: { status: { type: "string" } } } as never;

function isPanel(value: unknown): value is React.ComponentType<EntityFormPanelProps> {
    return typeof value === "function";
}

/** The component an app gets for `import { EntityFormPanel } from "@rebasepro/cms"`. */
function served(): React.ComponentType<EntityFormPanelProps> {
    const panel: unknown = Reflect.get(APP_MODULE_EXPORTS["@rebasepro/cms"], "EntityFormPanel");
    if (!isPanel(panel)) throw new Error("no EntityFormPanel");
    return panel;
}

describe("an app's EntityFormPanel", () => {
    it("drops formAutoSave from its overrides, and keeps the rest", () => {
        const Panel = served();
        render(<Panel collection={orders} defaultValues={{ status: "shipped" }}
            collectionOverrides={{ formAutoSave: true, name: "Shipments" }}/>);
        expect(mockSeen.at(-1)?.collectionOverrides).toEqual({ name: "Shipments" });
        expect(mockSeen.at(-1)?.defaultValues).toEqual({ status: "shipped" });
    });

    it("passes no overrides where it was given none", () => {
        const Panel = served();
        render(<Panel collection={orders}/>);
        expect(mockSeen.at(-1)).not.toHaveProperty("collectionOverrides");
    });
});
