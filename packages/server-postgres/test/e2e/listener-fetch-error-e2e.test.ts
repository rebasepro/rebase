/**
 * E2E: an in-process listener is told when a refetch fails.
 *
 * `driver.listenCollection({ onError })` reported a failed *initial* fetch and
 * nothing after it. A refetch after a change runs in the realtime service's
 * debounced driver refetch, whose `catch` only logged, so the listener kept its
 * last rows as if they were current and was never told the read now fails. The
 * driver never gave the realtime service its `onError` at all.
 *
 * In-process code is trusted, so the listener gets the error as thrown: here
 * the `RebaseApiError` an `afterRead` throws, the same instance, not the
 * masked text a socket frame carries.
 *
 * A real Postgres, the real driver running the real `afterRead` in the real
 * refetch. The MongoDB half is
 * `packages/server-mongo/test/realtime-subscription-error.test.ts`.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import { RebaseApiError, type CollectionConfig, type DataDriver, type User } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

const contractsTable = pgTable("contracts", {
    id: varchar("id").primaryKey(),
    title: varchar("title")
});

/** One instance, thrown on every sealed read, so `toBe` can check it arrived as thrown. */
const contractSealed = new RebaseApiError("This contract is sealed.", { status: 403, code: "FORBIDDEN" });

/** Readable until sealed, so the listener loads and a refetch then fails. */
let sealed = false;

const contractsCollection = {
    slug: "contracts",
    name: "Contracts",
    table: "contracts",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" }
    },
    callbacks: {
        afterRead: ({ row }: { row: Record<string, unknown> }) => {
            if (sealed) throw contractSealed;
            return row;
        }
    }
} as unknown as CollectionConfig;

/** What a listener was handed, in the order it was handed it. */
type Heard = { data: unknown } | { error: Error };

/** The error it was handed, or what it got instead, for `toBe` to name. */
const errorIn = (heard: Heard) => ("error" in heard ? heard.error : heard);

/**
 * Deliveries in arrival order. `next()` rejects when none arrives in time,
 * which is what a listener left uninformed looks like from outside.
 */
function inbox(label: string) {
    const queued: Heard[] = [];
    const waiting: ((item: Heard) => void)[] = [];
    return {
        push(item: Heard) {
            const waiter = waiting.shift();
            if (waiter) waiter(item);
            else queued.push(item);
        },
        next(): Promise<Heard> {
            const item = queued.shift();
            if (item) return Promise.resolve(item);
            return new Promise<Heard>((resolve, reject) => {
                const waiter = (arrived: Heard) => {
                    clearTimeout(timer);
                    resolve(arrived);
                };
                const timer = setTimeout(() => {
                    waiting.splice(waiting.indexOf(waiter), 1);
                    reject(new Error(`Nothing arrived for ${label}: the listener was never told`));
                }, 5_000);
                waiting.push(waiter);
            });
        }
    };
}

describe("an in-process listener is told when a refetch fails (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    let pool: pg.Pool;
    let realtime: RealtimeService;
    let driver: PostgresBackendDriver;
    const unsubscribes: (() => void)[] = [];

    function listenCollection(on: DataDriver) {
        if (!on.listenCollection) throw new Error("This driver cannot listen");
        const heard = inbox("the collection listener");
        unsubscribes.push(on.listenCollection({
            path: "contracts",
            onUpdate: (rows) => heard.push({ data: rows }),
            onError: (error) => heard.push({ error })
        }));
        return heard;
    }

    function listenOne(id: string) {
        const heard = inbox(`the listener on contracts/${id}`);
        unsubscribes.push(driver.listenOne({
            path: "contracts",
            id,
            onUpdate: (row) => heard.push({ data: row }),
            onError: (error) => heard.push({ error })
        }));
        return heard;
    }

    async function insert(id: string, title: string) {
        await observer.query("INSERT INTO public.contracts (id, title) VALUES ($1, $2)", [id, title]);
    }

    /** What `driver.save` sends after its commit. */
    const notifyChanged = (id: string, title: string) =>
        realtime.notifyUpdate("contracts", id, { id, title }, undefined, false);

    beforeAll(async () => {
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                observer = new pg.Client({ connectionString: container.connectionString });
                await observer.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        await observer.query("CREATE TABLE public.contracts (id varchar PRIMARY KEY, title varchar)");

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);

        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([contractsCollection]);
        registry.registerTable(contractsTable, "contracts");

        realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
    }, 120_000);

    afterEach(() => {
        for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    });

    afterAll(async () => {
        await realtime?.destroy();
        await observer?.end();
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("tells a collection listener, with the error as thrown", async () => {
        sealed = false;
        await insert("c-1", "Supply agreement");

        const heard = listenCollection(driver);
        expect(await heard.next()).toEqual({
            data: expect.arrayContaining([expect.objectContaining({ id: "c-1", title: "Supply agreement" })])
        });

        sealed = true;
        await notifyChanged("c-1", "Supply agreement");

        expect(errorIn(await heard.next())).toBe(contractSealed);
    });

    it("tells a row listener, with the error as thrown", async () => {
        sealed = false;
        await insert("c-2", "Framework agreement");

        const heard = listenOne("c-2");
        expect(await heard.next()).toEqual({ data: expect.objectContaining({ id: "c-2" }) });

        sealed = true;
        await notifyChanged("c-2", "Framework agreement");

        expect(errorIn(await heard.next())).toBe(contractSealed);
    });

    it("tells a listener on a scoped driver too", async () => {
        sealed = false;
        await insert("c-3", "Service agreement");
        const officer: User = {
            uid: "officer-7",
            displayName: null,
            email: null,
            photoURL: null,
            providerId: "password",
            isAnonymous: false,
            roles: []
        };

        const heard = listenCollection(await driver.withAuth(officer));
        expect(await heard.next()).toEqual({
            data: expect.arrayContaining([expect.objectContaining({ id: "c-3" })])
        });

        sealed = true;
        await notifyChanged("c-3", "Service agreement");

        expect(errorIn(await heard.next())).toBe(contractSealed);
    });

    it("still reports a failed initial fetch, as it did before", async () => {
        sealed = true;

        const heard = listenCollection(driver);

        expect(errorIn(await heard.next())).toBe(contractSealed);
    });
});
