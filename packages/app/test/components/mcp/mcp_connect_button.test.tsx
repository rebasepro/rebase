/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fakeAuthController, fakeUser } from "../../helpers/fakes";

/**
 * "Connect AI" in the drawer: who sees it, what it hands each client, and the
 * agents a person has connected.
 *
 * - Everyone signed in sees it while the backend serves `/mcp`; an agent signs
 *   in as them and is held to their row-level security.
 * - While `/mcp` is off only an administrator sees it, with how to turn it on.
 * - When the backend cannot be asked, nobody sees it.
 * - The URL is the one the server publishes, never one put together here.
 */

jest.mock("../../../src/hooks/useTranslation", () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, string>) => params ? `${key} ${JSON.stringify(params)}` : key
    })
}));

import { McpConnectButton } from "../../../src/components/mcp/McpConnectButton";
import { AuthControllerContext } from "../../../src/contexts/AuthControllerContext";
import { ApiConfigProvider } from "../../../src/hooks/ApiConfigContext";

const admin = fakeAuthController({ user: fakeUser({ uid: "admin-1", roles: ["admin"] }) });
const editor = fakeAuthController({ user: fakeUser({ uid: "editor-1", roles: ["editor"] }) });

/** jsdom has no `Response`: the fields the component reads, as the RLS simulator tests build them. */
function json(status: number, body: unknown): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: "",
        json: async () => {
            if (typeof body === "string") throw new SyntaxError("Unexpected token <");
            return body;
        }
    } as Response;
}

const fetchMock = jest.fn<typeof fetch>();

// The button lazy-loads its panel, and the first test pays for transforming it
// and the kit behind it: several seconds on a cold cache, past jest's default.
jest.setTimeout(30_000);

/** Each test gets its own backend origin: the status is asked once per origin per page. */
let origin = 0;
function nextApi(host = "api"): string {
    origin += 1;
    return `https://${host}${origin}.example.com`;
}

beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    document.title = "shop";
});

afterEach(() => {
    jest.restoreAllMocks();
});

/** Answers the discovery document and the grants routes, by URL. */
function backend(options: {
    metadata: { status: number; body?: unknown } | "unreachable";
    grants?: unknown[];
    onDelete?: (url: string) => void;
}) {
    let grants = options.grants ?? [];
    fetchMock.mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/.well-known/oauth-protected-resource/mcp")) {
            if (options.metadata === "unreachable") throw new TypeError("Failed to fetch");
            return json(options.metadata.status, options.metadata.body);
        }
        if (url.includes("/oauth/grants/") && init?.method === "DELETE") {
            options.onDelete?.(url);
            grants = [];
            return json(200, { revoked: true });
        }
        if (url.endsWith("/oauth/grants")) return json(200, { grants });
        return json(404, {});
    });
}

function renderButton(apiUrl: string, auth = editor) {
    return render(
        <ApiConfigProvider apiUrl={apiUrl} getAuthToken={async () => "session-token"}>
            <AuthControllerContext.Provider value={auth}>
                <McpConnectButton/>
            </AuthControllerContext.Provider>
        </ApiConfigProvider>
    );
}

describe("who sees Connect AI", () => {
    it("shows for anyone signed in while the backend serves /mcp", async () => {
        const api = nextApi();
        backend({ metadata: { status: 200, body: { resource: `${api}/mcp` } } });
        renderButton(api, editor);
        expect(await screen.findByRole("button", { name: "mcp_connect" })).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledWith(`${api}/.well-known/oauth-protected-resource/mcp`, expect.anything());
    });

    it("hides from a non-admin while /mcp is off", async () => {
        const api = nextApi();
        backend({ metadata: { status: 404 } });
        renderButton(api, editor);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(screen.queryByRole("button", { name: "mcp_connect" })).toBeNull();
    });

    it("shows an admin how to turn it on while /mcp is off", async () => {
        const api = nextApi();
        backend({ metadata: { status: 404 } });
        renderButton(api, admin);
        fireEvent.click(await screen.findByRole("button", { name: "mcp_connect" }));
        expect(await screen.findByText("mcp_off_title")).toBeTruthy();
        // Never a grants request for an endpoint that is not there.
        expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/oauth/grants"))).toBe(false);
    });

    it("shows nothing when the backend cannot be asked", async () => {
        const api = nextApi();
        backend({ metadata: "unreachable" });
        renderButton(api, admin);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(screen.queryByRole("button", { name: "mcp_connect" })).toBeNull();
    });

    it("treats a page served in the document's place as no endpoint", async () => {
        const api = nextApi();
        backend({ metadata: { status: 200, body: "<!doctype html>" } });
        renderButton(api, editor);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(screen.queryByRole("button", { name: "mcp_connect" })).toBeNull();
    });
});

describe("what it hands each client", () => {
    it("gives Claude Code the published URL, under the project's name", async () => {
        const api = nextApi();
        // Published under another address than the API's: a proxy, or REBASE_PUBLIC_URL.
        backend({ metadata: { status: 200, body: { resource: "https://shop.rebase.website/mcp" } } });
        renderButton(api);
        fireEvent.click(await screen.findByRole("button", { name: "mcp_connect" }));
        fireEvent.mouseDown(await screen.findByRole("tab", { name: "Claude Code" }));
        expect(await screen.findByText("claude mcp add --transport http shop https://shop.rebase.website/mcp")).toBeTruthy();
    });

    it("offers Claude and ChatGPT for a deployed server, and not for one on this machine", async () => {
        const remote = nextApi();
        backend({ metadata: { status: 200, body: { resource: "https://shop.rebase.website/mcp" } } });
        const first = renderButton(remote);
        fireEvent.click(await screen.findByRole("button", { name: "mcp_connect" }));
        expect(await screen.findByRole("tab", { name: "Claude" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "ChatGPT" })).toBeTruthy();
        first.unmount();

        const local = nextApi();
        backend({ metadata: { status: 200, body: { resource: "http://localhost:3609/mcp" } } });
        renderButton(local);
        fireEvent.click(await screen.findByRole("button", { name: "mcp_connect" }));
        expect(await screen.findByRole("tab", { name: "Claude Code" })).toBeTruthy();
        expect(screen.queryByRole("tab", { name: "Claude" })).toBeNull();
        expect(screen.queryByRole("tab", { name: "ChatGPT" })).toBeNull();
        expect(screen.getByText("mcp_connect_remote_only_local")).toBeTruthy();
        // Local: the name says so, as `rebase mcp connect` names it.
        expect(screen.getByText("claude mcp add --transport http shop-local http://localhost:3609/mcp")).toBeTruthy();
    });
});

describe("connected agents", () => {
    it("lists the live ones and disconnects one with the person's session", async () => {
        const api = nextApi();
        const deleted: string[] = [];
        backend({
            metadata: { status: 200, body: { resource: `${api}/mcp` } },
            grants: [
                { clientId: "mcp_live", clientName: "Claude Code", scope: "data:read", grantedAt: "2026-11-25T10:00:00Z", activeTokens: 1 },
                { clientId: "mcp_lapsed", clientName: "Old client", scope: "data:read", grantedAt: "2026-10-01T10:00:00Z", activeTokens: 0 }
            ],
            onDelete: (url) => deleted.push(url)
        });
        renderButton(api);
        fireEvent.click(await screen.findByRole("button", { name: "mcp_connect" }));
        expect(await screen.findByText("Claude Code", { selector: "p, span, div" })).toBeTruthy();
        expect(screen.queryByText("Old client")).toBeNull();

        const grantsCall = fetchMock.mock.calls.find(([input]) => String(input) === `${api}/api/oauth/grants`);
        expect(grantsCall?.[1]?.headers).toEqual({ Authorization: "Bearer session-token" });

        fireEvent.click(screen.getByRole("button", { name: "mcp_disconnect" }));
        await waitFor(() => expect(deleted).toEqual([`${api}/api/oauth/grants/mcp_live`]));
        expect(await screen.findByText("mcp_disconnected_note")).toBeTruthy();
        expect(screen.getByText("mcp_no_connected_agents")).toBeTruthy();
    });
});
