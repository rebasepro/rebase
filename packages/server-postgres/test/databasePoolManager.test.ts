import { DatabasePoolManager } from "../src/databasePoolManager";

// ── Mock pg.Pool ──────────────────────────────────────────────────────────────
// Each `new Pool(...)` call returns a fresh mock with `.end()` and `.on()`.
const createMockPool = () => ({
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    query: jest.fn().mockResolvedValue({ rows: [] })
});

let mockPoolInstances: ReturnType<typeof createMockPool>[] = [];

jest.mock("pg", () => ({
    Pool: jest.fn().mockImplementation(() => {
        const pool = createMockPool();
        mockPoolInstances.push(pool);
        return pool;
    })
}));

// ── Mock drizzle ──────────────────────────────────────────────────────────────
jest.mock("drizzle-orm/node-postgres", () => ({
    drizzle: jest.fn().mockImplementation(() => ({
        __drizzleMock: true
    }))
}));

// ── Mock logger ───────────────────────────────────────────────────────────────
jest.mock("@rebasepro/server", () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

const VALID_CONNECTION_STRING = "postgresql://user:pass@localhost:5432/mydb";

describe("DatabasePoolManager", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPoolInstances = [];
    });

    // ── Constructor ────────────────────────────────────────────────────────
    describe("constructor", () => {
        it("should extract the default database name from the connection string", () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            expect(manager.defaultDatabaseName).toBe("mydb");
        });

        it("should handle connection strings with paths containing multiple segments", () => {
            const manager = new DatabasePoolManager(
                "postgresql://user:pass@localhost:5432/production_db"
            );
            expect(manager.defaultDatabaseName).toBe("production_db");
        });

        it("should throw on an invalid connection string", () => {
            expect(() => new DatabasePoolManager("not-a-url")).toThrow(
                /Invalid adminConnectionString/
            );
        });
    });

    // ── getPool – caching ──────────────────────────────────────────────────
    describe("getPool", () => {
        it("should return the same pool instance for the same database name", () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);

            const pool1 = manager.getPool("testdb");
            const pool2 = manager.getPool("testdb");

            expect(pool1).toBe(pool2);
            // Only one Pool should have been constructed
            expect(mockPoolInstances).toHaveLength(1);
        });

        it("should create separate pool instances for different database names", () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);

            const poolA = manager.getPool("db_alpha");
            const poolB = manager.getPool("db_beta");

            expect(poolA).not.toBe(poolB);
            expect(mockPoolInstances).toHaveLength(2);
        });

        it("should register an error handler on newly created pools", () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getPool("errdb");

            const pool = mockPoolInstances[0];
            expect(pool.on).toHaveBeenCalledWith("error", expect.any(Function));
        });

        it("should build the connection string using the requested database name", () => {
            const { Pool: PoolCtor } = jest.requireMock("pg") as {
                Pool: jest.Mock;
            };

            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getPool("custom_db");

            const configArg = PoolCtor.mock.calls[0][0] as {
                connectionString: string;
            };
            expect(configArg.connectionString).toContain("/custom_db");
        });
    });

    // ── hasPool ────────────────────────────────────────────────────────────
    describe("hasPool", () => {
        it("should return false when no pool exists for the given name", () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            expect(manager.hasPool("nonexistent")).toBe(false);
        });

        it("should return true after a pool has been created", () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getPool("exists");
            expect(manager.hasPool("exists")).toBe(true);
        });
    });

    // ── getDrizzle ─────────────────────────────────────────────────────────
    describe("getDrizzle", () => {
        it("should return a drizzle instance for a given database name", () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            const db = manager.getDrizzle("appdb");

            expect(db).toBeDefined();
            expect((db as unknown as { __drizzleMock: boolean }).__drizzleMock).toBe(true);
        });

        it("should cache and reuse the drizzle instance for the same database name", () => {
            const { drizzle } = jest.requireMock("drizzle-orm/node-postgres") as {
                drizzle: jest.Mock;
            };

            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            const db1 = manager.getDrizzle("cached");
            const db2 = manager.getDrizzle("cached");

            expect(db1).toBe(db2);
            // drizzle() should only have been called once for this database
            expect(drizzle).toHaveBeenCalledTimes(1);
        });

        it("should create different drizzle instances for different databases", () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            const dbA = manager.getDrizzle("first");
            const dbB = manager.getDrizzle("second");

            expect(dbA).not.toBe(dbB);
        });
    });

    // ── disconnectDatabase ─────────────────────────────────────────────────
    describe("disconnectDatabase", () => {
        it("should call pool.end() and remove the pool from cache", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getPool("dropme");

            expect(manager.hasPool("dropme")).toBe(true);
            const pool = mockPoolInstances[0];

            await manager.disconnectDatabase("dropme");

            expect(pool.end).toHaveBeenCalledTimes(1);
            expect(manager.hasPool("dropme")).toBe(false);
        });

        it("should also clear the cached drizzle instance", async () => {
            const { drizzle } = jest.requireMock("drizzle-orm/node-postgres") as {
                drizzle: jest.Mock;
            };

            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getDrizzle("dropme");
            drizzle.mockClear();

            await manager.disconnectDatabase("dropme");

            // After disconnect, getDrizzle should create a fresh instance
            manager.getDrizzle("dropme");
            expect(drizzle).toHaveBeenCalledTimes(1);
        });

        it("should not throw when disconnecting a non-existent database", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            // Should complete without error
            await expect(
                manager.disconnectDatabase("ghost")
            ).resolves.toBeUndefined();
        });
    });

    // ── shutdown ────────────────────────────────────────────────────────────
    describe("shutdown", () => {
        it("should call pool.end() on every cached pool", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getPool("a");
            manager.getPool("b");
            manager.getPool("c");

            await manager.shutdown();

            for (const pool of mockPoolInstances) {
                expect(pool.end).toHaveBeenCalledTimes(1);
            }
        });

        it("should clear the pool cache after shutdown", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getPool("x");
            manager.getPool("y");

            await manager.shutdown();

            expect(manager.hasPool("x")).toBe(false);
            expect(manager.hasPool("y")).toBe(false);
        });

        it("should clear drizzle instances after shutdown", async () => {
            const { drizzle } = jest.requireMock("drizzle-orm/node-postgres") as {
                drizzle: jest.Mock;
            };

            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getDrizzle("z");
            drizzle.mockClear();

            await manager.shutdown();

            // A fresh drizzle call should be needed after shutdown
            manager.getDrizzle("z");
            expect(drizzle).toHaveBeenCalledTimes(1);
        });

        it("should not throw when called on a manager with no pools", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            await expect(manager.shutdown()).resolves.toBeUndefined();
        });

        it("should not throw when called multiple times", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getPool("once");

            await manager.shutdown();
            await expect(manager.shutdown()).resolves.toBeUndefined();
        });

        it("should handle a pool.end() rejection gracefully (Promise.all rejects)", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getPool("bad");

            const pool = mockPoolInstances[0];
            pool.end.mockRejectedValue(new Error("connection already closed"));

            await expect(manager.shutdown()).rejects.toThrow(
                "connection already closed"
            );
        });
    });

    // ── Pool re-creation after disconnect ──────────────────────────────────
    describe("pool re-creation after disconnect", () => {
        it("should create a fresh pool after disconnecting a database", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            const poolBefore = manager.getPool("recreate");

            await manager.disconnectDatabase("recreate");
            const poolAfter = manager.getPool("recreate");

            expect(poolBefore).not.toBe(poolAfter);
            expect(mockPoolInstances).toHaveLength(2);
        });

        it("should create fresh pools after shutdown", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            const poolBefore = manager.getPool("revive");

            await manager.shutdown();
            const poolAfter = manager.getPool("revive");

            expect(poolBefore).not.toBe(poolAfter);
        });
    });

    // ── servesOneDatabase ──────────────────────────────────────────────────
    describe("servesOneDatabase", () => {
        /** What `select version()` returns over the PGlite socket, verbatim. */
        const PGLITE_VERSION =
            "PostgreSQL 18.3 (PGlite 0.5.6) on wasm32-unknown-linux-gnu, compiled by emcc "
            + "(Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.74, 32-bit";

        /** What a stock server returns. Same major version — only the build differs. */
        const POSTGRES_VERSION =
            "PostgreSQL 18.3 (Debian 18.3-1.pgdg120+1) on x86_64-pc-linux-gnu, compiled by gcc "
            + "(Debian 12.2.0-14) 12.2.0, 64-bit";

        it("recognises the managed development database", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getPool("mydb").query = jest.fn().mockResolvedValue({
                rows: [{ version: PGLITE_VERSION }]
            }) as never;

            await expect(manager.servesOneDatabase()).resolves.toBe(true);
        });

        it("does not mistake a real Postgres of the same major version for it", async () => {
            // The version *number* is identical — PGlite is a wasm build of 18.3
            // — so anything keying off the major would refuse branching on every
            // stock server.
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            manager.getPool("mydb").query = jest.fn().mockResolvedValue({
                rows: [{ version: POSTGRES_VERSION }]
            }) as never;

            await expect(manager.servesOneDatabase()).resolves.toBe(false);
        });

        it("asks once and remembers — a live connection cannot change engine", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            const query = jest.fn().mockResolvedValue({ rows: [{ version: PGLITE_VERSION }] });
            manager.getPool("mydb").query = query as never;

            await manager.servesOneDatabase();
            await manager.servesOneDatabase();

            // A `PostgresBackendDriver` — which builds a `BranchService` — is
            // constructed per transaction, so an uncached probe would be a round
            // trip on every request that touches branching.
            expect(query).toHaveBeenCalledTimes(1);
        });

        it("fails open, and does not cache the failure", async () => {
            const manager = new DatabasePoolManager(VALID_CONNECTION_STRING);
            const query = jest.fn()
                .mockRejectedValueOnce(new Error("connection terminated"))
                .mockResolvedValue({ rows: [{ version: PGLITE_VERSION }] });
            manager.getPool("mydb").query = query as never;

            // A server that cannot answer is not one we can conclude anything
            // about: refusing would break branching on a healthy Postgres that
            // blinked.
            await expect(manager.servesOneDatabase()).resolves.toBe(false);
            // …and the wrong answer must not be the permanent one.
            await expect(manager.servesOneDatabase()).resolves.toBe(true);
        });
    });
});
