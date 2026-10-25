/**
 * `backend.shutdown()` stops the shared rate-limit store's sweep timer.
 *
 * `REBASE_RATE_LIMIT_STORE=sql` makes the backend create a store whose timer
 * deletes expired buckets every few minutes. Shutdown left it running: unref'd,
 * so the process could exit, but an embedder that closed the pool once
 * `shutdown()` resolved had its next tick run against a closed pool. A store the
 * caller passed in is the caller's, and is left alone.
 */
import { createServer } from "http";
import { Hono } from "hono";
import type { BackendBootstrapper, InitializedDriver } from "@rebasepro/types";
import { initializeRebaseBackend } from "../src/init";

const dispose = jest.fn();
jest.mock("../src/auth/sql-rate-limit-store", () => ({
    ...jest.requireActual("../src/auth/sql-rate-limit-store"),
    createSqlRateLimitStore: () => ({
        ensureTable: async () => true,
        hit: async () => ({ allowed: true, remaining: 1, retryAfterMs: 0 }),
        reset: async () => undefined,
        dispose
    })
}));

function bootstrapper(): BackendBootstrapper {
    const driver = {
        fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
        fetchEntity: async () => undefined,
        saveEntity: async () => ({}),
        deleteEntity: async () => undefined,
        countCollection: async () => 0,
        checkUniqueField: async () => true,
        healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
        admin: { executeSql: async () => [] }
    };
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: [], internals: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    } as unknown as BackendBootstrapper;
}

const saved = process.env.REBASE_RATE_LIMIT_STORE;
afterEach(() => {
    if (saved === undefined) delete process.env.REBASE_RATE_LIMIT_STORE;
    else process.env.REBASE_RATE_LIMIT_STORE = saved;
    dispose.mockClear();
});

async function boot(over: Record<string, unknown> = {}) {
    return initializeRebaseBackend({
        app: new Hono() as never,
        server: createServer(),
        collections: [],
        cronPersistence: false,
        bootstrappers: [bootstrapper()],
        ...over
    } as never);
}

it("disposes the SQL rate-limit store it created on backend.shutdown()", async () => {
    process.env.REBASE_RATE_LIMIT_STORE = "sql";
    const backend = await boot();
    expect(dispose).not.toHaveBeenCalled();
    await backend.shutdown(1_000);
    expect(dispose).toHaveBeenCalledTimes(1);
});

it("leaves a store the caller passed in to the caller", async () => {
    const own = { hit: async () => ({ allowed: true, remaining: 1, retryAfterMs: 0 }), reset: async () => undefined, dispose: jest.fn() };
    const backend = await boot({ rateLimit: { store: own } });
    await backend.shutdown(1_000);
    expect(own.dispose).not.toHaveBeenCalled();
});
