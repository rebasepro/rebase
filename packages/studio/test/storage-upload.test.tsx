/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { StorageListResult } from "@rebasepro/types";
import { useEnTranslation } from "./en-translation";

/**
 * Uploading into the storage browser, against an in-memory folder.
 *
 * An upload or delete that failed part-way reported the failure and left the
 * listing as it was before: the files that had been uploaded, or deleted,
 * before the failure were not shown as such until a manual refresh.
 */

function folder(names: string[], options: { failingUploads?: string[] } = {}) {
    const objects = new Set(names);
    return {
        objects,
        listObjects: jest.fn(async (_prefix: string): Promise<StorageListResult> => ({
            prefixes: [],
            items: [...objects].sort().map(fullPath => ({ name: fullPath, fullPath })) as StorageListResult["items"]
        })),
        getSignedUrl: jest.fn(async () => ({ url: null })),
        deleteObject: jest.fn(async (key: string) => { objects.delete(key); }),
        putObject: jest.fn(async ({ file, key }: { file: File; key: string }) => {
            if (options.failingUploads?.includes(file.name)) throw new Error(`upload of ${file.name} refused`);
            objects.add(key);
        })
    };
}

let store = folder([]);
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

jest.mock("react-router", () => ({
    useSearchParams: () => [new URLSearchParams(), jest.fn()]
}));

import { StorageView } from "../src/components/StorageView/StorageView";

/** Drop `names` onto the folder being shown. */
async function drop(names: string[]) {
    const files = names.map(name => new File(["x"], name, { type: "text/plain" }));
    const input = document.querySelector("input[type=file]");
    const root = input?.parentElement;
    if (!root) throw new Error("no drop zone");
    await act(async () => {
        fireEvent.drop(root, {
            dataTransfer: {
                files,
                items: files.map(file => ({ kind: "file", type: file.type, getAsFile: () => file })),
                types: ["Files"]
            }
        });
    });
}

/** The dialog box holding `text`, and its `answer` button pressed. */
async function answer(text: string, button: string) {
    let box: HTMLElement | null = (await screen.findByText(text)).parentElement;
    while (box && !within(box).queryByRole("button", { name: button })) box = box.parentElement;
    if (!box) throw new Error(`no "${button}" beside "${text}"`);
    const pressed = within(box).getByRole("button", { name: button });
    await act(async () => { fireEvent.click(pressed); });
}

const errors = () => snackbarOpen.mock.calls
    .map(([arg]) => arg as { type: string; message: string })
    .filter(call => call.type === "error")
    .map(call => call.message);

describe("uploading in the storage browser", () => {
    beforeEach(() => {
        snackbarOpen.mockClear();
    });

    it("lists the files that were uploaded before an upload failed", async () => {
        store = folder(["existing.txt"], { failingUploads: ["second.txt"] });
        render(<StorageView/>);
        await screen.findByText("existing.txt");

        await drop(["first.txt", "second.txt"]);

        await waitFor(() => expect(errors()).toEqual(["upload of second.txt refused"]));
        expect(await screen.findByText("first.txt")).toBeTruthy();
    });
});

/**
 * An upload is a put, and a put over an existing name replaced the file
 * without a word.
 */
describe("uploading over a file that is already there", () => {
    beforeEach(() => {
        snackbarOpen.mockClear();
    });

    it("asks first, and replaces nothing when told not to", async () => {
        store = folder(["report.pdf"]);
        render(<StorageView/>);
        await screen.findByText("report.pdf");

        await drop(["report.pdf", "notes.txt"]);

        expect(await screen.findByText("Replace 1 file?")).toBeTruthy();
        expect(screen.getByText(/“report.pdf” is already in this folder/)).toBeTruthy();
        expect(store.putObject).not.toHaveBeenCalled();

        await answer("Replace 1 file?", "Cancel");
        expect(store.putObject).not.toHaveBeenCalled();
    });

    it("replaces once told to", async () => {
        store = folder(["report.pdf"]);
        render(<StorageView/>);
        await screen.findByText("report.pdf");

        await drop(["report.pdf"]);
        await answer("Replace 1 file?", "Replace");

        await waitFor(() => expect(store.putObject).toHaveBeenCalledTimes(1));
    });

    it("does not ask when every name is new", async () => {
        store = folder(["report.pdf"]);
        render(<StorageView/>);
        await screen.findByText("report.pdf");

        await drop(["notes.txt"]);

        await waitFor(() => expect(store.putObject).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(/Replace 1 file/)).toBeNull();
    });
});

/**
 * The list view is a list on the sheet, and a list row has no fill of its own
 * (packages/ui/DESIGN.md). Its rows were the kit's card rows — every row
 * filled — so the list read as a stack of cards.
 */
describe("the storage list view", () => {
    it("draws its rows with no fill of their own", async () => {
        store = folder(["report.pdf"]);
        render(<StorageView/>);
        await screen.findByText("report.pdf");

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "List view" })); });

        const row = (await screen.findByText("report.pdf")).closest("tr");
        expect(row).not.toBeNull();
        expect(row!.className).not.toMatch(/(^|\s)bg-surface-card(\s|$)/);
        expect(row!.closest("tbody")!.className).not.toMatch(/(^|\s)bg-surface-card(\s|$)/);
    });
});
