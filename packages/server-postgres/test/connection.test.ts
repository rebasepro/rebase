import { Pool, PoolConfig } from "pg";

// ── Capture every Pool instantiation so we can inspect config & event handlers ──
interface MockPoolInstance {
    config: PoolConfig;
    handlers: Record<string, ((...args: unknown[]) => void)[]>;
    on: jest.Mock;
    end: jest.Mock;
}

const poolInstances: MockPoolInstance[] = [];

jest.mock("pg", () => {
    const actual = jest.requireActual<typeof import("pg")>("pg");
    const MockPool = jest.fn().mockImplementation((config: PoolConfig) => {
        const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
        const instance: MockPoolInstance = {
            config,
            handlers,
            on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
                handlers[event] = handlers[event] || [];
                handlers[event].push(handler);
                return instance;
            }),
            end: jest.fn().mockResolvedValue(undefined)
        };
        poolInstances.push(instance);
        return instance;
    });
    return { ...actual, Pool: MockPool };
});

// ── Stub drizzle – we only care that it is called, not what it returns ──
const mockDrizzle = jest.fn().mockReturnValue({ __drizzle: true });
jest.mock("drizzle-orm/node-postgres", () => ({
    drizzle: mockDrizzle
}));

// ── Stub the logger so it doesn't try to write anywhere ──
jest.mock("@rebasepro/server", () => ({
    logger: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

import {
    createPostgresDatabaseConnection,
    createDirectDatabaseConnection,
    createReadReplicaConnection
} from "../src/connection";
import { logger } from "@rebasepro/server";

// ── Helpers ──────────────────────────────────────────────────────────────────────
function lastPool(): MockPoolInstance {
    return poolInstances[poolInstances.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
    poolInstances.length = 0;
    jest.clearAllMocks();
});

describe("createPostgresDatabaseConnection", () => {
    const connStr = "postgresql://user:pass@localhost:5432/mydb";

    it("returns an object with db, pool, and connectionString", () => {
        const result = createPostgresDatabaseConnection(connStr);

        expect(result).toHaveProperty("db");
        expect(result).toHaveProperty("pool");
        expect(result).toHaveProperty("connectionString", connStr);
    });

    it("creates a Pool with the provided connectionString", () => {
        createPostgresDatabaseConnection(connStr);

        expect(Pool).toHaveBeenCalledTimes(1);
        expect(lastPool().config.connectionString).toBe(connStr);
    });

    it("applies default pool config values", () => {
        createPostgresDatabaseConnection(connStr);
        const cfg = lastPool().config;

        expect(cfg.max).toBe(20);
        expect(cfg.idleTimeoutMillis).toBe(30_000);
        expect(cfg.connectionTimeoutMillis).toBe(10_000);
        // query_timeout (client) must stay above statement_timeout (server) so
        // the server abort always wins — see the DEFAULT_POOL comment.
        expect(cfg.query_timeout).toBe(60_000);
        expect(cfg.statement_timeout).toBe(30_000);
        expect(cfg.keepAlive).toBe(true);
        expect(cfg.keepAliveInitialDelayMillis).toBe(0);
    });

    it("merges custom poolConfig over defaults", () => {
        createPostgresDatabaseConnection(connStr, undefined, {
            max: 50,
            idleTimeoutMillis: 60_000
        });
        const cfg = lastPool().config;

        expect(cfg.max).toBe(50);
        expect(cfg.idleTimeoutMillis).toBe(60_000);
        // other defaults are preserved
        expect(cfg.connectionTimeoutMillis).toBe(10_000);
        expect(cfg.keepAlive).toBe(true);
    });

    it("registers an error handler on the pool", () => {
        createPostgresDatabaseConnection(connStr);
        const pool = lastPool();

        expect(pool.on).toHaveBeenCalledWith("error", expect.any(Function));
        expect(pool.handlers["error"]).toHaveLength(1);
    });

    it("error handler logs unexpected pool errors", () => {
        createPostgresDatabaseConnection(connStr);
        const handler = lastPool().handlers["error"][0];

        handler(new Error("something broke"));

        expect(logger.error).toHaveBeenCalledWith(
            "[pg-pool] Unexpected pool error",
            expect.objectContaining({ detail: "something broke" })
        );
    });

    it("error handler logs additional warning for ETIMEDOUT errors", () => {
        createPostgresDatabaseConnection(connStr);
        const handler = lastPool().handlers["error"][0];

        handler(new Error("connect ETIMEDOUT 1.2.3.4:5432"));

        expect(logger.error).toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            "[pg-pool] Connection timeout detected — pool will auto-retry"
        );
    });

    it("calls drizzle with the pool when no schema is provided", () => {
        createPostgresDatabaseConnection(connStr);

        expect(mockDrizzle).toHaveBeenCalledWith(lastPool());
    });

    it("calls drizzle with pool and schema when schema is provided", () => {
        const schema = { users: {} };
        createPostgresDatabaseConnection(connStr, schema);

        expect(mockDrizzle).toHaveBeenCalledWith(lastPool(), { schema });
    });

    it("passes schema as Record<string, unknown>", () => {
        const schema: Record<string, unknown> = { orders: {}, products: {} };
        createPostgresDatabaseConnection(connStr, schema);

        expect(mockDrizzle).toHaveBeenCalledWith(lastPool(), { schema });
    });
});

describe("createDirectDatabaseConnection", () => {
    const connStr = "postgresql://user:pass@localhost:5432/direct_db";

    it("returns an object with db, pool, and connectionString", () => {
        const result = createDirectDatabaseConnection(connStr);

        expect(result).toHaveProperty("db");
        expect(result).toHaveProperty("pool");
        expect(result).toHaveProperty("connectionString", connStr);
    });

    it("uses a smaller default max of 5 for the direct pool", () => {
        createDirectDatabaseConnection(connStr);
        const cfg = lastPool().config;

        expect(cfg.max).toBe(5);
    });

    it("allows overriding the default max on the direct pool", () => {
        createDirectDatabaseConnection(connStr, undefined, { max: 3 });
        const cfg = lastPool().config;

        expect(cfg.max).toBe(3);
    });

    it("registers an error handler on the pool", () => {
        createDirectDatabaseConnection(connStr);
        const pool = lastPool();

        expect(pool.on).toHaveBeenCalledWith("error", expect.any(Function));
        expect(pool.handlers["error"]).toHaveLength(1);
    });

    it("error handler logs with [pg-direct-pool] prefix", () => {
        createDirectDatabaseConnection(connStr);
        const handler = lastPool().handlers["error"][0];

        handler(new Error("direct pool error"));

        expect(logger.error).toHaveBeenCalledWith(
            "[pg-direct-pool] Unexpected pool error",
            expect.objectContaining({ detail: "direct pool error" })
        );
    });

    it("calls drizzle without schema when none is given", () => {
        createDirectDatabaseConnection(connStr);

        expect(mockDrizzle).toHaveBeenCalledWith(lastPool());
    });

    it("calls drizzle with schema when given", () => {
        const schema = { sessions: {} };
        createDirectDatabaseConnection(connStr, schema);

        expect(mockDrizzle).toHaveBeenCalledWith(lastPool(), { schema });
    });
});

describe("createReadReplicaConnection", () => {
    const connStr = "postgresql://readonly:pass@replica:5432/replica_db";

    it("returns an object with db, pool, and connectionString", () => {
        const result = createReadReplicaConnection(connStr);

        expect(result).toHaveProperty("db");
        expect(result).toHaveProperty("pool");
        expect(result).toHaveProperty("connectionString", connStr);
    });

    it("uses a default max of 10 for the replica pool", () => {
        createReadReplicaConnection(connStr);
        const cfg = lastPool().config;

        expect(cfg.max).toBe(10);
    });

    it("allows overriding the default max on the replica pool", () => {
        createReadReplicaConnection(connStr, undefined, { max: 25 });

        expect(lastPool().config.max).toBe(25);
    });

    it("registers an error handler on the pool", () => {
        createReadReplicaConnection(connStr);
        const pool = lastPool();

        expect(pool.on).toHaveBeenCalledWith("error", expect.any(Function));
        expect(pool.handlers["error"]).toHaveLength(1);
    });

    it("error handler logs with [pg-replica-pool] prefix", () => {
        createReadReplicaConnection(connStr);
        const handler = lastPool().handlers["error"][0];

        handler(new Error("replica error"));

        expect(logger.error).toHaveBeenCalledWith(
            "[pg-replica-pool] Unexpected pool error",
            expect.objectContaining({ detail: "replica error" })
        );
    });

    it("inherits remaining default pool settings", () => {
        createReadReplicaConnection(connStr);
        const cfg = lastPool().config;

        expect(cfg.idleTimeoutMillis).toBe(30_000);
        expect(cfg.connectionTimeoutMillis).toBe(10_000);
        expect(cfg.keepAlive).toBe(true);
        expect(cfg.keepAliveInitialDelayMillis).toBe(0);
    });

    it("calls drizzle without schema when none is given", () => {
        createReadReplicaConnection(connStr);

        expect(mockDrizzle).toHaveBeenCalledWith(lastPool());
    });

    it("calls drizzle with schema when given", () => {
        const schema = { analytics: {} };
        createReadReplicaConnection(connStr, schema);

        expect(mockDrizzle).toHaveBeenCalledWith(lastPool(), { schema });
    });
});
