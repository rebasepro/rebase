import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * A LISTEN connection that goes half-open is noticed and replaced.
 *
 * Half-open — packets stop, no FIN, no RST — is what an idle-flow timeout on a
 * load balancer, a NAT or conntrack table, or a dead middlebox looks like, and
 * a LISTEN connection is idle by nature. It fires no `error` and no `end`, so
 * the listener used to keep it forever: CDC, the cross-instance broadcast and
 * the channel bus went quiet with no error, no reconnect and a green health
 * check (measured: zero frames 30 s after two external writes). Now the
 * connection must answer a heartbeat, and one that does not is torn down,
 * replaced, and the subscribers resynced.
 */

type FakeClient = {
    options: Record<string, unknown>;
    connect: jest.Mock;
    query: jest.Mock;
    end: jest.Mock;
    on: jest.Mock;
    handlers: Record<string, (arg?: unknown) => void>;
};
const clients: FakeClient[] = [];
/** When set, a heartbeat on the connection never comes back — the half-open link. */
let silent = false;

jest.mock("pg", () => ({
    Client: jest.fn().mockImplementation((options: unknown) => {
        const client: FakeClient = {
            options: options as Record<string, unknown>,
            connect: jest.fn(async () => undefined),
            query: jest.fn((text: unknown) => (text === "SELECT 1" && silent ? new Promise(() => undefined) : Promise.resolve({}))),
            end: jest.fn(async () => undefined),
            on: jest.fn(),
            handlers: {}
        };
        client.on.mockImplementation(((event: string, handler: (arg?: unknown) => void) => {
            client.handlers[event] = handler;
        }) as never);
        clients.push(client);
        return client;
    })
}));

jest.mock("@rebasepro/server", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

import { PgNotifyListener } from "../src/services/pg-notify-listener";

async function flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("a LISTEN connection's heartbeat", () => {
    let onReconnect: jest.Mock;
    let listener: PgNotifyListener;

    beforeEach(async () => {
        jest.useFakeTimers();
        clients.length = 0;
        silent = false;
        onReconnect = jest.fn();
        listener = new PgNotifyListener({
            connectionString: "postgres://localhost/db",
            channel: "rebase_test",
            onPayload: () => undefined,
            logLabel: "[TEST]",
            onReconnect,
            reconnectDelayMs: 1000,
            heartbeatIntervalMs: 30_000,
            heartbeatTimeoutMs: 10_000
        });
        await listener.start();
    });

    afterEach(async () => {
        await listener.stop();
        jest.useRealTimers();
    });

    it("turns on TCP keepalive", () => {
        expect(clients[0].options).toMatchObject({ keepAlive: true });
    });

    it("leaves a connection that answers alone", async () => {
        jest.advanceTimersByTime(30_000);
        await flush();
        jest.advanceTimersByTime(30_000);
        await flush();

        expect(clients).toHaveLength(1);
        expect(clients[0].query).toHaveBeenCalledWith("SELECT 1");
        expect(listener.status()).toMatchObject({ connected: true });
    });

    it("replaces a connection that stops answering, says so in its status, and resyncs", async () => {
        silent = true;
        jest.advanceTimersByTime(30_000);
        await flush();
        jest.advanceTimersByTime(10_000);
        await flush();

        // Given up on at once: ended, and reported down.
        expect(clients[0].end).toHaveBeenCalled();
        expect(listener.status()).toMatchObject({ connected: false, downSince: expect.any(Number) });
        expect(listener.connected).toBe(false);

        silent = false;
        jest.advanceTimersByTime(1000);
        await flush();

        expect(clients).toHaveLength(2);
        expect(clients[1].query).toHaveBeenCalledWith("LISTEN rebase_test");
        expect(onReconnect).toHaveBeenCalledTimes(1);
        expect(listener.status()).toEqual(expect.objectContaining({ connected: true }));
        expect(listener.status().downSince).toBeUndefined();
    });

    it("ignores a late event from the connection it gave up on", async () => {
        silent = true;
        jest.advanceTimersByTime(40_000);
        await flush();
        silent = false;
        jest.advanceTimersByTime(1000);
        await flush();
        expect(clients).toHaveLength(2);

        // The dead socket finally errors out, long after it was replaced.
        clients[0].handlers.error?.(new Error("read ETIMEDOUT"));
        clients[0].handlers.end?.();
        jest.advanceTimersByTime(5000);
        await flush();

        expect(clients).toHaveLength(2);
        expect(clients[1].end).not.toHaveBeenCalled();
        expect(listener.connected).toBe(true);
    });
});

describe("isCdcActive", () => {
    it("is false while the CDC connection is down, however CDC was configured", async () => {
        const { RealtimeService } = await import("../src/services/realtimeService");
        const { PostgresCollectionRegistry } = await import("../src/collections/PostgresCollectionRegistry");
        const realtime = new RealtimeService({} as never, new PostgresCollectionRegistry());
        Reflect.set(realtime, "cdcActive", true);
        Reflect.set(realtime, "cdcListener", { connected: false, status: () => ({ channel: "rebase_cdc", connected: false, downSince: 1 }) });

        expect(realtime.isCdcActive()).toBe(false);
        expect(realtime.health()).toEqual([{ name: "cdc", connected: false, downSince: 1 }]);

        Reflect.set(realtime, "cdcListener", { connected: true, status: () => ({ channel: "rebase_cdc", connected: true }) });
        expect(realtime.isCdcActive()).toBe(true);
    });
});
