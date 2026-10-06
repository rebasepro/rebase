/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The JS editor builds its own client for a run under "No Auth" and for a run
 * as another user. Both used to be built with the SDK's default auth, which
 * restores the session the app saved in `localStorage`: a "No Auth" run went
 * out with the signed-in administrator's token, and a run as another user
 * carried the administrator's session in `client.auth`. These run the real
 * client, against a stored session, and look at what reached the network.
 */

const STORED_SESSION = JSON.stringify({
    accessToken: "STORED-ADMIN-TOKEN",
    refreshToken: "stored-refresh-token",
    expiresAt: Date.now() + 3_600_000,
    user: { uid: "admin-1", email: "admin@example.test", roles: ["admin"] }
});

const listUsersPaginated = jest.fn(async () => ({
    users: [
        { uid: "admin-1", email: "admin@example.test", displayName: null, photoURL: null, roles: ["admin"] },
        { uid: "user-b", email: "b@example.test", displayName: null, photoURL: null, roles: [] }
    ],
    total: 2,
    limit: 50,
    offset: 0
}));

/** Stable across renders, as the real contexts are. */
const appContext = {
    authController: { user: { uid: "admin-1", email: "admin@example.test", displayName: null, roles: ["admin"] } }
};
const appClient = { admin: { listUsersPaginated } };
const apiConfig = { apiUrl: "http://api.test", apiPath: "/api", getAuthToken: async () => "admin-token" };

jest.mock("@rebasepro/app", () => ({
    useRebaseContext: () => appContext,
    useRebaseClient: () => appClient,
    useApiConfig: () => apiConfig,
    useSnackbarController: () => ({ open: jest.fn() }),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    useStudioUrlController: () => ({}),
    useStudioCollectionRegistry: () => ({ collections: [] }),
    useStudioSidePanelController: () => ({ open: jest.fn(), close: jest.fn() }),
    IconForView: () => null,
    ErrorView: ({ error }: { error: unknown }) => <div role="alert">{String(error)}</div>,
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

jest.mock("../src/components/JSEditor/JSMonacoEditor", () => ({
    JSMonacoEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
        <textarea aria-label="Script" value={value} onChange={(e) => onChange(e.target.value)}/>
    )
}));

import { JSEditor } from "../src/components/JSEditor/JSEditor";

/** The headers of every request the run's client sent. */
let requests: Array<{ url: string; headers: Record<string, string> }>;

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("rebase_auth", STORED_SESSION);
    requests = [];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
        return {
            status: 200,
            ok: true,
            statusText: "OK",
            headers: { get: () => null },
            text: async () => JSON.stringify({ data: [], meta: { total: 0, limit: 1, offset: 0, hasMore: false } })
        } as unknown as Response;
    }) as typeof fetch;
});

function runScript(code: string) {
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: /Run$/ }));
}

const PROBE = `
await client.data.collection("posts").find({ limit: 1 });
const session = client.auth.getSession();
// Joined at run time, so the marker is in the result and not in the script.
return ["ran", "as"].join("-") + " " + (session ? "session:" + session.user.uid : "no session") + " / user:" + (context.user ? context.user.uid : "none");
`;

describe("a run's own client", () => {
    it("under No Auth sends no credential, has no session, and says it runs as nobody", async () => {
        render(<JSEditor/>);
        fireEvent.click(screen.getByRole("button", { name: "No Auth" }));

        runScript(PROBE);

        expect((await screen.findByText(/ran-as /)).textContent).toContain("no session / user:none");
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe("http://api.test/api/data/posts?limit=1");
        expect(requests[0].headers.Authorization).toBeUndefined();
        expect(localStorage.getItem("rebase_auth")).toBe(STORED_SESSION);
    });

    it("as another user sends the administrator's token naming that user, and carries no session of its own", async () => {
        render(<JSEditor/>);
        fireEvent.click(await screen.findByRole("button", { name: "Run as b@example.test" }));

        runScript(PROBE);

        expect((await screen.findByText(/ran-as /)).textContent).toContain("no session / user:user-b");
        await waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0].headers.Authorization).toBe("Bearer admin-token");
        expect(requests[0].headers["x-rebase-impersonate"]).toBe("user-b");
        expect(localStorage.getItem("rebase_auth")).toBe(STORED_SESSION);
    });
});
