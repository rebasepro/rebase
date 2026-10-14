import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * A LISTEN connection that cannot be opened, and is retried, is one warning.
 *
 * Two backends in one process beside `rebase dev` (cs-08): the second found no
 * free connection for its LISTEN. Change capture fell back to app-level
 * realtime, which one INFO line explains, and the cross-instance listener —
 * which retries — logged `❌ [ERROR] … Failed to connect LISTEN client` with
 * the error's whole stack, as JSON, and again on every retry. The failure was
 * handled: a fallback that is working is not an error, and its stack is not
 * news.
 *
 * Now: one WARN line naming the reason (and the SQLSTATE), no stack, and the
 * retries of the same outage at debug. When it connects again it says so, as
 * it always did.
 */

type FakeClient = { connect: jest.Mock; query: jest.Mock; end: jest.Mock; on: jest.Mock };
const clients: FakeClient[] = [];
let connectBehaviour: () => Promise<unknown> = async () => undefined;

jest.mock("pg", () => ({
    Client: jest.fn().mockImplementation(() => {
        const client: FakeClient = {
            connect: jest.fn(() => connectBehaviour()),
            query: jest.fn(async () => ({})),
            end: jest.fn(async () => undefined),
            on: jest.fn()
        };
        clients.push(client);
        return client;
    })
}));

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock("@rebasepro/server", () => ({ logger: mockLogger }));

import { PgNotifyListener } from "../src/services/pg-notify-listener";

function noFreeConnection(): Error {
    return Object.assign(new Error("no free connection: 3 of 3 are in use"), { code: "53300" });
}

const options = {
    connectionString: "postgres://localhost/db",
    channel: "rebase_test",
    onPayload: () => undefined,
    logLabel: "[RealtimeService]",
    reconnectDelayMs: 1000,
    heartbeatIntervalMs: 0,
    retryInitialConnect: true
};

/** Every argument any log call received, flattened to text. */
function logged(mock: jest.Mock): string {
    return mock.mock.calls.map(call => call.map(arg => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ")).join("\n");
}

describe("a LISTEN connection that is retried", () => {
    let listener: PgNotifyListener | undefined;

    beforeEach(() => {
        jest.useFakeTimers();
        clients.length = 0;
        connectBehaviour = async () => undefined;
        jest.clearAllMocks();
    });

    afterEach(async () => {
        await listener?.stop();
        listener = undefined;
        jest.useRealTimers();
    });

    it("says it could not open in one WARN line, with the reason and no stack", async () => {
        connectBehaviour = async () => { throw noFreeConnection(); };

        listener = new PgNotifyListener(options);
        await listener.start();

        expect(mockLogger.error).not.toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
        const [line, data] = mockLogger.warn.mock.calls[0];
        expect(line).toContain("[RealtimeService]");
        expect(line).toContain("no free connection: 3 of 3 are in use");
        expect(line).toContain("53300");
        expect(line).toMatch(/retry/i);
        // One line: nothing structured beside it to carry a stack.
        expect(data).toBeUndefined();
        expect(logged(mockLogger.warn)).not.toMatch(/stack|\n\s+at /);
    });

    it("does not repeat it on every retry of the same outage", async () => {
        connectBehaviour = async () => { throw noFreeConnection(); };

        listener = new PgNotifyListener(options);
        await listener.start();
        for (let attempt = 0; attempt < 3; attempt++) await jest.advanceTimersByTimeAsync(1000);

        expect(clients.length).toBeGreaterThanOrEqual(4);
        expect(mockLogger.error).not.toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it("says when it is listening again, and warns afresh for a later outage", async () => {
        connectBehaviour = async () => { throw noFreeConnection(); };
        listener = new PgNotifyListener({ ...options, onReconnect: () => undefined });
        await listener.start();

        connectBehaviour = async () => undefined;
        await jest.advanceTimersByTimeAsync(1000);
        expect(listener.status().connected).toBe(true);
        expect(logged(mockLogger.warn)).toMatch(/reconnected/);
        mockLogger.warn.mockClear();

        // The connection drops, and cannot be reopened.
        connectBehaviour = async () => { throw noFreeConnection(); };
        const adopted = clients[clients.length - 1];
        const onEnd = adopted.on.mock.calls.find(([event]) => event === "end")?.[1] as (() => void);
        onEnd();
        await jest.advanceTimersByTimeAsync(1000);
        await jest.advanceTimersByTimeAsync(1000);

        expect(mockLogger.error).not.toHaveBeenCalled();
        const couldNotOpen = mockLogger.warn.mock.calls.filter(([line]) => String(line).includes("no free connection"));
        expect(couldNotOpen).toHaveLength(1);
    });
});
