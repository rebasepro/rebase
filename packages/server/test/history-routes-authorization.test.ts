/**
 * Who is allowed to read a row's previous values.
 *
 * `historyService` reads `rebase.entity_history` on the privileged handle the
 * bootstrapper built, and it has to: history is one table shadowing every
 * audited collection, so it cannot carry their row policies —
 * `ensure-history-table` even revokes it from `rebase_user` for exactly that
 * reason. That revoke closes the SQL path and leaves the HTTP one wide open,
 * because the route reads on the privileged handle regardless.
 *
 * So the route's own checks are the entire access-control model here, the same
 * way `storageAuthorize` is for storage. Every collection route next door goes
 * through `RestApiGenerator.getScopedDriver` (which refuses to fall back to the
 * unscoped driver, in a comment naming this exact hazard) and
 * `enforceApiKeyPermission`. This one, mounted onto the same router one line
 * above them in `init.ts`, went through neither.
 *
 * The fixtures below model the two mechanisms faithfully rather than asserting
 * on the implementation:
 *
 *  - `historyService` answers by table+id alone, with no notion of a caller —
 *    which is what `HistoryService` actually does;
 *  - the request-scoped driver's `fetchOne` returns `undefined` for rows RLS
 *    would deny, which is what an RLS-bound read does.
 *
 * A route that never consults the second cannot help but leak, and that is the
 * shape each test pins.
 */

import { Hono } from "hono";
import { createHistoryRoutes, type HistoryService } from "../src/history/history-routes";
import type { BackendCollectionRegistry } from "../src/collections/BackendCollectionRegistry";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";

function collection(slug: string, history = true): CollectionConfig {
    return {
        name: slug,
        slug,
        history,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

/** Alice's row. Bob is the caller throughout, and RLS hides it from him. */
const ALICES_SECRET = { title: "alice's private draft", salary: 145000 };

function mount(options: {
    /** Ids this caller's RLS context can see. Anything else reads as denied. */
    visibleToCaller: string[];
    /** Present only for API-key requests. */
    apiKey?: { id: string; permissions: unknown };
    /** Omit to model a request that reached the route with no scoped driver. */
    withScopedDriver?: boolean;
}) {
    const { visibleToCaller, apiKey, withScopedDriver = true } = options;

    // The privileged reader: table + id, no caller, no policies. What
    // `HistoryService` is.
    const fetchHistory = jest.fn(async (_table: string, _id: string) => ({
        data: [{ id: "h1", action: "update", values: ALICES_SECRET, previous_values: null }],
        total: 1
    }));
    const fetchHistoryEntry = jest.fn(async () => ({
        id: "h1",
        entity_id: "post-alice",
        table_name: "posts",
        values: ALICES_SECRET
    }));
    const historyService = { fetchHistory, fetchHistoryEntry } as unknown as HistoryService;

    // The request-scoped, RLS-bound driver. A denied row is `undefined`, which
    // is what a `SELECT` under a row policy that excludes it returns.
    const fetchOne = jest.fn(async ({ id }: { id: string | number }) =>
        (visibleToCaller.includes(String(id)) ? { id, title: "visible" } : undefined));
    const save = jest.fn().mockResolvedValue({ id: "post-alice", ...ALICES_SECRET });
    const scopedDriver = { fetchOne, save } as unknown as DataDriver;

    const registry = {
        getCollections: () => [collection("posts"), collection("comments")]
    } as unknown as BackendCollectionRegistry;

    const app = new Hono<HonoEnv>();
    app.use("/*", async (c, next) => {
        if (withScopedDriver) c.set("driver", scopedDriver);
        if (apiKey) c.set("apiKey", apiKey as never);
        await next();
    });
    app.route("/api/data", createHistoryRoutes({
        historyService,
        registry,
        // The unscoped driver the route is handed at construction. Nothing
        // should ever reach it for a read.
        driver: { fetchOne: jest.fn(), save: jest.fn() } as unknown as DataDriver
    }));

    return { app, fetchHistory, fetchHistoryEntry, fetchOne, save };
}

const listHistory = (app: Hono<HonoEnv>, path: string) => app.request(path);
const revert = (app: Hono<HonoEnv>, path: string) => app.request(path, { method: "POST" });

describe("GET /:slug/:id/history — RLS", () => {
    it("does not serve the history of a row the caller cannot read", async () => {
        // Bob asks for Alice's row. He can read his own and nothing else.
        const { app, fetchHistory } = mount({ visibleToCaller: ["post-bob"] });

        const res = await listHistory(app, "/api/data/posts/post-alice/history");

        expect(res.status).toBe(404);
        const body = JSON.stringify(await res.json());
        expect(body).not.toContain("alice's private draft");
        expect(body).not.toContain("145000");
        // And the privileged read never happened at all — authorization comes
        // first, so a denied caller costs a policy-checked lookup, not a scan
        // of the audit table.
        expect(fetchHistory).not.toHaveBeenCalled();
    });

    it("404s rather than 403s, so the answer does not confirm the row exists", async () => {
        // A row that exists but is hidden by RLS, and a row that does not exist,
        // must be indistinguishable. They differ only in the id the caller
        // themselves put in the URL — everything the *server* contributes is
        // identical, which is the property that matters.
        const { app } = mount({ visibleToCaller: [] });

        const denied = await listHistory(app, "/api/data/posts/post-alice/history");
        const absent = await listHistory(app, "/api/data/posts/no-such-row/history");

        const shape = async (res: Response, id: string) => ({
            status: res.status,
            body: JSON.stringify(await res.json()).split(id).join("<id>")
        });

        expect(await shape(denied, "post-alice")).toEqual(await shape(absent, "no-such-row"));
        expect(denied.status).toBe(404);
    });

    it("serves the history of a row the caller can read", async () => {
        const { app, fetchHistory, fetchOne } = mount({ visibleToCaller: ["post-bob"] });

        const res = await listHistory(app, "/api/data/posts/post-bob/history");

        expect(res.status).toBe(200);
        expect((await res.json() as { data: unknown[] }).data).toHaveLength(1);
        expect(fetchOne).toHaveBeenCalledWith(expect.objectContaining({ path: "posts", id: "post-bob" }));
        expect(fetchHistory).toHaveBeenCalled();
    });

    it("checks the row through the request-scoped driver, never the unscoped one", async () => {
        // The distinction the whole finding turns on: the driver passed at
        // construction is privileged, and using it to answer "may this caller
        // read this row?" answers "may the server?" instead.
        const { app, fetchOne } = mount({ visibleToCaller: ["post-bob"] });

        await listHistory(app, "/api/data/posts/post-bob/history");

        expect(fetchOne).toHaveBeenCalledTimes(1);
    });

    it("refuses when no scoped driver is set rather than falling back", async () => {
        const { app, fetchHistory } = mount({ visibleToCaller: ["post-alice"], withScopedDriver: false });

        const res = await listHistory(app, "/api/data/posts/post-alice/history");

        expect(res.status).toBe(500);
        expect(fetchHistory).not.toHaveBeenCalled();
    });
});

describe("GET /:slug/:id/history — API key permissions", () => {
    it("refuses a key with no permission for the collection", async () => {
        const { app, fetchHistory } = mount({
            visibleToCaller: ["post-alice"],
            apiKey: { id: "k1", permissions: [{ collection: "comments", operations: ["read"] }] }
        });

        const res = await listHistory(app, "/api/data/posts/post-alice/history");

        expect(res.status).toBe(403);
        expect(fetchHistory).not.toHaveBeenCalled();
    });

    it("allows a key scoped to this collection", async () => {
        const { app } = mount({
            visibleToCaller: ["post-alice"],
            apiKey: { id: "k1", permissions: [{ collection: "posts", operations: ["read"] }] }
        });

        expect((await listHistory(app, "/api/data/posts/post-alice/history")).status).toBe(200);
    });

    it("refuses a read-only key attempting a revert", async () => {
        // The permission check follows the request's method. A revert is a
        // write to the collection, and a key that may only read it must not be
        // able to reach one through the history route.
        const { app, save } = mount({
            visibleToCaller: ["post-alice"],
            apiKey: { id: "k1", permissions: [{ collection: "posts", operations: ["read"] }] }
        });

        const res = await revert(app, "/api/data/posts/post-alice/history/h1/revert");

        expect(res.status).toBe(403);
        expect(save).not.toHaveBeenCalled();
    });
});

describe("POST /:slug/:id/history/:historyId/revert — RLS", () => {
    it("does not look up a history entry for a row the caller cannot read", async () => {
        // The lookup is by history id alone across every table, so even the
        // distinction between "no such entry" and "not yours" is a read.
        const { app, fetchHistoryEntry, save } = mount({ visibleToCaller: ["post-bob"] });

        const res = await revert(app, "/api/data/posts/post-alice/history/h1/revert");

        expect(res.status).toBe(404);
        expect(fetchHistoryEntry).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it("still reverts for a caller who can read the row", async () => {
        const { app, save } = mount({ visibleToCaller: ["post-alice"] });

        const res = await revert(app, "/api/data/posts/post-alice/history/h1/revert");

        expect(res.status).toBe(200);
        expect(save).toHaveBeenCalledWith(expect.objectContaining({
            path: "posts",
            id: "post-alice",
            status: "existing"
        }));
    });
});

describe("GET /:slug/:id/history — pagination window", () => {
    it("refuses a limit above this route's ceiling instead of serving a shorter page", async () => {
        // It used to clamp 1000 → 100 and report 100 in `meta`, which is
        // self-consistent and still wrong: the caller asked for a thousand
        // entries, got a hundred, and nothing distinguished that from a row
        // with only a hundred revisions. Refuse, and name the ceiling.
        const { app, fetchHistory } = mount({ visibleToCaller: ["post-bob"] });

        const res = await listHistory(app, "/api/data/posts/post-bob/history?limit=1000");

        expect(res.status).toBe(400);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("INVALID_LIMIT");
        expect(body.error.message).toContain("100");
        // Refused before the read: nothing was fetched for a request that failed.
        expect(fetchHistory).not.toHaveBeenCalled();
    });

    it("reports the offset that was applied, not the one asked for", async () => {
        // `meta` is what a client paginates on. Echoing a requested offset the
        // route did not honour makes it advance past rows it never received.
        const { app, fetchHistory } = mount({ visibleToCaller: ["post-bob"] });

        const res = await listHistory(app, "/api/data/posts/post-bob/history?limit=100&offset=-5");

        const meta = (await res.json() as { meta: { limit: number; offset: number } }).meta;
        expect(meta.limit).toBe(100);
        expect(meta.offset).toBe(0);
        expect(fetchHistory).toHaveBeenCalledWith("posts", "post-bob", { limit: 100, offset: 0 });
    });

    it("still defaults an absent limit rather than reading every revision", async () => {
        const { app, fetchHistory } = mount({ visibleToCaller: ["post-bob"] });

        const res = await listHistory(app, "/api/data/posts/post-bob/history");

        expect(res.status).toBe(200);
        expect(fetchHistory).toHaveBeenCalledWith("posts", "post-bob", { limit: 20, offset: 0 });
    });
});
