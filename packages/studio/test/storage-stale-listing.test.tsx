/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StorageListResult } from "@rebasepro/types";
import { useEnTranslation } from "./en-translation";

/**
 * A listing that answers after the storage browser has moved on.
 *
 * Every listing asks for each file's metadata, so a large folder takes
 * seconds. A slow listing of the source (or folder) switched away from that
 * resolved after the new one replaced it: the picker said "Media" while the
 * grid held the default source's files, and their actions ran through Media
 * by the default source's paths.
 */

function listing(...names: string[]): StorageListResult {
    return {
        prefixes: [],
        items: names.map(fullPath => ({ name: fullPath, fullPath })) as StorageListResult["items"]
    };
}

let answerDefault: (result: StorageListResult) => void = () => undefined;

const defaultSource = {
    listObjects: jest.fn((_path: string) => new Promise<StorageListResult>(resolve => { answerDefault = resolve; })),
    getSignedUrl: jest.fn(async () => ({ url: null })),
    deleteObject: jest.fn(async (_path: string) => undefined)
};

const mediaSource = {
    listObjects: jest.fn(async (_path: string) => listing("clip.mp4")),
    getSignedUrl: jest.fn(async () => ({ url: null })),
    deleteObject: jest.fn(async (_path: string) => undefined)
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => useEnTranslation(),
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

describe("a listing that answers after the view moved on", () => {
    it("does not replace the listing of the source now selected", async () => {
        render(<StorageView/>);
        await waitFor(() => expect(defaultSource.listObjects).toHaveBeenCalled());

        fireEvent.change(screen.getByRole("combobox"), { target: { value: "media" } });
        await screen.findByText("clip.mp4");

        // The default source's listing, asked for first, answers last.
        await act(async () => {
            answerDefault(listing("old.png"));
        });

        expect(screen.queryByText("old.png")).toBeNull();
        expect(screen.getByText("clip.mp4")).toBeTruthy();
    });
});
