/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { StorageListResult } from "@rebasepro/types";

/**
 * Switching the storage browser to another storage source.
 *
 * The folder path is kept, but what was picked in it belongs to the source
 * switched away from. The open preview and the selection outlived the switch,
 * and their Delete runs through the selected source: a file opened in
 * "default" was deleted, by its path, from "media".
 */

function source(files: string[]) {
    return {
        listObjects: jest.fn(async (): Promise<StorageListResult> => ({
            prefixes: [],
            items: files.map(fullPath => ({ name: fullPath.split("/").pop() ?? fullPath, fullPath })) as StorageListResult["items"]
        })),
        getSignedUrl: jest.fn(async () => ({ url: null })),
        deleteObject: jest.fn(async (_path: string) => undefined)
    };
}

const defaultSource = source(["default/logo.png"]);
const mediaSource = source(["default/logo.png", "default/other.png"]);

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

const previewPrompt = /Are you sure you want to delete "logo.png"/;

describe("switching storage source", () => {
    it("closes the preview and drops the selection made in the other source", async () => {
        render(<StorageView/>);
        await waitFor(() => expect(defaultSource.listObjects).toHaveBeenCalled());

        // Open logo.png from the default source: it is previewed and selected.
        fireEvent.click((await screen.findAllByText("logo.png"))[0]);
        await waitFor(() => expect(screen.getByText(previewPrompt)).toBeTruthy());
        expect(screen.getByText("1 selected")).toBeTruthy();

        fireEvent.change(screen.getByRole("combobox"), { target: { value: "media" } });
        await waitFor(() => expect(mediaSource.listObjects).toHaveBeenCalled());
        await screen.findByText("other.png");

        expect(screen.queryByText(previewPrompt)).toBeNull();
        expect(screen.queryByText("1 selected")).toBeNull();
        expect(mediaSource.deleteObject).not.toHaveBeenCalled();
        expect(defaultSource.deleteObject).not.toHaveBeenCalled();
    });

    it("deletes a file opened after the switch from the source it was opened in", async () => {
        render(<StorageView/>);
        await waitFor(() => expect(defaultSource.listObjects).toHaveBeenCalled());
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "media" } });
        fireEvent.click(await screen.findByText("other.png"));

        const prompt = await screen.findByText(/Are you sure you want to delete "other.png"/);
        let dialog: HTMLElement | null = prompt.parentElement;
        while (dialog && !within(dialog).queryByRole("button", { name: "Delete" })) dialog = dialog.parentElement;
        expect(dialog).not.toBeNull();
        fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "Delete" }));

        await waitFor(() => expect(mediaSource.deleteObject).toHaveBeenCalledWith("default/other.png"));
        expect(defaultSource.deleteObject).not.toHaveBeenCalled();
    });
});
