/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DownloadConfig, StorageListResult } from "@rebasepro/types";
import { useEnTranslation } from "./en-translation";

/**
 * The link the storage browser's preview shows, downloads and copies.
 *
 * A private file's URL carries a download token, five minutes by default. The
 * preview, its Download button and its "Copy URL" all used the URL minted when
 * the folder was listed, so on a page left open past the token's life the
 * preview broke, Download opened a 401 and the copied link was dead. While it
 * did work, the link opened the file for anyone who had it — and it was shown
 * exactly like a public file's permanent link.
 */

let minted = 0;

/** A private file's link: a fresh token on every call, as the server mints them. */
const privateLink = async (): Promise<DownloadConfig> => {
    minted++;
    return {
        url: `http://files.test/api/storage/file/report.png?token=t${minted}`,
        metadata: { token: `t${minted}`, tokenExpiresIn: 300, contentType: "image/png", size: 10 } as DownloadConfig["metadata"]
    };
};

let files: string[] = [];

const source = {
    listObjects: jest.fn(async (): Promise<StorageListResult> => ({
        prefixes: [],
        items: files.map(fullPath => ({ name: fullPath.split("/").pop() ?? fullPath, fullPath })) as StorageListResult["items"]
    })),
    getSignedUrl: jest.fn(async (fullPath: string): Promise<DownloadConfig> =>
        fullPath.startsWith("public/")
            ? { url: `http://files.test/api/storage/file/${fullPath}` }
            : privateLink()),
    deleteObject: jest.fn(async (_path: string) => undefined)
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

// The view reads its folder from the URL; the router itself is not under test.
jest.mock("react-router", () => ({
    useSearchParams: () => [new URLSearchParams(), jest.fn()]
}));

import { StorageView } from "../src/components/StorageView/StorageView";

const writeText = jest.fn(async (_text: string) => undefined);
const open = jest.fn((_url?: string | URL, _target?: string) => null);

/** The last token a link was minted with. */
const lastToken = () => `t${minted}`;

describe("the preview's link", () => {
    jest.setTimeout(20000);

    beforeEach(() => {
        minted = 0;
        files = ["report.png"];
        writeText.mockClear();
        open.mockClear();
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        window.open = open as typeof window.open;
    });

    it("previews a file with a link minted when it is opened, not when it was listed", async () => {
        render(<StorageView/>);
        fireEvent.click(await screen.findByText("report.png"));

        // t1 is the listing's; opening the file mints t2.
        await waitFor(() => expect(lastToken()).toBe("t2"));
        await waitFor(() => {
            const sources = screen.getAllByAltText("report.png").map(img => img.getAttribute("src"));
            expect(sources).toContain("http://files.test/api/storage/file/report.png?token=t2");
        });
        expect(screen.getByText("http://files.test/api/storage/file/report.png?token=t2")).toBeTruthy();
    });

    it("copies a link minted at the click", async () => {
        render(<StorageView/>);
        fireEvent.click(await screen.findByText("report.png"));
        const shown = await screen.findByText("http://files.test/api/storage/file/report.png?token=t2");

        fireEvent.click(shown);

        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect(writeText).toHaveBeenCalledWith("http://files.test/api/storage/file/report.png?token=t3");
    });

    it("downloads through a link minted at the click", async () => {
        render(<StorageView/>);
        fireEvent.click(await screen.findByText("report.png"));
        await screen.findByText("http://files.test/api/storage/file/report.png?token=t2");

        fireEvent.click(screen.getByRole("button", { name: "Download" }));

        await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
        expect(open.mock.calls[0][0]).toBe("http://files.test/api/storage/file/report.png?token=t3");
    });

    it("says a private file's link is temporary and opens the file for whoever has it", async () => {
        render(<StorageView/>);
        fireEvent.click(await screen.findByText("report.png"));

        expect(await screen.findByText(/Temporary link: anyone who has it can open this file for up to 5 min/)).toBeTruthy();
        expect(screen.queryByText(/Public link/)).toBeNull();
    });

    it("says a public file's link is permanent and open to anyone", async () => {
        files = ["public/logo.png"];
        render(<StorageView/>);
        fireEvent.click(await screen.findByText("logo.png"));

        expect(await screen.findByText(/Public link: anyone can open this file, and the link does not expire/)).toBeTruthy();
        expect(screen.queryByText(/Temporary link/)).toBeNull();
    });
});
