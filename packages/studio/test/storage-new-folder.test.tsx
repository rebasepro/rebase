/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StorageListResult } from "@rebasepro/types";

/**
 * "New folder" in the storage browser, with a second storage source picked.
 *
 * Every other action in the view goes through the selected source, which
 * routes its requests by `storageId`. Creating a folder is a direct `POST
 * /storage/folder`, and it sent no `storageId` — so with "media" selected the
 * folder was made in the default backend, reported as created, and was not
 * there when the listing of "media" came back.
 */

function source() {
    return {
        listObjects: jest.fn(async (): Promise<StorageListResult> => ({ prefixes: [], items: [] })),
        getSignedUrl: jest.fn(async () => ({ url: null }))
    };
}

const defaultSource = source();
const mediaSource = source();

jest.mock("@rebasepro/app", () => ({
    useStorageSource: () => defaultSource,
    useStorageSources: () => ({
        registry: { media: { key: "media", label: "Media" } },
        sources: { default: defaultSource, media: mediaSource }
    }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ apiUrl: "http://api.test", getAuthToken: async () => "token" }),
    ErrorView: () => null
}));

// The view reads its folder from the URL; the router itself is not under test.
jest.mock("react-router", () => ({
    useSearchParams: () => [new URLSearchParams(), jest.fn()]
}));

import { StorageView } from "../src/components/StorageView/StorageView";

const fetchMock = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ message: "Folder created" }), { status: 201 }));

beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock;
});

/** Name a folder and press Enter, then return the body the view POSTed. */
async function createFolder(name: string): Promise<Record<string, unknown>> {
    fireEvent.change(screen.getByPlaceholderText("Enter folder name"), { target: { value: name } });
    fireEvent.keyDown(screen.getByPlaceholderText("Enter folder name"), { key: "Enter" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://api.test/api/storage/folder");
    return JSON.parse(String(init?.body));
}

describe("creating a folder", () => {
    it("creates it in the storage source that is selected", async () => {
        render(<StorageView/>);
        await waitFor(() => expect(defaultSource.listObjects).toHaveBeenCalled());

        fireEvent.change(screen.getByRole("combobox"), { target: { value: "media" } });
        await waitFor(() => expect(mediaSource.listObjects).toHaveBeenCalled());

        expect(await createFolder("reports")).toEqual({ path: "default/reports", storageId: "media" });
    });

    it("names no source when the default one is selected", async () => {
        render(<StorageView/>);
        await waitFor(() => expect(defaultSource.listObjects).toHaveBeenCalled());

        expect(await createFolder("reports")).toEqual({ path: "default/reports" });
    });
});
