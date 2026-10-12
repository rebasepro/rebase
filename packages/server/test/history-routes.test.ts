/**
 * Reverting an entity to a stored version.
 *
 * The interesting part is not the revert itself but its guard: the history id
 * arrives in the URL alongside the entity it is supposed to belong to, and
 * nothing else ties the two together. A history entry carries the full values of
 * some row at some point in time, so accepting one that belongs to a different
 * row — or to a different table that happens to use the same id space — writes
 * that row's contents over the target. The route checks both halves, and this
 * file is what makes the check load-bearing: with `||` mutated to `&&` (reject
 * only when BOTH mismatch) the rest of the suite stayed green.
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

type Entry = {
    id: string;
    entity_id: string;
    table_name: string;
    values: Record<string, unknown>;
};

function mount(entry: Entry | null) {
    const save = jest.fn().mockResolvedValue({ id: "post-1", title: "old title" });

    const historyService: HistoryService = {
        fetchHistory: jest.fn().mockResolvedValue({ data: [], total: 0 }),
        fetchHistoryEntry: jest.fn().mockResolvedValue(entry)
    };

    const registry = {
        getCollections: () => [collection("posts"), collection("comments")]
    } as unknown as BackendCollectionRegistry;

    // The request-scoped, RLS-bound driver every request to this router carries
    // — the auth middleware sets it before the route is ever reached. The route
    // reads the target row through it to decide whether this caller may see the
    // row's history at all; here that caller can see `post-1`, so these tests
    // are about the guard *after* authorization. See
    // `history-routes-authorization.test.ts` for the guard itself.
    const scopedDriver = {
        fetchOne: jest.fn(async ({ id }: { id: string | number }) =>
            (String(id) === "post-1" ? { id, title: "current title" } : undefined)),
        save
    } as unknown as DataDriver;

    const app = new Hono<HonoEnv>();
    app.use("/*", async (c, next) => {
        c.set("driver", scopedDriver);
        await next();
    });
    app.route("/api/data", createHistoryRoutes({
        historyService,
        registry,
        driver: { save: jest.fn() } as unknown as DataDriver
    }));

    return { app, save };
}

const revert = (app: Hono<HonoEnv>, path: string) => app.request(path, { method: "POST" });

describe("POST /:slug/:id/history/:historyId/revert", () => {
    it("reverts when the entry belongs to this entity in this table", async () => {
        const { app, save } = mount({
            id: "h1",
            entity_id: "post-1",
            table_name: "posts",
            values: { title: "old title" }
        });

        const res = await revert(app, "/api/data/posts/post-1/history/h1/revert");

        expect(res.status).toBe(200);
        const body = await res.json() as { meta: { reverted_from: string } };
        expect(body.meta.reverted_from).toBe("h1");
        expect(save).toHaveBeenCalledWith(expect.objectContaining({
            path: "posts",
            id: "post-1",
            values: { title: "old title" },
            status: "existing"
        }));
    });

    it("refuses an entry recorded against a different row", async () => {
        // Same table, someone else's row: reverting would copy that row's
        // values over post-1.
        const { app, save } = mount({
            id: "h1",
            entity_id: "post-999",
            table_name: "posts",
            values: { title: "another author's draft" }
        });

        const res = await revert(app, "/api/data/posts/post-1/history/h1/revert");

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { message: string } }).error.message)
            .toBe("History entry does not belong to this entity");
        expect(save).not.toHaveBeenCalled();
    });

    it("refuses an entry recorded against a different table", async () => {
        // Ids collide across tables far more often than they collide within
        // one — sequential integers, or the same uuid copied around during a
        // migration — so the table name is the half that actually gets hit.
        const { app, save } = mount({
            id: "h1",
            entity_id: "post-1",
            table_name: "comments",
            values: { body: "a comment, about to become a post" }
        });

        const res = await revert(app, "/api/data/posts/post-1/history/h1/revert");

        expect(res.status).toBe(400);
        expect(save).not.toHaveBeenCalled();
    });

    it("404s for a history id that does not exist", async () => {
        const { app, save } = mount(null);

        const res = await revert(app, "/api/data/posts/post-1/history/nope/revert");

        expect(res.status).toBe(404);
        expect(save).not.toHaveBeenCalled();
    });
});

// Calls 2026-10-12 (P7, DD-4c): entries recorded before the delete stopped
// reading the admin view model hold `{ __type: "relation", data: { values } }`
// envelopes carrying the related row. The list serves them as references only.
describe("GET /:slug/:id/history serves relations as references", () => {
    it("drops the related row's values from a legacy entry, in both snapshots", async () => {
        const envelope = { __type: "relation", id: 7, path: "authors", data: { id: 7, path: "authors", values: { email: "a@b.c" } } };
        const historyService: HistoryService = {
            fetchHistory: jest.fn().mockResolvedValue({
                data: [{
                    id: "h1", entity_id: "post-1", table_name: "posts", action: "delete",
                    values: { title: "Hi", author: envelope, readers: [envelope] },
                    previous_values: { author: envelope }
                }],
                total: 1
            }),
            fetchHistoryEntry: jest.fn()
        };
        const registry = { getCollections: () => [collection("posts")] } as unknown as BackendCollectionRegistry;
        const scopedDriver = { fetchOne: jest.fn(async ({ id }: { id: string }) => ({ id })) } as unknown as DataDriver;
        const app = new Hono<HonoEnv>();
        app.use("/*", async (c, next) => { c.set("driver", scopedDriver); await next(); });
        app.route("/api/data", createHistoryRoutes({ historyService, registry, driver: {} as DataDriver }));

        const res = await app.request("/api/data/posts/post-1/history");
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<{ values: Record<string, unknown>; previous_values: Record<string, unknown> }> };
        const ref = { __type: "relation", id: 7, path: "authors" };
        expect(body.data[0].values).toEqual({ title: "Hi", author: ref, readers: [ref] });
        expect(body.data[0].previous_values).toEqual({ author: ref });
        expect(JSON.stringify(body)).not.toContain("a@b.c");
    });
});

// Calls 2026-10-12 (S8): entries recorded before 229f61720 stored the row as
// `afterRead` showed it, computed fields included, and deletes before
// 1bad8f5b5 stored the admin view model, relations as envelopes. A revert to
// one answered 400 VALIDATION_UNKNOWN_FIELDS. It now writes the row's columns,
// drops the rest, and names what it dropped.
describe("reverting an entry that holds keys the row has no column for", () => {
    const authors = { name: "authors", slug: "authors", properties: { id: { type: "number", isId: "increment" } } } as unknown as CollectionConfig;
    const posts = {
        name: "posts",
        slug: "posts",
        history: true,
        properties: {
            id: { type: "string", isId: "uuid" },
            title: { type: "string" },
            author: { type: "relation", relationName: "author" },
            comments: { type: "relation", relationName: "comments" }
        },
        relations: [
            { kind: "belongsTo", relationName: "author", target: () => authors, localKey: "author_id" },
            { kind: "hasMany", relationName: "comments", target: () => authors, foreignKeyOnTarget: "post_id" }
        ]
    } as unknown as CollectionConfig;

    function mountWith(values: Record<string, unknown>) {
        const save = jest.fn().mockResolvedValue({ id: "post-1" });
        const historyService: HistoryService = {
            fetchHistory: jest.fn().mockResolvedValue({ data: [], total: 0 }),
            fetchHistoryEntry: jest.fn().mockResolvedValue({ id: "h1", entity_id: "post-1", table_name: "posts", values })
        };
        const registry = { getCollections: () => [posts] } as unknown as BackendCollectionRegistry;
        // The REST row: its columns, the owning relation as its foreign key.
        const scopedDriver = {
            restFetchService: { fetchOneForRest: jest.fn(async () => ({ id: "post-1", title: "now", authorId: 2 })) },
            save
        } as unknown as DataDriver;
        const app = new Hono<HonoEnv>();
        app.use("/*", async (c, next) => { c.set("driver", scopedDriver); await next(); });
        app.route("/api/data", createHistoryRoutes({ historyService, registry, driver: {} as DataDriver }));
        return { app, save };
    }

    it("drops a computed field and a to-many relation, and says which", async () => {
        const { app, save } = mountWith({
            id: "post-1",
            title: "then",
            authorId: 1,
            displayName: "Then, by Ada",
            comments: [{ __type: "relation", id: 4, path: "comments" }]
        });

        const res = await revert(app, "/api/data/posts/post-1/history/h1/revert");

        expect(res.status).toBe(200);
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ values: { id: "post-1", title: "then", authorId: 1 } }));
        const body = await res.json() as { meta: { reverted_from: string; dropped_fields?: string[] } };
        expect(body.meta).toEqual({ reverted_from: "h1", dropped_fields: ["displayName", "comments"] });
    });

    it("writes an owning relation's envelope back as its foreign key", async () => {
        const { app, save } = mountWith({
            title: "then",
            author: { __type: "relation", id: 1, path: "authors", data: { values: { email: "a@b.c" } } }
        });

        const res = await revert(app, "/api/data/posts/post-1/history/h1/revert");

        expect(res.status).toBe(200);
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ values: { title: "then", authorId: 1 } }));
        const body = await res.json() as { meta: Record<string, unknown> };
        expect(body.meta).toEqual({ reverted_from: "h1" });
    });

    it("leaves an entry of columns as it is", async () => {
        const { app, save } = mountWith({ id: "post-1", title: "then", authorId: null });
        const res = await revert(app, "/api/data/posts/post-1/history/h1/revert");
        expect(res.status).toBe(200);
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ values: { id: "post-1", title: "then", authorId: null } }));
    });
});
