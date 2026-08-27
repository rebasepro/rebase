/**
 * @jest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router";
import { useBuildUrlController } from "../../src/hooks/navigation/useBuildUrlController";
import { CollectionRegistryController } from "@rebasepro/types";
import { CollectionRegistry } from "@rebasepro/common";

const mockRegistry = {
    collections: [],
    collectionRegistryRef: { current: new CollectionRegistry() }
} as Partial<CollectionRegistryController> as CollectionRegistryController;

function build(basePath: string) {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(MemoryRouter, null, children);
    return renderHook(() => useBuildUrlController({
        basePath,
        baseCollectionPath: "/c",
        collectionRegistryController: mockRegistry
    }), { wrapper }).result.current;
}

describe("useBuildUrlController", () => {
    describe("root basePath (\"/\")", () => {
        const c = () => build("/");

        it("builds collection URLs without a prefix", () => {
            expect(c().buildUrlCollectionPath("products")).toBe("/c/products");
        });

        it("recognizes collection paths and maps them to data paths", () => {
            expect(c().isUrlCollectionPath("/c/products")).toBe(true);
            expect(c().urlPathToDataPath("/c/products")).toBe("products");
        });
    });

    describe("prefixed basePath (\"/admin\")", () => {
        const c = () => build("/admin");

        it("builds collection URLs with the prefix", () => {
            expect(c().buildUrlCollectionPath("products")).toBe("/admin/c/products");
        });

        it("builds app URLs with the prefix", () => {
            expect(c().buildAppUrlPath("schema")).toBe("/admin/schema");
        });

        it("home URL is the prefix", () => {
            expect(c().homeUrl).toBe("/admin");
        });

        // The regression that caused the "spinner forever, no data fetch" hang:
        // a prefixed location must still be recognized as a collection path.
        it("recognizes prefixed collection paths and strips the prefix for the data path", () => {
            expect(c().isUrlCollectionPath("/admin/c/products")).toBe(true);
            expect(c().urlPathToDataPath("/admin/c/products")).toBe("products");
        });

        it("does not treat a non-collection prefixed path as a collection path", () => {
            expect(c().isUrlCollectionPath("/admin/schema")).toBe(false);
        });
    });
});
