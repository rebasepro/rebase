/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The JS editor's "Run as" offered a user picker, and for a chosen user built a
 * client with the administrator's own token and nothing naming the user — so a
 * script run "as B" ran as the administrator. The picker also only ever listed
 * the signed-in user. It now lists the project's users for an administrator,
 * and a run as one of them goes out with `impersonate`, which the server
 * honours on the data API, functions and realtime and refuses everywhere else.
 */

const session: { roles: string[] } = { roles: ["admin"] };
const listUsersPaginated = jest.fn(async (_options?: { search?: string; limit?: number }) => ({
    users: [
        { uid: "admin-1", email: "admin@example.test", displayName: null, photoURL: null, providerId: "password", roles: ["admin"], createdAt: "", updatedAt: "" },
        { uid: "user-b", email: "b@example.test", displayName: null, photoURL: null, providerId: "password", roles: [], createdAt: "", updatedAt: "" }
    ],
    total: 2,
    limit: 50,
    offset: 0
}));
/** The options of every client the editor built for a run. */
const built: Array<Record<string, unknown>> = [];
/** How many of those clients were released after their run. */
let closed = 0;

jest.mock("@rebasepro/app", () => ({
    useRebaseContext: () => ({
        authController: { user: { uid: "admin-1", email: "admin@example.test", displayName: null, roles: session.roles } }
    }),
    useRebaseClient: () => ({ admin: { listUsersPaginated }, data: { whoami: "the administrator's own client" } }),
    useApiConfig: () => ({ apiUrl: "http://api.test", getAuthToken: async () => "admin-token" }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    useStudioUrlController: () => ({}),
    useStudioCollectionRegistry: () => ({ collections: [] }),
    useStudioSidePanelController: () => ({ open: jest.fn(), close: jest.fn() }),
    IconForView: () => null,
    ErrorView: ({ error }: { error: unknown }) => <div role="alert">{String(error)}</div>,
    // The real picker is a popover; a row of buttons is enough to choose from.
    UserSelectPopover: ({ users, onUserSelected }: {
        users: Array<{ uid: string; email?: string | null }>;
        onUserSelected: (user: { uid: string } | null) => void;
    }) => (
        <div>
            {users.map((user) => (
                <button key={user.uid} onClick={() => onUserSelected(user)}>{`Run as ${user.email}`}</button>
            ))}
        </div>
    )
}));

jest.mock("@rebasepro/client", () => ({
    createRebaseClient: (options: Record<string, unknown>) => {
        built.push(options);
        return {
            data: { whoami: "the scoped client" },
            setAuthTokenGetter: () => undefined,
            close: () => { closed += 1; }
        };
    },
    createMemoryStorage: () => ({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
}));

jest.mock("../src/components/JSEditor/JSMonacoEditor", () => ({
    JSMonacoEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
        <textarea aria-label="Script" value={value} onChange={(e) => onChange(e.target.value)}/>
    )
}));

import { JSEditor } from "../src/components/JSEditor/JSEditor";

function runScript(code: string) {
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: /Run$/ }));
}

beforeEach(() => {
    localStorage.clear();
    built.length = 0;
    closed = 0;
    listUsersPaginated.mockClear();
    session.roles = ["admin"];
});

describe("the JS editor's Run as", () => {
    it("runs a script as the chosen user through a client that impersonates them", async () => {
        render(<JSEditor/>);

        fireEvent.click(await screen.findByRole("button", { name: "Run as b@example.test" }));
        runScript("return client.data.whoami;");

        await waitFor(() => expect(built).toHaveLength(1));
        expect(built[0]).toEqual({
            baseUrl: "http://api.test",
            token: "admin-token",
            impersonate: "user-b",
            // Its own empty session: never the one the app saved.
            auth: expect.objectContaining({ persistSession: false, autoRefresh: false })
        });
        expect(await screen.findByText(/the scoped client/)).toBeTruthy();
        await waitFor(() => expect(closed).toBe(1));
    });

    it("runs as the administrator through their own client when nobody else is chosen", async () => {
        render(<JSEditor/>);
        await screen.findByRole("button", { name: "Run as b@example.test" });

        runScript("return client.data.whoami;");

        expect(await screen.findByText(/the administrator's own client/)).toBeTruthy();
        expect(built).toHaveLength(0);
    });

    it("offers nobody else to a user who is not an administrator", async () => {
        session.roles = ["editor"];
        render(<JSEditor/>);

        expect(await screen.findByRole("button", { name: "Run as admin@example.test" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Run as b@example.test" })).toBeNull();
        expect(listUsersPaginated).not.toHaveBeenCalled();
    });
});
