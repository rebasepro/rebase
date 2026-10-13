/**
 * E2E: a row's live frames carry the `ETag` its `GET` answers, and a `PATCH`
 * that sends one back answers with the next.
 *
 * The admin form edits a row it holds through `listenById`, and the offline
 * queue replays edits of rows it read the same way. Neither could make a
 * conditional write: `If-Match` is honoured by `PATCH`, but the socket frame
 * the row arrived in carried no version, so the only tag a client ever held
 * was from a `GET`. A `subscribe_one` that asks with `etag: true` now gets one
 * on every frame — the same tag `GET /:id` hands out for the same row, with
 * or without `include` — and a client that does not ask gets the frame it
 * always got.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import type { CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { createPostgresWebSocket } from "../../src/websocket.js";
import { RestApiGenerator } from "../../../server/src/api/rest/api-generator.js";
import { errorHandler } from "../../../server/src/api/errors.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { configureJwt, generateAccessToken } from "../../../server/src/auth/jwt.js";

const peopleTable = pgTable("people", { id: varchar("id").primaryKey(), name: varchar("name") });
const notesTable = pgTable("notes", {
    id: varchar("id").primaryKey(),
    title: varchar("title"),
    authorId: varchar("author_id"),
    due: timestamp("due", { withTimezone: true, mode: "string" })
});
const docsTable = pgTable("docs", {
    id: varchar("id").primaryKey(),
    title: varchar("title"),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
});

const peopleCollection = {
    slug: "people",
    name: "People",
    table: "people",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        name: { name: "Name", type: "string" }
    }
} as unknown as CollectionConfig;

/**
 * No `on_update` date, so the tag is a hash of the row — the strict case. `due`
 * is a date, so a door that hashed the admin view model (`{ __type: "date" }`)
 * rather than the REST row would hand out a tag no write matches.
 */
const notesCollection = {
    slug: "notes",
    name: "Notes",
    table: "notes",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        author: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: () => peopleCollection } },
        due: { name: "Due", type: "date" }
    },
    // What a reader is served is what a tag is a hash of: a field this adds is
    // in the GET's tag, so it has to be in the frame's and the PATCH's too.
    callbacks: {
        afterRead: ({ row }: { row: Record<string, unknown> }) => ({ ...row, shout: String(row.title).toUpperCase() })
    }
} as unknown as CollectionConfig;

/** Versioned by an `on_update` date: the tag is that column's value. */
const docsCollection = {
    slug: "docs",
    name: "Docs",
    table: "docs",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        updated_at: { name: "Updated", type: "date", autoValue: "on_update" }
    }
} as unknown as CollectionConfig;

const USER = { uid: "etag-user", roles: ["admin"] };

type Frame = Record<string, unknown> & { type: string; subscriptionId?: string; row?: Record<string, unknown> | null; etag?: string };

describe("ETags on live row frames and PATCH (E2E)", () => {
    let container: PgContainer;
    let pool: pg.Pool;
    let observer: pg.Client;
    let realtime: RealtimeService;
    let server: Server;
    let socket: NodeWebSocket;
    const app = new Hono<HonoEnv>();
    const frames: Frame[] = [];

    const rest = (path: string, init?: RequestInit) => app.request(`/api/data${path}`, init);
    const getTag = async (id: string, slug = "notes") => {
        const res = await rest(`/${slug}/${id}`);
        expect(res.status).toBe(200);
        return res.headers.get("ETag");
    };
    const patch = (id: string, body: Record<string, unknown>, ifMatch?: string, slug = "notes") => rest(`/${slug}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(ifMatch ? { "If-Match": ifMatch } : {}) },
        body: JSON.stringify(body)
    });

    /** The `n`th `single_update` frame for a subscription, waited for. */
    async function nthFrame(subscriptionId: string, n: number): Promise<Frame> {
        for (let waited = 0; waited < 10_000; waited += 25) {
            const matching = frames.filter((f) => f.type === "single_update" && f.subscriptionId === subscriptionId);
            if (matching.length >= n) return matching[n - 1];
            await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(`no frame #${n} for ${subscriptionId}; got ${JSON.stringify(frames)}`);
    }

    function subscribeOne(subscriptionId: string, payload: Record<string, unknown>) {
        socket.send(JSON.stringify({ type: "subscribe_one", requestId: subscriptionId, payload: { ...payload, subscriptionId } }));
    }

    beforeAll(async () => {
        configureJwt({ secret: "realtime-etag-e2e-secret-0123456789abcdef", accessExpiresIn: "1h" });
        container = await startPgContainer();
        observer = new pg.Client({ connectionString: container.connectionString });
        await observer.connect();
        await observer.query(`
            CREATE TABLE public.people (id varchar PRIMARY KEY, name varchar);
            INSERT INTO public.people (id, name) VALUES ('p-1', 'Ada');
            CREATE TABLE public.notes (id varchar PRIMARY KEY, title varchar, author_id varchar REFERENCES public.people(id), due timestamptz);
            INSERT INTO public.notes (id, title, author_id, due) VALUES
                ('n-1', 'first', 'p-1', '2026-01-02T03:04:05Z'), ('n-2', 'second', 'p-1', NULL),
                ('n-3', 'third', 'p-1', NULL), ('n-4', 'fourth', 'p-1', NULL);
            CREATE TABLE public.docs (id varchar PRIMARY KEY, title varchar, updated_at timestamptz);
            INSERT INTO public.docs (id, title, updated_at) VALUES ('d-1', 'versioned', '2026-01-01T00:00:00Z');
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([peopleCollection, notesCollection, docsCollection]);
        registry.registerTable(peopleTable, "people");
        registry.registerTable(notesTable, "notes");
        registry.registerTable(docsTable, "docs");
        realtime = new RealtimeService(db as never, registry);
        const driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);

        app.onError(errorHandler);
        app.use("/api/data/*", async (c, next) => {
            c.set("user", USER as never);
            c.set("driver", await driver.withAuth(USER as never));
            await next();
        });
        app.route("/api/data", new RestApiGenerator([peopleCollection, notesCollection, docsCollection], driver).generateRoutes());

        server = createServer();
        createPostgresWebSocket(server, realtime, driver, { requireAuth: true });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        socket = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        await new Promise<void>((resolve, reject) => {
            socket.once("open", () => resolve());
            socket.once("error", reject);
        });
        socket.on("message", (data) => frames.push(JSON.parse(String(data)) as Frame));
        socket.send(JSON.stringify({ type: "AUTHENTICATE", requestId: "auth", payload: { token: await generateAccessToken(USER.uid, USER.roles) } }));
        for (let waited = 0; !frames.some((f) => f.type === "AUTH_SUCCESS"); waited += 25) {
            if (waited > 10_000) throw new Error(`no AUTH_SUCCESS: ${JSON.stringify(frames)}`);
            await new Promise((r) => setTimeout(r, 25));
        }
    }, 120_000);

    afterAll(async () => {
        socket?.close();
        await realtime?.destroy();
        await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
        await observer?.end();
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("a frame's tag is the GET's, and a PATCH sending it is accepted and moves it", async () => {
        subscribeOne("s-1", { path: "notes", id: "n-1", etag: true });
        const first = await nthFrame("s-1", 1);
        expect(first.row).toMatchObject({ id: "n-1", title: "first", shout: "FIRST" });
        expect(first.etag).toBe(await getTag("n-1"));

        const write = await patch("n-1", { title: "edited" }, first.etag);
        expect(write.status).toBe(200);
        // The written version's tag, so the next conditional write can chain.
        expect(await write.json()).toMatchObject({ title: "edited", shout: "EDITED" });
        const written = write.headers.get("ETag");
        expect(written).toBe(await getTag("n-1"));

        const second = await nthFrame("s-1", 2);
        expect(second.row).toMatchObject({ title: "edited" });
        expect(second.etag).toBe(written);
        expect(second.etag).not.toBe(first.etag);

        // The tag the first frame carried no longer names the row.
        const stale = await patch("n-1", { title: "lost update" }, first.etag);
        expect(stale.status).toBe(412);
    });

    it("a versioned collection's frame carries the version's tag, and it moves with each write", async () => {
        subscribeOne("s-5", { path: "docs", id: "d-1", etag: true });
        const first = await nthFrame("s-5", 1);
        expect(first.etag).toBe(await getTag("d-1", "docs"));
        const write = await patch("d-1", { title: "v2" }, first.etag, "docs");
        expect(write.status).toBe(200);
        expect(write.headers.get("ETag")).toBe(await getTag("d-1", "docs"));
        const second = await nthFrame("s-5", 2);
        expect(second.etag).toBe(write.headers.get("ETag"));
        expect(second.etag).not.toBe(first.etag);
    });

    it("a frame that loads relations carries the tag of the row without them", async () => {
        subscribeOne("s-2", { path: "notes", id: "n-2", include: ["author"], etag: true });
        const frame = await nthFrame("s-2", 1);
        expect(frame.row).toMatchObject({ id: "n-2" });
        expect(frame.etag).toBe(await getTag("n-2"));
        expect((await patch("n-2", { title: "ok" }, frame.etag)).status).toBe(200);
    });

    it("a subscriber that does not ask gets the frame it always got", async () => {
        subscribeOne("s-3", { path: "notes", id: "n-3" });
        const frame = await nthFrame("s-3", 1);
        expect(frame.row).toMatchObject({ id: "n-3" });
        expect(Object.keys(frame).sort()).toEqual(["row", "subscriptionId", "type"]);
    });

    it("a deleted row's frame carries no tag", async () => {
        subscribeOne("s-4", { path: "notes", id: "n-4", etag: true });
        expect((await nthFrame("s-4", 1)).etag).toBeTypeOf("string");
        expect((await rest("/notes/n-4", { method: "DELETE" })).status).toBe(204);
        const gone = await nthFrame("s-4", 2);
        expect(gone.row).toBeNull();
        expect(gone).not.toHaveProperty("etag");
    });

    it("a PATCH without If-Match is unconditional, and still names the version it wrote", async () => {
        const res = await patch("n-3", { title: "plain" });
        expect(res.status).toBe(200);
        expect(res.headers.get("ETag")).toBe(await getTag("n-3"));
    });
});
