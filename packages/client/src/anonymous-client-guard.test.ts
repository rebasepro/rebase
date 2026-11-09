import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ANONYMOUS_SERVER_CLIENT_WARNING, createTransport } from "./transport";
import { createRebaseClient } from "./index";
import { jsonResponse } from "../test/support/responses";

/**
 * A client built off-browser with no credential is silently anonymous: RLS
 * answers it with whatever is public, which is usually nothing. A `scrape-jobs`
 * script hit this twice. These pin the *narrowness* of the guard as much as the
 * guard itself — a warning that fires on legitimate anonymous clients (browser
 * before sign-in, public reads) is noise that teaches people to ignore warnings.
 */

/** A fetch answering every request with an empty page — a fresh `Response` each time. */
const okFetch = () => jest.fn<typeof fetch>(async () => jsonResponse({ data: [] }));

/**
 * Stand-ins for the browser's globals: only `window.location` and
 * `document.cookie` are read, and a whole `Window` or `Document` cannot be
 * built in Node, so they are installed as properties.
 */
const setGlobal = (name: "window" | "document", value: object | undefined) => {
    if (value === undefined) { Reflect.deleteProperty(globalThis, name); return; }
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
};

const setWindow = (defined: boolean) =>
    setGlobal("window", defined ? { location: { origin: "https://app.example.com", href: "https://app.example.com/" } } : undefined);

const setDocument = (defined: boolean) => setGlobal("document", defined ? { cookie: "" } : undefined);

let warn: jest.SpiedFunction<typeof console.warn>;

beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    warn.mockRestore();
    setWindow(false);
    setDocument(false);
});

const anonymousWarnings = () => warn.mock.calls.filter(([first]) => first === ANONYMOUS_SERVER_CLIENT_WARNING);

describe("anonymous server client guard", () => {
    it("warns when a Node-side client has no credential at all", async () => {
        const transport = createTransport({ baseUrl: "http://localhost:3001", fetch: okFetch() });

        await transport.request("/data/jobs");

        expect(anonymousWarnings()).toHaveLength(1);
        expect(anonymousWarnings()[0][0]).toContain("anonymous: true");
    });

    it("warns once per client, not once per request", async () => {
        const transport = createTransport({ baseUrl: "http://localhost:3001", fetch: okFetch() });

        await transport.request("/data/jobs");
        await transport.request("/data/jobs");
        await transport.request("/data/other");

        expect(anonymousWarnings()).toHaveLength(1);
    });

    it("warns per client, so a second offending client is still reported", async () => {
        const a = createTransport({ baseUrl: "http://localhost:3001", fetch: okFetch() });
        const b = createTransport({ baseUrl: "http://localhost:3001", fetch: okFetch() });

        await a.request("/data/jobs");
        await b.request("/data/jobs");

        expect(anonymousWarnings()).toHaveLength(2);
    });

    it("stays silent in a browser, where anonymous-before-sign-in is normal", async () => {
        setWindow(true);
        const transport = createTransport({ fetch: okFetch() });

        await transport.request("/data/posts");

        expect(anonymousWarnings()).toHaveLength(0);
    });

    it("stays silent when only `document` is defined, so an SSR/test shim is not mistaken for Node", async () => {
        setDocument(true);
        const transport = createTransport({ baseUrl: "http://localhost:3001", fetch: okFetch() });

        await transport.request("/data/posts");

        expect(anonymousWarnings()).toHaveLength(0);
    });

    it("stays silent when a token was passed", async () => {
        const transport = createTransport({ baseUrl: "http://localhost:3001", token: "service-key", fetch: okFetch() });

        await transport.request("/data/jobs");

        expect(anonymousWarnings()).toHaveLength(0);
    });

    it("stays silent when the token arrives after construction (the reason this is checked at first request)", async () => {
        const transport = createTransport({ baseUrl: "http://localhost:3001", fetch: okFetch() });
        transport.setToken("service-key");

        await transport.request("/data/jobs");

        expect(anonymousWarnings()).toHaveLength(0);
    });

    it("stays silent when an auth token getter is installed", async () => {
        const transport = createTransport({ baseUrl: "http://localhost:3001", fetch: okFetch() });
        transport.setAuthTokenGetter(async () => "fetched-token");

        await transport.request("/data/jobs");

        expect(anonymousWarnings()).toHaveLength(0);
    });

    it("stays silent for a token getter that has nothing yet — the credential path exists", async () => {
        const transport = createTransport({ baseUrl: "http://localhost:3001", fetch: okFetch() });
        transport.setAuthTokenGetter(async () => null);

        await transport.request("/data/jobs");

        expect(anonymousWarnings()).toHaveLength(0);
    });

    it("stays silent for the cookie auth flow, where the credential is not a header", async () => {
        const transport = createTransport(
            { baseUrl: "http://localhost:3001", fetch: okFetch() },
            { credentialOutOfBand: true }
        );

        await transport.request("/data/jobs");

        expect(anonymousWarnings()).toHaveLength(0);
    });

    it("stays silent when the caller opted in with `anonymous: true`", async () => {
        const transport = createTransport({ baseUrl: "http://localhost:3001", anonymous: true, fetch: okFetch() });

        await transport.request("/data/jobs");

        expect(anonymousWarnings()).toHaveLength(0);
    });
});

describe("anonymous server client guard, through createRebaseClient", () => {
    it("warns for a credential-less client built in a script", async () => {
        const client = createRebaseClient({
            baseUrl: "http://localhost:3001",
            realtime: false,
            fetch: okFetch()
        });

        await client.collection("jobs").find();

        expect(anonymousWarnings()).toHaveLength(1);
    });

    it("stays silent when `auth.authFlowMode` is cookie", async () => {
        const client = createRebaseClient({
            baseUrl: "http://localhost:3001",
            realtime: false,
            fetch: okFetch(),
            auth: { authFlowMode: "cookie", persistSession: false }
        });

        await client.collection("jobs").find();

        expect(anonymousWarnings()).toHaveLength(0);
    });

    it("stays silent when the caller opted in with `anonymous: true`", async () => {
        const client = createRebaseClient({
            baseUrl: "http://localhost:3001",
            realtime: false,
            anonymous: true,
            fetch: okFetch()
        });

        await client.collection("jobs").find();

        expect(anonymousWarnings()).toHaveLength(0);
    });
});
