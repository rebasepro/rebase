/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, afterEach } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { AuthChangeEvent, RebaseClient, RebaseSession, StorageSourceDefinition } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { Rebase, useAuthController, useRebaseAuthController } from "@rebasepro/app";

import { RebaseCMS } from "../../src/components/RebaseCMS";
import { RebaseNavigation } from "../../src/components/RebaseNavigation";

/**
 * What the panel asks the backend when it loads, for a user who is not an
 * admin.
 *
 * Every page load by such a user, on a deployment without storage, sent
 * three requests that could only fail:
 *
 * - `GET /storage/sources` answered 501 and was logged at ERROR.
 * - `GET /admin/schema/status` and `GET /schema-editor/status` answered 403.
 *
 * Together they filled the logs with errors nobody could act on. The panel
 * already reads what it needs to skip them: `GET /auth/config` says whether
 * there is storage, and `GET /auth/scopes` says whether this user may read the
 * schema.
 *
 * The admin case runs in the same harness, so the test cannot pass by
 * observing nothing. With the scope and the storage, all three requests go out.
 */

const API = "https://api.example.com/api";
const REFUSED = ["/storage/sources", "/admin/schema/status", "/schema-editor/status"];

const posts = {
    slug: "posts",
    name: "Posts",
    properties: { title: { type: "string", name: "Title" } }
} as unknown as AdminCollection;

interface Backend {
    /** `held` from `GET /auth/scopes`. */
    held: string[];
    /** `storage` from `GET /auth/config`. */
    storage: boolean;
}

/** Every URL the shell asked for, in order. */
let requested: string[] = [];

/** One fetch for the whole shell, answering as the backend described would. */
function serve(backend: Backend) {
    requested = [];
    const json = (body: unknown, status = 200) => ({
        ok: status < 400,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body)
    }) as unknown as Response;

    global.fetch = (async (input: string) => {
        const url = String(input);
        requested.push(url);
        const path = url.slice(API.length);
        if (path === "/auth/config") {
            return json({
                hasBuiltInAuthRoutes: true,
                emailPasswordLogin: true,
                registrationEnabled: false,
                passwordReset: false,
                adminPasswordReset: true,
                sessionManagement: true,
                profileUpdate: true,
                emailVerification: false,
                magicLink: false,
                anonymousLogin: false,
                enabledProviders: [],
                storage: backend.storage
            });
        }
        if (path === "/auth/scopes") return json({ scopes: [], held: backend.held });
        if (path === "/storage/sources") return json({ data: [], configured: backend.storage });
        if (path === "/admin/schema/status") return json({ enabled: false, canPlan: false, canApply: false });
        if (path === "/schema-editor/status") return json({ enabled: false });
        return json({ error: { message: `unexpected ${path}` } }, 404);
    }) as unknown as typeof fetch;
}

const session: RebaseSession = {
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: {
        uid: "u1",
        email: "editor@example.com",
        displayName: null,
        photoURL: null,
        providerId: "password",
        isAnonymous: false,
        roles: ["editor"]
    }
};

/**
 * The SDK client as the shell uses it. Each call goes through `fetch` to the
 * route the real client calls, so the request log above sees everything the
 * shell causes.
 */
function client(): RebaseClient {
    const get = async <T,>(path: string): Promise<T> => {
        const res = await fetch(`${API}${path}`);
        return await res.json() as T;
    };
    return {
        baseUrl: "https://api.example.com",
        apiPath: "/api",
        data: { collection: () => ({}) },
        storage: {},
        resolveToken: async () => session.accessToken,
        auth: {
            getSession: () => session,
            onAuthStateChange: (_handler: (e: AuthChangeEvent, s: RebaseSession | null) => void) => () => undefined,
            isInitialized: async () => undefined,
            canRestoreSession: () => true,
            getUser: async () => session.user,
            getAuthConfig: () => get("/auth/config")
        },
        personalKeys: { listScopes: () => get("/auth/scopes") },
        fetchStorageSources: async () => (await get<{ data: StorageSourceDefinition[] }>("/storage/sources")).data
    } as unknown as RebaseClient;
}

/**
 * Rendered once the auth controller knows both answers. Everything the shell
 * would ask depends on them, so by this point it has asked.
 */
function Settled() {
    const authController = useAuthController() as { heldScopes?: string[]; storageEnabled?: boolean | null };
    const known = authController.heldScopes !== undefined && authController.storageEnabled !== null;
    return known ? <span data-testid="settled"/> : null;
}

function Shell({ rebaseClient }: { rebaseClient: RebaseClient }) {
    const authController = useRebaseAuthController({ client: rebaseClient as never });
    return (
        <Rebase client={rebaseClient} authController={authController}>
            <RebaseCMS collections={[posts]} collectionEditor={true}/>
            <RebaseNavigation>
                <Settled/>
            </RebaseNavigation>
        </Rebase>
    );
}

async function mountShell(backend: Backend) {
    serve(backend);
    const rebaseClient = client();
    // A data router, as the app has: the shell blocks navigation away from
    // unsaved forms, and that needs one.
    const router = createMemoryRouter([{ path: "*", element: <Shell rebaseClient={rebaseClient}/> }]);
    render(<RouterProvider router={router}/>);
    await screen.findByTestId("settled");
    // Let the effects of the render that settled it run, and the requests
    // they start resolve.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

/** `<Rebase client>` alone: the panel builds its own controller, which reports no scopes. */
function ShellWithItsOwnController({ rebaseClient }: { rebaseClient: RebaseClient }) {
    return (
        <Rebase client={rebaseClient}>
            <RebaseCMS collections={[posts]} collectionEditor={true}/>
            <RebaseNavigation>{null}</RebaseNavigation>
        </Rebase>
    );
}

const asked = (suffix: string) => requested.some(url => url.endsWith(suffix));

afterEach(() => {
    requested = [];
});

describe("the shell's requests on load", () => {
    it("asks none of them for a user without schema:read on a deployment without storage", async () => {
        await mountShell({ held: ["data:read", "data:write", "storage:read", "storage:write"], storage: false });

        // It did read what it decides from, so the silence below is a decision.
        expect(asked("/auth/config")).toBe(true);
        expect(asked("/auth/scopes")).toBe(true);
        expect(requested.filter(url => REFUSED.some(suffix => url.endsWith(suffix)))).toEqual([]);
    });

    it("asks all of them for an admin on a deployment with storage", async () => {
        await mountShell({ held: ["data:read", "schema:read", "schema:write"], storage: true });

        for (const suffix of REFUSED) expect([suffix, asked(suffix)]).toEqual([suffix, true]);
    });

    it("asks for the schema status but not the storage sources when only storage is off", async () => {
        await mountShell({ held: ["schema:read", "schema:write"], storage: false });

        expect(asked("/admin/schema/status")).toBe(true);
        expect(asked("/schema-editor/status")).toBe(true);
        expect(asked("/storage/sources")).toBe(false);
    });

    it("still asks when the auth controller does not report scopes or storage", async () => {
        // Nothing to decide from, so the backend decides, as it always has.
        // Gating on scopes the controller cannot report would take the
        // collection editor away from every app built this way.
        serve({ held: [], storage: false });
        const rebaseClient = client();
        const router = createMemoryRouter([{
            path: "*",
            element: <ShellWithItsOwnController rebaseClient={rebaseClient}/>
        }]);
        render(<RouterProvider router={router}/>);

        await waitFor(() => {
            for (const suffix of REFUSED) expect([suffix, asked(suffix)]).toEqual([suffix, true]);
        });
    });
});
