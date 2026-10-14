/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { createRebaseClient } from "@rebasepro/client";
import type { RebaseAuthController } from "../../src/auth/types";
import { useRebaseAuthController } from "../../src/auth/useRebaseAuthController";

/**
 * An anonymous page load of the generated app asks the server about a session
 * at most once per browser.
 *
 * The template builds its client in cookie mode, in a `useMemo` under
 * `<React.StrictMode>`. Every load of a visitor who never signed in sent
 * `POST /auth/refresh` once per client the page built, and the server refused
 * each with `401 NO_SESSION`: two or three errors in the console and as many
 * lines in the backend's log, per page view, for a visitor with nothing to
 * refresh. Anything that then asked the auth controller for a token sent one
 * more.
 *
 * The first load in a browser still has to ask: the refresh cookie is HttpOnly,
 * so only the server can say there is none. After it has said so, a load asks
 * nothing, and neither does a request for a token.
 */

const API = "http://api.test";

let paths: string[] = [];

function json(body: unknown, status = 200) {
    return {
        ok: status < 400,
        status,
        statusText: String(status),
        headers: { get: () => "application/json" },
        json: async () => body,
        text: async () => JSON.stringify(body)
    } as unknown as Response;
}

beforeEach(() => {
    paths = [];
    localStorage.clear();
    global.fetch = (async (input: RequestInfo | URL) => {
        const path = String(input).slice(API.length);
        paths.push(path);
        if (path === "/api/auth/refresh") return json({ error: { code: "NO_SESSION", message: "No refresh token presented" } }, 401);
        if (path === "/api/auth/config") return json({ needsSetup: false, registrationEnabled: false, enabledProviders: [] });
        return json({ error: { code: "UNAUTHORIZED", message: "unauthorized" } }, 401);
    }) as typeof fetch;
});

const refreshes = () => paths.filter(p => p === "/api/auth/refresh").length;

/** The generated `App.tsx`, as far as auth goes. */
async function loadPage(): Promise<{ controller: () => RebaseAuthController, unmount: () => void }> {
    const held: { current?: RebaseAuthController } = {};
    const closers: (() => void)[] = [];
    function App() {
        const rebaseClient = React.useMemo(() => {
            const client = createRebaseClient({ baseUrl: API, auth: { authFlowMode: "cookie" } });
            closers.push(() => client.close());
            return client;
        }, []);
        held.current = useRebaseAuthController({ client: rebaseClient });
        return null;
    }
    const view = render(<React.StrictMode><App/></React.StrictMode>);
    // Until the restore on load has settled.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    return {
        controller: () => held.current!,
        unmount: () => {
            view.unmount();
            closers.forEach(close => close());
        }
    };
}

describe("an anonymous load of the generated app", () => {
    it("asks about a session on the first visit, and not on the next", async () => {
        const first = await loadPage();
        expect(first.controller().user).toBeNull();
        expect(refreshes()).toBeGreaterThan(0);
        first.unmount();

        paths = [];
        const second = await loadPage();
        expect(second.controller().user).toBeNull();
        expect(second.controller().initialLoading).toBe(false);
        expect(refreshes()).toBe(0);
        second.unmount();
    });

    it("sends no refresh for a token nobody can have", async () => {
        const first = await loadPage();
        first.unmount();

        paths = [];
        const second = await loadPage();
        await expect(second.controller().getAuthToken()).rejects.toMatchObject({ code: "NOT_SIGNED_IN" });
        expect(refreshes()).toBe(0);
        second.unmount();
    });
});
