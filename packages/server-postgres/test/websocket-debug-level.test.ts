import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { Server } from "http";

let mockWssInstance: any = null;

jest.mock("ws", () => ({
    WebSocketServer: jest.fn().mockImplementation(() => {
        const instance = { on: jest.fn() };
        mockWssInstance = instance;
        return instance;
    }),
    WebSocket: jest.fn()
}));

/**
 * The REAL logger, deliberately — the claim under test is the level gate, and a
 * stubbed `logger.debug` would report only that something was called.
 */
jest.mock("@rebasepro/server", () => ({
    extractUserFromToken: () => ({ uid: "u-1", roles: [] }),
    safeCompare: (a: string, b: string) => a === b,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    logger: require("../../server/src/utils/logger").logger,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolveRequireAuth: require("../../server/src/auth/require-auth").resolveRequireAuth,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    assertWriteRequestValid: require("../../server/src/api/rest/write-validation").assertWriteRequestValid,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ApiError: require("../../server/src/api/errors").ApiError
}));

import { createPostgresWebSocket } from "../src/websocket";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { setLogLevel } from "../../server/src/utils/logger";

/**
 * The socket's debug tracing obeys the one level system.
 *
 * It used to be `console.debug`, gated on `NODE_ENV` alone. While
 * `utils/logging.ts` existed it was muted anyway — that module reassigned
 * `console.debug` to a no-op whenever the level was above debug — so deleting
 * that second, competing level system unmuted it: `LOG_LEVEL=warn`, the line
 * the scaffold's own `.env.example` ships, silenced every structured line and
 * left these ones printing.
 */
describe("the websocket's debug tracing is level-gated", () => {
    let written: string[];
    let consoleDebug: jest.SpiedFunction<typeof console.debug>;

    const connect = () => {
        const connectionCallback = mockWssInstance.on.mock.calls.find(
            (call: any[]) => call[0] === "connection"
        )[1];
        connectionCallback({ on: jest.fn(), send: jest.fn() } as never);
    };

    const boot = () => {
        mockWssInstance = null;
        createPostgresWebSocket(
            {} as Server,
            { addClient: jest.fn(), registerDataDriverSubscription: jest.fn() } as unknown as RealtimeService,
            { key: "postgres", initialised: true, admin: {} } as unknown as PostgresBackendDriver,
            { requireAuth: true, jwtSecret: "test-jwt-secret" }
        );
    };

    beforeEach(() => {
        written = [];
        const capture = (...args: unknown[]) => { written.push(args.join(" ")); };
        jest.spyOn(console, "log").mockImplementation(capture);
        jest.spyOn(console, "warn").mockImplementation(capture);
        jest.spyOn(console, "error").mockImplementation(capture);
        consoleDebug = jest.spyOn(console, "debug").mockImplementation(capture);
        jest.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => { written.push(String(chunk)); return true; }) as never);
    });

    afterEach(() => {
        setLogLevel(undefined);
        jest.restoreAllMocks();
    });

    it("writes nothing at LOG_LEVEL=warn", () => {
        setLogLevel("warn");
        boot();
        connect();

        expect(written).toEqual([]);
    });

    it("still traces at LOG_LEVEL=debug", () => {
        setLogLevel("debug");
        boot();
        connect();

        expect(written.join("\n")).toContain("WebSocket client connected");
    });

    it("never reaches console.debug, at any level", () => {
        // The class, not the instance: a `console.*` call from server code is
        // outside the level system and outside the redactor.
        setLogLevel("debug");
        boot();
        connect();

        expect(consoleDebug).not.toHaveBeenCalled();
    });
});
