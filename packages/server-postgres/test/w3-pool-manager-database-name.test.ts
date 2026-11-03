/**
 * The main database's name is the database's, not its spelling in a URL.
 *
 * `postgresql://…/caf%C3%A9` names the database `café`: the URL percent-encodes
 * it, and pg decodes it to connect. `defaultDatabaseName` kept the encoded
 * spelling, so the branch service copied `TEMPLATE "caf%C3%A9"` — a database
 * that does not exist — and a pool asked for by the real name (a branch's
 * recorded parent) was a second pool beside the first, which disconnecting
 * by that name left open, blocking the copy.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { DatabasePoolManager } from "../src/databasePoolManager";

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

jest.mock("drizzle-orm/node-postgres", () => ({
    drizzle: jest.fn().mockImplementation(() => ({ __drizzleMock: true }))
}));

jest.mock("@rebasepro/server", () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockPoolInstances = [];
});

describe("the main database's name", () => {
    it("is decoded as pg decodes it", () => {
        expect(new DatabasePoolManager("postgresql://u:p@localhost:5432/caf%C3%A9").defaultDatabaseName).toBe("café");
        expect(new DatabasePoolManager("postgresql://u:p@localhost:5432/my%20app").defaultDatabaseName).toBe("my app");
        expect(new DatabasePoolManager("postgresql://u:p@localhost:5432/café").defaultDatabaseName).toBe("café");
    });

    it("names one pool, whichever way it is asked for", async () => {
        const manager = new DatabasePoolManager("postgresql://u:p@localhost:5432/caf%C3%A9");
        expect(manager.getPool(manager.defaultDatabaseName)).toBe(manager.getPool("café"));

        await manager.disconnectDatabase("café");
        expect(manager.hasPool(manager.defaultDatabaseName)).toBe(false);
    });

    it("reaches the database it names", () => {
        const { Pool } = jest.requireMock("pg") as { Pool: jest.Mock };
        new DatabasePoolManager("postgresql://u:p@localhost:5432/caf%C3%A9").getPool("café");
        const { connectionString } = Pool.mock.calls[0][0] as { connectionString: string };
        // pg reads the database as `decodeURI(pathname)` (pg-connection-string).
        expect(decodeURI(new URL(connectionString).pathname.slice(1))).toBe("café");
    });
});
