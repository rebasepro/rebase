import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { createAuth } from "./auth";
import { requestAppleAuthorization } from "./apple-sign-in";
import type { Transport } from "./transport";

/**
 * Sign in with Apple from a browser and from a native app.
 *
 * The popup is Apple's (`AppleID.auth`), so it is stood in for here; what is
 * ours is the `state` binding, telling a closed popup from a failure, and the
 * body that reaches `POST /auth/apple` — which must carry the name and never an
 * email, and must say which kind of client the code was issued to.
 */

interface AppleInit { clientId: string; redirectURI: string; state: string; scope: string; usePopup: boolean }

let lastInit: AppleInit | null = null;
let answer: (init: AppleInit) => Promise<unknown>;

const originalWindow = (globalThis as { window?: unknown }).window;
const originalDocument = (globalThis as { document?: unknown }).document;

beforeEach(() => {
    lastInit = null;
    Object.assign(globalThis, {
        window: { location: { origin: "https://app.example.com" } },
        document: {},
        AppleID: {
            auth: {
                init(config: AppleInit) { lastInit = config; },
                signIn() { return answer(lastInit!); }
            }
        }
    });
});

afterEach(() => {
    Object.assign(globalThis, { window: originalWindow, document: originalDocument });
    delete (globalThis as { AppleID?: unknown }).AppleID;
});

const SESSION = {
    user: { uid: "u1", email: "user@example.com", roles: [] },
    tokens: { accessToken: "a", refreshToken: "r", accessTokenExpiresAt: Date.now() + 60_000 }
};

function authWithFetch() {
    const fetchFn = jest.fn(async (_url: string, _init?: { body?: string }) => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => SESSION
    }));
    const transport = {
        request: jest.fn(),
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        setOnUnauthorized: jest.fn(),
        baseUrl: "http://localhost:3000",
        apiPath: "/api",
        fetchFn,
        getHeaders: () => ({}),
        resolveToken: jest.fn(async () => null)
    } as unknown as Transport;
    const posted = () => {
        const call = fetchFn.mock.calls.find(([url]) => String(url).endsWith("/auth/apple"));
        if (!call) throw new Error("nothing was posted to /auth/apple");
        return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
    };
    return { auth: createAuth(transport), fetchFn, posted };
}

describe("requestAppleAuthorization", () => {
    it("returns the code with the redirect URI it authorized against", async () => {
        answer = async (init) => ({
            authorization: { code: "apple-code", state: init.state },
            user: { email: "user@example.com", name: { firstName: "Jane", lastName: "Doe" } }
        });

        const result = await requestAppleAuthorization({ clientId: "com.example.service" });

        expect(lastInit).toMatchObject({
            clientId: "com.example.service",
            redirectURI: "https://app.example.com/",
            scope: "name email",
            usePopup: true
        });
        expect(result).toEqual({
            code: "apple-code",
            redirectUri: "https://app.example.com/",
            user: { name: { firstName: "Jane", lastName: "Doe" } }
        });
    });

    it("refuses a code whose state is not the one this page sent", async () => {
        answer = async () => ({ authorization: { code: "injected", state: "someone-elses" } });
        await expect(requestAppleAuthorization({ clientId: "com.example.service" }))
            .rejects.toMatchObject({ code: "APPLE_SIGN_IN_FAILED" });
    });

    it("reports a closed popup as a cancellation, not a failure", async () => {
        answer = async () => { throw { error: "popup_closed_by_user" }; };
        await expect(requestAppleAuthorization({ clientId: "com.example.service" }))
            .rejects.toMatchObject({ code: "APPLE_SIGN_IN_CANCELLED" });
    });

    it("says a native app has no popup", async () => {
        Object.assign(globalThis, { window: undefined });
        await expect(requestAppleAuthorization({ clientId: "com.example.service" }))
            .rejects.toMatchObject({ code: "APPLE_SIGN_IN_UNAVAILABLE" });
    });
});

describe("client.auth Apple sign-in", () => {
    it("posts a native code with its bundle id and no redirect URI", async () => {
        const { auth, posted } = authWithFetch();
        await auth.signInWithApple({
            code: "native-code",
            bundleId: "com.example.ios",
            user: { name: { firstName: "Jane" }, email: "spoofed@example.com" }
        });
        expect(posted()).toEqual({
            code: "native-code",
            bundleId: "com.example.ios",
            user: { name: { firstName: "Jane" } }
        });
    });

    it("keeps the positional web form, without forwarding an email", async () => {
        const { auth, posted } = authWithFetch();
        await auth.signInWithApple("web-code", "https://app.example.com/", { email: "spoofed@example.com" });
        expect(posted()).toEqual({ code: "web-code", redirectUri: "https://app.example.com/" });
    });

    it("signInWithApplePopup takes the Services ID from /auth/config when none is passed", async () => {
        answer = async (init) => ({ authorization: { code: "apple-code", state: init.state } });
        const { auth, fetchFn, posted } = authWithFetch();
        fetchFn.mockImplementationOnce(async () => ({
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ enabledProviders: ["apple"], providerClientIds: { apple: "com.from.backend" } })
        }));

        await auth.signInWithApplePopup();

        expect(lastInit?.clientId).toBe("com.from.backend");
        expect(posted()).toEqual({ code: "apple-code", redirectUri: "https://app.example.com/" });
    });

    it("signInWithApplePopup says what to set when the backend publishes no Services ID", async () => {
        const { auth, fetchFn } = authWithFetch();
        fetchFn.mockImplementationOnce(async () => ({
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ enabledProviders: ["apple"] })
        }));
        await expect(auth.signInWithApplePopup()).rejects.toThrow(/APPLE_CLIENT_ID/);
    });
});
