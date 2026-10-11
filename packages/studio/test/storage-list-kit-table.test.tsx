/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { StorageListResult } from "@rebasepro/types";
import { useEnTranslation } from "./en-translation";

/**
 * The storage browser's list view is the kit's table (`Table`, `TableHeader`,
 * `TableRow`, `TableCell`), not a hand-styled `<table>`: its header cells are
 * column headers (`th scope="col"`), and each file row still reaches the lazy
 * metadata observer through `TableRow`'s ref (see storage-lazy-metadata).
 */

const defaultSource = {
    listObjects: jest.fn(async (_path?: string): Promise<StorageListResult> => ({
        prefixes: [{ name: "docs", fullPath: "default/docs" }] as StorageListResult["prefixes"],
        items: [{ name: "logo.png", fullPath: "default/logo.png" }] as StorageListResult["items"]
    })),
    getSignedUrl: jest.fn(async () => ({ url: null })),
    deleteObject: jest.fn(async (_path: string) => undefined)
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => useEnTranslation(),
    useStorageSource: () => defaultSource,
    useStorageSources: () => ({ registry: {}, sources: { default: defaultSource } }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ apiUrl: "http://api.test", getAuthToken: async () => "token" }),
    ErrorView: () => null
}));

jest.mock("@rebasepro/ui", () => {
    const stub = jest.requireActual<Record<string, unknown>>("@rebasepro/ui");
    const overrides: Record<string, unknown> = {
        Tooltip: ({ title, children }: { title?: string; children: React.ReactNode }) =>
            <div title={title}>{children}</div>
    };
    return new Proxy(overrides, {
        get: (target, key: string | symbol) => typeof key === "string" && key in target ? target[key] : stub[key as string],
        has: () => true
    });
});

jest.mock("react-router", () => ({
    useSearchParams: () => [new URLSearchParams(), jest.fn()]
}));

/** Every element the lazy-metadata hook asks to watch. */
const observed: Element[] = [];
class RecordingObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(element: Element): void {
        observed.push(element);
        queueMicrotask(() => this.callback([{ target: element, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
}

import { StorageView } from "../src/components/StorageView/StorageView";

beforeEach(() => {
    observed.length = 0;
    Object.assign(globalThis, { IntersectionObserver: RecordingObserver });
});

afterEach(() => {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
});

describe("the storage list view", () => {
    jest.setTimeout(20000);

    async function openList() {
        render(<StorageView/>);
        await waitFor(() => expect(defaultSource.listObjects).toHaveBeenCalled());
        fireEvent.click(within(screen.getByTitle("List view")).getByRole("button"));
        return screen.findByRole("table");
    }

    it("is the kit table, with column headers", async () => {
        const table = await openList();
        const headers = within(table).getAllByRole("columnheader");
        expect(headers.length).toBe(5);
        expect(headers.map(header => header.getAttribute("scope"))).toEqual(["col", "col", "col", "col", "col"]);
        expect(within(table).getByRole("columnheader", { name: "Name" })).toBeTruthy();
    });

    it("hands each file row to the lazy-metadata observer", async () => {
        const table = await openList();
        const row = within(table).getByText("logo.png").closest("tr");
        await waitFor(() => expect(observed).toContain(row));
        expect(row?.getAttribute("data-storage-path")).toBe("default/logo.png");
    });
});
