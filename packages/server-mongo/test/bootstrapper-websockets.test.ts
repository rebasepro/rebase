/**
 * `MongoBootstrapper.initializeWebsockets` and the AuthAdapter.
 *
 * `BackendBootstrapper` declares five parameters here and `init.ts` passes
 * five; this bootstrapper accepted four. JavaScript drops the surplus argument
 * silently and TypeScript has nothing to object to, because each side is
 * individually consistent — so the socket never saw the adapter, and every
 * realtime AUTHENTICATE on an adapter-backed deployment failed with "Invalid or
 * expired token".
 */

import type { Db, MongoClient } from "mongodb";
import type { AuthAdapter, DataDriver, RealtimeProvider } from "@rebasepro/types";

const createMongoWebSocket = jest.fn();
jest.mock("../src/websocket", () => ({
    createMongoWebSocket: (...args: unknown[]) => createMongoWebSocket(...args)
}));

import { createMongoBootstrapper } from "../src/MongoBootstrapper";

describe("MongoBootstrapper.initializeWebsockets", () => {
    beforeEach(() => createMongoWebSocket.mockClear());

    it("forwards the AuthAdapter it is handed", async () => {
        const bootstrapper = createMongoBootstrapper({ connection: {} as Db,
client: {} as MongoClient });
        const authAdapter = { verifyRequest: jest.fn() } as unknown as AuthAdapter;

        await bootstrapper.initializeWebsockets!(
            {},
            {} as RealtimeProvider,
            {} as DataDriver,
            { jwtSecret: "s" },
            authAdapter
        );

        expect(createMongoWebSocket).toHaveBeenCalledTimes(1);
        expect(createMongoWebSocket.mock.calls[0][5]).toBe(authAdapter);
    });

    it("still works when no adapter is configured", async () => {
        const bootstrapper = createMongoBootstrapper({ connection: {} as Db,
client: {} as MongoClient });

        await bootstrapper.initializeWebsockets!({}, {} as RealtimeProvider, {} as DataDriver, { jwtSecret: "s" });

        expect(createMongoWebSocket.mock.calls[0][5]).toBeUndefined();
    });
});
