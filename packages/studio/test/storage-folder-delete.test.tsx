/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { StorageListResult, StorageReference } from "@rebasepro/types";
import { useEnTranslation } from "./en-translation";

/**
 * Listing and deleting folders in the storage browser, against a store that
 * answers the way an object store does: a page at a time, and a folder made
 * with "New folder" held by a zero-byte `name/` marker.
 *
 * The browser read one page of every listing. A folder past the page size was
 * shown cut short with no sign of more, and "Delete" — "the folder and all of
 * its contents" — deleted the first page of each level and reported the folder
 * deleted. On S3 and GCS the folder's own marker was never deleted, so a
 * folder made in Studio came back after every delete. And success was
 * reported without looking: what was still there after a delete was announced
 * as deleted.
 */

const PAGE_SIZE = 2;

function reference(fullPath: string): StorageReference {
    return { name: fullPath.split("/").pop() ?? fullPath, fullPath } as StorageReference;
}

/** An in-memory bucket listed with a `/` delimiter, `PAGE_SIZE` entries a page. */
function objectStore(keys: string[], options: { undeletable?: string[] } = {}) {
    const objects = new Set(keys);

    const entries = (prefix: string) => {
        const base = prefix ? `${prefix}/` : "";
        const folders = new Set<string>();
        const files: string[] = [];
        for (const key of [...objects].sort()) {
            if (!key.startsWith(base)) continue;
            const rest = key.slice(base.length);
            // The listed folder's own marker is not something in it.
            if (rest === "") continue;
            const slash = rest.indexOf("/");
            if (slash === -1) files.push(key);
            else folders.add(base + rest.slice(0, slash));
        }
        return [
            ...[...folders].map(fullPath => ({ folder: true, fullPath })),
            ...files.map(fullPath => ({ folder: false, fullPath }))
        ];
    };

    return {
        objects,
        listObjects: jest.fn(async (prefix: string, page?: { pageToken?: string }): Promise<StorageListResult> => {
            const all = entries(prefix);
            const start = page?.pageToken ? Number(page.pageToken) : 0;
            const slice = all.slice(start, start + PAGE_SIZE);
            return {
                prefixes: slice.filter(e => e.folder).map(e => reference(e.fullPath)),
                items: slice.filter(e => !e.folder).map(e => reference(e.fullPath)),
                nextPageToken: start + PAGE_SIZE < all.length ? String(start + PAGE_SIZE) : undefined
            };
        }),
        getSignedUrl: jest.fn(async () => ({ url: null })),
        deleteObject: jest.fn(async (key: string) => {
            // A delete that answers success and removes nothing: a hook, a
            // lock, a directory that is not empty yet.
            if (options.undeletable?.includes(key)) return;
            objects.delete(key);
        })
    };
}

let store = objectStore([]);
const snackbarOpen = jest.fn();

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => useEnTranslation(),
    useStorageSource: () => store,
    useStorageSources: () => ({ registry: {}, sources: { default: store } }),
    useSnackbarController: () => ({ open: snackbarOpen }),
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

// The view reads its folder from the URL; the router itself is not under test.
jest.mock("react-router", () => ({
    useSearchParams: () => [new URLSearchParams(), jest.fn()]
}));

import { StorageView } from "../src/components/StorageView/StorageView";

/** Select `name` in the grid, press the toolbar's Delete, and confirm. */
async function deleteFromGrid(name: string) {
    fireEvent.click(await screen.findByText(name));
    await screen.findByText("1 selected");
    // The toolbar's Delete comes first; the dialog's is inside the prompt's box.
    fireEvent.click(screen.getAllByRole("button", { name: /Delete/ })[0]);

    const prompt = await screen.findByText("Delete 1 item?");
    let dialog: HTMLElement | null = prompt.parentElement;
    while (dialog && !within(dialog).queryByRole("button", { name: /Delete/ })) dialog = dialog.parentElement;
    expect(dialog).not.toBeNull();
    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: /Delete/ }));
}

const messages = (type: "success" | "error") =>
    snackbarOpen.mock.calls
        .map(([arg]) => arg as { type: string; message: string })
        .filter(call => call.type === type)
        .map(call => call.message);

describe("folders in the storage browser", () => {
    jest.setTimeout(20000);

    beforeEach(() => {
        snackbarOpen.mockClear();
    });

    it("lists every page of a folder", async () => {
        store = objectStore(["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]);
        render(<StorageView/>);

        for (const name of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]) {
            expect(await screen.findByText(name)).toBeTruthy();
        }
        expect(screen.getByText("5 files")).toBeTruthy();
    });

    it("deletes every file in a folder, past the first page of each level", async () => {
        store = objectStore([
            "big/1.txt", "big/2.txt", "big/3.txt",
            "big/inner/1.txt", "big/inner/2.txt", "big/inner/3.txt",
            "keep.txt"
        ]);
        render(<StorageView/>);

        await deleteFromGrid("big");

        await waitFor(() => expect(messages("success")).toEqual(["1 item deleted"]));
        expect([...store.objects]).toEqual(["keep.txt"]);
        expect(messages("error")).toEqual([]);
    });

    it("deletes the marker that holds a folder made with New folder", async () => {
        store = objectStore(["reports/", "reports/q3.pdf", "keep.txt"]);
        render(<StorageView/>);

        await deleteFromGrid("reports");

        await waitFor(() => expect(messages("success")).toEqual(["1 item deleted"]));
        expect([...store.objects]).toEqual(["keep.txt"]);
        await waitFor(() => expect(screen.queryByText("reports")).toBeNull());
    });

    it("says what is still there instead of reporting it deleted", async () => {
        store = objectStore(["locked/a.txt", "locked/b.txt", "keep.txt"], { undeletable: ["locked/b.txt"] });
        render(<StorageView/>);

        await deleteFromGrid("locked");

        await waitFor(() => expect(messages("error")).toEqual(["“locked” is still there after the delete"]));
        expect(messages("success")).toEqual([]);
        expect(screen.getByText("locked")).toBeTruthy();
    });
});
