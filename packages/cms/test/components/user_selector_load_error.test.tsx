/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The user picker hid its failure: a `GET /admin/users` answered with 403 or
 * 500 showed "No users found.", which says something false about the
 * installation. It now says the list could not be loaded, and why.
 */
beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
        observe() { /* no layout in jsdom */ }
        unobserve() { /* no layout in jsdom */ }
        disconnect() { /* no layout in jsdom */ }
    };
});

const CLIENT = { baseUrl: "http://api.test" };
const AUTH = { getAuthToken: async () => "token" };

jest.mock("@rebasepro/app", () => ({
    apiBaseOf: () => "http://api.test/api",
    useTranslation: () => ({ t: (key: string) => key }),
    useRebaseClient: () => CLIENT,
    useAuthController: () => AUTH,
    UserDisplay: ({ user }: { user: { uid: string } }) => <span data-testid="user">{user.uid}</span>
}));

jest.mock("../../src/preview", () => ({
    EmptyValue: () => <span data-testid="empty-value">—</span>
}));

import { UserSelector } from "../../src/components/UserSelector";

afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
});

describe("UserSelector when the list cannot be loaded", () => {
    it("says so, with the server's reason, instead of 'No users found'", async () => {
        (globalThis as { fetch?: unknown }).fetch = (async () => ({
            ok: false,
            status: 403,
            json: async () => ({ error: { message: "Missing scope users:read", code: "FORBIDDEN" } })
        })) as never;

        render(<UserSelector/>);
        await act(async () => {
            fireEvent.click(screen.getByRole("button"));
        });

        await waitFor(() => expect(screen.getByRole("alert").textContent)
            .toBe("Could not load users: Missing scope users:read"));
        expect(screen.queryByText("No users found.")).toBeNull();
    });
});
