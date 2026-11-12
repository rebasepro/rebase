/**
 * @jest-environment jsdom
 *
 * `useSidePanel().open()` took `entityId` and `onUpdate` in 0.28; they are
 * `id` and `onSaved` now. Code written against 0.28 — a JS config, an app
 * compiled without types — must keep opening the record it names and hearing
 * about its saves: `open({ path, entityId: 5 })` opened a blank "new record"
 * form, and saving it made a duplicate.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type {
    AdminCollection,
    AuthController,
    NavigationStateController,
    SideDialogPanelProps,
    SideDialogsController,
    SidePanelBindingProps,
    UrlController,
    CollectionRegistryController
} from "@rebasepro/cms-types";
import type { Entity } from "@rebasepro/types";
import { resetDeprecationWarningsForTests } from "@rebasepro/common";

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useLargeLayout: () => true,
        useCustomizationController: () => ({}),
        useComponentOverride: (_key: string, fallback: unknown) => fallback
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { useBuildSidePanel } from "../../src/hooks/useBuildSidePanel";
import { useBuildUrlController } from "../../src/hooks/navigation/useBuildUrlController";

const products = {
    slug: "products",
    name: "Products",
    properties: {},
    // The view a record opens on: "existing" opens on "details", "new" on nothing.
    defaultSelectedView: ({ status }: { status: string }) => status === "existing" ? "details" : undefined
} as Partial<AdminCollection> as AdminCollection;

const registry = {
    collections: [products]
} as Partial<CollectionRegistryController> as CollectionRegistryController;

const panels: SideDialogPanelProps[] = [];

const sideDialogsController = {
    sidePanels: [],
    setSidePanels: () => undefined,
    close: () => undefined,
    open: (panel: SideDialogPanelProps | SideDialogPanelProps[]) => {
        panels.push(...(Array.isArray(panel) ? panel : [panel]));
    },
    replace: (panel: SideDialogPanelProps | SideDialogPanelProps[]) => {
        panels.push(...(Array.isArray(panel) ? panel : [panel]));
    }
} satisfies SideDialogsController;

function renderSidePanel() {
    return renderHook(() => {
        const urlController: UrlController = useBuildUrlController({
            basePath: "/",
            baseCollectionPath: "/c",
            collectionRegistryController: registry
        });
        return useBuildSidePanel(
            registry,
            urlController,
            { loading: true } as Partial<NavigationStateController> as NavigationStateController,
            sideDialogsController,
            { user: null } as Partial<AuthController> as AuthController
        );
    }, {
        wrapper: ({ children }) => <MemoryRouter initialEntries={["/c/products"]}>{children}</MemoryRouter>
    });
}

function panelRecord(panel: SideDialogPanelProps): SidePanelBindingProps | undefined {
    return panel.additional as SidePanelBindingProps | undefined;
}

describe("useSidePanel: the 0.28 names still work", () => {

    let warn: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
        panels.length = 0;
        resetDeprecationWarningsForTests();
        warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        window.history.replaceState(null, "", "/c/products");
    });

    afterEach(() => {
        warn.mockRestore();
    });

    it("open({ path, entityId }) opens that existing record, and warns once naming `id`", () => {
        const { result } = renderSidePanel();

        result.current.open({ path: "products", entityId: "5", collection: products });
        result.current.open({ path: "products", entityId: "5", collection: products });

        expect(panels).toHaveLength(2);
        expect(panelRecord(panels[0])?.id).toBe("5");
        // Opened as "existing": on the view an existing record opens on, at its own address.
        expect(panelRecord(panels[0])?.selectedTab).toBe("details");
        expect(panels[0].urlPath).toBe("/c/products/5/details#side");
        expect(panels[0].key).toBe("products/5");

        const entityIdWarnings = warn.mock.calls.filter(([m]) => String(m).includes("entityId"));
        expect(entityIdWarnings).toHaveLength(1);
        expect(String(entityIdWarnings[0][0])).toContain("`id`");
    });

    it("replace({ path, entityId }) replaces the panel with that existing record", () => {
        const { result } = renderSidePanel();

        result.current.replace({ path: "products", entityId: 7, collection: products });

        expect(panelRecord(panels[0])?.id).toBe(7);
        expect(panels[0].urlPath).toBe("/c/products/7#side");
    });

    it("open() without the old names warns about nothing", () => {
        const { result } = renderSidePanel();

        result.current.open({ path: "products", id: "5", collection: products, onSaved: () => undefined });

        expect(warn).not.toHaveBeenCalled();
    });

    it("calls `onUpdate` after a save with the saved record as an entity, and warns once naming `onSaved`", () => {
        const { result } = renderSidePanel();
        const onUpdate = jest.fn<(params: { entity: Entity }) => void>();
        const onSaved = jest.fn<(params: { row: Record<string, unknown>; id: string | number }) => void>();

        result.current.open({ path: "products", entityId: "5", collection: products, onUpdate, onSaved });

        // What the panel's form hands its `onSaved` once the record is stored.
        panelRecord(panels[0])?.onSaved?.({ row: { id: 5, name: "Chair" }, id: "5" });

        expect(onSaved).toHaveBeenCalledWith({ row: { id: 5, name: "Chair" }, id: "5" });
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate.mock.calls[0][0]).toEqual({
            entity: { id: "5", path: "products", values: { id: 5, name: "Chair" } }
        });

        const onUpdateWarnings = warn.mock.calls.filter(([m]) => String(m).includes("onUpdate"));
        expect(onUpdateWarnings).toHaveLength(1);
        expect(String(onUpdateWarnings[0][0])).toContain("`onSaved`");
    });
});
