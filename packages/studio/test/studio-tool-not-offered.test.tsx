/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { FakeResponse } from "./helpers/fakeResponse";
import { useEnTranslation } from "./en-translation";

/**
 * A backend may leave a Studio tool's API out on purpose, and every route of
 * it then answers 404 "Not found". Each pane used to say so its own way — a
 * red "Not found" banner over an empty list that still offered "Create
 * Webhook", the same over "Create your first table", inline red text inside
 * every Database section. These assert that each says the one calm thing
 * instead, and offers nothing to create.
 */

jest.mock("@rebasepro/app", () => ({
    useApiBase: () => "/api",
    useApiConfig: () => ({ apiUrl: "http://localhost:3000", getAuthToken: async () => "test-token" }),
    useAuthController: () => ({ getAuthToken: async () => "test-token" }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useTranslation: () => useEnTranslation(),
    useTableDescriptors: () => ({ status: "ready", tables: [] }),
    ConfirmationDialog: () => null
}));

import { WebhooksView } from "../src/components/Webhooks/WebhooksView";
import { TableEditorView } from "../src/components/TableEditor/TableEditorView";
import { FunctionsSection } from "../src/components/Database/FunctionsSection";

const originalFetch = globalThis.fetch;

/** A server with none of the tool's routes: every request is a 404 "Not found". */
function serveNothing() {
    globalThis.fetch = jest.fn<typeof fetch>(async () => new FakeResponse({
        status: 404,
        statusText: "Not Found",
        json: { error: { code: "NOT_FOUND", message: "Not found" } }
    }));
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function expectNotOffered() {
    expect(screen.getByText(/This server does not offer this tool/)).toBeTruthy();
    // The bare "Not found" adds nothing under that title, and is not an error.
    expect(screen.queryByText("Not found")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
}

describe("a Studio tool the server does not offer", () => {
    it("Webhooks says so, and offers no webhook to create", async () => {
        serveNothing();
        render(<WebhooksView/>);

        expect(await screen.findByText("Not available on this server")).toBeTruthy();
        expectNotOffered();
        // The stubbed kit renders the closed create dialog too, whose submit
        // stays disabled with no name typed; the empty state's button is live.
        expect(screen.queryAllByRole("button", { name: "Create Webhook" }).filter(button => !button.hasAttribute("disabled"))).toEqual([]);
        expect(screen.queryByText("New Webhook")).toBeNull();
        expect(screen.queryByText(/No webhooks configured yet/)).toBeNull();
    });

    it("Tables says so, and offers no first table to create", async () => {
        serveNothing();
        render(<TableEditorView/>);

        expect(await screen.findByText("Not available on this server")).toBeTruthy();
        expectNotOffered();
        expect(screen.queryByText(/Create your first table/)).toBeNull();
        expect(screen.queryByText(/No user tables yet/)).toBeNull();
    });

    it("a Database section says so in place of its rows", async () => {
        serveNothing();
        render(<FunctionsSection/>);

        expect(await screen.findByText("Not available on this server")).toBeTruthy();
        expectNotOffered();
    });
});
