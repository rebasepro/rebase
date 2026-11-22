/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The API explorer's "Try it" panel pre-filled every request with a
 * `rebase-branch` header that nothing on the server reads — so every request
 * carried an empty header, and the panel suggested a branch switch that does
 * not exist.
 */

/** Who is signed in, and the client the panel lists users through — per test. */
const session: { user: { uid: string; email: string; roles: string[] } | null; client: unknown } = {
    user: null,
    client: undefined
};

/** What the host says about the tools — per test; the admin panel's default unless set. */
const host: { capabilities: StudioCapabilities } = { capabilities: { codebase: true } };

jest.mock("@rebasepro/app", () => ({
    useStudioCapabilities: () => host.capabilities,
    toPublicApiUrl: jest.requireActual<typeof import("../../app/src/hooks/useStudioBridge")>(
        "../../app/src/hooks/useStudioBridge"
    ).toPublicApiUrl,
    useRebaseContext: () => ({ authController: { user: session.user } }),
    useTranslation: () => ({ t: (key: string) => key }),
    useRebaseClient: () => session.client,
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

import { TryItPanel } from "../src/components/ApiExplorer/TryItPanel";
import type { ParsedEndpoint } from "../src/components/ApiExplorer/types";
import type { StudioCapabilities } from "@rebasepro/app";

const listPosts: ParsedEndpoint = {
    id: "get-data-posts",
    method: "get",
    path: "/data/posts",
    shortPath: "/posts",
    summary: "List posts",
    description: "",
    tags: ["posts"],
    parameters: [],
    responses: {}
};

const fetchMock = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response("{}", { status: 200, statusText: "OK" }));

beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
    global.fetch = fetchMock;
    session.user = null;
    session.client = undefined;
    host.capabilities = { codebase: true };
});

describe("a fresh Try-it request", () => {
    it("sends no header the caller did not add", async () => {
        render(
            <TryItPanel
                endpoint={listPosts}
                apiUrl="http://api.test"
                getAuthToken={async () => null}
                user={null}
            />
        );

        // The admin panel's own choices, which the service-key host drops.
        expect(screen.getByRole("button", { name: /No Auth/ })).toBeTruthy();
        expect(screen.getByText("http://api.test/data/posts")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /Send Request/ }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const [, init] = fetchMock.mock.calls[0];
        expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    });
});

describe("running a request as another user", () => {
    it("offers an administrator the project's users and sends the chosen one's uid in x-rebase-impersonate", async () => {
        session.user = { uid: "admin-1", email: "admin@example.test", roles: ["admin"] };
        const listUsersPaginated = jest.fn(async (_options?: { search?: string; limit?: number }) => ({
            users: [
                { uid: "admin-1", email: "admin@example.test", displayName: null, photoURL: null, providerId: "password", roles: ["admin"], createdAt: "", updatedAt: "" },
                { uid: "user-b", email: "b@example.test", displayName: null, photoURL: null, providerId: "password", roles: [], createdAt: "", updatedAt: "" },
                { uid: "user-gone", email: "gone@example.test", displayName: null, photoURL: null, providerId: "password", roles: [], disabled: true, createdAt: "", updatedAt: "" }
            ],
            total: 3,
            limit: 50,
            offset: 0
        }));
        session.client = { admin: { listUsersPaginated } };

        render(
            <TryItPanel
                endpoint={listPosts}
                apiUrl="http://api.test"
                getAuthToken={async () => "admin-token"}
                user={null}
            />
        );

        fireEvent.click(await screen.findByRole("button", { name: "Run as b@example.test" }));
        // Nobody to run as who would be refused: a disabled account is not offered.
        expect(screen.queryByRole("button", { name: "Run as gone@example.test" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: /Send Request/ }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const [, init] = fetchMock.mock.calls[0];
        expect(init?.headers).toEqual({
            "Content-Type": "application/json",
            Authorization: "Bearer admin-token",
            "x-rebase-impersonate": "user-b"
        });
    });

    it("lists nobody else for a user who is not an administrator", async () => {
        session.user = { uid: "member-1", email: "member@example.test", roles: ["editor"] };
        const listUsersPaginated = jest.fn(async () => ({ users: [], total: 0, limit: 50, offset: 0 }));
        session.client = { admin: { listUsersPaginated } };

        render(
            <TryItPanel
                endpoint={listPosts}
                apiUrl="http://api.test"
                getAuthToken={async () => "member-token"}
                user={null}
            />
        );

        expect(await screen.findByRole("button", { name: "Run as member@example.test" })).toBeTruthy();
        expect(listUsersPaginated).not.toHaveBeenCalled();
    });
});

describe("under a host whose requests all run as a service key", () => {
    /*
     * The hosted console: a proxy swaps the console's session for the
     * project's service key. A request with no credential is refused there,
     * and the server refuses x-rebase-impersonate from a service key, so
     * neither "No Auth" nor "Run as" may be offered.
     */
    beforeEach(() => {
        host.capabilities = {
            codebase: false,
            requestIdentity: { kind: "service-key", publicApiOrigin: "https://my-app.example.com" }
        };
    });

    it("says it runs as the service key and offers neither No Auth nor Run as", async () => {
        session.user = { uid: "admin-1", email: "admin@example.test", roles: ["admin"] };
        session.client = { admin: { listUsersPaginated: jest.fn(async () => ({ users: [], total: 0, limit: 50, offset: 0 })) } };

        render(
            <TryItPanel
                endpoint={listPosts}
                apiUrl="https://console.test/api/functions/studio/p1/proxy"
                getAuthToken={async () => "console-session"}
                user={null}
                basePath="/api"
            />
        );

        expect(screen.getByText("studio_auth_service_key")).toBeTruthy();
        expect(screen.queryByRole("button", { name: /No Auth/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /JWT Token/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /^Run as / })).toBeNull();
    });

    it("sends the host's credential and no impersonation header, to the proxy", async () => {
        render(
            <TryItPanel
                endpoint={listPosts}
                apiUrl="https://console.test/api/functions/studio/p1/proxy"
                getAuthToken={async () => "console-session"}
                user={null}
                basePath="/api"
            />
        );

        fireEvent.click(screen.getByRole("button", { name: /Send Request/ }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe("https://console.test/api/functions/studio/p1/proxy/api/data/posts");
        expect(init?.headers).toEqual({
            "Content-Type": "application/json",
            Authorization: "Bearer console-session"
        });
    });

    it("shows the project's public URL, not the proxy's", () => {
        render(
            <TryItPanel
                endpoint={listPosts}
                apiUrl="https://console.test/api/functions/studio/p1/proxy"
                getAuthToken={async () => "console-session"}
                user={null}
                basePath="/api"
            />
        );

        expect(screen.getByText("https://my-app.example.com/api/data/posts")).toBeTruthy();
        expect(screen.queryByText(/console\.test/)).toBeNull();
    });
});
