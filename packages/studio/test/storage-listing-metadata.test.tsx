/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { DownloadConfig, StorageListResult, StorageReference } from "@rebasepro/types";
import { useEnTranslation } from "./en-translation";

/**
 * The storage browser draws a folder from its listing.
 *
 * The built-in sources' listings carry each file's size, version and (except
 * on S3) type, so the browser no longer asks the server for a file's metadata
 * just to show its row: a folder of documents makes no metadata request at
 * all. What still asks is a file the listing did not describe — a custom
 * source's bare listing — and, in the grid, an image, whose thumbnail is drawn
 * from the link the request mints.
 */

/** What the fake source's listing says of each file. */
let listed: StorageReference[] = [];

const getSignedUrl = jest.fn(async (path: string): Promise<DownloadConfig> => ({
    url: `http://files.test/${path}?token=t`,
    metadata: { size: 4096, contentType: "image/png" }
} as DownloadConfig));

const source = {
    listObjects: jest.fn(async (): Promise<StorageListResult> => ({ prefixes: [], items: listed })),
    getSignedUrl,
    deleteObject: jest.fn(async () => undefined)
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => useEnTranslation(),
    useStorageSource: () => source,
    useStorageSources: () => ({ registry: {}, sources: { default: source } }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ apiUrl: "http://api.test", getAuthToken: async () => "token" }),
    ErrorView: () => null
}));

jest.mock("react-router", () => ({
    useSearchParams: () => [new URLSearchParams(), jest.fn()]
}));

/** Every file is on screen. */
class EverythingVisible {
    constructor(private readonly callback: IntersectionObserverCallback) {}

    observe(element: Element): void {
        queueMicrotask(() => this.callback([{ target: element, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
}

import { StorageView } from "../src/components/StorageView/StorageView";

const describedFile = (name: string, size: number, contentType?: string): StorageReference => ({
    name,
    fullPath: name,
    size,
    updated: "2026-10-01T12:00:00.000Z",
    ...(contentType ? { contentType } : {})
} as StorageReference);

const bareFile = (name: string): StorageReference => ({ name, fullPath: name } as StorageReference);

/** Let the observer's microtasks and any requests they started settle. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
    listed = [];
    getSignedUrl.mockClear();
    source.listObjects.mockClear();
    Object.assign(globalThis, { IntersectionObserver: EverythingVisible });
});

afterEach(() => {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
});

describe("a folder whose listing describes its files", () => {
    it("shows each document's size from the listing and asks the server nothing more", async () => {
        listed = Array.from({ length: 30 }, (_, i) => describedFile(`report-${String(i).padStart(2, "0")}.pdf`, 2048, "application/pdf"));
        render(<StorageView/>);

        expect(await screen.findByText("30 files")).toBeTruthy();
        const card = screen.getByText("report-00.pdf").parentElement as HTMLElement;
        expect(within(card).getByText("2.0 KB")).toBeTruthy();
        await settle();

        expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it("asks only for the images' thumbnails in the grid", async () => {
        listed = [
            ...Array.from({ length: 10 }, (_, i) => describedFile(`doc-${i}.pdf`, 1024, "application/pdf")),
            ...Array.from({ length: 4 }, (_, i) => describedFile(`photo-${i}.png`, 2048, "image/png")),
            // An S3 listing carries no type: the extension says it is an image.
            describedFile("scan.jpg", 3072)
        ];
        render(<StorageView/>);
        await screen.findByText("15 files");

        await waitFor(() => expect(getSignedUrl).toHaveBeenCalledTimes(5));
        await settle();
        expect(getSignedUrl.mock.calls.map(([path]) => path).sort())
            .toEqual(["photo-0.png", "photo-1.png", "photo-2.png", "photo-3.png", "scan.jpg"]);
    });

    it("still asks per file when the listing describes nothing — a custom source", async () => {
        listed = Array.from({ length: 6 }, (_, i) => bareFile(`blob-${i}.bin`));
        render(<StorageView/>);
        await screen.findByText("6 files");

        await waitFor(() => expect(getSignedUrl).toHaveBeenCalledTimes(6));
        const card = screen.getByText("blob-0.bin").parentElement as HTMLElement;
        await waitFor(() => expect(within(card).getByText("4.0 KB")).toBeTruthy());
    });
});
