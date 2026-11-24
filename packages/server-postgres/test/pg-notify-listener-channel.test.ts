import { describe, it, expect, jest, beforeEach } from "@jest/globals";

type Handler = (...args: unknown[]) => void;
const handlers: Record<string, Handler> = {};

jest.mock("pg", () => ({
    Client: jest.fn().mockImplementation(() => ({
        connect: jest.fn<(...args: unknown[]) => unknown>(async () => undefined),
        query: jest.fn<(...args: unknown[]) => unknown>(async () => ({})),
        end: jest.fn<(...args: unknown[]) => unknown>(async () => undefined),
        on: jest.fn((event: string, handler: Handler) => { handlers[event] = handler; })
    }))
}));

jest.mock("@rebasepro/server", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

import { PgNotifyListener } from "../src/services/pg-notify-listener";

/**
 * A LISTEN connection hears only its own channel.
 *
 * On the managed development database (PGlite) every client connection is
 * multiplexed onto one backend, so a connection that ran `LISTEN rebase_cdc`
 * is also handed every other channel some other connection listens on. The
 * first boot of every new project printed "[CDC] Dropping unparseable change
 * notification." ten times: the payloads were the DDL event trigger's
 * `{"tag":"CREATE TABLE",…}` on `rebase_schema_changed`, read as row changes.
 * Postgres itself never does this, which is why nothing caught it.
 */
describe("PgNotifyListener channel filtering", () => {
    beforeEach(() => {
        for (const key of Object.keys(handlers)) delete handlers[key];
    });

    it("ignores a notification on another channel", async () => {
        const payloads: string[] = [];
        const listener = new PgNotifyListener({
            connectionString: "postgres://localhost/db",
            channel: "rebase_cdc",
            onPayload: (payload) => { payloads.push(payload); },
            logLabel: "[TEST]"
        });
        await listener.start();

        handlers.notification({ channel: "rebase_schema_changed", payload: "{\"tag\":\"CREATE TABLE\"}" });
        handlers.notification({ channel: "rebase_cdc", payload: "{\"table\":\"posts\"}" });
        await Promise.resolve();

        expect(payloads).toEqual(["{\"table\":\"posts\"}"]);
        await listener.stop();
    });

    it("matches the channel as Postgres folds an unquoted identifier", async () => {
        const payloads: string[] = [];
        const listener = new PgNotifyListener({
            connectionString: "postgres://localhost/db",
            channel: "Rebase_Jobs",
            onPayload: (payload) => { payloads.push(payload); },
            logLabel: "[TEST]"
        });
        await listener.start();

        // `LISTEN Rebase_Jobs` listens on `rebase_jobs`, and that is the name
        // the server reports.
        handlers.notification({ channel: "rebase_jobs", payload: "x" });
        await Promise.resolve();

        expect(payloads).toEqual(["x"]);
        await listener.stop();
    });
});
