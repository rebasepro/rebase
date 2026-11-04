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

    // A record id is any string the database holds. The browser hands the
    // router a percent-encoded pathname, so `/c/products/café` arrives as
    // `/c/products/caf%C3%A9`; and an id holding `#` or `?` written into a URL
    // raw ends the path there, the rest read as the hash or the query.
    describe("record ids that are not URL-safe", () => {
        const c = () => build("/admin");

        const ids: [string, string, string][] = [
            ["a plain id", "B34SAP8Z", "B34SAP8Z"],
            ["a unicode id", "café", "caf%C3%A9"],
            ["an id with a space", "big chair", "big%20chair"],
            ["an id with #", "a#b", "a%23b"],
            ["an id with ?", "a?b", "a%3Fb"],
            ["an id with %", "50%", "50%25"],
            ["an id that reads as an escape", "%41", "%2541"]
        ];

        it.each(ids)("builds %s as one encoded segment", (_label, id, encoded) => {
            expect(c().buildUrlCollectionPath(`products/${id}`)).toBe(`/admin/c/products/${encoded}`);
            expect(c().buildUrlCollectionPath(`products/${id}/variants/${id}`))
                .toBe(`/admin/c/products/${encoded}/variants/${encoded}`);
        });

        it.each(ids)("reads %s back from the URL it builds", (_label, id) => {
            const dataPath = `products/${id}/variants/${id}`;
            expect(c().urlPathToDataPath(c().buildUrlCollectionPath(dataPath))).toBe(dataPath);
        });

        it("reads a pasted URL the browser encoded", () => {
            expect(c().urlPathToDataPath("/admin/c/products/caf%C3%A9")).toBe("products/café");
            expect(c().urlPathToDataPath("/admin/c/products/big%20chair/variants/a%23b")).toBe("products/big chair/variants/a#b");
        });

        it("keeps a segment whose escapes are malformed as it is", () => {
            expect(c().urlPathToDataPath("/admin/c/products/50%")).toBe("products/50%");
            expect(c().urlPathToDataPath("/admin/c/products/%E0%A4%A/variants/caf%C3%A9")).toBe("products/%E0%A4%A/variants/café");
        });

        it("never turns an encoded slash into a path separator", () => {
            expect(c().urlPathToDataPath("/admin/c/products/a%2Fb")).toBe("products/a%2Fb");
        });

        it("leaves collection slugs, slashes in slugs included, as they are", () => {
            expect(c().buildUrlCollectionPath("content/podcasts/abc123/episodes")).toBe("/admin/c/content/podcasts/abc123/episodes");
            expect(c().urlPathToDataPath("/admin/c/content/podcasts/abc123/episodes")).toBe("content/podcasts/abc123/episodes");
        });
    });
});
