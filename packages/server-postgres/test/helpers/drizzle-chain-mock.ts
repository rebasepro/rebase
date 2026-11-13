import { drizzle } from "drizzle-orm/node-postgres";

/**
 * A drizzle database whose query builder is a chain of `jest.fn()`s.
 *
 * The unit suites over `DataService` / `PersistService` / the relation
 * writers assert on the calls a statement was built from (`db.values` got the
 * serialized row, `db.where` ran, `db.limit(1)`), and answer the terminal call
 * of each statement with rows (`db.limit.mockResolvedValue([...])`). Every
 * builder method returns the database itself, so `db.select().from(t).where(c)`
 * is `db` all the way down and any method can be the one that resolves.
 *
 * The object IS a drizzle database (`drizzle.mock()`, no client) with the
 * builder methods replaced, so it is passed where the code expects a
 * `NodePgDatabase` without a cast, and each replaced method is a `jest.Mock`
 * the test can program and inspect.
 *
 * - `rowCount: 1` — UPDATE and DELETE report how many rows they matched and
 *   the driver refuses a write that matched none.
 * - `transaction(cb)` runs `cb` with the same database.
 * - `awaitable` (default true): awaiting the chain itself (a statement that
 *   ends on `.where()`) resolves to an empty result carrying `rowCount: 1`.
 *   Pass `false` for suites whose terminal call is always programmed.
 */
export function drizzleChainMock({ awaitable = true }: { awaitable?: boolean } = {}) {
    const chain = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        $dynamic: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        // Junction inserts land with ON CONFLICT DO NOTHING so that two
        // editors adding the same link concurrently is a no-op.
        onConflictDoNothing: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        rowCount: 1,
        then: awaitable
            ? jest.fn((resolve: (rows: unknown[]) => unknown) => resolve(Object.assign([], { rowCount: 1 })))
            : undefined,
        transaction: jest.fn()
    };
    const db = Object.assign(drizzle.mock(), chain);
    chain.transaction.mockImplementation((callback: (tx: typeof db) => unknown) => callback(db));
    return db;
}

/** The database {@link drizzleChainMock} returns. */
export type DrizzleChainMock = ReturnType<typeof drizzleChainMock>;
