/**
 * E2E: an in-process listener's first delivery is the same read as every
 * delivery after it.
 *
 * `driver.listenCollection` / `listenOne` registered the subscription with the
 * realtime service and then ran the first fetch themselves, outside it. Every
 * refresh after a change runs in the service, as the subscriber, through a
 * delivery slot. The first fetch did none of that:
 *
 * - **Scope.** A listener on `driver.withAuth(user)` read its first rows through
 *   the base driver — the owner connection, no RLS — and was handed rows its
 *   policies deny. The user's context was stamped onto the subscription only
 *   afterwards, and only the refreshes read it (without `isAnonymous`).
 * - **Order.** It took no delivery slot, so a slow first fetch landed over a
 *   newer refresh, and after an unsubscribe.
 * - **Deletions.** `listenOne` dropped a `null`, so a deleted or missing row
 *   never reached the listener, which kept the last row it had.
 * - **The query.** The listener hand-listed its fields and dropped `logical`,
 *   so an `or(...)` listener was handed every row.
 *
 * The `afterRead` below can hold a read open, which is how the tests choose the
 * interleaving: every read of `notes`, first fetch or refresh, runs it.
 *
 * Requires Docker. The socket path's equivalents are in `rls-enforcement` and
 * `test/realtime-delivery-order.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, DataDriver, ListenCollectionProps, User } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { ensureAppRole, REBASE_USER_ROLE } from "../../src/security/rls-enforcement.js";

const tasksTable = pgTable("tasks", {
    id: varchar("id").primaryKey(),
    title: varchar("title"),
    owner_id: varchar("owner_id")
});

const tasksCollection = {
    slug: "tasks",
    name: "Tasks",
    table: "tasks",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        owner_id: { name: "Owner", type: "string" }
    }
} as unknown as CollectionConfig;

const notesTable = pgTable("notes", {
    id: varchar("id").primaryKey(),
    title: varchar("title")
});

type Deferred = { promise: Promise<void>; resolve: () => void };
const defer = (): Deferred => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => { resolve = res; });
    return { promise, resolve };
};

/**
 * The next read of `notes` to reach `afterRead` waits here until released.
 * `reached` resolves once it is waiting, so its rows have already been read.
 */
let hold: { reached: Deferred; release: Deferred } | undefined;

const notesCollection = {
    slug: "notes",
    name: "Notes",
    table: "notes",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" }
    },
    callbacks: {
        afterRead: async ({ row }: { row: Record<string, unknown> }) => {
            const held = hold;
            hold = undefined;
            if (held) {
                held.reached.resolve();
                await held.release.promise;
            }
            return row;
        }
    }
} as unknown as CollectionConfig;

/** Hold the next read of `notes` open. */
function holdNextRead() {
    const held = { reached: defer(), release: defer() };
    hold = held;
    return { reached: held.reached.promise, release: () => held.release.resolve() };
}

type Heard = { data: unknown } | { error: Error };

/**
 * Deliveries in arrival order. `next()` rejects when none arrives in time;
 * `nothingWithin()` rejects when one does.
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
                    reject(new Error(`Nothing arrived for ${label}`));
                }, 5_000);
                waiting.push(waiter);
            });
        },
        async nothingWithin(ms: number): Promise<void> {
            await new Promise(r => setTimeout(r, ms));
            if (queued.length > 0) {
                throw new Error(`${label} was handed ${JSON.stringify(queued)}`);
            }
        }
    };
}

/** The ids a collection delivery carried, sorted. */
const idsIn = (heard: Heard): string[] => {
    if (!("data" in heard) || !Array.isArray(heard.data)) {
        throw new Error(`Expected rows, got ${JSON.stringify(heard)}`);
    }
    return heard.data.map((row: Record<string, unknown>) => String(row.id)).sort();
};

const titlesIn = (heard: Heard): string[] => {
    if (!("data" in heard) || !Array.isArray(heard.data)) {
        throw new Error(`Expected rows, got ${JSON.stringify(heard)}`);
    }
    return heard.data.map((row: Record<string, unknown>) => String(row.title));
};

const person = (uid: string, isAnonymous = false): User => ({
    uid,
    displayName: null,
    email: null,
    photoURL: null,
    providerId: isAnonymous ? "anonymous" : "password",
    isAnonymous,
    roles: []
});

describe("an in-process listener's first delivery (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    let pool: pg.Pool;
    let realtime: RealtimeService;
    let driver: PostgresBackendDriver;
    const unsubscribes: (() => void)[] = [];

    function listenCollection(
        on: DataDriver,
        path: string,
        query: Partial<ListenCollectionProps> = {}
    ) {
        if (!on.listenCollection) throw new Error("This driver cannot listen");
        const heard = inbox(`the listener on ${path}`);
        const unsubscribe = on.listenCollection({
            ...query,
            path,
            onUpdate: (rows) => heard.push({ data: rows }),
            onError: (error) => heard.push({ error })
        });
        unsubscribes.push(unsubscribe);
        return Object.assign(heard, { unsubscribe });
    }

    function listenOne(on: DataDriver, path: string, id: string) {
        if (!on.listenOne) throw new Error("This driver cannot listen");
        const heard = inbox(`the listener on ${path}/${id}`);
        const unsubscribe = on.listenOne({
            path,
            id,
            onUpdate: (row) => heard.push({ data: row }),
            onError: (error) => heard.push({ error })
        });
        unsubscribes.push(unsubscribe);
        return Object.assign(heard, { unsubscribe });
    }

    /** What `driver.save` / `driver.delete` send after their commit. */
    const notify = (path: string, id: string, row: Record<string, unknown> | null) =>
        realtime.notifyUpdate(path, id, row, undefined, false);

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

        // The container logs in as a superuser, the worst case the bootstrapper
        // meets: without the role switch, RLS binds nothing on this connection.
        await observer.query(`
            CREATE SCHEMA IF NOT EXISTS auth;
            CREATE OR REPLACE FUNCTION auth.uid() RETURNS text AS $$
                SELECT NULLIF(current_setting('app.uid', true), '');
            $$ LANGUAGE sql STABLE;

            -- Each user reads their own tasks, and a guest reads none: the
            -- second clause is what 'isAnonymous' reaches.
            CREATE TABLE public.tasks (id varchar PRIMARY KEY, title varchar, owner_id varchar);
            ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
            CREATE POLICY tasks_own ON public.tasks FOR SELECT TO public
                USING (owner_id = auth.uid()
                       AND coalesce(current_setting('app.is_anonymous', true), 'false') <> 'true');
            INSERT INTO public.tasks (id, title, owner_id) VALUES
                ('t-a', 'A task', 'user-a'),
                ('t-b', 'B task', 'user-b'),
                ('t-g', 'Guest task', 'guest-1');

            -- No RLS: readable by anyone, so what these tests see is decided by
            -- ordering and query shape alone.
            CREATE TABLE public.notes (id varchar PRIMARY KEY, title varchar);
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);

        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([tasksCollection, notesCollection]);
        registry.registerTable(tasksTable, "tasks");
        registry.registerTable(notesTable, "notes");

        realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);

        // Provisioned and switched on exactly as the bootstrapper does.
        await ensureAppRole(async (text) => (await pool.query(text)).rows as Record<string, unknown>[], ["public", "auth"]);
        driver.rlsUserRole = REBASE_USER_ROLE;
        realtime.rlsUserRole = REBASE_USER_ROLE;
    }, 120_000);

    afterEach(async () => {
        for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
        hold = undefined;
        await observer.query("DELETE FROM public.notes");
    });

    afterAll(async () => {
        await realtime?.destroy();
        await observer?.end();
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    describe("scope", () => {
        it("hands a collection listener only the rows its user may read", async () => {
            const heard = listenCollection(await driver.withAuth(person("user-a")), "tasks");

            expect(idsIn(await heard.next())).toEqual(["t-a"]);
        });

        it("does not hand a row listener a row its user may not read", async () => {
            const heard = listenOne(await driver.withAuth(person("user-a")), "tasks", "t-b");

            expect(await heard.next()).toEqual({ data: null });
        });

        it("reads as a guest on the first delivery and on every refresh", async () => {
            const heard = listenCollection(await driver.withAuth(person("guest-1", true)), "tasks");
            expect(idsIn(await heard.next())).toEqual([]);

            await observer.query("UPDATE public.tasks SET title = 'Guest task, edited' WHERE id = 't-g'");
            await notify("tasks", "t-g", { id: "t-g" });

            expect(idsIn(await heard.next())).toEqual([]);
        });

        it("serves a listener on the base driver the same rows first and after a change", async () => {
            const heard = listenCollection(driver, "tasks");
            const first = idsIn(await heard.next());

            await observer.query("UPDATE public.tasks SET title = 'A task, edited' WHERE id = 't-a'");
            await notify("tasks", "t-a", { id: "t-a" });

            expect(idsIn(await heard.next())).toEqual(first);
        });
    });

    describe("order", () => {
        it("does not let a slow first fetch overwrite a newer refresh", async () => {
            await observer.query("INSERT INTO public.notes (id, title) VALUES ('n-1', 'draft')");
            const firstRead = holdNextRead();

            const heard = listenCollection(driver, "notes");
            await firstRead.reached;

            await observer.query("UPDATE public.notes SET title = 'final' WHERE id = 'n-1'");
            await notify("notes", "n-1", { id: "n-1", title: "final" });
            expect(titlesIn(await heard.next())).toEqual(["final"]);

            firstRead.release();
            await heard.nothingWithin(1_000);
        });

        it("does not let a slow first fetch overwrite a newer refresh of a row", async () => {
            await observer.query("INSERT INTO public.notes (id, title) VALUES ('n-2', 'draft')");
            const firstRead = holdNextRead();

            const heard = listenOne(driver, "notes", "n-2");
            await firstRead.reached;

            await observer.query("UPDATE public.notes SET title = 'final' WHERE id = 'n-2'");
            await notify("notes", "n-2", { id: "n-2", title: "final" });
            expect(await heard.next()).toEqual({ data: expect.objectContaining({ title: "final" }) });

            firstRead.release();
            await heard.nothingWithin(1_000);
        });

        it("delivers nothing once the listener has unsubscribed", async () => {
            await observer.query("INSERT INTO public.notes (id, title) VALUES ('n-3', 'draft')");
            const firstRead = holdNextRead();

            const heard = listenCollection(driver, "notes");
            await firstRead.reached;
            heard.unsubscribe();

            firstRead.release();
            await heard.nothingWithin(1_000);
        });
    });

    describe("deletions", () => {
        it("tells a row listener its row was deleted", async () => {
            await observer.query("INSERT INTO public.notes (id, title) VALUES ('n-4', 'doomed')");
            const heard = listenOne(driver, "notes", "n-4");
            expect(await heard.next()).toEqual({ data: expect.objectContaining({ id: "n-4" }) });

            await observer.query("DELETE FROM public.notes WHERE id = 'n-4'");
            await notify("notes", "n-4", null);

            expect(await heard.next()).toEqual({ data: null });
        });

        it("tells a row listener the row is not there", async () => {
            const heard = listenOne(driver, "notes", "n-never");

            expect(await heard.next()).toEqual({ data: null });
        });
    });

    describe("the query", () => {
        it("applies an or(...) group to the first delivery and to every refresh", async () => {
            await observer.query(`INSERT INTO public.notes (id, title) VALUES
                ('n-5', 'alpha'), ('n-6', 'beta'), ('n-7', 'gamma')`);
            const heard = listenCollection(driver, "notes", {
                logical: {
                    type: "or",
                    conditions: [
                        { column: "title", operator: "==", value: "alpha" },
                        { column: "title", operator: "==", value: "gamma" }
                    ]
                }
            });
            expect(idsIn(await heard.next())).toEqual(["n-5", "n-7"]);

            await observer.query("UPDATE public.notes SET title = 'beta, edited' WHERE id = 'n-6'");
            await notify("notes", "n-6", { id: "n-6" });

            expect(idsIn(await heard.next())).toEqual(["n-5", "n-7"]);
        });
    });
});
