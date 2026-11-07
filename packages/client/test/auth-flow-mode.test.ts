import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createMemoryStorage, resolveAuthFlowMode } from "../src/auth";
import { createRebaseClient } from "../src/index";
import { AUTH_FLOW_HEADER } from "@rebasepro/types";

/**
 * Signed out about an hour after signing in.
 *
 * A backend run by the Rebase runtime always keeps the refresh token in an
 * HttpOnly cookie and answers the body's with `""`. The client defaulted to
 * json mode, so a browser app that did not set `authFlowMode` held nothing to
 * renew with: once the access token expired the session was dropped, without
 * a word. A browser now defaults to cookie mode, and a sign-in answer that
 * shows the client cannot renew says so at once.
 *
 * The other half: an app kept `getSession()` and sent its `accessToken` to its
 * own routes, long after a renewal had replaced it. `getAccessToken()` is the
 * token to send, renewed when it is spent.
 */

const HOUR = 3_600_000;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface Sent { path: string; credentials: RequestCredentials | undefined; body: string | undefined; authorization: string | undefined; flow: string | undefined }

/**
 * A backend. With `cookieAuth` it behaves as the runtime does: the refresh
 * token goes in a cookie — kept, as a browser keeps a cross-origin one, only
 * when the request said `credentials: "include"` — and the body carries `""`.
 * Without it the token is in the body. Every sign-in and refresh mints an
 * access token good for `expiresIn`.
 */
function createServer(options: { cookieAuth: boolean; expiresIn?: number; refresh?: "ok" | "refused" | "unreachable" }) {
    const sent: Sent[] = [];
    let jar: string | null = null;
    let n = 0;
    const issued = new Set<string>();
    const answer = (include: boolean) => {
        n++;
        const refreshToken = `R${n}`;
        issued.add(refreshToken);
        if (options.cookieAuth && include) jar = refreshToken;
        return json({
            user: { uid: "u1", email: "a@b.c" },
            tokens: {
                accessToken: `a${n}`,
                refreshToken: options.cookieAuth ? "" : refreshToken,
                accessTokenExpiresAt: Date.now() + (options.expiresIn ?? HOUR)
            }
        });
    };
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const path = url.replace("http://api.test/api", "");
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const body = typeof init?.body === "string" ? init.body : undefined;
        sent.push({ path, credentials: init?.credentials, body, authorization: headers.Authorization, flow: headers[AUTH_FLOW_HEADER] });
        const include = init?.credentials === "include";
        if (path === "/auth/login") return answer(include);
        if (path === "/auth/refresh") {
            if (options.refresh === "unreachable") throw new TypeError("Failed to fetch");
            const presented = (options.cookieAuth && include && jar) || (JSON.parse(body || "{}") as { refreshToken?: string }).refreshToken;
            if (options.refresh === "refused" || !presented || !issued.has(presented)) {
                return json({ error: { code: "INVALID_TOKEN", message: "no session" } }, 401);
            }
            return answer(include);
        }
        return json({ error: { code: "NOT_FOUND", message: path } }, 404);
    }) as typeof fetch;
    return { fetchFn, sent, refreshes: () => sent.filter((s) => s.path === "/auth/refresh") };
}

const setDocument = (defined: boolean) => {
    if (!defined) { delete (globalThis as never as { document?: unknown }).document; return; }
    (globalThis as never as { document: unknown }).document = { cookie: "" };
};

const clients: { close: () => void }[] = [];
let error: jest.SpiedFunction<typeof console.error>;

beforeEach(() => {
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    clients.splice(0).forEach((c) => c.close());
    error.mockRestore();
    setDocument(false);
});

function client(fetchFn: typeof fetch, auth: Parameters<typeof createRebaseClient>[0]["auth"] = {}) {
    const c = createRebaseClient({ baseUrl: "http://api.test", realtime: false, fetch: fetchFn, auth: { autoRefresh: false, ...auth } });
    clients.push(c);
    return c;
}

const flowErrors = () => error.mock.calls.filter(([first]) => typeof first === "string" && first.startsWith("[rebase] This server"));

describe("the default flow mode", () => {
    it("is cookie in a browser, json off one, and json in a browser that brings its own storage", () => {
        expect(resolveAuthFlowMode()).toBe("json");
        setDocument(true);
        expect(resolveAuthFlowMode()).toBe("cookie");
        expect(resolveAuthFlowMode({ storage: createMemoryStorage() })).toBe("json");
        expect(resolveAuthFlowMode({ authFlowMode: "json" })).toBe("json");
        setDocument(false);
        expect(resolveAuthFlowMode({ authFlowMode: "cookie" })).toBe("cookie");
    });

    it("keeps a browser app signed in past its first hour against a cookie server", async () => {
        setDocument(true);
        const server = createServer({ cookieAuth: true, expiresIn: 5_000 });
        const c = client(server.fetchFn);
        await c.auth.isInitialized();

        await c.auth.signInWithEmail("a@b.c", "pw");
        const login = server.sent.find((s) => s.path === "/auth/login");
        expect(login?.credentials).toBe("include");

        // The access token is within the margin of expiring: the next token
        // asked for is a renewed one, through the cookie. (The refresh before
        // it is the restore tried on load, refused: no cookie yet.)
        expect(await c.auth.getAccessToken()).toBe("a2");
        expect(server.refreshes()).toHaveLength(2);
        expect(server.refreshes()[1]).toMatchObject({ body: "{}", credentials: "include" });
        expect(c.auth.getSession()?.user.uid).toBe("u1");
        expect(flowErrors()).toHaveLength(0);
    });
});

describe("a sign-in the client cannot renew", () => {
    it("is reported once, naming cookie mode, when a json client is handed no refresh token", async () => {
        const server = createServer({ cookieAuth: true });
        const c = client(server.fetchFn, { authFlowMode: "json" });

        await c.auth.signInWithEmail("a@b.c", "pw");
        await c.auth.signInWithEmail("a@b.c", "pw");

        expect(flowErrors()).toHaveLength(1);
        expect(flowErrors()[0][0]).toContain("authFlowMode: \"cookie\"");
        expect(flowErrors()[0][0]).toContain("in about 60 minutes");
    });

    it("is reported, naming json mode, when a cookie client is handed the token in the body", async () => {
        const server = createServer({ cookieAuth: false });
        const c = client(server.fetchFn, { authFlowMode: "cookie" });

        await c.auth.signInWithEmail("a@b.c", "pw");

        expect(flowErrors()).toHaveLength(1);
        expect(flowErrors()[0][0]).toContain("authFlowMode: \"json\"");
    });

    it("is not reported for a json client that brought its own storage, which chose to keep its sign-in apart", async () => {
        setDocument(true);
        const server = createServer({ cookieAuth: true });
        const c = client(server.fetchFn, { storage: createMemoryStorage() });

        await c.auth.signInWithEmail("a@b.c", "pw");

        expect(flowErrors()).toHaveLength(0);
    });

    it("is reported for a json client by default, off the browser, naming the server update", async () => {
        const server = createServer({ cookieAuth: true });
        const c = client(server.fetchFn);

        await c.auth.signInWithEmail("a@b.c", "pw");

        expect(flowErrors()).toHaveLength(1);
        expect(flowErrors()[0][0]).toContain("update it");
    });

    it("is not reported when the modes agree", async () => {
        await client(createServer({ cookieAuth: true }).fetchFn, { authFlowMode: "cookie" }).auth.signInWithEmail("a@b.c", "pw");
        await client(createServer({ cookieAuth: false }).fetchFn, { authFlowMode: "json" }).auth.signInWithEmail("a@b.c", "pw");

        expect(flowErrors()).toHaveLength(0);
    });
});

describe("getAccessToken", () => {
    it("is null with no one signed in", async () => {
        const c = client(createServer({ cookieAuth: false }).fetchFn);
        expect(await c.auth.getAccessToken()).toBeNull();
    });

    it("answers the held token while it is good, without a request", async () => {
        const server = createServer({ cookieAuth: false });
        const c = client(server.fetchFn);
        await c.auth.signInWithEmail("a@b.c", "pw");

        expect(await c.auth.getAccessToken()).toBe("a1");
        expect(server.refreshes()).toHaveLength(0);
    });

    it("renews a spent token once for calls made together, where a kept session goes stale", async () => {
        const server = createServer({ cookieAuth: false, expiresIn: 5_000 });
        const c = client(server.fetchFn);
        await c.auth.signInWithEmail("a@b.c", "pw");
        const kept = c.auth.getSession();

        const tokens = await Promise.all([c.auth.getAccessToken(), c.auth.getAccessToken(), c.auth.getAccessToken()]);

        expect(tokens).toEqual(["a2", "a2", "a2"]);
        expect(server.refreshes()).toHaveLength(1);
        expect(kept?.accessToken).toBe("a1");
        expect(c.auth.getSession()).not.toBe(kept);
    });

    it("ends the session and answers null when the renewal is refused", async () => {
        const server = createServer({ cookieAuth: false, expiresIn: 5_000, refresh: "refused" });
        const c = client(server.fetchFn);
        await c.auth.signInWithEmail("a@b.c", "pw");
        const events: string[] = [];
        c.auth.onAuthStateChange((event) => events.push(event));

        expect(await c.auth.getAccessToken()).toBeNull();
        expect(c.auth.getSession()).toBeNull();
        expect(events).toContain("SIGNED_OUT");
    });

    it("keeps the session and answers the held token when the server cannot be reached", async () => {
        const server = createServer({ cookieAuth: false, expiresIn: 5_000, refresh: "unreachable" });
        const c = client(server.fetchFn);
        await c.auth.signInWithEmail("a@b.c", "pw");

        expect(await c.auth.getAccessToken()).toBe("a1");
        expect(c.auth.getSession()?.accessToken).toBe("a1");
    });

    it("waits for the session a cookie client restores on load", async () => {
        setDocument(true);
        const server = createServer({ cookieAuth: true });
        const first = client(server.fetchFn);
        await first.auth.isInitialized();
        await first.auth.signInWithEmail("a@b.c", "pw");

        // A reload: nothing in memory, the cookie still in the jar.
        const reloaded = client(server.fetchFn);

        expect(await reloaded.auth.getAccessToken()).toBe("a2");
    });
});

describe("the flow header", () => {
    it("goes on every auth request a json client makes, so a cookieAuth server answers it in the body", async () => {
        const server = createServer({ cookieAuth: false, expiresIn: 5_000 });
        const c = client(server.fetchFn, { authFlowMode: "json" });

        await c.auth.signInWithEmail("a@b.c", "pw");
        await c.auth.getAccessToken();
        await c.auth.signOut();

        const paths = server.sent.map((s) => s.path);
        expect(paths).toEqual(expect.arrayContaining(["/auth/login", "/auth/refresh", "/auth/logout"]));
        expect(server.sent.every((s) => s.flow === "json")).toBe(true);
    });

    it("goes on the session upgrades sent through the transport", async () => {
        const sent: Sent[] = [];
        const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const headers = (init?.headers ?? {}) as Record<string, string>;
            sent.push({ path: url.replace("http://api.test/api", ""), credentials: init?.credentials, body: undefined, authorization: headers.Authorization, flow: headers[AUTH_FLOW_HEADER] });
            return json({ user: { uid: "u1", email: "a@b.c" }, tokens: { accessToken: "a", refreshToken: "R", accessTokenExpiresAt: Date.now() + HOUR } });
        }) as typeof fetch;
        const c = client(fetchFn, { authFlowMode: "json" });

        await c.auth.signInAnonymously();
        await c.auth.linkAnonymous("a@b.c", "pw");

        expect(sent.map((s) => [s.path, s.flow])).toEqual([["/auth/anonymous", "json"], ["/auth/anonymous/link", "json"]]);
    });

    it("is not sent in cookie mode", async () => {
        const server = createServer({ cookieAuth: true });
        const c = client(server.fetchFn, { authFlowMode: "cookie" });

        await c.auth.signInWithEmail("a@b.c", "pw");

        expect(server.sent.every((s) => s.flow === undefined)).toBe(true);
    });
});
