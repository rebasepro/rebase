import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { createRebaseClient } from "../src/index";
import { FaultServer } from "./support/fault-socket";

/**
 * A client says nothing about its connection unless asked to.
 *
 * In a browser the realtime socket wrote "Connected to PostgreSQL backend" and
 * "WebSocket auto-authenticated" with `console.debug` on every page load, so a
 * public site printed them to each visitor's console — noise, and the name of
 * its backend. They are written now only with `debug: true`, or when one
 * browser asks with `localStorage.rebase_debug`, or with
 * `globalThis.__REBASE_DEBUG__`. Warnings and errors are not affected.
 *
 * The suite runs in Node; each test stands in for a browser by defining
 * `window`, `localStorage` and `WebSocket` on `globalThis`, the globals the
 * client reads.
 */

const GLOBALS = ["window", "localStorage", "WebSocket", "__REBASE_DEBUG__"] as const;
let saved: Map<string, PropertyDescriptor | undefined>;
let clients: { close: () => void }[] = [];

function defineGlobal(name: (typeof GLOBALS)[number], value: unknown): void {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/** A `localStorage` holding `entries`, as much of one as the client reads. */
function storageWith(entries: Record<string, string>): Pick<Storage, "getItem"> {
    return { getItem: (key: string) => entries[key] ?? null };
}

/**
 * A client in a browser page that connects, signs its socket in, loses the
 * connection and redials — every line of connection chatter there is.
 */
async function connectSignInAndRedial(options: { debug?: boolean } = {}): Promise<void> {
    const server = new FaultServer();
    defineGlobal("WebSocket", server.WebSocket);
    const client = createRebaseClient({
        baseUrl: "https://songs.example.test",
        token: "a-token",
        fetch: async () => new Response("{}", { status: 200 }),
        ...options
    });
    clients.push(client);
    client.ws!.ensureConnected();
    await jest.advanceTimersByTimeAsync(20);
    expect(server.receivedOfType("AUTHENTICATE")).toHaveLength(1);

    server.current!.drop();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(server.sockets.length).toBeGreaterThan(1);
}

function debugLines(spy: jest.SpiedFunction<typeof console.debug>): string[] {
    return spy.mock.calls.map(call => call.map(String).join(" "));
}

describe("connection logging", () => {
    let debug: jest.SpiedFunction<typeof console.debug>;
    let log: jest.SpiedFunction<typeof console.log>;
    let info: jest.SpiedFunction<typeof console.info>;

    beforeEach(() => {
        saved = new Map(GLOBALS.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
        clients = [];
        jest.useFakeTimers();
        defineGlobal("window", globalThis);
        defineGlobal("localStorage", storageWith({}));
        debug = jest.spyOn(console, "debug").mockImplementation(() => undefined);
        log = jest.spyOn(console, "log").mockImplementation(() => undefined);
        info = jest.spyOn(console, "info").mockImplementation(() => undefined);
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        for (const client of clients) client.close();
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
        for (const [name, descriptor] of saved) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    });

    it("a default client in a browser logs nothing below a warning", async () => {
        await connectSignInAndRedial();
        expect(debug).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
        expect(info).not.toHaveBeenCalled();
    });

    it("`debug: true` logs the connection's progress", async () => {
        await connectSignInAndRedial({ debug: true });
        const lines = debugLines(debug);
        expect(lines).toContain("Connected to PostgreSQL backend");
        expect(lines).toContain("WebSocket auto-authenticated");
        expect(lines).toContain("Disconnected from PostgreSQL backend");
        expect(lines.some(line => line.startsWith("Attempting to reconnect"))).toBe(true);
        expect(log).not.toHaveBeenCalled();
    });

    it("`localStorage.rebase_debug` turns it on in one browser, with no code change", async () => {
        defineGlobal("localStorage", storageWith({ rebase_debug: "1" }));
        await connectSignInAndRedial();
        expect(debugLines(debug)).toContain("Connected to PostgreSQL backend");
    });

    it("any other `rebase_debug` value leaves it off", async () => {
        defineGlobal("localStorage", storageWith({ rebase_debug: "0" }));
        await connectSignInAndRedial();
        expect(debug).not.toHaveBeenCalled();
    });

    it("a localStorage that throws on read leaves it off, and does not break the client", async () => {
        defineGlobal("localStorage", {
            getItem: () => {
                throw new DOMException("The operation is insecure.", "SecurityError");
            }
        });
        await connectSignInAndRedial();
        expect(debug).not.toHaveBeenCalled();
    });

    it("`globalThis.__REBASE_DEBUG__` turns it on", async () => {
        defineGlobal("__REBASE_DEBUG__", true);
        await connectSignInAndRedial();
        expect(debugLines(debug)).toContain("WebSocket auto-authenticated");
    });

    it("outside a browser, localStorage is not consulted", async () => {
        Reflect.deleteProperty(globalThis, "window");
        const getItem = jest.fn(() => "1");
        defineGlobal("localStorage", { getItem });
        await connectSignInAndRedial();
        expect(getItem).not.toHaveBeenCalled();
        expect(debug).not.toHaveBeenCalled();
    });
});
