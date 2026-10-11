/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
