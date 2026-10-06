import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createRebaseClient } from "../src/index";
import { createMemoryStorage } from "../src/auth";

/**
 * A private file's URL carries a download token the server minted for the user
 * who asked for it, and the storage source caches that URL for the token's life
 * (~5 minutes). The cache outlived the user: after a sign-out, or another user
 * signing in in the same tab, a preview of the same path was handed the URL
 * minted for the previous user — the file served on their token.
 *
 * A real client — real auth, real transport, real storage source — against a
 * fake backend that mints a download token naming whoever asked.
 */

const HOUR = 3_600_000;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function path(input: string | URL | Request): string {
    return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function backend() {
    const metadataRequests: string[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
        const url = path(input);
        if (url.endsWith("/auth/login")) {
            const { email } = JSON.parse(String(init?.body)) as { email: string };
            const uid = email.split("@")[0];
            return jsonResponse({
                tokens: { accessToken: `token-${uid}`, refreshToken: `refresh-${uid}`, accessTokenExpiresAt: Date.now() + HOUR },
                user: { uid }
            });
        }
        if (url.endsWith("/auth/logout")) return jsonResponse({ success: true });
        if (url.endsWith("/auth/refresh")) return jsonResponse({ error: { message: "No session", code: "INVALID_TOKEN" } }, 401);
        if (url.includes("/storage/metadata/")) {
            const bearer = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer /, "") ?? "anonymous";
            metadataRequests.push(bearer);
            return jsonResponse({ data: { token: `download-for-${bearer}`, tokenExpiresIn: 300 } });
        }
        return jsonResponse({});
    };
    return { fetchStub, metadataRequests };
}

let open: { close: () => void }[] = [];

beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    for (const client of open) client.close();
    open = [];
    jest.restoreAllMocks();
});

describe.each(["json", "cookie"] as const)("a signed URL after a change of user (%s auth)", (authFlowMode) => {
    function client(server: ReturnType<typeof backend>) {
        const rebase = createRebaseClient({
            baseUrl: "http://api.test",
            realtime: false,
            fetch: server.fetchStub,
            auth: { autoRefresh: false, authFlowMode, storage: createMemoryStorage() }
        });
        open.push(rebase);
        return rebase;
    }

    it("is not the one minted for the user who signed in before", async () => {
        const server = backend();
        const rebase = client(server);
        await rebase.auth.isInitialized();

        await rebase.auth.signInWithEmail("alice@example.com", "pw");
        const forAlice = await rebase.storage.getSignedUrl("private/report.pdf");
        expect(forAlice.url).toContain("download-for-token-alice");
        // Warm: Alice's second look is served from the cache.
        await rebase.storage.getSignedUrl("private/report.pdf");
        expect(server.metadataRequests).toEqual(["token-alice"]);

        // Bob signs in over Alice's session, in the same tab.
        await rebase.auth.signInWithEmail("bob@example.com", "pw");
        const forBob = await rebase.storage.getSignedUrl("private/report.pdf");
        expect(forBob.url).toContain("download-for-token-bob");
        expect(server.metadataRequests).toEqual(["token-alice", "token-bob"]);
    });

    it("is not the one minted before the user signed out", async () => {
        const server = backend();
        const rebase = client(server);
        await rebase.auth.isInitialized();

        await rebase.auth.signInWithEmail("alice@example.com", "pw");
        await rebase.storage.getSignedUrl("private/report.pdf");
        await rebase.auth.signOut();

        const signedOut = await rebase.storage.getSignedUrl("private/report.pdf");
        expect(signedOut.url).not.toContain("token-alice");
        expect(server.metadataRequests).toEqual(["token-alice", "anonymous"]);
    });
});
