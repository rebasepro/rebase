/**
 * A schema change at boot waits for a table's lock in one-second slices.
 *
 * A statement waiting for a table lock sits in that table's lock queue, and
 * every query that arrives after it queues behind it. Boot DDL used to wait for
 * as long as the pool's `statement_timeout` allowed — 30 s — so a boot that met
 * a long transaction, a report or a `pg_dump` held every live query on that
 * table for up to 30 s per statement. Now each statement that changes an
 * existing table carries `SET LOCAL lock_timeout`, and a timeout is retried
 * after a pause in which the queue drains.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { ensureCollectionTables, type Queryable } from "../src/schema/ensure-collection-tables";

const posts = {
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        id: { type: "string", isId: "uuid" },
        title: { type: "string" }
    }
} as unknown as CollectionConfig;

const lockTimeout = (): Error => Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });

/** `public.posts` exists with only its key; `fail` decides what a DDL statement does. */
function db(fail: (text: string, n: number) => Error | undefined = () => undefined) {
    const ran: string[] = [];
    const client: Queryable = {
        async query<T>(text: string): Promise<{ rows: T[] }> {
            if (/information_schema\.columns/i.test(text)) {
                return {
                    rows: [{ table_schema: "public", table_name: "posts", column_name: "id", is_nullable: "NO", udt_name: "uuid" }] as unknown as T[]
                };
            }
            if (/pg_class/i.test(text)) return { rows: [{ schema: "public", name: "posts", kind: "r" }] as unknown as T[] };
            if (/^\s*SELECT|EXISTS\(SELECT/i.test(text)) return { rows: [] };
            ran.push(text);
            const error = fail(text, ran.filter(r => r === text).length);
            if (error) throw error;
            return { rows: [] };
        }
    };
    return { client, ran };
}

const addTitle = (ran: string[]) => ran.filter(t => /ADD COLUMN IF NOT EXISTS "title"/.test(t));

describe("boot schema changes and table locks", () => {
    afterEach(() => jest.useRealTimers());

    it("sends a change to an existing table under a lock_timeout", async () => {
        const { client, ran } = db();
        await ensureCollectionTables(client, [posts], undefined, { databaseExtensions: [], lockTimeoutMs: 1000 });

        expect(addTitle(ran)).toEqual([
            "SET LOCAL lock_timeout = '1000ms';\nALTER TABLE \"public\".\"posts\" ADD COLUMN IF NOT EXISTS \"title\" TEXT;"
        ]);
    });

    it("retries a lock timeout until the holder lets go", async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        const { client, ran } = db((text, n) => (/"title"/.test(text) && n <= 2 ? lockTimeout() : undefined));
        const pending = ensureCollectionTables(client, [posts], undefined, { databaseExtensions: [], lockTimeoutMs: 1000 });
        await jest.runAllTimersAsync();
        const outcome = await pending;

        expect(addTitle(ran)).toHaveLength(3);
        expect(outcome.failures).toEqual([]);
    });

    it("fails the boot, saying why, when the lock is held throughout", async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        const { client, ran } = db(text => (/"title"/.test(text) ? lockTimeout() : undefined));
        const pending = ensureCollectionTables(client, [posts], undefined, { databaseExtensions: [], lockTimeoutMs: 1000 });
        const settled = pending.then(() => undefined, (err: Error) => err);
        await jest.runAllTimersAsync();
        const error = await settled;

        expect(error?.message).toMatch(/lock timeout[\s\S]*another session held this table's lock/);
        expect(addTitle(ran)).toHaveLength(10);
    });

    it("leaves statements as they were without a lock budget", async () => {
        // The live schema editor applies changes somebody confirmed, and waits.
        const { client, ran } = db();
        await ensureCollectionTables(client, [posts], undefined, { databaseExtensions: [] });

        expect(addTitle(ran)).toEqual(["ALTER TABLE \"public\".\"posts\" ADD COLUMN IF NOT EXISTS \"title\" TEXT;"]);
    });

    it("sends each statement on its own to a handle that takes one per query", async () => {
        const refusal = Object.assign(new Error("cannot insert multiple commands into a prepared statement"), { code: "42601" });
        const { client, ran } = db(text => (/^SET LOCAL/.test(text) ? refusal : undefined));
        const outcome = await ensureCollectionTables(client, [posts], undefined, { databaseExtensions: [], lockTimeoutMs: 1000 });

        expect(addTitle(ran)).toEqual([
            "SET LOCAL lock_timeout = '1000ms';\nALTER TABLE \"public\".\"posts\" ADD COLUMN IF NOT EXISTS \"title\" TEXT;",
            "ALTER TABLE \"public\".\"posts\" ADD COLUMN IF NOT EXISTS \"title\" TEXT;"
        ]);
        expect(outcome.failures).toEqual([]);
    });
});
