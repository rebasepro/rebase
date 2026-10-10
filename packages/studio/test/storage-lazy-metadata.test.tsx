/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DownloadConfig, StorageListResult, StorageReference } from "@rebasepro/types";
import { useEnTranslation } from "./en-translation";

/**
 * What opening a folder in the storage browser asks the server for.
 *
 * The browser asked for every file's metadata — one `/storage/metadata/<key>`
 * request per file, an auth hook and a HEAD on the bucket each — and showed
 * nothing until the last had answered: a folder of 1,000 files was 1,001
 * requests and about eight seconds of a spinner. Deleting a folder deleted its
 * files one request at a time.
 *
 * The listing is shown as it comes back. Metadata — the size, the type, the
 * thumbnail's link — is asked for the files on screen, a few at a time.
 */

const FILE_COUNT = 500;
/** How many of the files the (fake) viewport shows. */
const ON_SCREEN = 12;

function reference(fullPath: string): StorageReference {
    return { name: fullPath.split("/").pop() ?? fullPath, fullPath } as StorageReference;
}

const names = Array.from({ length: FILE_COUNT }, (_, index) => `photo-${String(index).padStart(3, "0")}.png`);

/** Metadata requests: who asked, how many were open at once, and a way to answer them. */
let inFlight = 0;
let maxInFlight = 0;
let pending: (() => void)[] = [];
/** Answer each metadata request as it is asked, instead of holding it in {@link pending}. */
let answerAtOnce = false;
const getSignedUrl = jest.fn((path: string) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<DownloadConfig>(resolve => {
        const answer = () => {
            inFlight--;
            resolve({ url: `http://files.test/${path}?token=t`, metadata: { size: 2048, contentType: "image/png" } } as DownloadConfig);
        };
        if (answerAtOnce) answer();
        else pending.push(answer);
    });
});

let deletesInFlight = 0;
let maxDeletesInFlight = 0;
const objects = new Set<string>();
const deleteObject = jest.fn(async (key: string) => {
    deletesInFlight++;
    maxDeletesInFlight = Math.max(maxDeletesInFlight, deletesInFlight);
    await new Promise(resolve => setTimeout(resolve, 1));
    objects.delete(key);
    deletesInFlight--;
});

const source = {
    listObjects: jest.fn(async (prefix: string): Promise<StorageListResult> => {
        const base = prefix ? `${prefix}/` : "";
        const folders = new Set<string>();
        const items: StorageReference[] = [];
        for (const key of [...objects].sort()) {
            if (!key.startsWith(base)) continue;
            const rest = key.slice(base.length);
            if (rest === "") continue;
            const slash = rest.indexOf("/");
            if (slash === -1) items.push(reference(key));
            else folders.add(base + rest.slice(0, slash));
        }
        return { prefixes: [...folders].map(reference), items };
    }),
    getSignedUrl,
    deleteObject
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

// The dialog's confirm button is a `LoadingButton`, which the kit's stub
// renders as a plain div; here it is a button that can be pressed.
jest.mock("@rebasepro/ui", () => {
    const stub = jest.requireActual<Record<string, unknown>>("@rebasepro/ui");
    const overrides: Record<string, unknown> = {
        LoadingButton: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) =>
            <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
    };
    return new Proxy(overrides, {
        get: (target, key: string | symbol) => typeof key === "string" && key in target ? target[key] : stub[key as string],
        has: () => true
    });
});

jest.mock("react-router", () => ({
    useSearchParams: () => [new URLSearchParams(), jest.fn()]
}));

/**
 * A viewport that shows the first {@link ON_SCREEN} files: jsdom lays nothing
 * out, so what is "on screen" is decided here, by the file's name.
 */
class ViewportObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}

    observe(element: Element): void {
        const label = element.textContent ?? "";
        const index = names.findIndex(name => label.includes(name));
        const isIntersecting = index >= 0 && index < ON_SCREEN;
        queueMicrotask(() => this.callback([{ target: element, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
}

import { StorageView } from "../src/components/StorageView/StorageView";

beforeEach(() => {
    inFlight = 0;
    maxInFlight = 0;
    pending = [];
    answerAtOnce = false;
    deletesInFlight = 0;
    maxDeletesInFlight = 0;
    getSignedUrl.mockClear();
    deleteObject.mockClear();
    objects.clear();
    Object.assign(globalThis, { IntersectionObserver: ViewportObserver });
});

afterEach(() => {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
});

/** Answer every metadata request asked so far, and the ones they let start. */
async function answerAll(): Promise<void> {
    while (pending.length > 0) {
        await act(async () => {
            const answering = pending;
            pending = [];
            answering.forEach(answer => answer());
        });
    }
}

describe("opening a folder of 500 files", () => {
    jest.setTimeout(30000);

    it("shows the files before any of their metadata has answered", async () => {
        names.forEach(name => objects.add(name));
        render(<StorageView/>);

        expect(await screen.findByText("500 files")).toBeTruthy();
        expect(screen.getByText(names[0])).toBeTruthy();
        expect(screen.getByText(names[FILE_COUNT - 1])).toBeTruthy();
    });

    it("asks for the metadata of the files on screen only, a few at a time", async () => {
        names.forEach(name => objects.add(name));
        render(<StorageView/>);
        await screen.findByText("500 files");

        await answerAll();
        await waitFor(() => expect(getSignedUrl).toHaveBeenCalledTimes(ON_SCREEN));

        expect(getSignedUrl.mock.calls.map(([path]) => path).sort()).toEqual(names.slice(0, ON_SCREEN));
        expect(maxInFlight).toBeGreaterThan(1);
        expect(maxInFlight).toBeLessThanOrEqual(6);
    });

    it("shows a file's size once its metadata answers", async () => {
        names.forEach(name => objects.add(name));
        render(<StorageView/>);
        await screen.findByText("500 files");

        await answerAll();

        const card = screen.getByText(names[0]).parentElement as HTMLElement;
        await waitFor(() => expect(within(card).getByText("2.0 KB")).toBeTruthy());
    });
});

describe("deleting a folder of 40 files", () => {
    jest.setTimeout(30000);

    it("deletes several files at once, never more than eight", async () => {
        answerAtOnce = true;
        for (let index = 0; index < 40; index++) objects.add(`album/${index}.png`);
        objects.add("keep.txt");
        render(<StorageView/>);

        fireEvent.click(await screen.findByText("album"));
        await screen.findByText("1 selected");
        fireEvent.click(screen.getAllByRole("button", { name: /Delete/ })[0]);
        const prompt = await screen.findByText("Delete 1 item?");
        let dialog: HTMLElement | null = prompt.parentElement;
        while (dialog && !within(dialog).queryByRole("button", { name: /Delete/ })) dialog = dialog.parentElement;
        fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: /Delete/ }));

        await waitFor(() => expect([...objects]).toEqual(["keep.txt"]));
        expect(maxDeletesInFlight).toBeGreaterThan(1);
        expect(maxDeletesInFlight).toBeLessThanOrEqual(8);
    });
});
