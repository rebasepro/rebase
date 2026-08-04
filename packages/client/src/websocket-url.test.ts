import { jest } from "@jest/globals";
import { createRebaseClient } from "./index";

/**
 * Where the realtime socket dials, given a `baseUrl`.
 *
 * The socket URL is derived rather than configured, so every disagreement
 * between how it is derived and where the API actually lives shows up only as
 * realtime not working — never as an error naming a cause.
 */

function setWindow(origin: string | undefined) {
    if (origin === undefined) {
        delete (globalThis as never as { window?: unknown }).window;
        return;
    }
    (globalThis as never as { window: unknown }).window = {
        location: { origin, href: origin + "/" }
    };
}

function trackingWebSocket() {
    const opened: string[] = [];
    class FakeWebSocket {
        static readonly OPEN = 1;
        readyState = 0;
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onmessage: (() => void) | null = null;
        constructor(public url: string) { opened.push(url); }
        close() { /* no-op */ }
        send() { /* no-op */ }
    }
    return { FakeWebSocket: FakeWebSocket as unknown as typeof WebSocket, opened };
}

describe("realtime socket URL", () => {
    const originalWebSocket = globalThis.WebSocket;

    afterEach(() => {
        globalThis.WebSocket = originalWebSocket;
        setWindow(undefined);
        jest.restoreAllMocks();
    });

    it("keeps the path of a relative baseUrl, as it does for an absolute one", () => {
        // A backend mounted under a path is the reason `baseUrl` accepts one.
        // Resolving the relative form to `.origin` dropped it, so the same
        // deployment dialled two different URLs depending on whether its
        // baseUrl was written as "/backend" or "https://app.example.com/backend".
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;
        setWindow("https://app.example.com");

        const relative = createRebaseClient({ baseUrl: "/backend" });
        relative.collection("posts").listen!(undefined, () => {});

        const absolute = createRebaseClient({ baseUrl: "https://app.example.com/backend" });
        absolute.collection("posts").listen!(undefined, () => {});

        expect(opened[0]).toBe("wss://app.example.com/backend");
        expect(opened[0]).toBe(opened[1]);
    });

    it("dials the page origin when no baseUrl is set in a browser", () => {
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;
        setWindow("https://app.example.com");

        const client = createRebaseClient({});
        client.collection("posts").listen!(undefined, () => {});

        expect(opened[0]).toBe("wss://app.example.com");
    });

    it("says why realtime is unavailable when no URL could be derived", () => {
        // Node, with a relative baseUrl there is nothing to resolve against.
        // The client silently had no socket, and `realtime.channel()` then
        // blamed `realtime: false` — an option the caller never passed.
        setWindow(undefined);
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const client = createRebaseClient({ baseUrl: "/backend" });

        expect(client.ws).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("websocketUrl"));
        expect(() => client.realtime.channel("room")).toThrow(/no WebSocket URL could be derived/i);
        // It may still *suggest* `realtime: false` as the way to make this
        // deliberate; what it must not do is claim that is what happened.
        expect(() => client.realtime.channel("room")).not.toThrow(/disabled on this client/);
    });

    it("still blames the opt-out when realtime really was switched off", () => {
        const client = createRebaseClient({ baseUrl: "https://api.example.com", realtime: false });
        expect(() => client.realtime.channel("room")).toThrow(/realtime: false/);
    });
});
