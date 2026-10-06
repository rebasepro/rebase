/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

/**
 * A thumbnail of a stored image asks the storage file route for a resized
 * rendition (`?width=…&format=webp`), not the full-size original: a table page
 * of 100 rows of 3 MB photos shown at 40 px downloaded ~300 MB.
 *
 * The resize needs `sharp`, an optional dependency; a server without it
 * answers 500. So whether a server resizes is learned once, from one probe,
 * before any thumbnail asks — a server that cannot resize sees one failed
 * request per page load, not one per row.
 */

let origin = "https://one.example.com";
const contentTypes: Record<string, string> = {};
const getSignedUrl = jest.fn(async (key: string) => ({
    url: `${origin}/api/storage/file/${key}?token=t`,
    metadata: { contentType: contentTypes[key] ?? "image/jpeg" }
}));

jest.mock("@rebasepro/app", () => {
    const source = { getSignedUrl };
    const sources = { registry: {}, sources: {} };
    const overrides: Record<string, unknown> = {
        useStorageSource: () => source,
        useStorageSources: () => sources
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { StorageThumbnail } from "../../src/preview/components/StorageThumbnail";

/** The probe images the thumbnails construct; each settles as `serverResizes` says. */
const probes: string[] = [];
let serverResizes = true;
class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
        probes.push(value);
        setTimeout(() => (serverResizes ? this.onload?.() : this.onerror?.()), 0);
    }
}

let site = 0;
beforeEach(() => {
    // A fresh server per test: what a server can do is remembered per origin.
    origin = `https://server-${++site}.example.com`;
    probes.length = 0;
    serverResizes = true;
    Object.defineProperty(window, "Image", { value: FakeImage, configurable: true, writable: true });
});

function thumbnails(paths: string[]) {
    return render(<div>{paths.map(path =>
        <StorageThumbnail key={path} storagePathOrDownloadUrl={path} storeUrl={false} size="small"/>)}</div>);
}

async function sources(container: HTMLElement, count: number): Promise<string[]> {
    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(count));
    return Array.from(container.querySelectorAll("img")).map(img => img.getAttribute("src") ?? "");
}

describe("a thumbnail of a stored image", () => {
    it("asks for a small webp rendition, not the original", async () => {
        const paths = Array.from({ length: 20 }, (_, i) => `photos/${i}.jpg`);
        const { container } = thumbnails(paths);

        const srcs = await sources(container, 20);
        for (const [i, src] of srcs.entries()) {
            expect(src).toBe(`${origin}/api/storage/file/photos/${i}.jpg?token=t&width=96&format=webp`);
        }
        expect(probes).toHaveLength(1);
    });

    it("shows originals, after a single probe, on a server that cannot resize", async () => {
        serverResizes = false;
        // Other paths than the test above: the thumbnail remembers what it drew per path.
        const paths = Array.from({ length: 20 }, (_, i) => `other/${i}.jpg`);
        const { container } = thumbnails(paths);

        const srcs = await sources(container, 20);
        for (const src of srcs) expect(src).not.toContain("width=");
        expect(probes).toHaveLength(1);
    });

    it("leaves an SVG or a GIF as it is, with no probe", async () => {
        contentTypes["art/logo.svg"] = "image/svg+xml";
        contentTypes["art/loop.gif"] = "image/gif";
        const { container } = thumbnails(["art/logo.svg", "art/loop.gif"]);

        for (const src of await sources(container, 2)) expect(src).not.toContain("width=");
        expect(probes).toHaveLength(0);
    });

    it("leaves a URL that is not the storage file route alone", async () => {
        getSignedUrl.mockImplementationOnce(async () => ({
            url: "https://firebasestorage.example.com/v0/b/x/o/a.jpg?alt=media",
            metadata: { contentType: "image/jpeg" }
        }));
        const { container } = thumbnails(["elsewhere/a.jpg"]);

        expect(await sources(container, 1)).toEqual(["https://firebasestorage.example.com/v0/b/x/o/a.jpg?alt=media"]);
        expect(probes).toHaveLength(0);
    });

    it("falls back to the original when its rendition fails", async () => {
        const { container } = thumbnails(["photos/odd.jpg"]);
        const [src] = await sources(container, 1);
        expect(src).toContain("width=96");

        act(() => {
            fireEvent.error(container.querySelector("img")!);
        });
        expect(container.querySelector("img")?.getAttribute("src")).toBe(`${origin}/api/storage/file/photos/odd.jpg?token=t`);
    });
});
