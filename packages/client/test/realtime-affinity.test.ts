import { afterEach, describe, expect, it } from "@jest/globals";
import { createRebaseClient } from "../src/index";

/**
 * `realtime.affinity` names the group a socket belongs to on the socket's
 * address, where a platform can route on it. The SDK's half is the address:
 * the right value in one `affinity` parameter, at each dial, and nothing at all
 * when none was named.
 */
function recordDials() {
    const dialled: string[] = [];

    class FakeWebSocket {
        static readonly OPEN = 1;
        readyState = 0;
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onmessage: (() => void) | null = null;

        constructor(url: string) {
            dialled.push(url);
        }

        close() { /* no-op */ }

        send() { /* no-op */ }
    }

    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    return dialled;
}

const affinityOf = (url: string) => new URL(url).searchParams.getAll("affinity");

describe("realtime affinity", () => {
    const original = globalThis.WebSocket;

    afterEach(() => {
        globalThis.WebSocket = original;
    });

    it("names nothing unless asked", () => {
        const dialled = recordDials();
        const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

        client.ws?.ensureConnected();

        expect(dialled).toHaveLength(1);
        expect(affinityOf(dialled[0])).toEqual([]);
        client.close();
    });

    it("names the option on the socket's address, beside the opt-ins, and leaves the address itself alone", () => {
        const dialled = recordDials();
        const client = createRebaseClient({ baseUrl: "http://localhost:3000", realtime: { affinity: "ROOM-1" } });

        client.ws?.ensureConnected();

        expect(dialled[0]).toMatch(/^ws:\/\/localhost:3000\?/);
        expect(affinityOf(dialled[0])).toEqual(["ROOM-1"]);
        expect(new URL(dialled[0]).searchParams.get("rebase_caps")).toContain("heartbeat");
        client.close();
    });

    it("encodes a key that isn't URL-safe", () => {
        const dialled = recordDials();
        const client = createRebaseClient({ baseUrl: "http://localhost:3000", realtime: { affinity: "a b&c=d" } });

        client.ws?.ensureConnected();

        expect(affinityOf(dialled[0])).toEqual(["a b&c=d"]);
        client.close();
    });

    it("takes a key known only later, before the socket connects", () => {
        const dialled = recordDials();
        const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

        client.realtime.setAffinity("ROOM-2");
        expect(dialled).toHaveLength(0);

        client.ws?.ensureConnected();
        expect(affinityOf(dialled[0])).toEqual(["ROOM-2"]);
        client.close();
    });

    it("leaves an open socket where it is, and uses the new key at the next dial", () => {
        const dialled = recordDials();
        const client = createRebaseClient({ baseUrl: "http://localhost:3000", realtime: { affinity: "ROOM-1" } });
        client.ws?.ensureConnected();

        client.realtime.setAffinity("ROOM-2");
        expect(dialled).toHaveLength(1);

        client.ws?.disconnect();
        client.ws?.ensureConnected();
        expect(affinityOf(dialled[1])).toEqual(["ROOM-2"]);
        client.close();
    });

    it("clears with null, and an empty key names nothing", () => {
        const dialled = recordDials();
        const client = createRebaseClient({ baseUrl: "http://localhost:3000", realtime: { affinity: "ROOM-1" } });

        client.realtime.setAffinity(null);
        client.ws?.ensureConnected();
        expect(affinityOf(dialled[0])).toEqual([]);

        client.ws?.disconnect();
        client.realtime.setAffinity("");
        client.ws?.ensureConnected();
        expect(affinityOf(dialled[1])).toEqual([]);
        client.close();
    });

    it("keeps an address that already names one, and replaces it rather than sending two", () => {
        const dialled = recordDials();
        const client = createRebaseClient({
            baseUrl: "http://localhost:3000",
            websocketUrl: "wss://host.example/?affinity=HAND&other=1"
        });

        client.ws?.ensureConnected();
        expect(dialled[0]).toMatch(/^wss:\/\/host\.example\/\?affinity=HAND&other=1&rebase_caps=/);

        client.ws?.disconnect();
        client.realtime.setAffinity("ROOM-1");
        client.ws?.ensureConnected();
        expect(affinityOf(dialled[1])).toEqual(["ROOM-1"]);
        expect(new URL(dialled[1]).searchParams.get("other")).toBe("1");
        client.close();
    });

    it("an options object leaves realtime on, and realtime: false stays off", () => {
        const dialled = recordDials();
        const on = createRebaseClient({ baseUrl: "http://localhost:3000", realtime: {} });
        expect(on.ws).toBeDefined();
        on.close();

        const off = createRebaseClient({ baseUrl: "http://localhost:3000", realtime: false });
        expect(() => off.realtime.setAffinity("ROOM-1")).not.toThrow();
        expect(off.ws).toBeUndefined();
        expect(dialled).toHaveLength(0);
        off.close();
    });
});
