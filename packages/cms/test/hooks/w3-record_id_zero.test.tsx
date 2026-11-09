/**
 * @jest-environment jsdom
 *
 * A record whose id is `0` opens as that record.
 *
 * Whether there was a record was asked of the id's truthiness, and `0` is
 * falsy: the side panel opened record 0 as a new one, wrote a `#new_side` URL
 * for it, and its Save created a row instead of editing row 0. Full screen
 * navigated to the collection with `#new`.
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type {
    AdminCollection,
    AuthController,
    NavigationStateController,
    SideDialogPanelProps,
    SideDialogsController,
    SidePanelController,
    UrlController
} from "@rebasepro/cms-types";
import type { CollectionRegistryController } from "@rebasepro/types";

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
import { navigateToEntity } from "../../src/util/navigation_utils";
import { hasEntityId } from "@rebasepro/common";
import { fakeAuthController, fakeCollectionRegistry, fakeNavigationState, fakeUrlController } from "../helpers/fakes";

const statuses: (string | undefined)[] = [];
const ids: unknown[] = [];
const products: AdminCollection = {
    slug: "products",
    name: "Products",
    properties: {},
    defaultSelectedView: ({ status, id }) => {
        statuses.push(status);
        ids.push(id);
        return undefined;
    }
};

const registry = fakeCollectionRegistry([products]);

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
            fakeNavigationState({ loading: true }),
            sideDialogsController,
            fakeAuthController({ user: null })
        );
    }, {
        wrapper: ({ children }) => <MemoryRouter initialEntries={["/c/products"]}>{children}</MemoryRouter>
    });
}

describe("hasEntityId", () => {
    it("is true for 0 and any other number, and for a non-empty string", () => {
        expect(hasEntityId(0)).toBe(true);
        expect(hasEntityId(42)).toBe(true);
        expect(hasEntityId("0")).toBe(true);
        expect(hasEntityId("abc")).toBe(true);
    });

    it("is false for no id", () => {
        expect(hasEntityId(undefined)).toBe(false);
        expect(hasEntityId(null)).toBe(false);
        expect(hasEntityId("")).toBe(false);
        expect(hasEntityId(Number.NaN)).toBe(false);
    });
});

describe("a record with id 0", () => {
    beforeEach(() => {
        panels.length = 0;
        statuses.length = 0;
        ids.length = 0;
        window.history.replaceState(null, "", "/c/products");
    });

    it("opens in the side panel as an existing record, under its own URL", () => {
        const { result } = renderSidePanel();

        result.current.open({ path: "products", id: 0, collection: products });

        expect(statuses).toEqual(["existing"]);
        // The record's id, as `defaultSelectedView` is handed it.
        expect(ids).toEqual([0]);
        expect(panels).toHaveLength(1);
        expect(panels[0].urlPath).toBe("/c/products/0#side");
    });

    it("can be copied", () => {
        const { result } = renderSidePanel();

        expect(() => result.current.open({ path: "products", id: 0, copy: true, collection: products }))
            .not.toThrow();
        expect(statuses).toEqual(["copy"]);
    });

    it("opens full screen at its own URL, not the new-record one", () => {
        const navigate = jest.fn();
        const navigation = fakeUrlController({ navigate });

        navigateToEntity({
            openEntityMode: "full_screen",
            path: "products",
            id: 0,
            selectedTab: "details",
            sidePanelController: {} as SidePanelController,
            navigation
        });

        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate.mock.calls[0][0]).toBe("/c/products/0/details");
    });
});
