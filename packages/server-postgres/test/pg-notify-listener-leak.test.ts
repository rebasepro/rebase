import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const clients: Array<{ connect: jest.Mock; query: jest.Mock; end: jest.Mock; on: jest.Mock }> = [];
let queryBehaviour: () => Promise<unknown> = async () => ({});

jest.mock("pg", () => ({
    Client: jest.fn().mockImplementation(() => {
        const client = {
            connect: jest.fn(async () => undefined),
            query: jest.fn(() => queryBehaviour()),
            end: jest.fn(async () => undefined),
            on: jest.fn()
        };
        clients.push(client as never);
        return client;
    })
}));

jest.mock("@rebasepro/server", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

import { PgNotifyListener } from "../src/services/pg-notify-listener";

/**
 * A LISTEN connection that fails *after* connecting used to be lost.
 *
 * `connect()` builds the client, connects it, issues `LISTEN`, and only then
 * assigns `this.client`. Everything before that assignment can throw — and when
 * it does, nothing in the class knows the connection exists: `stop()` closes
 * `this.client`, `scheduleReconnect` closes `this.client`, and both are still
 * undefined. The backend stays open on the server while the reconnect timer
 * opens another one, every few seconds, for as long as the failure lasts.
 *
 * `LISTEN` failing on its own is the case that makes this reachable: the TCP
 * connection is fine, so `connect()` resolves, and the statement is what the
 * server refuses.
 */
describe("a LISTEN client that could not be adopted is closed", () => {
    const options = {
        connectionString: "postgres://localhost/db",
        channel: "rebase_test",
        onPayload: () => undefined,
        logLabel: "[TEST]",
        reconnectDelayMs: 10_000
    };

    beforeEach(() => {
        clients.length = 0;
        queryBehaviour = async () => ({});
        jest.clearAllMocks();
    });

    it("closes the connection when LISTEN fails", async () => {
        queryBehaviour = async () => { throw new Error("permission denied for channel"); };

        const listener = new PgNotifyListener(options);
        await expect(listener.start()).rejects.toThrow(/permission denied/);

        expect(clients).toHaveLength(1);
        expect(clients[0].connect).toHaveBeenCalled();
        expect(clients[0].end).toHaveBeenCalled();
    });

    it("does not close the connection it did adopt", async () => {
        // The control: a successful start must leave the client open, or the
        // listener would immediately stop listening.
        const listener = new PgNotifyListener(options);
        await listener.start();

        expect(clients).toHaveLength(1);
        expect(clients[0].end).not.toHaveBeenCalled();

        await listener.stop();
        expect(clients[0].end).toHaveBeenCalled();
    });

    it("leaves nothing open across repeated failures", async () => {
        // The shape that turns one leak into an outage: the reconnect loop runs
        // this path again and again, and each attempt used to strand a backend.
        queryBehaviour = async () => { throw new Error("still failing"); };

        for (let attempt = 0; attempt < 3; attempt++) {
            const listener = new PgNotifyListener(options);
            await expect(listener.start()).rejects.toThrow();
        }

        expect(clients).toHaveLength(3);
        for (const client of clients) {
            expect(client.end).toHaveBeenCalled();
        }
    });
});
