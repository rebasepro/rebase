/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { StorageListResult } from "@rebasepro/types";

/**
 * Deleting a file from a row of the storage browser's list view.
 *
 * The preview panel and the bulk delete ask before deleting; the trash button
 * on a list row deleted the object on the first click — a button that shows
 * only on hover, where a tap on a touch screen lands without seeing it.
 */

const defaultSource = {
    listObjects: jest.fn(async (_path?: string): Promise<StorageListResult> => ({
        prefixes: [],
        items: [{ name: "logo.png", fullPath: "default/logo.png" }] as StorageListResult["items"]
    })),
    getSignedUrl: jest.fn(async () => ({ url: null })),
    deleteObject: jest.fn(async (_path: string) => undefined)
};

jest.mock("@rebasepro/app", () => ({
    useStorageSource: () => defaultSource,
    useStorageSources: () => ({ registry: {}, sources: { default: defaultSource } }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ apiUrl: "http://api.test", getAuthToken: async () => "token" }),
    ErrorView: () => null
}));

// The kit's stub, with a tooltip that keeps its title, so the view-mode
// buttons can be told apart, and the dialog's loading button a button.
jest.mock("@rebasepro/ui", () => {
    const stub = jest.requireActual<Record<string, unknown>>("@rebasepro/ui");
    const overrides: Record<string, unknown> = {
        Tooltip: ({ title, children }: { title?: string; children: React.ReactNode }) =>
            <div title={title}>{children}</div>,
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

describe("the list view's row delete", () => {
    jest.setTimeout(20000);
    it("asks before deleting, and deletes the row's file once confirmed", async () => {
        render(<StorageView/>);
        await waitFor(() => expect(defaultSource.listObjects).toHaveBeenCalled());

        const listViewButton = within(screen.getByTitle("List view")).getByRole("button");
        fireEvent.click(listViewButton);
        const row = (await screen.findByText("logo.png")).closest("tr");
        expect(row).not.toBeNull();

        fireEvent.click(within(row as HTMLElement).getByRole("button"));

        const prompt = await screen.findByText(/Are you sure you want to delete "logo.png"/);
        expect(defaultSource.deleteObject).not.toHaveBeenCalled();

        let dialog: HTMLElement | null = prompt.parentElement;
        while (dialog && !within(dialog).queryByRole("button", { name: /Delete/ })) dialog = dialog.parentElement;
        expect(dialog).not.toBeNull();
        fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: /Delete/ }));

        await waitFor(() => expect(defaultSource.deleteObject).toHaveBeenCalledTimes(1));
        expect(defaultSource.deleteObject).toHaveBeenCalledWith("default/logo.png");
        // A file is deleted as the object it is, not listed and deleted as a folder.
        expect(defaultSource.listObjects).not.toHaveBeenCalledWith("default/logo.png");
    });
});
