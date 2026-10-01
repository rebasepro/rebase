import { createHealthCheck, REALTIME_LISTENER_GRACE_MS } from "../src/init/health";
import type { DataDriver, RealtimeListenerHealth, RealtimeProvider } from "@rebasepro/types";

/**
 * `/health` says when realtime has stopped receiving changes.
 *
 * A LISTEN connection that went half-open lost every external and
 * cross-instance change while writes through this pod still looked live, and
 * `/health` said OK — so nothing routed around it. A connection that is down
 * and being replaced is reported; one still down past the grace window fails
 * the check.
 */
const driver = { admin: { executeSql: async () => ({ rows: [] }) } } as unknown as DataDriver;

const provider = (listeners: RealtimeListenerHealth[]) =>
    ({ health: () => listeners }) as unknown as RealtimeProvider;

describe("createHealthCheck with realtime listeners", () => {
    it("is healthy, and says nothing more, while every listener is connected", async () => {
        const result = await createHealthCheck(driver, undefined, [provider([{ name: "cdc", connected: true }])])();
        expect(result).toEqual({ healthy: true, latencyMs: expect.any(Number) });
    });

    it("reports a listener that just dropped, without failing over a reconnect", async () => {
        const listeners = [{ name: "cdc", connected: false, downSince: Date.now() - 2000 }];
        const result = await createHealthCheck(driver, undefined, [provider(listeners)])();
        expect(result).toMatchObject({ healthy: true, details: { realtime: { listeners } } });
    });

    it("fails on a listener down past the grace window", async () => {
        const listeners = [{ name: "cdc", connected: false, downSince: Date.now() - REALTIME_LISTENER_GRACE_MS - 1000 }];
        const result = await createHealthCheck(driver, undefined, [provider(listeners)])();
        expect(result).toMatchObject({ healthy: false, details: { realtime: { listeners } } });
    });
});
