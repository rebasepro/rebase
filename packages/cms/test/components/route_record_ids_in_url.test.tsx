/**
 * @jest-environment jsdom
 *
 * A record whose id is not URL-safe opens from its URL, and the URLs the route
 * writes for it lead back to it.
 *
 * The browser percent-encodes the pathname it hands the router: a link to the
 * record `café` arrives as `/c/products/caf%C3%A9`, and the route read the id
 * `caf%C3%A9`, a record that does not exist. Going the other way, an id holding
 * `#` or `?` written into a URL raw ended the path there, so a tab change on
 * the record `a#b` navigated to the record `a` with the hash `#b/__json`.
 */
import { fakeCollectionRegistry } from "../helpers/fakes";
import React from "react";
import { act } from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { CollectionRegistryController } from "@rebasepro/types";

type BlockerArgs = {
    currentLocation: { pathname: string, hash: string },
    nextLocation: { pathname: string, hash: string }
};

const mockVariants = {
    slug: "variants",
    name: "Variants",
    properties: { name: { type: "string", name: "Name" } }
} as AdminCollection<Record<string, unknown>>;

const mockProducts = {
    slug: "products",
    name: "Products",
    properties: { name: { type: "string", name: "Name" } },
    childCollections: () => [mockVariants]
} as AdminCollection<Record<string, unknown>>;

const mockRegistry = fakeCollectionRegistry([mockProducts], {
    getCollection: (slug: string) => slug === "products" ? mockProducts : slug === "variants" ? mockVariants : undefined
});

const mockBlocker: { shouldBlock?: (args: BlockerArgs) => boolean } = {};

type RecordViewProps = {
    entityId?: string | number,
    selectedTab?: string,
    onTabChange?: (params: { selectedTab?: string }) => void,
    onSaved?: (params: { id?: string | number, selectedTab?: string }) => void,
    onValuesModified?: (modified: boolean) => void
};

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useUserConfigurationPersistence: () => undefined,
        useCustomizationController: () => ({ collectionViews: [] }),
        useComponentOverride: (_key: string, fallback: unknown) => fallback,
        useNavigationBlocker: (shouldBlock: (args: BlockerArgs) => boolean) => {
            mockBlocker.shouldBlock = shouldBlock;
            return { state: "unblocked" };
        },
        useTranslation: () => ({ t: (key: string) => key })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/components/lazy_record_views", () => ({
    LazyCollectionViewBinding: (props: { selectedEntityId?: string | number, selectedTab?: string }) =>
        <div data-testid="collection-view">{`selected ${props.selectedEntityId} tab ${props.selectedTab ?? "-"}`}</div>,
    LazyEditViewBinding: (props: RecordViewProps) => <div>
        <div data-testid="full-screen-record">{`record ${props.entityId} tab ${props.selectedTab ?? "-"}`}</div>
        <button onClick={() => props.onTabChange?.({ selectedTab: "__json" })}>json tab</button>
        <button onClick={() => props.onSaved?.({ id: "new id#1" })}>save</button>
        <button onClick={() => props.onValuesModified?.(true)}>modify</button>
    </div>,
    LazyDetailViewBinding: () => <div data-testid="detail-view"/>
}));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => mockRegistry
}));
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => {
    const { useBuildUrlController } = jest.requireActual<typeof import("../../src/hooks/navigation/useBuildUrlController")>(
        "../../src/hooks/navigation/useBuildUrlController"
    );
    return {
        useUrlController: () => useBuildUrlController({
            basePath: "/",
            baseCollectionPath: "/c",
            collectionRegistryController: mockRegistry
        })
    };
});
jest.mock("../../src/hooks/useBreadcrumbsController", () => ({ useBreadcrumbsController: () => ({ set: () => undefined }) }));
jest.mock("../../src/hooks/navigation/contexts/NavigationStateContext", () => ({
    useNavigationStateController: () => ({ navigationLoadingError: undefined, refreshNavigation: () => undefined })
}));

import { RebaseRoute } from "../../src/routes/RebaseRoute";

function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location">{location.pathname + location.hash}</div>;
}

function renderAt(url: string) {
    render(<MemoryRouter initialEntries={[url]}>
        <RebaseRoute/>
        <LocationProbe/>
    </MemoryRouter>);
}

// Each id as the database holds it, and as the browser's pathname carries it.
const ids: [string, string, string][] = [
    ["a plain id", "B34SAP8Z", "B34SAP8Z"],
    ["a unicode id", "café", "caf%C3%A9"],
    ["an id with a space", "big chair", "big%20chair"],
    ["an id with #", "a#b", "a%23b"],
    ["an id with ?", "a?b", "a%3Fb"],
    ["an id with %", "50%", "50%25"]
];

describe("a record whose id is not URL-safe, opened from its URL", () => {

    beforeEach(() => {
        mockBlocker.shouldBlock = undefined;
    });

    it.each(ids)("opens %s full screen", async (_label, id, encoded) => {
        renderAt(`/c/products/${encoded}#full`);
        expect((await screen.findByTestId("full-screen-record")).textContent).toBe(`record ${id} tab -`);
    });

    it.each(ids)("opens %s beside the list", async (_label, id, encoded) => {
        renderAt(`/c/products/${encoded}`);
        expect((await screen.findByTestId("collection-view")).textContent).toBe(`selected ${id} tab -`);
    });

    it.each(ids)("reads the tab after %s", async (_label, id, encoded) => {
        renderAt(`/c/products/${encoded}/__json#full`);
        expect((await screen.findByTestId("full-screen-record")).textContent).toBe(`record ${id} tab __json`);
    });

    it.each(ids)("reads the tab after %s beside the list", async (_label, id, encoded) => {
        renderAt(`/c/products/${encoded}/__json`);
        expect((await screen.findByTestId("collection-view")).textContent).toBe(`selected ${id} tab __json`);
    });

    it.each(ids)("opens a subcollection record under %s", async (_label, id, encoded) => {
        renderAt(`/c/products/${encoded}/variants/${encoded}#full`);
        expect((await screen.findByTestId("full-screen-record")).textContent).toBe(`record ${id} tab -`);
    });

    it("reads an id the browser left with a bare %", async () => {
        renderAt("/c/products/50%#full");
        expect((await screen.findByTestId("full-screen-record")).textContent).toBe("record 50% tab -");
    });

    it.each(ids)("changes the tab of %s without leaving the record", async (_label, _id, encoded) => {
        renderAt(`/c/products/${encoded}#full`);
        await screen.findByTestId("full-screen-record");
        act(() => screen.getByText("json tab").click());
        expect(screen.getByTestId("location").textContent).toBe(`/c/products/${encoded}/__json#full`);
    });

    it("writes the id a new record is saved under as one segment", async () => {
        renderAt("/c/products#new");
        await screen.findByTestId("full-screen-record");
        act(() => screen.getByText("save").click());
        expect(screen.getByTestId("location").textContent).toBe("/c/products/new%20id%231");
    });

    it.each(ids)("lets %s, once edited, move between its own tabs, and asks before leaving it", async (_label, id, encoded) => {
        renderAt(`/c/products/${encoded}#full`);
        await screen.findByTestId("full-screen-record");
        act(() => screen.getByText("modify").click());
        const shouldBlock = mockBlocker.shouldBlock!;
        const currentLocation = { pathname: `/c/products/${encoded}`, hash: "#full" };

        expect(shouldBlock({ currentLocation, nextLocation: { pathname: `/c/products/${encoded}/__json`, hash: "#full" } })).toBe(false);
        expect(shouldBlock({ currentLocation, nextLocation: { pathname: `/c/products/${encoded}/edit`, hash: "" } })).toBe(false);
        // The same record, its id written by a router that does not encode.
        expect(shouldBlock({ currentLocation, nextLocation: { pathname: `/c/products/${id}/__json`, hash: "" } })).toBe(false);

        expect(shouldBlock({ currentLocation, nextLocation: { pathname: "/c/products", hash: "" } })).toBe(true);
        expect(shouldBlock({ currentLocation, nextLocation: { pathname: `/c/products/${encoded}x`, hash: "" } })).toBe(true);
    });

    it("lets a side panel close back onto an edited record", async () => {
        renderAt("/c/products/caf%C3%A9#full");
        await screen.findByTestId("full-screen-record");
        act(() => screen.getByText("modify").click());
        expect(mockBlocker.shouldBlock!({
            currentLocation: { pathname: "/c/products/caf%C3%A9", hash: "#side" },
            nextLocation: { pathname: "/c/products", hash: "" }
        })).toBe(false);
    });
});
